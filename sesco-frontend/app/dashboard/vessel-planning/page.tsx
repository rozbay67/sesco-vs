'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

// Statuses shown in vessel planning
const VP_STATUSES = new Set([
  'LAYCAN_NOMINATED', 'LAYCAN_REVISED', 'VESSEL_NOMINATED',
  // backward compat
  'FIXTURED',
])

// Status options in vessel planning dropdown (with display labels)
const VP_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'LAYCAN_NOMINATED', label: 'Pending' },
  { value: 'LAYCAN_REVISED',   label: 'Pending (Revised)' },
  { value: 'VESSEL_NOMINATED', label: 'Vessel Nominated' },
  { value: 'VESSEL_ACCEPTED',  label: 'Vessel Accepted' },
  { value: 'VESSEL_REJECTED',  label: 'Vessel Rejected' },
]

const STATUS_COLOR: Record<string, string> = {
  PLANNED:                'bg-gray-600 text-gray-100',
  CONFIRMED_FOR_FIXTURE:  'bg-blue-700 text-blue-100',
  LAYCAN_NOMINATED:       'bg-yellow-500 text-yellow-900',
  LAYCAN_REVISED:         'bg-yellow-600 text-yellow-100',
  VESSEL_NOMINATED:       'bg-orange-500 text-orange-100',
  VESSEL_ACCEPTED:        'bg-green-700 text-green-100',
  VESSEL_REJECTED:        'bg-red-600 text-red-100',
  LOADED:                 'bg-purple-600 text-purple-100',
  DISCHARGED:             'bg-indigo-500 text-indigo-100',
  COMPLETED:              'bg-green-800 text-green-100',
  CANCELLED:              'bg-red-700 text-red-100',
  // backward compat
  OPEN_FOR_FIXTURE:       'bg-blue-700 text-blue-100',
  FIXTURED:               'bg-green-700 text-green-100',
  LOADING:                'bg-orange-500 text-orange-100',
  SAILED:                 'bg-purple-600 text-purple-100',
  DISCHARGING:            'bg-orange-400 text-orange-900',
}

// Required vessel docs for VESSEL_ACCEPTED
const REQUIRED_VESSEL_DOCS = ['Q88', 'P_AND_I_CERT', 'CLASS_CERT', 'GEAR_CERT', 'REGISTRY_CERT']
const VESSEL_DOC_LABEL: Record<string, string> = {
  Q88: 'Q88', P_AND_I_CERT: 'P&I Cert', CLASS_CERT: 'Class Cert',
  GEAR_CERT: 'Gear Cert', REGISTRY_CERT: 'Registry Cert',
}

type CargoItem = { quantity_mt: number; cargo_types: { cargo_name: string } | { cargo_name: string }[] | null }

type VesselPlan = {
  id: string
  cargo_ref: string
  planning_stage: string
  status: string
  vessel_name: string | null
  vessel_id: string | null
  owner_operator: string | null
  charterer: string | null
  shipper: string | null
  consignee: string | null
  source_origin: string | null
  cargo_description: string | null
  quantity_mt: number
  load_port: string
  discharge_port: string
  laycan_start: string | null
  laycan_end: string | null
  discharge_eta: string | null
  cp_ref: string | null
  freight_rate: number | null
  load_rate: number | null
  disch_rate: number | null
  estimated_demurrage_exposure: number | null
  load_agent: string | null
  discharge_agent: string | null
  etd: string | null
  ets: string | null
  notes: string | null
  cargo_plan_items: CargoItem[]
}

type EditForm = {
  vessel_name: string
  owner_operator: string
  charterer: string
  shipper: string
  consignee: string
  load_port: string
  discharge_port: string
  laycan_start: string
  laycan_end: string
  discharge_eta: string
  etd: string
  ets: string
  cp_ref: string
  freight_rate: string
  load_rate: string
  disch_rate: string
  estimated_demurrage_exposure: string
  load_agent: string
  discharge_agent: string
  status: string
  notes: string
}

type NomForm = {
  vessel_name: string
  imo_number: string; mmsi: string; call_sign: string; flag: string
  year_built: string; vessel_type: string; dwt: string
  loa: string; beam: string; max_draft: string
  holds_count: string; gear_description: string
  class_society: string; p_and_i_club: string
}

function blankNomForm(vesselName = ''): NomForm {
  return {
    vessel_name: vesselName,
    imo_number: '', mmsi: '', call_sign: '', flag: '',
    year_built: '', vessel_type: '', dwt: '',
    loa: '', beam: '', max_draft: '',
    holds_count: '', gear_description: '',
    class_society: '', p_and_i_club: '',
  }
}

function blankForm(p?: VesselPlan): EditForm {
  return {
    vessel_name:                  p?.vessel_name    || '',
    owner_operator:               p?.owner_operator || '',
    charterer:                    p?.charterer      || '',
    shipper:                      p?.shipper        || '',
    consignee:                    p?.consignee      || '',
    load_port:                    p?.load_port      || '',
    discharge_port:               p?.discharge_port || '',
    laycan_start:                 p?.laycan_start   || '',
    laycan_end:                   p?.laycan_end     || '',
    discharge_eta:                p?.discharge_eta ? p.discharge_eta.split('T')[0] : '',
    etd:                          p?.etd            || '',
    ets:                          p?.ets            || '',
    cp_ref:                       p?.cp_ref         || '',
    freight_rate:                 p?.freight_rate != null ? String(p.freight_rate) : '',
    load_rate:                    p?.load_rate      != null ? String(p.load_rate)  : '',
    disch_rate:                   p?.disch_rate     != null ? String(p.disch_rate) : '',
    estimated_demurrage_exposure: p?.estimated_demurrage_exposure != null ? String(p.estimated_demurrage_exposure) : '',
    load_agent:                   p?.load_agent     || '',
    discharge_agent:              p?.discharge_agent || '',
    status:                       p?.status         || 'LAYCAN_NOMINATED',
    notes:                        p?.notes          || '',
  }
}

function daysTo(dateStr: string | null): number | null {
  if (!dateStr) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86_400_000)
}

function urgencyBadge(days: number | null) {
  if (days === null) return { cls: 'bg-gray-700 text-gray-400', label: '—' }
  if (days <= 0)  return { cls: 'bg-red-700 text-red-100 font-bold',  label: 'OVR' }
  if (days <= 10) return { cls: 'bg-red-600 text-red-100 font-bold',  label: `${days}d` }
  if (days <= 25) return { cls: 'bg-yellow-600 text-yellow-100',      label: `${days}d` }
  return { cls: 'bg-green-800 text-green-200', label: `${days}d` }
}

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}

function fmtNum(n: number | null | undefined, suffix = '') {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 }) + suffix
}

function primaryCargoType(items: CargoItem[]): string {
  if (!items || items.length === 0) return '—'
  const resolved = items.map(i => {
    const ct = i.cargo_types as any
    return { name: (Array.isArray(ct) ? ct[0]?.cargo_name : ct?.cargo_name) || '?', qty: i.quantity_mt }
  }).sort((a, b) => b.qty - a.qty)
  if (resolved.length === 1) return resolved[0].name
  return `${resolved[0].name} +${resolved.length - 1}`
}

export default function VesselPlanningPage() {
  const [all, setAll]             = useState<VesselPlan[]>([])
  const [loading, setLoading]     = useState(true)
  const [editId, setEditId]       = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [form, setForm]           = useState<EditForm>(blankForm())
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const [info, setInfo]           = useState('')
  const panelRef                  = useRef<HTMLDivElement>(null)

  // Vessel Nomination Modal
  const [showNomModal,   setShowNomModal]   = useState(false)
  const [nomPlan,        setNomPlan]        = useState<VesselPlan | null>(null)
  const [nomForm,        setNomForm]        = useState<NomForm>(blankNomForm())
  const [nomFiles,       setNomFiles]       = useState<Record<string, File>>({})
  const [nomSaving,      setNomSaving]      = useState(false)
  const [nomError,       setNomError]       = useState('')
  const [nomFileTarget,  setNomFileTarget]  = useState('')
  const nomFileRef                          = useRef<HTMLInputElement>(null)
  // Parse mode
  const [nomParseMode,   setNomParseMode]   = useState<'manual'|'screenshot'|'paste'>('manual')
  const [nomParseText,   setNomParseText]   = useState('')
  const [nomParsing,     setNomParsing]     = useState(false)
  const [nomParseError,  setNomParseError]  = useState('')
  const parseScreenRef                      = useRef<HTMLInputElement>(null)
  // Delete modal
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deletePassword,  setDeletePassword]  = useState('')
  const [deleteError,     setDeleteError]     = useState('')
  const [deleting,        setDeleting]        = useState(false)
  // Vessel doc counts: vesselId → {uploaded, total}
  const [vesselDocMap, setVesselDocMap] = useState<Record<string, {uploaded: number; total: number}>>({})
  // Vessel Docs Modal
  const [showDocsModal,  setShowDocsModal]  = useState(false)
  const [docsVesselId,   setDocsVesselId]   = useState<string | null>(null)
  const [docsVesselName, setDocsVesselName] = useState('')
  const [docsRecords,    setDocsRecords]    = useState<{id:string;doc_type:string;status:string;file_name:string|null;storage_path:string|null;uploaded_at:string|null}[]>([])
  const [docsLoading,    setDocsLoading]    = useState(false)
  const [docsUploading,  setDocsUploading]  = useState<string | null>(null)
  const docsFileRef                         = useRef<HTMLInputElement>(null)
  const [docsFileTarget, setDocsFileTarget] = useState('')
  const router                    = useRouter()

  const [fSearch,    setFSearch]    = useState('')
  const [fStatus,    setFStatus]    = useState('')
  const [fVessel,    setFVessel]    = useState('')
  const [fDisch,     setFDisch]     = useState('')
  const [fLoadPort,  setFLoadPort]  = useState('')
  const [fOwner,     setFOwner]     = useState('')
  const [fConsignee, setFConsignee] = useState('')

  useEffect(() => {
    loadData()
    const supabase = createClient()
    const sub = supabase
      .channel('vessel_planning_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cargo_plans' }, () => loadData())
      .subscribe()
    const onVisible = () => { if (!document.hidden) loadData() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      supabase.removeChannel(sub)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  async function loadData() {
    const supabase = createClient()
    const { data, error: e } = await supabase
      .from('cargo_plans')
      .select(`id,cargo_ref,planning_stage,status,vessel_name,vessel_id,owner_operator,charterer,shipper,consignee,
               source_origin,cargo_description,quantity_mt,load_port,discharge_port,
               laycan_start,laycan_end,discharge_eta,cp_ref,freight_rate,load_rate,disch_rate,
               estimated_demurrage_exposure,load_agent,discharge_agent,etd,ets,notes,
               cargo_plan_items(quantity_mt,cargo_types(cargo_name))`)
      .neq('is_archived', true)
      .in('status', [...VP_STATUSES])
      .order('laycan_start', { ascending: true })
    if (e) { setError(e.message); setLoading(false); return }
    const plans = (data || []) as unknown as VesselPlan[]
    setAll(plans)

    // Load vessel_documents counts for all vessels
    const vesselIds = [...new Set(plans.map(p => p.vessel_id).filter(Boolean))] as string[]
    if (vesselIds.length > 0) {
      const { data: docs } = await supabase
        .from('vessel_documents')
        .select('vessel_id,status')
        .in('vessel_id', vesselIds)
      const map: Record<string, {uploaded: number; total: number}> = {}
      for (const d of docs || []) {
        if (!map[d.vessel_id]) map[d.vessel_id] = { uploaded: 0, total: 0 }
        map[d.vessel_id].total++
        if (d.status === 'UPLOADED') map[d.vessel_id].uploaded++
      }
      setVesselDocMap(map)
    }
    setLoading(false)
  }

  // Unique filter values
  const vessels    = [...new Set(all.map(p => p.vessel_name).filter(Boolean))]    as string[]
  const dischPorts = [...new Set(all.map(p => p.discharge_port).filter(Boolean))] as string[]
  const loadPorts  = [...new Set(all.map(p => p.load_port).filter(Boolean))]      as string[]
  const owners     = [...new Set(all.map(p => p.owner_operator).filter(Boolean))] as string[]
  const consignees = [...new Set(all.map(p => p.consignee).filter(Boolean))]      as string[]

  const visible = all.filter(p => {
    if (fStatus    && p.status !== fStatus) return false
    if (fVessel    && p.vessel_name !== fVessel) return false
    if (fDisch     && p.discharge_port !== fDisch) return false
    if (fLoadPort  && p.load_port !== fLoadPort) return false
    if (fOwner     && p.owner_operator !== fOwner) return false
    if (fConsignee && p.consignee !== fConsignee) return false
    if (fSearch) {
      const q = fSearch.toLowerCase()
      if (
        !p.cargo_ref.toLowerCase().includes(q) &&
        !(p.vessel_name?.toLowerCase().includes(q)) &&
        !(p.cp_ref?.toLowerCase().includes(q)) &&
        !(p.consignee?.toLowerCase().includes(q)) &&
        !(p.owner_operator?.toLowerCase().includes(q))
      ) return false
    }
    return true
  })

  function openEdit(p: VesselPlan) {
    setEditId(p.id); setForm(blankForm(p)); setError(''); setPanelOpen(true)
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }
  function setF(k: keyof EditForm, v: string) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave() {
    if (!editId) return
    setSaving(true); setError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const num = (v: string) => v.trim() ? parseFloat(v) : null

    const payload: Record<string, any> = {
      vessel_name:                  form.vessel_name    || null,
      owner_operator:               form.owner_operator || null,
      charterer:                    form.charterer      || null,
      shipper:                      form.shipper        || null,
      consignee:                    form.consignee      || null,
      load_port:                    form.load_port,
      discharge_port:               form.discharge_port,
      terminal:                     form.discharge_port || '',
      laycan_start:                 form.laycan_start   || null,
      laycan_end:                   form.laycan_end     || null,
      discharge_eta:                form.discharge_eta  || null,
      etd:                          form.etd            || null,
      ets:                          form.ets            || null,
      cp_ref:                       form.cp_ref         || null,
      freight_rate:                 num(form.freight_rate),
      load_rate:                    num(form.load_rate),
      disch_rate:                   num(form.disch_rate),
      estimated_demurrage_exposure: num(form.estimated_demurrage_exposure),
      load_agent:                   form.load_agent     || null,
      discharge_agent:              form.discharge_agent || null,
      status:                       form.status,
      notes:                        form.notes          || null,
    }

    const { error: e } = await supabase.from('cargo_plans').update(payload).eq('id', editId)
    if (e) { setError(e.message); setSaving(false); return }
    setSaving(false); setPanelOpen(false); loadData(); router.refresh()
  }

  async function quickStatus(planId: string, newStatus: string) {
    setError(''); setInfo('')
    const plan = all.find(p => p.id === planId)

    // VESSEL_NOMINATED → open nomination modal (form + doc upload)
    if (newStatus === 'VESSEL_NOMINATED') {
      setNomPlan(plan || null)
      setNomForm(blankNomForm(plan?.vessel_name || ''))
      setNomFiles({})
      setNomError(''); setNomParseError(''); setNomParseText(''); setNomParseMode('manual')
      setShowNomModal(true)
      return
    }

    // VESSEL_ACCEPTED: warn if docs missing, but do not block
    if (newStatus === 'VESSEL_ACCEPTED') {
      if (!plan?.vessel_id) {
        setError('No vessel assigned — nominate the vessel first.')
        return
      }
      const supabase = createClient()
      const { data: docs } = await supabase
        .from('vessel_documents')
        .select('doc_type, status')
        .eq('vessel_id', plan.vessel_id)
      const uploaded = new Set((docs || []).filter((d: any) => d.status === 'UPLOADED').map((d: any) => d.doc_type))
      const missing = REQUIRED_VESSEL_DOCS.filter(r => !uploaded.has(r))
      if (missing.length > 0) {
        setInfo(`Vessel accepted with missing documents: ${missing.map(m => VESSEL_DOC_LABEL[m] ?? m).join(', ')}. Upload via Vessel Docs button.`)
      }
    }

    const supabase = createClient()
    const updatePayload: Record<string, any> = { status: newStatus }
    // On acceptance, ensure vessel_name on cargo_plan is synced from vessel record
    if (newStatus === 'VESSEL_ACCEPTED' && plan?.vessel_id) {
      const { data: vRec } = await supabase.from('vessels').select('vessel_name').eq('id', plan.vessel_id).maybeSingle()
      if (vRec?.vessel_name) updatePayload.vessel_name = vRec.vessel_name
    }
    await supabase.from('cargo_plans').update(updatePayload).eq('id', planId)
    const LEAVES_VP = new Set(['VESSEL_ACCEPTED', 'VESSEL_REJECTED', 'LOADED', 'DISCHARGED', 'COMPLETED', 'CANCELLED'])
    if (LEAVES_VP.has(newStatus)) {
      setAll(ps => ps.filter(p => p.id !== planId))
      if (newStatus === 'VESSEL_ACCEPTED') router.push('/dashboard/vessel-schedule')
    } else {
      setAll(ps => ps.map(p => p.id === planId ? { ...p, status: newStatus } : p))
    }
  }

  // ── Vessel Nomination Modal handlers ──────────────────────────────────────

  function setNF(k: keyof NomForm, v: string) { setNomForm(f => ({ ...f, [k]: v })) }

  function triggerNomFile(docType: string) {
    setNomFileTarget(docType)
    nomFileRef.current?.click()
  }

  function handleNomFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !nomFileTarget) return
    e.target.value = ''
    setNomFiles(prev => ({ ...prev, [nomFileTarget]: file }))
  }

  // ── Vessel Docs Modal ─────────────────────────────────────────────────────

  async function openDocsModal(plan: VesselPlan) {
    if (!plan.vessel_id) { setError('No vessel assigned yet — nominate the vessel first.'); return }
    setDocsVesselId(plan.vessel_id)
    setDocsVesselName(plan.vessel_name || 'Vessel')
    setShowDocsModal(true)
    setDocsLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('vessel_documents')
      .select('id,doc_type,status,file_name,storage_path,uploaded_at')
      .eq('vessel_id', plan.vessel_id)
      .order('doc_type')
    setDocsRecords(data || [])
    setDocsLoading(false)
  }

  function triggerDocsFile(docType: string) {
    setDocsFileTarget(docType)
    docsFileRef.current?.click()
  }

  async function handleDocsFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !docsFileTarget || !docsVesselId) return
    e.target.value = ''
    setDocsUploading(docsFileTarget)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const ext = file.name.split('.').pop()
    const { data: upData, error: upErr } = await supabase.storage
      .from('vessel-documents')
      .upload(`vessels/${docsVesselId}/${docsFileTarget}.${ext}`, file, { upsert: true })
    if (upErr) { setDocsUploading(null); return }
    await supabase.from('vessel_documents').upsert({
      vessel_id: docsVesselId, doc_type: docsFileTarget, status: 'UPLOADED',
      storage_path: upData.path, file_name: file.name,
      uploaded_by: user?.id, uploaded_at: new Date().toISOString(),
    }, { onConflict: 'vessel_id,doc_type' })
    // Refresh docs list
    const { data } = await supabase.from('vessel_documents')
      .select('id,doc_type,status,file_name,storage_path,uploaded_at')
      .eq('vessel_id', docsVesselId).order('doc_type')
    setDocsRecords(data || [])
    // Update doc count badge
    const uploaded = (data || []).filter((d: any) => d.status === 'UPLOADED').length
    setVesselDocMap(m => ({ ...m, [docsVesselId]: { total: data?.length || 0, uploaded } }))
    setDocsUploading(null)
  }

  async function handleDocsDownload(storagePath: string, fileName: string | null) {
    const supabase = createClient()
    const { data, error } = await supabase.storage.from('vessel-documents').createSignedUrl(storagePath, 3600)
    if (error || !data) return
    const a = document.createElement('a'); a.href = data.signedUrl
    a.download = fileName || 'document'; a.target = '_blank'; a.click()
  }

  async function parseAndFill(image?: string, mimeType?: string, text?: string, fileType?: string) {
    setNomParsing(true); setNomParseError('')
    try {
      const res = await fetch('/api/parse-vessel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image, mimeType, text, fileType }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setNomParseError(data.error || 'Parse failed'); return }
      const p = data.parsed
      setNomForm(f => ({
        ...f,
        vessel_name:      p.vessel_name      != null ? String(p.vessel_name)      : f.vessel_name,
        imo_number:       p.imo_number       != null ? String(p.imo_number)       : f.imo_number,
        mmsi:             p.mmsi             != null ? String(p.mmsi)             : f.mmsi,
        call_sign:        p.call_sign        != null ? String(p.call_sign)        : f.call_sign,
        flag:             p.flag             != null ? String(p.flag)             : f.flag,
        year_built:       p.year_built       != null ? String(p.year_built)       : f.year_built,
        vessel_type:      p.vessel_type      != null ? String(p.vessel_type)      : f.vessel_type,
        dwt:              p.dwt              != null ? String(p.dwt)              : f.dwt,
        loa:              p.loa              != null ? String(p.loa)              : f.loa,
        beam:             p.beam             != null ? String(p.beam)             : f.beam,
        max_draft:        p.max_draft        != null ? String(p.max_draft)        : f.max_draft,
        holds_count:      p.holds_count      != null ? String(p.holds_count)      : f.holds_count,
        gear_description: p.gear_description != null ? String(p.gear_description) : f.gear_description,
        class_society:    p.class_society    != null ? String(p.class_society)    : f.class_society,
        p_and_i_club:     p.p_and_i_club     != null ? String(p.p_and_i_club)     : f.p_and_i_club,
      }))
    } finally {
      setNomParsing(false)
    }
  }

  async function handleParseFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    e.target.value = ''
    const ext = file.name.split('.').pop()?.toLowerCase() || ''

    // .docx → extract text via mammoth, then send as text
    if (ext === 'docx') {
      setNomParsing(true); setNomParseError('')
      try {
        const mammoth = (await import('mammoth')).default
        const arrayBuffer = await file.arrayBuffer()
        const { value: docText } = await mammoth.extractRawText({ arrayBuffer })
        if (!docText.trim()) { setNomParseError('Could not extract text from Word document'); setNomParsing(false); return }
        await parseAndFill(undefined, undefined, docText)
      } catch (err: any) {
        setNomParseError(err.message || 'Failed to read Word document')
        setNomParsing(false)
      }
      return
    }

    // .doc (old binary) → not supported, guide user
    if (ext === 'doc') {
      setNomParseError('Old .doc format not supported. Please save the file as .docx or export as PDF.')
      return
    }

    // PDF → base64 + document API
    if (file.type === 'application/pdf' || ext === 'pdf') {
      const reader = new FileReader()
      reader.onload = async () => {
        const b64 = (reader.result as string).split(',')[1]
        await parseAndFill(b64, 'application/pdf', undefined, 'pdf')
      }
      reader.readAsDataURL(file)
      return
    }

    // Image (PNG/JPG/etc.) → vision
    const reader = new FileReader()
    reader.onload = async () => {
      const b64 = (reader.result as string).split(',')[1]
      await parseAndFill(b64, file.type)
    }
    reader.readAsDataURL(file)
  }

  async function handleDeletePlan() {
    if (!editId) return
    setDeleting(true); setDeleteError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) { setDeleteError('Not authenticated'); setDeleting(false); return }

    const { error: authErr } = await supabase.auth.signInWithPassword({ email: user.email, password: deletePassword })
    if (authErr) { setDeleteError('Wrong password'); setDeleting(false); return }

    // Get current record for audit log
    const { data: rec } = await supabase.from('cargo_plans').select('*').eq('id', editId).single()

    // Archive: soft delete
    await supabase.from('cargo_plans').update({ is_archived: true }).eq('id', editId)

    // Audit log
    await supabase.from('audit_logs').insert({
      table_name: 'cargo_plans',
      record_id: editId,
      action_type: 'ARCHIVE',
      user_id: user.id,
      old_value: rec || {},
      new_value: { is_archived: true },
      application_context: { action: 'delete', performed_via: 'vessel-planning' },
    })

    setAll(ps => ps.filter(p => p.id !== editId))
    setShowDeleteModal(false); setPanelOpen(false)
    setDeletePassword(''); setDeleting(false)
    setInfo('Record archived.')
  }

  async function saveVesselNomination() {
    if (!nomPlan) return
    if (!nomForm.vessel_name.trim()) { setNomError('Vessel name is required'); return }
    setNomSaving(true); setNomError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const vesselPayload: Record<string, any> = {
      vessel_name:      nomForm.vessel_name.trim(),
      imo_number:       nomForm.imo_number   || null,
      mmsi:             nomForm.mmsi          || null,
      call_sign:        nomForm.call_sign     || null,
      flag:             nomForm.flag          || null,
      year_built:       nomForm.year_built    ? parseInt(nomForm.year_built)    : null,
      vessel_type:      nomForm.vessel_type   || null,
      dwt:              nomForm.dwt           ? parseFloat(nomForm.dwt)         : null,
      loa:              nomForm.loa           ? parseFloat(nomForm.loa)         : null,
      beam:             nomForm.beam          ? parseFloat(nomForm.beam)        : null,
      max_draft:        nomForm.max_draft     ? parseFloat(nomForm.max_draft)   : null,
      holds_count:      nomForm.holds_count   ? parseInt(nomForm.holds_count)   : null,
      gear_description: nomForm.gear_description || null,
      class_society:    nomForm.class_society || null,
      p_and_i_club:     nomForm.p_and_i_club  || null,
    }

    // Upsert vessel record
    let vesselId = nomPlan.vessel_id
    if (!vesselId) {
      let existing: { id: string } | null = null
      if (nomForm.imo_number) {
        const { data } = await supabase.from('vessels').select('id').eq('imo_number', nomForm.imo_number).maybeSingle()
        existing = data
      }
      if (!existing && nomForm.vessel_name.trim()) {
        const { data } = await supabase.from('vessels').select('id').eq('vessel_name', nomForm.vessel_name.trim()).maybeSingle()
        existing = data
      }
      if (existing) {
        vesselId = existing.id
        await supabase.from('vessels').update(vesselPayload).eq('id', vesselId)
      } else {
        const { data: nv, error: ve } = await supabase.from('vessels').insert(vesselPayload).select('id').single()
        if (ve || !nv) { setNomError(ve?.message || 'Failed to create vessel record'); setNomSaving(false); return }
        vesselId = nv.id
      }
    } else {
      await supabase.from('vessels').update(vesselPayload).eq('id', vesselId)
    }

    // Upload selected files → vessel_documents UPLOADED
    for (const [docType, file] of Object.entries(nomFiles)) {
      const ext = file.name.split('.').pop()
      const { data: upData, error: upErr } = await supabase.storage
        .from('vessel-documents')
        .upload(`vessels/${vesselId}/${docType}.${ext}`, file, { upsert: true })
      if (upErr) continue
      await supabase.from('vessel_documents').upsert({
        vessel_id: vesselId, doc_type: docType, status: 'UPLOADED',
        storage_path: upData.path, file_name: file.name,
        uploaded_by: user?.id, uploaded_at: new Date().toISOString(),
      }, { onConflict: 'vessel_id,doc_type' })
    }

    // Remaining docs → PENDING
    const uploadedTypes = new Set(Object.keys(nomFiles))
    const pending = REQUIRED_VESSEL_DOCS.filter(t => !uploadedTypes.has(t))
    if (pending.length > 0) {
      await supabase.from('vessel_documents').upsert(
        pending.map(doc_type => ({ vessel_id: vesselId, doc_type, status: 'PENDING' })),
        { onConflict: 'vessel_id,doc_type', ignoreDuplicates: true }
      )
    }

    // Update cargo_plan: link vessel_id + vessel_name + set VESSEL_NOMINATED
    const nominatedName = nomForm.vessel_name.trim()
    const { error: cpErr } = await supabase.from('cargo_plans')
      .update({ vessel_id: vesselId, vessel_name: nominatedName, status: 'VESSEL_NOMINATED' })
      .eq('id', nomPlan.id)
    if (cpErr) { setNomError(cpErr.message); setNomSaving(false); return }

    setAll(ps => ps.map(p => p.id === nomPlan.id
      ? { ...p, status: 'VESSEL_NOMINATED', vessel_id: vesselId, vessel_name: nominatedName }
      : p
    ))
    setShowNomModal(false)
    setNomSaving(false)
    const nUploaded = Object.keys(nomFiles).length
    setInfo(
      `Vessel nominated. ${nUploaded} document${nUploaded !== 1 ? 's' : ''} uploaded, ` +
      `${REQUIRED_VESSEL_DOCS.length - nUploaded} pending. ` +
      `Upload remaining docs via Cargo Plan > Documents.`
    )
  }

  function clearFilters() {
    setFSearch(''); setFStatus(''); setFVessel(''); setFDisch('')
    setFLoadPort(''); setFOwner(''); setFConsignee('')
  }
  const hasFilters = fSearch || fStatus || fVessel || fDisch || fLoadPort || fOwner || fConsignee

  const editingPlan = all.find(p => p.id === editId)
  const urgent = all.filter(p => { const d = daysTo(p.laycan_start); return d !== null && d <= 10 }).length

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Nav */}
      <nav className="bg-gray-800 px-6 py-3 flex justify-between items-center border-b border-gray-700 sticky top-0 z-30">
        <div className="flex items-center gap-3 text-sm">
          <button onClick={() => router.push('/dashboard')} className="text-gray-400 hover:text-white">← Dashboard</button>
          <span className="text-gray-600">/</span>
          <button onClick={() => router.push('/dashboard/cargo-plans')} className="text-gray-400 hover:text-white">Cargo Plans</button>
          <span className="text-gray-600">/</span>
          <button onClick={() => router.push('/dashboard/cargo-nomination')} className="text-gray-400 hover:text-white">Nomination</button>
          <span className="text-gray-600">/</span>
          <span className="text-white font-semibold">Vessel Planning</span>
          {!loading && <span className="text-gray-500 ml-2">{all.length} records</span>}
        </div>
      </nav>

      {/* Info / Error banners */}
      {info && (
        <div className="bg-green-900/60 border-b border-green-700 px-6 py-2 flex items-start justify-between gap-4">
          <p className="text-green-300 text-xs">{info}</p>
          <button onClick={() => setInfo('')} className="text-green-500 hover:text-green-300 text-sm shrink-0">✕</button>
        </div>
      )}
      {error && !panelOpen && (
        <div className="bg-red-900/40 border-b border-red-800 px-6 py-2 flex items-start justify-between gap-4">
          <p className="text-red-300 text-xs">{error}</p>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-300 text-sm shrink-0">✕</button>
        </div>
      )}

      {/* Edit Panel */}
      {panelOpen && editId && (
        <div ref={panelRef} className="bg-gray-800 border-b border-gray-600 px-6 py-4 sticky top-[57px] z-20 shadow-xl">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold text-sm text-gray-200">
              ✏️ Vessel Planning: <span className="text-white">{editingPlan?.cargo_ref}</span>
              {editingPlan?.vessel_name && <span className="text-gray-400 ml-2">— {editingPlan.vessel_name}</span>}
            </h2>
            <button onClick={() => setPanelOpen(false)} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
          </div>

          {/* Row 1: Parties */}
          <p className="text-gray-600 text-[10px] uppercase tracking-wider mb-1">Parties & Vessel</p>
          <div className="grid grid-cols-6 gap-x-3 gap-y-2 text-xs mb-3">
            {([
              ['Vessel',           'vessel_name',    'text'],
              ['Owner / Operator', 'owner_operator', 'text'],
              ['Charterer',        'charterer',      'text'],
              ['Shipper',          'shipper',        'text'],
              ['Consignee',        'consignee',      'text'],
              ['C/P Ref',          'cp_ref',         'text'],
            ] as [string, keyof EditForm, string][]).map(([label, key, type]) => (
              <div key={key}>
                <p className="text-gray-500 mb-0.5">{label}</p>
                <input type={type} value={form[key]} onChange={e => setF(key, e.target.value)}
                  className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs focus:outline-none focus:border-blue-500" />
              </div>
            ))}
          </div>

          {/* Row 2: Ports & Agents */}
          <p className="text-gray-600 text-[10px] uppercase tracking-wider mb-1">Ports & Agents</p>
          <div className="grid grid-cols-6 gap-x-3 gap-y-2 text-xs mb-3">
            {([
              ['Load Port',       'load_port',       'text'],
              ['Load Agent',      'load_agent',      'text'],
              ['Disch Port',      'discharge_port',  'text'],
              ['Disch Agent',     'discharge_agent', 'text'],
            ] as [string, keyof EditForm, string][]).map(([label, key, type]) => (
              <div key={key}>
                <p className="text-gray-500 mb-0.5">{label}</p>
                <input type={type} value={form[key]} onChange={e => setF(key, e.target.value)}
                  className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs focus:outline-none focus:border-blue-500" />
              </div>
            ))}
          </div>

          {/* Row 3: Schedule */}
          <p className="text-gray-600 text-[10px] uppercase tracking-wider mb-1">Schedule</p>
          <div className="grid grid-cols-6 gap-x-3 gap-y-2 text-xs mb-3">
            {([
              ['Laycan Start', 'laycan_start',  'date'],
              ['Laycan End',   'laycan_end',    'date'],
              ['ETD',          'etd',           'date'],
              ['ETS',          'ets',           'date'],
              ['ETA',          'discharge_eta', 'date'],
            ] as [string, keyof EditForm, string][]).map(([label, key, type]) => (
              <div key={key}>
                <p className="text-gray-500 mb-0.5">{label}</p>
                <input type={type} value={form[key]} onChange={e => setF(key, e.target.value)}
                  className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs focus:outline-none focus:border-blue-500" />
              </div>
            ))}
          </div>

          {/* Row 4: Rates */}
          <p className="text-gray-600 text-[10px] uppercase tracking-wider mb-1">Rates & Commercial</p>
          <div className="grid grid-cols-6 gap-x-3 gap-y-2 text-xs mb-3">
            {([
              ['Freight Rate ($/MT)', 'freight_rate'],
              ['Load Rate (MT/day)',  'load_rate'],
              ['Disch Rate (MT/day)', 'disch_rate'],
              ['Demurrage ($)',       'estimated_demurrage_exposure'],
            ] as [string, keyof EditForm][]).map(([label, key]) => (
              <div key={key}>
                <p className="text-gray-500 mb-0.5">{label}</p>
                <input type="number" value={form[key]} onChange={e => setF(key, e.target.value)}
                  className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs focus:outline-none focus:border-blue-500" />
              </div>
            ))}
            <div>
              <p className="text-gray-500 mb-0.5">Status</p>
              <select value={form.status} onChange={e => setF('status', e.target.value)}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs focus:outline-none focus:border-blue-500">
                {VP_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <p className="text-gray-500 mb-0.5">Notes</p>
              <input value={form.notes} onChange={e => setF('notes', e.target.value)}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs focus:outline-none focus:border-blue-500" />
            </div>
          </div>

          {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
          <div className="flex gap-2 mt-2">
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded text-xs font-medium">
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => setPanelOpen(false)}
              className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs">Cancel</button>
            <button onClick={() => { setDeletePassword(''); setDeleteError(''); setShowDeleteModal(true) }}
              className="ml-auto px-4 py-1.5 bg-red-900 hover:bg-red-800 text-red-200 rounded text-xs">
              Delete
            </button>
          </div>
        </div>
      )}

      <main className="p-4">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-3">
          <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
            <p className="text-gray-400 text-xs">In Vessel Planning</p>
            <p className="text-2xl font-bold mt-0.5">{all.length}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 border border-red-900">
            <p className="text-gray-400 text-xs">Urgent ≤10d</p>
            <p className={`text-2xl font-bold mt-0.5 ${urgent > 0 ? 'text-red-400' : ''}`}>{urgent}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 border border-yellow-900">
            <p className="text-gray-400 text-xs">LAYCAN_NOMINATED</p>
            <p className="text-2xl font-bold mt-0.5 text-yellow-400">
              {all.filter(p => p.status === 'LAYCAN_NOMINATED').length}
            </p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 border border-green-900">
            <p className="text-gray-400 text-xs">FIXTURED</p>
            <p className="text-2xl font-bold mt-0.5 text-green-400">
              {all.filter(p => p.status === 'FIXTURED').length}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-3 flex-wrap items-center">
          <input value={fSearch} onChange={e => setFSearch(e.target.value)}
            placeholder="Search ref, vessel, C/P ref, consignee…"
            className="px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-xs text-white w-56 focus:outline-none focus:border-blue-500" />
          {[
            [fStatus,    setFStatus,    'All Statuses',   VP_STATUS_OPTIONS.map(o => o.value)],
            [fVessel,    setFVessel,    'All Vessels',    vessels],
            [fDisch,     setFDisch,     'All Disch Ports',dischPorts],
            [fLoadPort,  setFLoadPort,  'All Load Ports', loadPorts],
            [fOwner,     setFOwner,     'All Owner/Op',   owners],
            [fConsignee, setFConsignee, 'All Consignees', consignees],
          ].map(([val, setter, placeholder, opts]: any) => (
            <select key={placeholder} value={val} onChange={(e: any) => setter(e.target.value)}
              className="px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-xs text-white focus:outline-none">
              <option value="">{placeholder}</option>
              {(opts as string[]).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ))}
          {hasFilters && (
            <button onClick={clearFilters}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300">Clear</button>
          )}
          <span className="ml-auto text-xs text-gray-500">{visible.length} / {all.length}</span>
        </div>

        {/* Table */}
        {loading ? (
          <p className="text-gray-500 text-sm p-4">Loading...</p>
        ) : error ? (
          <p className="text-red-400 text-sm p-4">{error}</p>
        ) : visible.length === 0 ? (
          <div className="bg-gray-800 rounded-lg p-10 text-center border border-gray-700">
            <p className="text-gray-400 text-sm">No vessel planning records.</p>
            <p className="text-gray-600 text-xs mt-1">
              Cargoes appear here when status is VESSEL_NOMINATED, LAYCAN_NOMINATED, or FIXTURED.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-700">
            <table className="w-full text-xs">
              <thead className="bg-gray-800 text-gray-400 uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Days</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Cargo Ref</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Vessel</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Owner / Op</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Charterer</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Consignee</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">C/P Ref</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Cargo Type</th>
                  <th className="px-3 py-2 text-right whitespace-nowrap">Total MT</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Load Port</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Disch Port</th>
                  <th className="px-3 py-2 text-right whitespace-nowrap">Load Rate</th>
                  <th className="px-3 py-2 text-right whitespace-nowrap">Disch Rate</th>
                  <th className="px-3 py-2 text-right whitespace-nowrap">Demurrage</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Laycan Start</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Laycan End</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">ETA</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">ETD</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">ETS</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Load Agent</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Disch Agent</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Status</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Docs</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {visible.map(p => {
                  const days  = daysTo(p.laycan_start)
                  const badge = urgencyBadge(days)
                  const isEditing = panelOpen && editId === p.id
                  const cargoType = primaryCargoType(p.cargo_plan_items || [])
                  return (
                    <tr key={p.id}
                      className={`transition-colors ${isEditing ? 'bg-blue-900/20' : 'hover:bg-gray-800/60'}`}>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="px-3 py-2 font-medium text-white whitespace-nowrap">{p.cargo_ref}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{p.vessel_name || <span className="text-yellow-600/80 italic">TBN</span>}</span>
                          {p.vessel_id && (() => {
                            const dc = vesselDocMap[p.vessel_id]
                            if (!dc) return <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-800 text-yellow-200">no docs</span>
                            if (dc.uploaded >= dc.total && dc.total >= 5)
                              return <span className="text-[9px] px-1 py-0.5 rounded bg-green-800 text-green-200">{dc.uploaded}/{dc.total} ✓</span>
                            return <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-700 text-yellow-100">{dc.uploaded}/{dc.total} docs</span>
                          })()}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-300">
                        {p.owner_operator || <span className="text-blue-500/60 italic text-[10px]">needed</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-300">{p.charterer || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-300">{p.consignee || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {p.cp_ref
                          ? <span className="text-blue-300">{p.cp_ref}</span>
                          : <span className="text-gray-600 italic text-[10px]">no C/P</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-300 max-w-[120px] truncate" title={cargoType}>
                        {cargoType}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-gray-200">
                        {fmtNum(p.quantity_mt)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-300">{p.load_port || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-300">{p.discharge_port || '—'}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-gray-300">{fmtNum(p.load_rate, '/d')}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-gray-300">{fmtNum(p.disch_rate, '/d')}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-gray-300">
                        {p.estimated_demurrage_exposure != null ? `$${fmtNum(p.estimated_demurrage_exposure)}` : '—'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmt(p.laycan_start)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmt(p.laycan_end)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-blue-300">{fmt(p.discharge_eta)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-300">{fmt(p.etd)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-300">{fmt(p.ets)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-400 text-[11px]">{p.load_agent || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-400 text-[11px]">{p.discharge_agent || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <select value={p.status} onChange={e => quickStatus(p.id, e.target.value)}
                          className={`text-[10px] px-1.5 py-0.5 rounded border-0 font-medium cursor-pointer focus:outline-none ${STATUS_COLOR[p.status] || 'bg-gray-600 text-gray-100'}`}>
                          {VP_STATUS_OPTIONS.map(o => (
                            <option key={o.value} value={o.value} className="bg-gray-800 text-white">{o.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {p.vessel_id ? (
                          <button onClick={() => openDocsModal(p)}
                            className={`px-2 py-0.5 rounded text-[10px] ${
                              vesselDocMap[p.vessel_id]?.uploaded >= 5
                                ? 'bg-green-800 text-green-200 hover:bg-green-700'
                                : 'bg-yellow-800 text-yellow-200 hover:bg-yellow-700'
                            }`}>
                            Docs
                          </button>
                        ) : (
                          <span className="text-gray-700 text-[10px]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <button onClick={() => openEdit(p)}
                          className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-[10px]">Edit</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* ── Delete Confirmation Modal ───────────────────────────────────────── */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-gray-900 border border-red-900 rounded-xl w-full max-w-sm p-6 shadow-2xl">
            <h2 className="font-bold text-red-300 mb-1">Archive Record</h2>
            <p className="text-gray-400 text-xs mb-4">
              This will archive <span className="text-white">{all.find(p => p.id === editId)?.cargo_ref}</span>.
              Enter your password to confirm.
            </p>
            <input
              type="password"
              value={deletePassword}
              onChange={e => setDeletePassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleDeletePlan()}
              placeholder="Your password"
              autoFocus
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm focus:outline-none focus:border-red-500 mb-3"
            />
            {deleteError && <p className="text-red-400 text-xs mb-3">{deleteError}</p>}
            <div className="flex gap-2">
              <button onClick={handleDeletePlan} disabled={deleting || !deletePassword}
                className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded text-sm font-semibold">
                {deleting ? 'Archiving…' : 'Archive'}
              </button>
              <button onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Vessel Docs Modal ───────────────────────────────────────────────── */}
      {showDocsModal && docsVesselId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowDocsModal(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-2xl"
               onClick={e => e.stopPropagation()}>

            <input ref={docsFileRef} type="file" className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              onChange={handleDocsFileChange} />

            {/* Header */}
            <div className="sticky top-0 bg-gray-900 border-b border-gray-700 px-6 py-4 flex justify-between items-center z-10">
              <div>
                <h2 className="font-bold text-white">Vessel Documents</h2>
                <p className="text-gray-400 text-xs mt-0.5">{docsVesselName}</p>
              </div>
              <button onClick={() => setShowDocsModal(false)} className="text-gray-500 hover:text-white text-2xl leading-none">✕</button>
            </div>

            <div className="p-6">
              {docsLoading ? (
                <p className="text-gray-500 text-sm">Loading…</p>
              ) : (
                <div className="space-y-2">
                  {REQUIRED_VESSEL_DOCS.map(docType => {
                    const rec = docsRecords.find(d => d.doc_type === docType)
                    const isUploading = docsUploading === docType
                    return (
                      <div key={docType} className="flex items-center justify-between bg-gray-800 rounded px-4 py-2.5">
                        <div>
                          <p className="text-xs text-gray-200 font-medium">{VESSEL_DOC_LABEL[docType]}</p>
                          {rec?.status === 'UPLOADED'
                            ? <p className="text-[10px] text-green-400 mt-0.5">✓ {rec.file_name}</p>
                            : <p className="text-[10px] text-yellow-600 mt-0.5">Pending</p>
                          }
                        </div>
                        <div className="flex items-center gap-2">
                          {rec?.status === 'UPLOADED' && rec.storage_path && (
                            <button onClick={() => handleDocsDownload(rec.storage_path!, rec.file_name)}
                              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[10px] text-gray-300">
                              Download
                            </button>
                          )}
                          <button onClick={() => triggerDocsFile(docType)} disabled={isUploading}
                            className={`px-3 py-1 rounded text-[11px] disabled:opacity-50 ${
                              rec?.status === 'UPLOADED'
                                ? 'bg-green-800 text-green-200 hover:bg-green-700'
                                : 'bg-blue-800 text-blue-200 hover:bg-blue-700'
                            }`}>
                            {isUploading ? 'Uploading…' : rec?.status === 'UPLOADED' ? 'Replace' : 'Upload'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Vessel Nomination Modal ─────────────────────────────────────────── */}
      {showNomModal && nomPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowNomModal(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl"
               onClick={e => e.stopPropagation()}>

            {/* Hidden file inputs */}
            <input ref={nomFileRef} type="file" className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              onChange={handleNomFileChange} />
            <input ref={parseScreenRef} type="file" className="hidden"
              accept="image/*,.pdf,.docx"
              onChange={handleParseFile} />

            {/* Header */}
            <div className="sticky top-0 bg-gray-900 border-b border-gray-700 px-6 py-4 flex justify-between items-start z-10">
              <div>
                <h2 className="font-bold text-white">Vessel Nomination</h2>
                <p className="text-gray-400 text-xs mt-0.5">
                  <span className="font-mono text-blue-400">{nomPlan.cargo_ref}</span>
                  {' — '}{nomPlan.vessel_name || 'TBN'}
                  {nomPlan.load_port && <span className="text-gray-500"> · {nomPlan.load_port} → {nomPlan.discharge_port}</span>}
                </p>
              </div>
              <button onClick={() => setShowNomModal(false)} className="text-gray-500 hover:text-white text-2xl leading-none">✕</button>
            </div>

            <div className="p-6 space-y-6">
              {/* Parse from Q88 / Email */}
              <section className="bg-gray-800/60 rounded-lg p-4 border border-gray-700">
                <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3">Fill from Q88 / Email</h3>
                <div className="flex gap-2 mb-3">
                  {(['manual','screenshot','paste'] as const).map(mode => (
                    <button key={mode} onClick={() => setNomParseMode(mode)}
                      className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${nomParseMode === mode ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                      {mode === 'manual' ? 'Manual Entry' : mode === 'screenshot' ? 'PDF / Word / Image' : 'Paste Text'}
                    </button>
                  ))}
                </div>
                {nomParseMode === 'screenshot' && (
                  <div>
                    <button onClick={() => parseScreenRef.current?.click()} disabled={nomParsing}
                      className="px-4 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 rounded text-xs font-medium">
                      {nomParsing ? 'Parsing…' : 'Select File'}
                    </button>
                    <p className="text-gray-500 text-[10px] mt-1.5">
                      Supported: <span className="text-gray-300">PDF</span> (Q88 / Baltic questionnaire),{' '}
                      <span className="text-gray-300">Word .docx</span>,{' '}
                      <span className="text-gray-300">PNG / JPG</span> screenshot —
                      Claude will extract all vessel fields and fill the form below.
                    </p>
                  </div>
                )}
                {nomParseMode === 'paste' && (
                  <div>
                    <textarea value={nomParseText} onChange={e => setNomParseText(e.target.value)}
                      rows={5} placeholder="Paste Q88 text or email content here…"
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-xs focus:outline-none focus:border-blue-500 mb-2 resize-none" />
                    <button onClick={() => parseAndFill(undefined, undefined, nomParseText)}
                      disabled={nomParsing || !nomParseText.trim()}
                      className="px-4 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 rounded text-xs font-medium">
                      {nomParsing ? 'Parsing…' : 'Parse & Fill'}
                    </button>
                  </div>
                )}
                {nomParseMode === 'manual' && (
                  <p className="text-gray-600 text-[10px]">Fill the fields below manually.</p>
                )}
                {nomParseError && <p className="text-red-400 text-xs mt-2">{nomParseError}</p>}
              </section>

              {/* Section 1: Identification */}
              <section>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Vessel Identification</h3>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <p className="text-gray-500 mb-0.5">Vessel Name <span className="text-red-400">*</span></p>
                    <input value={nomForm.vessel_name} onChange={e => setNF('vessel_name', e.target.value)}
                      placeholder="Required"
                      className={`w-full px-2 py-1.5 bg-gray-700 border rounded focus:outline-none focus:border-blue-500 ${!nomForm.vessel_name.trim() ? 'border-red-600' : 'border-gray-600'}`} />
                  </div>
                  {([
                    ['IMO Number',  'imo_number'],
                    ['MMSI',        'mmsi'],
                    ['Call Sign',   'call_sign'],
                    ['Flag',        'flag'],
                    ['Year Built',  'year_built'],
                  ] as [string, keyof NomForm][]).map(([label, key]) => (
                    <div key={key}>
                      <p className="text-gray-500 mb-0.5">{label}</p>
                      <input value={nomForm[key]} onChange={e => setNF(key, e.target.value)}
                        className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500" />
                    </div>
                  ))}
                </div>
              </section>

              {/* Section 2: Technical */}
              <section>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Technical Particulars</h3>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  {([
                    ['Vessel Type',     'vessel_type'],
                    ['DWT (t)',         'dwt'],
                    ['LOA (m)',         'loa'],
                    ['Beam (m)',        'beam'],
                    ['Max Draft (m)',   'max_draft'],
                    ['No. of Holds',   'holds_count'],
                  ] as [string, keyof NomForm][]).map(([label, key]) => (
                    <div key={key}>
                      <p className="text-gray-500 mb-0.5">{label}</p>
                      <input value={nomForm[key]} onChange={e => setNF(key, e.target.value)}
                        className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500" />
                    </div>
                  ))}
                  <div className="col-span-3">
                    <p className="text-gray-500 mb-0.5">Gear / Cranes</p>
                    <input value={nomForm.gear_description} onChange={e => setNF('gear_description', e.target.value)}
                      placeholder="e.g. 4 × 30t cranes"
                      className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-xs focus:outline-none focus:border-blue-500" />
                  </div>
                </div>
              </section>

              {/* Section 3: Class & P&I */}
              <section>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Class & P&I</h3>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  {([
                    ['Class Society', 'class_society'],
                    ['P&I Club',      'p_and_i_club'],
                  ] as [string, keyof NomForm][]).map(([label, key]) => (
                    <div key={key}>
                      <p className="text-gray-500 mb-0.5">{label}</p>
                      <input value={nomForm[key]} onChange={e => setNF(key, e.target.value)}
                        className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500" />
                    </div>
                  ))}
                </div>
              </section>

              {/* Section 4: Documents */}
              <section>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Documents
                  <span className="ml-2 text-gray-600 normal-case font-normal">(upload now or later via Cargo Plan › Documents)</span>
                </h3>
                <div className="space-y-2">
                  {REQUIRED_VESSEL_DOCS.map(docType => {
                    const file = nomFiles[docType]
                    return (
                      <div key={docType} className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
                        <div>
                          <p className="text-xs text-gray-200">{VESSEL_DOC_LABEL[docType]}</p>
                          {file && <p className="text-[10px] text-green-400 mt-0.5">✓ {file.name}</p>}
                          {!file && <p className="text-[10px] text-yellow-600 mt-0.5">Pending</p>}
                        </div>
                        <button
                          onClick={() => triggerNomFile(docType)}
                          className={`px-3 py-1 rounded text-[11px] ${file ? 'bg-green-800 text-green-200 hover:bg-green-700' : 'bg-blue-800 text-blue-200 hover:bg-blue-700'}`}
                        >
                          {file ? 'Replace' : 'Upload'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </section>

              {nomError && <p className="text-red-400 text-xs">{nomError}</p>}
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-gray-900 border-t border-gray-700 px-6 py-4 flex gap-3">
              <button
                onClick={saveVesselNomination}
                disabled={nomSaving}
                className="px-5 py-2 bg-orange-600 hover:bg-orange-500 rounded text-sm font-semibold disabled:opacity-50"
              >
                {nomSaving ? 'Saving…' : 'Nominate Vessel'}
              </button>
              <button
                onClick={() => setShowNomModal(false)}
                className="px-5 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
