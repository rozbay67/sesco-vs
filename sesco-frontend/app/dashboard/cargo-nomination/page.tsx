'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

// Statuses allowed in cargo nomination dropdown
const NOMINATION_STATUSES = [
  'CONFIRMED_FOR_FIXTURE',
  'LAYCAN_NOMINATED',
  'LAYCAN_REVISED',
  'VESSEL_NOMINATED',
]

// Plans past this stage leave the nomination view
const TERMINAL_STATUSES = new Set([
  'VESSEL_ACCEPTED', 'VESSEL_REJECTED',
  'LOADED', 'DISCHARGED', 'COMPLETED', 'CANCELLED',
  // backward compat
  'FIXTURED', 'LOADING', 'SAILED', 'DISCHARGING',
])

// Display label in nomination context
const NOMINATION_LABEL: Record<string, string> = {
  CONFIRMED_FOR_FIXTURE: 'Pending',
  LAYCAN_NOMINATED:      'Laycan Nominated',
  LAYCAN_REVISED:        'Laycan Revised',
  VESSEL_NOMINATED:      'Vessel Nominated',
}

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

const ALERT_DAYS = 28
const NOMINATION_DAYS = 40

type CargoPlan = {
  id: string
  cargo_ref: string
  planning_stage: string
  status: string
  shipper: string | null
  consignee: string | null
  charterer: string | null
  owner_operator: string | null
  source_origin: string | null
  load_port: string
  discharge_port: string
  laycan_start: string | null
  laycan_end: string | null
  vessel_name: string | null
  notes: string | null
}

type EditForm = {
  vessel_name: string
  owner_operator: string
  charterer: string
  shipper: string
  consignee: string
  source_origin: string
  load_port: string
  discharge_port: string
  laycan_start: string
  laycan_end: string
  status: string
  notes: string
}

function blankForm(p?: CargoPlan): EditForm {
  return {
    vessel_name:    p?.vessel_name    || '',
    owner_operator: p?.owner_operator || '',
    charterer:      p?.charterer      || '',
    shipper:        p?.shipper        || '',
    consignee:      p?.consignee      || '',
    source_origin:  p?.source_origin  || '',
    load_port:      p?.load_port      || '',
    discharge_port: p?.discharge_port || '',
    laycan_start:   p?.laycan_start   || '',
    laycan_end:     p?.laycan_end     || '',
    status:         p?.status         || 'PLANNED',
    notes:          p?.notes          || '',
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
  if (days <= 0)  return { cls: 'bg-red-700 text-red-100 font-bold', label: 'OVR' }
  if (days <= 10) return { cls: 'bg-red-600 text-red-100 font-bold', label: `${days}d` }
  if (days <= 25) return { cls: 'bg-yellow-600 text-yellow-100',     label: `${days}d` }
  return { cls: 'bg-green-800 text-green-200', label: `${days}d` }
}

function fmt(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}

export default function CargoNominationPage() {
  const [all, setAll]             = useState<CargoPlan[]>([])
  const [loading, setLoading]     = useState(true)
  const [editId, setEditId]       = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [form, setForm]           = useState<EditForm>(blankForm())
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const panelRef                  = useRef<HTMLDivElement>(null)
  const router                    = useRouter()
  // Delete modal
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deletePassword,  setDeletePassword]  = useState('')
  const [deleteError,     setDeleteError]     = useState('')
  const [deleting,        setDeleting]        = useState(false)

  const [fSearch,    setFSearch]    = useState('')
  const [fStatus,    setFStatus]    = useState('')
  const [fSource,    setFSource]    = useState('')
  const [fDisch,     setFDisch]     = useState('')
  const [fVessel,    setFVessel]    = useState('')
  const [fOwner,     setFOwner]     = useState('')
  const [fLoadPort,  setFLoadPort]  = useState('')
  const [fConsignee, setFConsignee] = useState('')

  useEffect(() => {
    loadData()
    const supabase = createClient()
    const sub = supabase
      .channel('cargo_nomination_sync')
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
      .select('id,cargo_ref,planning_stage,status,shipper,consignee,charterer,owner_operator,source_origin,load_port,discharge_port,laycan_start,laycan_end,vessel_name,notes')
      .neq('is_archived', true)
      .order('laycan_start', { ascending: true })
    if (e) { setError(e.message); setLoading(false); return }

    const today = new Date(); today.setHours(0, 0, 0, 0)
    const cutoff = new Date(today); cutoff.setDate(today.getDate() + NOMINATION_DAYS)

    const nominations = (data || []).filter((p: CargoPlan) => {
      if (TERMINAL_STATUSES.has(p.status)) return false
      const hasOwner     = !!p.owner_operator
      const withinCutoff = p.laycan_start ? new Date(p.laycan_start) <= cutoff : false
      return hasOwner || withinCutoff
    })
    setAll(nominations)
    setLoading(false)
  }

  // Alert: within 28 days
  const alertPlans = all.filter(p => {
    const d = daysTo(p.laycan_start)
    return d !== null && d <= ALERT_DAYS
  })

  // Unique filter values
  const sources     = [...new Set(all.map(p => p.source_origin).filter(Boolean))] as string[]
  const dischPorts  = [...new Set(all.map(p => p.discharge_port).filter(Boolean))] as string[]
  const loadPorts   = [...new Set(all.map(p => p.load_port).filter(Boolean))]      as string[]
  const vessels     = [...new Set(all.map(p => p.vessel_name).filter(Boolean))]    as string[]
  const owners      = [...new Set(all.map(p => p.owner_operator).filter(Boolean))] as string[]
  const consignees  = [...new Set(all.map(p => p.consignee).filter(Boolean))]      as string[]

  const visible = all.filter(p => {
    if (fStatus    && p.status !== fStatus) return false
    if (fSource    && p.source_origin !== fSource) return false
    if (fDisch     && p.discharge_port !== fDisch) return false
    if (fVessel    && p.vessel_name !== fVessel) return false
    if (fOwner     && p.owner_operator !== fOwner) return false
    if (fLoadPort  && p.load_port !== fLoadPort) return false
    if (fConsignee && p.consignee !== fConsignee) return false
    if (fSearch) {
      const q = fSearch.toLowerCase()
      if (
        !p.cargo_ref.toLowerCase().includes(q) &&
        !(p.vessel_name?.toLowerCase().includes(q)) &&
        !(p.consignee?.toLowerCase().includes(q)) &&
        !(p.owner_operator?.toLowerCase().includes(q))
      ) return false
    }
    return true
  })

  function openEdit(p: CargoPlan) {
    setEditId(p.id); setForm(blankForm(p)); setError(''); setPanelOpen(true)
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }
  function setF(k: keyof EditForm, v: string) { setForm(f => ({ ...f, [k]: v })) }

  async function handleDeletePlan() {
    if (!editId) return
    setDeleting(true); setDeleteError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) { setDeleteError('Not authenticated'); setDeleting(false); return }

    const { error: authErr } = await supabase.auth.signInWithPassword({ email: user.email, password: deletePassword })
    if (authErr) { setDeleteError('Wrong password'); setDeleting(false); return }

    const { data: rec } = await supabase.from('cargo_plans').select('*').eq('id', editId).single()
    await supabase.from('cargo_plans').update({ is_archived: true }).eq('id', editId)
    await supabase.from('audit_logs').insert({
      table_name: 'cargo_plans', record_id: editId, action_type: 'ARCHIVE',
      user_id: user.id, old_value: rec || {}, new_value: { is_archived: true },
      application_context: { action: 'delete', performed_via: 'cargo-nomination' },
    })

    setAll(ps => ps.filter(p => p.id !== editId))
    setShowDeleteModal(false); setPanelOpen(false)
    setDeletePassword(''); setDeleting(false)
  }

  async function handleSave() {
    if (!editId) return
    setSaving(true); setError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const payload: Record<string, any> = {
      vessel_name:    form.vessel_name    || null,
      owner_operator: form.owner_operator || null,
      charterer:      form.charterer      || null,
      shipper:        form.shipper        || null,
      consignee:      form.consignee      || null,
      source_origin:  form.source_origin  || null,
      load_port:      form.load_port,
      discharge_port: form.discharge_port,
      terminal:       form.discharge_port || '',
      laycan_start:   form.laycan_start   || null,
      laycan_end:     form.laycan_end     || null,
      status:         form.status,
      notes:          form.notes          || null,
    }
    const { error: e } = await supabase.from('cargo_plans').update(payload).eq('id', editId)
    if (e) { setError(e.message); setSaving(false); return }
    setSaving(false); setPanelOpen(false); loadData(); router.refresh()
    if (form.status === 'LAYCAN_NOMINATED' || form.status === 'LAYCAN_REVISED') {
      router.push('/dashboard/vessel-planning')
    }
  }

  async function quickStatus(planId: string, newStatus: string) {
    const supabase = createClient()
    await supabase.from('cargo_plans').update({ status: newStatus }).eq('id', planId)
    if (TERMINAL_STATUSES.has(newStatus)) {
      setAll(ps => ps.filter(p => p.id !== planId))
    } else {
      setAll(ps => ps.map(p => p.id === planId ? { ...p, status: newStatus } : p))
    }
    if (newStatus === 'LAYCAN_NOMINATED') {
      router.push('/dashboard/vessel-planning')
    }
  }

  function clearFilters() {
    setFSearch(''); setFStatus(''); setFSource(''); setFDisch('')
    setFVessel(''); setFOwner(''); setFLoadPort(''); setFConsignee('')
  }
  const hasFilters = fSearch || fStatus || fSource || fDisch || fVessel || fOwner || fLoadPort || fConsignee

  const urgent      = all.filter(p => { const d = daysTo(p.laycan_start); return d !== null && d <= 10 }).length
  const needsVessel = all.filter(p => !p.vessel_name).length
  const needsOwner  = all.filter(p => !p.owner_operator).length
  const editingPlan = all.find(p => p.id === editId)

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Nav */}
      <nav className="bg-gray-800 px-6 py-3 flex justify-between items-center border-b border-gray-700 sticky top-0 z-30">
        <div className="flex items-center gap-3 text-sm">
          <button onClick={() => router.push('/dashboard')} className="text-gray-400 hover:text-white">← Dashboard</button>
          <span className="text-gray-600">/</span>
          <button onClick={() => router.push('/dashboard/cargo-plans')} className="text-gray-400 hover:text-white">Cargo Plans</button>
          <span className="text-gray-600">/</span>
          <span className="text-white font-semibold">Cargo Nomination</span>
          {!loading && <span className="text-gray-500 ml-2">{all.length} active</span>}
        </div>
        <button
          onClick={() => router.push('/dashboard/vessel-planning')}
          className="px-3 py-1.5 bg-yellow-700 hover:bg-yellow-600 rounded text-sm font-medium"
        >
          Vessel Planning →
        </button>
      </nav>

      {/* Edit Panel */}
      {panelOpen && editId && (
        <div ref={panelRef} className="bg-gray-800 border-b border-gray-600 px-6 py-4 sticky top-[57px] z-20 shadow-xl">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold text-sm text-gray-200">
              ✏️ Editing: <span className="text-white">{editingPlan?.cargo_ref}</span>
            </h2>
            <button onClick={() => setPanelOpen(false)} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
          </div>
          <div className="grid grid-cols-6 gap-x-3 gap-y-2 text-xs">
            {([
              ['Vessel',           'vessel_name',    'text'],
              ['Owner / Operator', 'owner_operator', 'text'],
              ['Charterer',        'charterer',      'text'],
              ['Shipper',          'shipper',        'text'],
              ['Consignee',        'consignee',      'text'],
              ['Source',           'source_origin',  'text'],
              ['Load Port',        'load_port',      'text'],
              ['Disch Port',       'discharge_port', 'text'],
              ['Laycan Start',     'laycan_start',   'date'],
              ['Laycan End',       'laycan_end',     'date'],
            ] as [string, keyof EditForm, string][]).map(([label, key, type]) => (
              <div key={key}>
                <p className="text-gray-500 mb-0.5">{label}</p>
                <input type={type} value={form[key]} onChange={e => setF(key, e.target.value)}
                  className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs focus:outline-none focus:border-blue-500" />
              </div>
            ))}
            <div>
              <p className="text-gray-500 mb-0.5">Status</p>
              <select value={form.status} onChange={e => setF('status', e.target.value)}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs focus:outline-none focus:border-blue-500">
                {NOMINATION_STATUSES.map(s => <option key={s} value={s}>{NOMINATION_LABEL[s] ?? s}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <p className="text-gray-500 mb-0.5">Notes</p>
              <input value={form.notes} onChange={e => setF('notes', e.target.value)}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
          <div className="flex gap-2 mt-3">
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

      {/* Delete Confirmation Modal */}
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

      <main className="p-4">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-3">
          <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
            <p className="text-gray-400 text-xs">Active</p>
            <p className="text-2xl font-bold mt-0.5">{all.length}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 border border-red-900">
            <p className="text-gray-400 text-xs">Urgent ≤10d</p>
            <p className={`text-2xl font-bold mt-0.5 ${urgent > 0 ? 'text-red-400' : ''}`}>{urgent}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 border border-yellow-900">
            <p className="text-gray-400 text-xs">Vessel TBN</p>
            <p className={`text-2xl font-bold mt-0.5 ${needsVessel > 0 ? 'text-yellow-400' : ''}`}>{needsVessel}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 border border-blue-900">
            <p className="text-gray-400 text-xs">Owner/Op Missing</p>
            <p className={`text-2xl font-bold mt-0.5 ${needsOwner > 0 ? 'text-blue-400' : ''}`}>{needsOwner}</p>
          </div>
        </div>

        {/* 28-day alert panel */}
        {alertPlans.length > 0 && (
          <div className="bg-amber-950/60 border border-amber-700/50 rounded-lg px-4 py-3 mb-3">
            <p className="text-amber-400 text-xs font-semibold mb-2">⚠ Laycan within {ALERT_DAYS} days</p>
            <div className="flex flex-wrap gap-2">
              {alertPlans.map(p => {
                const d = daysTo(p.laycan_start)
                const badge = urgencyBadge(d)
                return (
                  <button key={p.id} onClick={() => openEdit(p)}
                    className="flex items-center gap-1.5 bg-gray-800/80 hover:bg-gray-700/80 border border-gray-600 rounded px-2 py-1 text-xs transition-colors">
                    <span className="text-white font-medium">{p.cargo_ref}</span>
                    {p.vessel_name && <span className="text-gray-400">· {p.vessel_name}</span>}
                    <span className={`px-1 py-0 rounded text-[10px] ${badge.cls}`}>{badge.label}</span>
                    {p.status === 'LAYCAN_NOMINATED' && (
                      <span className="text-yellow-400/70 text-[9px]">NOM</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-2 mb-3 flex-wrap items-center">
          <input value={fSearch} onChange={e => setFSearch(e.target.value)}
            placeholder="Search ref, vessel, consignee, owner…"
            className="px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-xs text-white w-56 focus:outline-none focus:border-blue-500" />
          {[
            [fStatus,    setFStatus,    'All Statuses',   NOMINATION_STATUSES],
            [fSource,    setFSource,    'All Sources',    sources],
            [fDisch,     setFDisch,     'All Disch Ports',dischPorts],
            [fLoadPort,  setFLoadPort,  'All Load Ports', loadPorts],
            [fVessel,    setFVessel,    'All Vessels',    vessels],
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
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300">
              Clear
            </button>
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
            <p className="text-gray-400 text-sm">No nominations found.</p>
            <p className="text-gray-600 text-xs mt-1">
              Cargoes appear here when owner/operator is set or laycan is within {NOMINATION_DAYS} days.
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
                  <th className="px-3 py-2 text-left whitespace-nowrap">Source</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Laycan Start</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Laycan End</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Load Port</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Disch Port</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Owner / Op</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Charterer</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Consignee</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Status</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {visible.map(p => {
                  const days  = daysTo(p.laycan_start)
                  const badge = urgencyBadge(days)
                  const isEditing = panelOpen && editId === p.id
                  return (
                    <tr key={p.id}
                      className={`transition-colors ${isEditing ? 'bg-blue-900/20' : 'hover:bg-gray-800/60'}`}>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="px-3 py-2 font-medium text-white whitespace-nowrap">{p.cargo_ref}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {p.vessel_name || <span className="text-yellow-600/80 italic">TBN</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-300">{p.source_origin || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmt(p.laycan_start)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmt(p.laycan_end)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-300">{p.load_port || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-300">{p.discharge_port || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {p.owner_operator || <span className="text-blue-500/60 italic text-[10px]">needed</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-300">{p.charterer || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-300">{p.consignee || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <select value={p.status} onChange={e => quickStatus(p.id, e.target.value)}
                          className={`text-[10px] px-1.5 py-0.5 rounded border-0 font-medium cursor-pointer focus:outline-none ${STATUS_COLOR[p.status] || 'bg-gray-600 text-gray-100'}`}>
                          {NOMINATION_STATUSES.map(s => (
                            <option key={s} value={s} className="bg-gray-800 text-white">{NOMINATION_LABEL[s] ?? s}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(p)}
                            className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-[10px]">Edit</button>
                          {p.status === 'LAYCAN_NOMINATED' && (
                            <button onClick={() => router.push('/dashboard/vessel-planning')}
                              className="px-2 py-0.5 bg-yellow-700/70 hover:bg-yellow-600/70 rounded text-[10px] text-yellow-200 whitespace-nowrap">
                              → VP
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
