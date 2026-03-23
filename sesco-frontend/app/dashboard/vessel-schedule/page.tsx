'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase'
import type { VesselRow } from './types'

const MapClient = dynamic(() => import('./MapClient'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center text-[#4a6080] text-sm">
      Loading map…
    </div>
  ),
})

// ── helpers ────────────────────────────────────────────────────────────────
function chtrBadge(stage: string) {
  if (stage === 'EXECUTION') return 'VOY'
  if (stage === 'FIXTURE')   return 'TC'
  return 'PLAN'
}
const BADGE_STYLE: Record<string, string> = {
  PLAN: 'bg-amber-500 text-black',
  VOY:  'bg-indigo-500 text-white',
  TC:   'bg-yellow-400 text-black',
}

function isLive(ts: string | null) {
  return !!ts && Date.now() - new Date(ts).getTime() < 48 * 3_600_000
}
function fmt(d: string | null | undefined) {
  if (!d) return 'N/A'
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? String(d)
    : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtTs(ts: string | null) {
  if (!ts) return 'N/A'
  const dt = new Date(ts)
  if (isNaN(dt.getTime())) return ts
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + dt.toUTCString().slice(17, 22) + ' UTC'
}
function voyProgress(v: VesselRow) {
  if (v.distance_total && v.distance_to_go) {
    return Math.max(0, Math.min(100, Math.round((v.distance_total - v.distance_to_go) / v.distance_total * 100)))
  }
  if (v.sailed_at && v.discharge_eta) {
    const total = new Date(v.discharge_eta).getTime() - new Date(v.sailed_at).getTime()
    const done  = Date.now() - new Date(v.sailed_at).getTime()
    if (total > 0) return Math.max(0, Math.min(100, Math.round(done / total * 100)))
  }
  return null
}

// Calculated ETA = sailed_at + (distance_total / avg_reported_speed)
// avg_reported_speed = average of all AIS-reported speed_knots; fallback to latest speed_knots
function calcEta(v: VesselRow): Date | null {
  if (!v.sailed_at || !v.distance_total || v.distance_total <= 0) return null

  // Average of all historically reported speeds (only positive values)
  const speeds = (v.all_positions || [])
    .map(p => p.speed_knots)
    .filter((s): s is number => s != null && s > 0)
  const avgSpeed = speeds.length > 0
    ? speeds.reduce((a, b) => a + b, 0) / speeds.length
    : (v.speed_knots && v.speed_knots > 0 ? v.speed_knots : null)

  if (!avgSpeed || avgSpeed <= 0) return null

  const hoursTotal = v.distance_total / avgSpeed
  return new Date(new Date(v.sailed_at).getTime() + hoursTotal * 3_600_000)
}

// ── voyage status ──────────────────────────────────────────────────────────
const VOYAGE_STATUSES = [
  'ENROUTE_LP','ARRIVED_LP','LOADING','SAILED_LP',
  'UNDERWAY_UE','ARRIVED_DP','ANCHORAGE','DISCHARGING','COMPLETED','SAILED_DP',
]
const VOYAGE_STATUS_LABEL: Record<string, string> = {
  ENROUTE_LP:  'Enroute to LP',
  ARRIVED_LP:  'Arrived LP',
  LOADING:     'Loading',
  SAILED_LP:   'Sailed from LP',
  UNDERWAY_UE: 'Underway (Engine)',
  ARRIVED_DP:  'Arrived DP',
  ANCHORAGE:   'Anchorage',
  DISCHARGING: 'Discharging',
  COMPLETED:   'Completed',
  SAILED_DP:   'Sailed from DP',
}
const VOYAGE_STATUS_COLOR: Record<string, string> = {
  ENROUTE_LP:  '#60a5fa',
  ARRIVED_LP:  '#34d399',
  LOADING:     '#fbbf24',
  SAILED_LP:   '#a78bfa',
  UNDERWAY_UE: '#93c5fd',
  ARRIVED_DP:  '#6ee7b7',
  ANCHORAGE:   '#fde68a',
  DISCHARGING: '#fdba74',
  COMPLETED:   '#86efac',
  SAILED_DP:   '#c4b5fd',
}

// Statuses that appear in vessel schedule
// Flow: Cargo Nomination → Vessel Planning → Vessel Schedule
// Only accepted + active voyage statuses; completed/nominated leave this view
const VS_STATUSES = [
  'VESSEL_ACCEPTED', 'LOADED', 'DISCHARGED',
  // backward compat
  'FIXTURED', 'SAILED', 'LOADING', 'DISCHARGING',
]

// Cargo plan status label/color for the schedule
const CARGO_STATUS_LABEL: Record<string, string> = {
  VESSEL_ACCEPTED: 'Accepted',
  LOADED:          'Loaded',
  DISCHARGED:      'Discharged',
  FIXTURED:        'Fixtured',
  SAILED:          'Sailed',
  LOADING:         'Loading',
  DISCHARGING:     'Discharging',
}
const CARGO_STATUS_COLOR: Record<string, string> = {
  VESSEL_ACCEPTED: 'bg-green-700 text-green-100',
  LOADED:          'bg-purple-600 text-purple-100',
  DISCHARGED:      'bg-indigo-500 text-indigo-100',
  FIXTURED:        'bg-teal-700 text-teal-100',
  SAILED:          'bg-purple-600 text-purple-100',
  LOADING:         'bg-orange-500 text-orange-100',
  DISCHARGING:     'bg-orange-400 text-orange-900',
}

// ── page ───────────────────────────────────────────────────────────────────
export default function VesselSchedulePage() {
  const [vessels,    setVessels]    = useState<VesselRow[]>([])
  const [loading,    setLoading]    = useState(true)
  const [isAdmin,    setIsAdmin]    = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [aisTarget,  setAisTarget]  = useState<VesselRow | null>(null)
  const [showModal,  setShowModal]  = useState(false)
  const [aisText,    setAisText]    = useState('')
  const [aisImage,   setAisImage]   = useState<string | null>(null)
  const [aisMime,    setAisMime]    = useState('image/png')
  const [aisSaving,  setAisSaving]  = useState(false)
  const [aisParsed,  setAisParsed]  = useState<Partial<VesselRow> | null>(null)
  const [aisError,   setAisError]   = useState('')
  // Edit override modal
  const [showEdit,   setShowEdit]   = useState(false)
  const [editForm,   setEditForm]   = useState<Record<string,string>>({})
  const detailRef  = useRef<HTMLDivElement>(null)
  const fileRef    = useRef<HTMLInputElement>(null)
  const router     = useRouter()

  // ── load data ─────────────────────────────────────────────────────────
  const loadVessels = useCallback(async () => {
    const supabase = createClient()

    // Check admin role
    const { data: roles } = await supabase.from('user_roles').select('role').eq('is_archived', false)
    setIsAdmin((roles || []).some((r: any) => r.role === 'Admin'))

    // Fetch all non-archived plans with a vessel name — filter status client-side
    // (server-side enum .in() fails if any value is not yet in the DB enum)
    const { data: plans, error: plansErr } = await supabase
      .from('cargo_plans')
      .select('id,cargo_ref,planning_stage,status,voyage_status,vessel_name,owner_operator,charterer,shipper,consignee,load_port,discharge_port,laycan_start,laycan_end,discharge_eta,quantity_mt,cp_ref,vessel_id')
      .neq('is_archived', true)
      .order('laycan_start', { ascending: true })

    if (plansErr || !plans) { setLoading(false); return }

    const VS_STATUS_SET = new Set(VS_STATUSES)

    // Client-side: status filter + exclude TBN / blank vessel names
    const realPlans = (plans as any[]).filter(p =>
      VS_STATUS_SET.has(p.status) &&
      p.vessel_name && p.vessel_name.trim() !== '' && !p.vessel_name.toUpperCase().startsWith('TBN')
    )

    // Latest vessel_positions per vessel_name — limit prevents unbounded table scan
    const { data: positions } = await supabase
      .from('vessel_positions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)

    // Group ALL positions per vessel (already sorted desc by created_at)
    const posGroups: Record<string, any[]> = {}
    for (const pos of positions || []) {
      const key = (pos.vessel_name || '').toLowerCase().trim()
      if (key) {
        if (!posGroups[key]) posGroups[key] = []
        posGroups[key].push(pos)
      }
    }

    const rows: VesselRow[] = realPlans.map((p: any) => {
      const vesselKey = (p.vessel_name || '').toLowerCase().trim()
      const allPos = posGroups[vesselKey] || []
      const pos = allPos[0] || {}
      return {
        id: p.id, cargo_ref: p.cargo_ref,
        planning_stage: p.planning_stage, status: p.status,
        voyage_status: p.voyage_status ?? null,
        vessel_name: p.vessel_name,
        owner_operator: p.owner_operator, charterer: p.charterer,
        shipper: p.shipper, consignee: p.consignee,
        load_port: p.load_port, discharge_port: p.discharge_port,
        laycan_start: p.laycan_start, laycan_end: p.laycan_end,
        discharge_eta: p.discharge_eta, quantity_mt: p.quantity_mt, cp_ref: p.cp_ref,
        latitude:         pos.latitude         ?? null,
        longitude:        pos.longitude        ?? null,
        speed_knots:      pos.speed_knots      ?? null,
        course_deg:       pos.course_deg       ?? null,
        ais_status:       pos.status           ?? null,
        ais_timestamp_utc: pos.ais_timestamp_utc ?? null,
        vessel_type:      pos.vessel_type      ?? null,
        dwt:              pos.dwt              ?? null,
        departed_from:    pos.departed_from    ?? null,
        sailed_at:        pos.sailed_at        ?? null,
        destination:      pos.destination      ?? null,
        draft:            pos.draft            ?? null,
        distance_to_go:   pos.distance_to_go   ?? null,
        distance_total:   pos.distance_total   ?? null,
        imo_number:       pos.imo_number       ?? null,
        eta_utc:          pos.eta_utc          ?? null,
        vessel_position_id: pos.id             ?? null,
        all_positions: allPos
          .filter((p: any) => p.latitude != null && p.longitude != null)
          .map((p: any) => ({
            id: p.id,
            latitude: p.latitude,
            longitude: p.longitude,
            speed_knots: p.speed_knots ?? null,
            course_deg: p.course_deg ?? null,
            ais_status: p.status ?? null,
            ais_timestamp_utc: p.ais_timestamp_utc ?? p.created_at ?? null,
          })),
      }
    })

    setVessels(rows)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadVessels()
    const supabase = createClient()
    const sub = supabase.channel('vs_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vessel_positions' }, loadVessels)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cargo_plans' },     loadVessels)
      .subscribe()
    return () => { supabase.removeChannel(sub) }
  }, [loadVessels])

  const selected = vessels.find(v => v.id === selectedId) ?? null

  function handleSelect(id: string) {
    setSelectedId(p => p === id ? null : id)
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }

  // ── image upload ──────────────────────────────────────────────────────
  function handleImageFile(file: File) {
    const reader = new FileReader()
    reader.onload = e => {
      const dataUrl = e.target?.result as string
      const [header, b64] = dataUrl.split(',')
      const mime = header.match(/:(.*?);/)?.[1] || 'image/png'
      setAisImage(b64)
      setAisMime(mime)
    }
    reader.readAsDataURL(file)
  }

  async function parseImage() {
    if (!aisImage) return
    setAisSaving(true); setAisError(''); setAisParsed(null)
    try {
      const res = await fetch('/api/parse-ais', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: aisImage, mimeType: aisMime }),
      })
      const json = await res.json()
      if (json.error) { setAisError(json.error); setAisSaving(false); return }
      setAisParsed(json.parsed)
    } catch (e: any) { setAisError(e.message) }
    setAisSaving(false)
  }

  async function saveAis() {
    if (!aisTarget) return
    const data = aisParsed || parseMTText(aisText)
    if (!data || Object.keys(data).length === 0) { setAisError('No data to save'); return }
    setAisSaving(true); setAisError('')

    const supabase = createClient()
    const { data: vRow } = await supabase.from('vessels').select('id')
      .eq('vessel_name', aisTarget.vessel_name).maybeSingle()

    // Use AIS-reported timestamp if parsed, otherwise record current time as "saved_at"
    const parsedTs = data.ais_timestamp_utc
    const payload: Record<string, any> = {
      vessel_name:       aisTarget.vessel_name,
      vessel_id:         vRow?.id ?? null,
      source:            aisImage ? 'screenshot_image' : 'screenshot_text',
      raw_text:          aisText || null,
      ais_timestamp_utc: parsedTs || new Date().toISOString(),
    }
    const map: Record<string, string> = {
      latitude: 'latitude', longitude: 'longitude', speed_knots: 'speed_knots',
      course_deg: 'course_deg', ais_status: 'status', vessel_type: 'vessel_type',
      dwt: 'dwt', departed_from: 'departed_from', sailed_at: 'sailed_at',
      destination: 'destination', draft: 'draft', distance_to_go: 'distance_to_go',
      distance_total: 'distance_total', imo_number: 'imo_number', eta_utc: 'eta_utc',
    }
    for (const [src, dest] of Object.entries(map)) {
      const val = (data as any)[src]
      if (val != null) payload[dest] = val
    }

    const { error: e } = await supabase.from('vessel_positions').insert(payload)
    if (e) { setAisError(e.message); setAisSaving(false); return }
    closeModal(); loadVessels()
  }

  function closeModal() {
    setShowModal(false); setAisText(''); setAisImage(null); setAisParsed(null); setAisError('')
    setAisSaving(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function quickVoyageStatus(planId: string, newStatus: string) {
    const supabase = createClient()
    const val = newStatus || null
    await supabase.from('cargo_plans').update({ voyage_status: val }).eq('id', planId)
    setVessels(vs => vs.map(v => v.id === planId ? { ...v, voyage_status: val } : v))
  }
  function openModal(v: VesselRow) {
    // Always reset ALL parse state before opening
    setAisTarget(v); setAisText(''); setAisImage(null); setAisParsed(null)
    setAisError(''); setAisSaving(false)
    if (fileRef.current) fileRef.current.value = ''
    setShowModal(true)
  }
  function openEditModal(v: VesselRow) {
    setAisTarget(v)
    setEditForm({
      ais_status:     v.ais_status     || '',
      latitude:       v.latitude       != null ? String(v.latitude)    : '',
      longitude:      v.longitude      != null ? String(v.longitude)   : '',
      speed_knots:    v.speed_knots    != null ? String(v.speed_knots) : '',
      course_deg:     v.course_deg     != null ? String(v.course_deg)  : '',
      draft:          v.draft          != null ? String(v.draft)       : '',
      departed_from:  v.departed_from  || '',
      sailed_at:      v.sailed_at      ? v.sailed_at.slice(0, 16) : '',
      destination:    v.destination    || '',
      distance_to_go: v.distance_to_go != null ? String(v.distance_to_go)  : '',
      distance_total: v.distance_total != null ? String(v.distance_total)   : '',
      imo_number:     v.imo_number     || '',
      vessel_type:    v.vessel_type    || '',
      dwt:            v.dwt            != null ? String(v.dwt) : '',
      eta_utc:        v.eta_utc        ? v.eta_utc.slice(0, 16) : '',
    })
    setAisError(''); setShowEdit(true)
  }
  async function saveEdit() {
    if (!aisTarget) return
    setAisSaving(true); setAisError('')
    const supabase = createClient()
    const { data: vRow } = await supabase.from('vessels').select('id')
      .eq('vessel_name', aisTarget.vessel_name).maybeSingle()
    const n = (k: string) => editForm[k] ? parseFloat(editForm[k]) : null
    const payload: Record<string, any> = {
      vessel_name: aisTarget.vessel_name,
      vessel_id:   vRow?.id ?? null,
      source:      'manual_edit',
      ais_timestamp_utc: new Date().toISOString(),
      status:        editForm.ais_status    || null,
      latitude:      n('latitude'),
      longitude:     n('longitude'),
      speed_knots:   n('speed_knots'),
      course_deg:    n('course_deg'),
      draft:         n('draft'),
      departed_from: editForm.departed_from || null,
      sailed_at:     editForm.sailed_at     || null,
      destination:   editForm.destination   || null,
      distance_to_go:  n('distance_to_go'),
      distance_total:  n('distance_total'),
      imo_number:    editForm.imo_number    || null,
      vessel_type:   editForm.vessel_type   || null,
      dwt:           n('dwt'),
      eta_utc:       editForm.eta_utc       || null,
    }
    const { error: e } = await supabase.from('vessel_positions').insert(payload)
    if (e) { setAisError(e.message); setAisSaving(false); return }
    setShowEdit(false); setAisSaving(false); loadVessels()
  }

  const pct        = selected ? voyProgress(selected) : null
  const selectedCalcEta = selected ? calcEta(selected) : null

  // ── render ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0a1628', color: '#e2e8f0' }}>

      {/* ── NAV ── */}
      <nav style={{ background: '#060e1a', borderBottom: '1px solid #1e3a5f' }}
        className="px-6 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3 text-sm">
          <button onClick={() => router.push('/dashboard')}
            className="text-[#4a6080] hover:text-white transition-colors">← Dashboard</button>
          <span className="text-[#1e3a5f]">/</span>
          <span className="font-bold text-white tracking-wide">VESSEL SCHEDULE</span>
          {!loading && (
            <span style={{ color: '#4a6080', fontSize: 12 }}>{vessels.length} vessels</span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => router.push('/dashboard/vessel-planning')}
            style={{ background: '#111d2c', border: '1px solid #1e3a5f' }}
            className="px-3 py-1.5 rounded text-xs text-[#94a3b8] hover:text-white transition-colors">
            Vessel Planning
          </button>
          <button onClick={loadVessels}
            style={{ background: '#111d2c', border: '1px solid #1e3a5f' }}
            className="px-3 py-1.5 rounded text-xs text-[#94a3b8] hover:text-white transition-colors">
            ↻ Refresh
          </button>
        </div>
      </nav>

      {/* ── FLEET MAP ── */}
      <div style={{ background: '#060e1a', borderBottom: '1px solid #1e3a5f' }}>
        <div className="px-5 py-2 flex items-center justify-between">
          <span className="text-xs font-semibold tracking-widest text-[#4a6080] uppercase">
            Fleet Map — All Vessels
          </span>
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setSelectedId(null)}
              style={{ background: selectedId === null ? '#1e3a5f' : '#111d2c', border: '1px solid #1e3a5f' }}
              className="px-2 py-0.5 rounded text-[10px] text-[#94a3b8] hover:text-white">
              ALL
            </button>
            {vessels.map(v => {
              const b = chtrBadge(v.planning_stage)
              return (
                <button key={v.id} onClick={() => handleSelect(v.id)}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-opacity ${BADGE_STYLE[b]} ${selectedId === v.id ? 'opacity-100' : 'opacity-60 hover:opacity-90'}`}>
                  {v.vessel_name}
                </button>
              )
            })}
          </div>
        </div>
        <div className="mx-4 mb-3 rounded-lg overflow-hidden" style={{ height: 460, border: '1px solid #1e3a5f' }}>
          <MapClient vessels={vessels} selectedId={selectedId} onSelect={handleSelect} />
        </div>
      </div>

      {/* ── VESSEL SCHEDULE TABLE ── */}
      <div className="flex-1 p-4">
        <div className="text-xs font-semibold tracking-widest text-[#4a6080] uppercase mb-3">
          Vessel Schedule
        </div>

        {loading ? (
          <p className="text-[#4a6080] text-sm p-4">Loading…</p>
        ) : vessels.length === 0 ? (
          <div style={{ background: '#111d2c', border: '1px solid #1e3a5f' }}
            className="rounded-lg p-10 text-center">
            <p className="text-[#4a6080] text-sm">No vessels in schedule.</p>
            <p className="text-[#2a4060] text-xs mt-1">Assign a vessel name to a cargo plan to see it here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid #1e3a5f' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: '#060e1a', borderBottom: '1px solid #1e3a5f' }}>
                  {['CHTR','VESSEL','TYPE','STATUS','POSITION','SPEED','DEPARTED','DESTINATION','ETA (AIS / CALC / PLAN)','LAST AIS','MT LIVE'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left whitespace-nowrap"
                      style={{ color: '#4a6080', fontWeight: 600, letterSpacing: '0.05em', fontSize: 10 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vessels.map((v, i) => {
                  const badge = chtrBadge(v.planning_stage)
                  const live  = isLive(v.ais_timestamp_utc)
                  const isSel = v.id === selectedId
                  return (
                    <tr key={v.id} onClick={() => handleSelect(v.id)}
                      style={{
                        background: isSel ? '#0d2040' : i % 2 === 0 ? '#0d1825' : '#0f1e30',
                        borderLeft: isSel ? '3px solid #3b82f6' : '3px solid transparent',
                        borderBottom: '1px solid #1a2e45',
                        cursor: 'pointer',
                      }}
                      className="transition-colors hover:brightness-110">

                      {/* CHTR */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${BADGE_STYLE[badge]}`}>
                          {badge}
                        </span>
                      </td>

                      {/* VESSEL */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <p className="font-semibold whitespace-nowrap" style={{ color: '#60a5fa', fontSize: 12 }}>
                            {v.vessel_name}
                          </p>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium whitespace-nowrap ${CARGO_STATUS_COLOR[v.status] || 'bg-gray-700 text-gray-300'}`}>
                            {CARGO_STATUS_LABEL[v.status] || v.status}
                          </span>
                        </div>
                        {v.cargo_ref   && <p style={{ color: '#334d66', fontSize: 9 }}>{v.cargo_ref}</p>}
                        {v.charterer    && <p style={{ color: '#64748b', fontSize: 10 }}>Chtr: {v.charterer}</p>}
                        {v.owner_operator && <p style={{ color: '#64748b', fontSize: 10 }}>Owner: {v.owner_operator}</p>}
                        {v.imo_number   && <p style={{ color: '#334d66', fontSize: 9 }}>IMO {v.imo_number}</p>}
                      </td>

                      {/* TYPE */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <p style={{ color: '#94a3b8' }}>{v.vessel_type || 'Voyage'}</p>
                        {v.dwt && <p style={{ color: '#4a6080', fontSize: 10 }}>{v.dwt.toLocaleString()} DWT</p>}
                      </td>

                      {/* VOYAGE STATUS */}
                      <td className="px-3 py-2.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        {isAdmin ? (
                          <select
                            value={v.voyage_status || ''}
                            onChange={e => quickVoyageStatus(v.id, e.target.value)}
                            style={{
                              background: '#0d1825',
                              border: '1px solid #1e3a5f',
                              color: v.voyage_status ? VOYAGE_STATUS_COLOR[v.voyage_status] : '#4a6080',
                              fontSize: 10, borderRadius: 4, padding: '2px 4px', cursor: 'pointer',
                            }}
                          >
                            <option value="">— Not set —</option>
                            {VOYAGE_STATUSES.map(s => (
                              <option key={s} value={s} style={{ background: '#0d1825', color: '#e2e8f0' }}>
                                {VOYAGE_STATUS_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <p style={{ color: v.voyage_status ? VOYAGE_STATUS_COLOR[v.voyage_status] : '#4a6080', fontSize: 11 }}>
                            {v.voyage_status ? VOYAGE_STATUS_LABEL[v.voyage_status] : (CARGO_STATUS_LABEL[v.status] || v.status)}
                          </p>
                        )}
                        {v.ais_status && (
                          <p style={{ color: '#334d66', fontSize: 9, marginTop: 2 }}>{v.ais_status}</p>
                        )}
                      </td>

                      {/* POSITION */}
                      <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: '#94a3b8', fontFamily: 'monospace' }}>
                        {v.latitude != null
                          ? `${v.latitude.toFixed(5)}N / ${v.longitude!.toFixed(5)}W`
                          : <span style={{ color: '#334d66' }}>N/A</span>}
                      </td>

                      {/* SPEED */}
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {v.speed_knots != null
                          ? <span style={{ color: v.speed_knots > 0 ? '#fbbf24' : '#64748b', fontFamily: 'monospace', fontWeight: 'bold' }}>
                              {v.speed_knots} kn
                            </span>
                          : <span style={{ color: '#334d66' }}>—</span>}
                      </td>

                      {/* DEPARTED */}
                      <td className="px-3 py-2.5">
                        <p className="whitespace-nowrap" style={{ color: '#94a3b8' }}>
                          {v.departed_from || v.load_port || 'N/A'}
                        </p>
                        {v.sailed_at && (
                          <p style={{ color: '#334d66', fontSize: 9 }}>
                            {new Date(v.sailed_at).toISOString().replace('T',' ').slice(0,19)}
                          </p>
                        )}
                      </td>

                      {/* DESTINATION */}
                      <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: '#94a3b8' }}>
                        {v.destination || v.discharge_port || 'N/A'}
                      </td>

                      {/* ETA */}
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs">
                        {v.eta_utc ? (
                          <p style={{ color: '#34d399', fontWeight: 600 }}>
                            <span style={{ color: '#4a6080', fontSize: 9, marginRight: 4 }}>AIS</span>
                            {fmt(v.eta_utc)}
                          </p>
                        ) : (
                          <p style={{ color: '#334d66', fontSize: 9 }}>AIS —</p>
                        )}
                        {(() => { const c = calcEta(v); return c ? (
                          <p style={{ color: '#fbbf24' }}>
                            <span style={{ color: '#4a6080', fontSize: 9, marginRight: 4 }}>CALC</span>
                            {fmt(c.toISOString())}
                          </p>
                        ) : <p style={{ color: '#334d66', fontSize: 9 }}>CALC —</p> })()}
                        <p style={{ color: '#60a5fa', fontSize: 10 }}>
                          <span style={{ color: '#334d66', fontSize: 9, marginRight: 4 }}>PLAN</span>
                          {fmt(v.discharge_eta)}
                        </p>
                      </td>

                      {/* LAST AIS */}
                      <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: '#4a6080', fontSize: 10 }}>
                        {fmtTs(v.ais_timestamp_utc)}
                      </td>

                      {/* MT LIVE */}
                      <td className="px-3 py-2.5 text-center">
                        {isAdmin ? (
                          <button onClick={e => { e.stopPropagation(); openModal(v) }}
                            className="px-2 py-0.5 rounded text-[10px] font-bold transition-colors"
                            style={{ background: live ? '#14532d' : '#1a2a3a', color: live ? '#86efac' : '#64748b', border: `1px solid ${live ? '#166534' : '#1e3a5f'}` }}>
                            {live ? 'Live' : 'No AIS'}
                          </button>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px]"
                            style={{ background: live ? '#14532d' : '#1a2a3a', color: live ? '#86efac' : '#64748b' }}>
                            {live ? 'Live' : 'No AIS'}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── DETAIL PANEL ── */}
        {selected && (
          <div ref={detailRef} className="mt-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold tracking-wider uppercase text-sm" style={{ color: '#94a3b8' }}>
                {selected.vessel_name} — Vessel Detail
              </h2>
              <div className="flex items-center gap-3">
                {isAdmin && (
                  <>
                    <button onClick={() => openEditModal(selected)}
                      style={{ background: '#1a2a10', border: '1px solid #2a4a18' }}
                      className="px-3 py-1 rounded text-xs text-[#86efac] hover:text-white">
                      ✏️ Edit Override
                    </button>
                    <button onClick={() => openModal(selected)}
                      style={{ background: '#0d2040', border: '1px solid #1e3a5f' }}
                      className="px-3 py-1 rounded text-xs text-[#60a5fa] hover:text-white">
                      📷 Update AIS
                    </button>
                  </>
                )}
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-xs" style={{ color: '#64748b' }}>MARINETRAFFIC LIVE</span>
                </span>
                <button onClick={() => setSelectedId(null)}
                  style={{ background: '#111d2c', border: '1px solid #1e3a5f' }}
                  className="px-2 py-1 rounded text-xs text-[#64748b] hover:text-white">
                  ✕ Close
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {/* STATUS & CARGO */}
              <div style={{ background: '#0d1825', border: '1px solid #1e3a5f' }} className="rounded-lg p-4">
                <p style={{ color: '#334d66', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                  Status & Cargo
                </p>
                <p style={{ color: '#34d399', fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
                  {selected.ais_status || selected.status}
                </p>
                <p style={{ color: '#334d66', fontSize: 10, textTransform: 'uppercase', marginBottom: 6 }}>Cargo</p>
                <div className="space-y-1 text-xs" style={{ color: '#94a3b8' }}>
                  <p>Type: <span style={{ color: '#e2e8f0' }}>Bulk Cement</span></p>
                  <p>Total: <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: 14 }}>
                    {selected.quantity_mt?.toLocaleString()} MT
                  </span></p>
                  {selected.cargo_ref && <p>Ref: <span style={{ color: '#60a5fa' }}>{selected.cargo_ref}</span></p>}
                  {selected.consignee && <p>Consignee: <span style={{ color: '#e2e8f0' }}>{selected.consignee}</span></p>}
                  {selected.shipper   && <p>Logistics: <span style={{ color: '#94a3b8' }}>{selected.shipper}</span></p>}
                </div>
              </div>

              {/* POSITION & SPEED */}
              <div style={{ background: '#0d1825', border: '1px solid #1e3a5f' }} className="rounded-lg p-4">
                <p style={{ color: '#334d66', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                  Position & Speed
                </p>
                {selected.latitude != null ? (
                  <div className="space-y-3 text-xs">
                    <div>
                      <p style={{ color: '#334d66', fontSize: 9, textTransform: 'uppercase' }}>LAT/LNG</p>
                      <p style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                        {selected.latitude.toFixed(6)}° / {selected.longitude?.toFixed(6)}°
                      </p>
                    </div>
                    <div>
                      <p style={{ color: '#334d66', fontSize: 9, textTransform: 'uppercase' }}>SPEED</p>
                      <p style={{ color: '#fbbf24', fontWeight: 700, fontSize: 18 }}>{selected.speed_knots} kn</p>
                    </div>
                    {selected.course_deg != null && (
                      <div>
                        <p style={{ color: '#334d66', fontSize: 9, textTransform: 'uppercase' }}>COURSE</p>
                        <p style={{ color: '#e2e8f0' }}>{selected.course_deg}°</p>
                      </div>
                    )}
                    {selected.draft != null && (
                      <div>
                        <p style={{ color: '#334d66', fontSize: 9, textTransform: 'uppercase' }}>DRAFT</p>
                        <p style={{ color: '#e2e8f0' }}>{selected.draft}m</p>
                      </div>
                    )}
                    <div>
                      <p style={{ color: '#334d66', fontSize: 9, textTransform: 'uppercase' }}>LAST AIS</p>
                      <p style={{ color: '#64748b', fontSize: 10 }}>{fmtTs(selected.ais_timestamp_utc)}</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center mt-6">
                    <p style={{ color: '#334d66', fontSize: 12 }}>No AIS data</p>
                    {isAdmin && (
                      <button onClick={() => openModal(selected)}
                        style={{ background: '#0d2040', border: '1px solid #1e3a5f', marginTop: 8 }}
                        className="px-3 py-1.5 rounded text-xs text-[#60a5fa]">
                        + Add AIS Data
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* VOYAGE */}
              <div style={{ background: '#0d1825', border: '1px solid #1e3a5f' }} className="rounded-lg p-4">
                <p style={{ color: '#334d66', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                  Voyage
                </p>
                <div className="space-y-2.5 text-xs">
                  {[
                    ['FROM',      selected.departed_from || selected.load_port],
                    ['SAILED',    selected.sailed_at ? fmtTs(selected.sailed_at) : 'N/A'],
                    ['TO',        selected.destination || selected.discharge_port],
                    ['CARGO REF', selected.cargo_ref],
                    ['LAYCAN',    selected.laycan_start ? `${fmt(selected.laycan_start)} – ${fmt(selected.laycan_end)}` : 'N/A'],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <p style={{ color: '#334d66', fontSize: 9, textTransform: 'uppercase' }}>{label}</p>
                      <p style={{ color: label === 'CARGO REF' ? '#60a5fa' : '#e2e8f0' }}>{val || '—'}</p>
                    </div>
                  ))}
                  {/* ETA comparison block */}
                  <div style={{ borderTop: '1px solid #1e3a5f', paddingTop: 8, marginTop: 4 }}>
                    <p style={{ color: '#334d66', fontSize: 9, textTransform: 'uppercase', marginBottom: 6 }}>ETA</p>
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span style={{ color: '#4a6080', fontSize: 9 }}>AIS (vessel reported)</span>
                        <span style={{ color: selected.eta_utc ? '#34d399' : '#334d66', fontWeight: 600, fontSize: 11 }}>
                          {selected.eta_utc ? fmt(selected.eta_utc) : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span style={{ color: '#4a6080', fontSize: 9 }}>CALC (sailed_at + dist/avg kn)</span>
                        <span style={{ color: selectedCalcEta ? '#fbbf24' : '#334d66', fontWeight: 600, fontSize: 11 }}>
                          {selectedCalcEta ? fmt(selectedCalcEta.toISOString()) : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span style={{ color: '#4a6080', fontSize: 9 }}>PLAN (laycan+32d)</span>
                        <span style={{ color: '#60a5fa', fontSize: 11 }}>
                          {fmt(selected.discharge_eta)}
                        </span>
                      </div>
                    </div>
                  </div>
                  {selected.distance_total != null && (
                    <div>
                      <p style={{ color: '#334d66', fontSize: 9, textTransform: 'uppercase' }}>DISTANCE</p>
                      <p style={{ color: '#e2e8f0' }}>
                        {selected.distance_to_go
                          ? `${Math.round(selected.distance_total - selected.distance_to_go).toLocaleString()} / ${selected.distance_total.toLocaleString()} NM`
                          : `${selected.distance_total.toLocaleString()} NM`}
                      </p>
                    </div>
                  )}
                  {pct != null && (
                    <div>
                      <p style={{ color: '#334d66', fontSize: 9, textTransform: 'uppercase', marginBottom: 4 }}>PROGRESS</p>
                      <div style={{ background: '#1e3a5f', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: '#22c55e', transition: 'width 0.3s' }} />
                      </div>
                      <p style={{ color: '#22c55e', fontSize: 11, marginTop: 2 }}>{pct}%</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── AIS INPUT MODAL ── */}
      {showModal && aisTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}>
          <div style={{ background: '#0d1825', border: '1px solid #1e3a5f', width: 540, maxHeight: '85vh' }}
            className="rounded-xl p-6 overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-bold text-sm text-white">Update AIS — {aisTarget.vessel_name}</h3>
                <p style={{ color: '#4a6080', fontSize: 11, marginTop: 2 }}>
                  Upload MarineTraffic screenshot or paste text
                </p>
              </div>
              <button onClick={closeModal} className="text-[#4a6080] hover:text-white text-xl">✕</button>
            </div>

            {/* Image upload */}
            <div
              style={{ border: '2px dashed #1e3a5f', borderRadius: 8, padding: '16px', marginBottom: 12, cursor: 'pointer', textAlign: 'center' }}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImageFile(f) }}>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f) }} />
              {aisImage
                ? <p style={{ color: '#34d399', fontSize: 12 }}>✓ Image loaded — ready to parse</p>
                : <p style={{ color: '#4a6080', fontSize: 12 }}>Drop screenshot here or click to upload</p>}
            </div>

            {aisImage && (
              <button onClick={parseImage} disabled={aisSaving}
                style={{ background: '#1e3a5f', border: '1px solid #2a5080', marginBottom: 12, width: '100%' }}
                className="px-4 py-2 rounded text-xs font-semibold text-[#60a5fa] hover:text-white disabled:opacity-50">
                {aisSaving ? 'Parsing with AI…' : '🤖 Parse with Claude AI'}
              </button>
            )}

            {/* OR text paste */}
            <p style={{ color: '#334d66', fontSize: 10, textTransform: 'uppercase', marginBottom: 6 }}>
              — or paste MarineTraffic text —
            </p>
            <textarea value={aisText} onChange={e => setAisText(e.target.value)} rows={7}
              placeholder={'MV G TAISHAN\nIMO: 9440992\nStatus: Underway using Engine\nPosition: 32.028912°N / -28.57659°W\nSpeed: 11.1 kn\nCourse: 262°\nDraft: 11m\nLast AIS: 12 Mar 2026 23:54 UTC\nDeparted: Abu Qir, Egypt\nDestination: HOUSTON\nETA: 28 Mar 2026\nDistance: 2927 / 5854 NM'}
              style={{ background: '#060e1a', border: '1px solid #1e3a5f', color: '#e2e8f0', fontFamily: 'monospace', fontSize: 11, width: '100%', borderRadius: 6, padding: 10, resize: 'none' }}
            />

            {/* Parsed preview — compute once to avoid repeated parseMTText calls */}
            {(() => {
              const previewData = aisParsed || (aisText ? parseMTText(aisText) : null)
              if (!previewData || Object.keys(previewData).length === 0) return null
              return (
                <div style={{ background: '#060e1a', border: '1px solid #1e3a5f', borderRadius: 6, padding: 10, marginTop: 8, fontSize: 11 }}>
                  <p style={{ color: '#4a6080', fontSize: 10, marginBottom: 6 }}>Parsed data:</p>
                  {Object.entries(previewData)
                    .filter(([, v]) => v != null)
                    .map(([k, v]) => (
                      <p key={k} style={{ color: '#94a3b8' }}>
                        <span style={{ color: '#4a6080' }}>{k}: </span>{String(v)}
                      </p>
                    ))}
                </div>
              )
            })()}

            {aisError && <p className="text-red-400 text-xs mt-2">{aisError}</p>}

            <div className="flex gap-2 mt-4">
              <button onClick={saveAis} disabled={aisSaving || (!aisText && !aisParsed)}
                style={{ background: '#1e4a8a', border: '1px solid #2a5080' }}
                className="px-4 py-2 rounded text-xs font-semibold text-white disabled:opacity-40 flex-1">
                {aisSaving ? 'Saving…' : 'Save AIS Data'}
              </button>
              <button onClick={closeModal}
                style={{ background: '#111d2c', border: '1px solid #1e3a5f' }}
                className="px-4 py-2 rounded text-xs text-[#64748b] hover:text-white">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── EDIT OVERRIDE MODAL ── */}
      {showEdit && aisTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}>
          <div style={{ background: '#0d1825', border: '1px solid #1e3a5f', width: 520, maxHeight: '85vh' }}
            className="rounded-xl p-6 overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-bold text-sm text-white">Edit AIS — {aisTarget.vessel_name}</h3>
                <p style={{ color: '#4a6080', fontSize: 11, marginTop: 2 }}>
                  Override AIS data — saves a new position record
                </p>
              </div>
              <button onClick={() => setShowEdit(false)} className="text-[#4a6080] hover:text-white text-xl">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs mb-4">
              {[
                ['AIS Status',      'ais_status',     'text'],
                ['Latitude (°N)',   'latitude',       'number'],
                ['Longitude (°E/W)','longitude',      'number'],
                ['Speed (kn)',       'speed_knots',    'number'],
                ['Course (°)',       'course_deg',     'number'],
                ['Draft (m)',        'draft',          'number'],
                ['Departed From',   'departed_from',  'text'],
                ['Sailed At',       'sailed_at',      'datetime-local'],
                ['Destination',     'destination',    'text'],
                ['Dist to Go (NM)', 'distance_to_go', 'number'],
                ['Total Dist (NM)', 'distance_total', 'number'],
                ['IMO Number',      'imo_number',     'text'],
                ['Vessel Type',     'vessel_type',    'text'],
                ['DWT',             'dwt',            'number'],
                ['AIS ETA',         'eta_utc',        'datetime-local'],
              ].map(([label, key, type]) => (
                <div key={key}>
                  <p style={{ color: '#4a6080', marginBottom: 3 }}>{label}</p>
                  <input
                    type={type}
                    value={editForm[key] || ''}
                    onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{ background: '#060e1a', border: '1px solid #1e3a5f', color: '#e2e8f0', borderRadius: 5, padding: '5px 8px', width: '100%', fontSize: 11 }}
                  />
                </div>
              ))}
            </div>
            {aisError && <p className="text-red-400 text-xs mb-2">{aisError}</p>}
            <div className="flex gap-2">
              <button onClick={saveEdit} disabled={aisSaving}
                style={{ background: '#1a4a1a', border: '1px solid #2a6a2a' }}
                className="px-4 py-2 rounded text-xs font-semibold text-[#86efac] disabled:opacity-40 flex-1">
                {aisSaving ? 'Saving…' : 'Save Override'}
              </button>
              <button onClick={() => setShowEdit(false)}
                style={{ background: '#111d2c', border: '1px solid #1e3a5f' }}
                className="px-4 py-2 rounded text-xs text-[#64748b] hover:text-white">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── simple text parser (fallback when no Claude API) ──────────────────────
function parseMTText(raw: string): Partial<VesselRow> {
  if (!raw.trim()) return {}
  const get = (patterns: RegExp[]) => {
    for (const p of patterns) { const m = raw.match(p); if (m) return m[1]?.trim() }
    return null
  }
  const lngRaw = get([/(\d+\.\d+)[°\s]*[EW]/i])
  const lngDir = raw.match(/\d+\.\d+[°\s]*([EW])/i)?.[1]?.toUpperCase()
  const lngVal = lngRaw ? parseFloat(lngRaw) * (lngDir === 'W' ? -1 : 1) : undefined

  const res: Partial<VesselRow> = {}
  const lat = get([/(\d+\.\d+)[°\s]*N/i])
  if (lat) res.latitude = parseFloat(lat)
  if (lngVal != null) res.longitude = lngVal
  const spd = get([/Speed[:\s]+([\d.]+)\s*kn/i])
  if (spd) res.speed_knots = parseFloat(spd)
  const crs = get([/Course[:\s]+([\d.]+)/i])
  if (crs) res.course_deg = parseFloat(crs)
  const dft = get([/Draft[:\s]+([\d.]+)/i])
  if (dft) res.draft = parseFloat(dft)
  const imo = get([/IMO[:\s#]+(\d{7,})/i])
  if (imo) res.imo_number = imo
  const sts = get([/Status[:\s]+([^\n]+)/i, /Navigation Status[:\s]+([^\n]+)/i])
  if (sts) res.ais_status = sts
  const dep = get([/Departed?[:\s]+([^\n]+)/i, /From[:\s]+([^\n]+)/i])
  if (dep) res.departed_from = dep
  const dst = get([/Destination[:\s]+([^\n]+)/i, /To[:\s]+([^\n]+)/i])
  if (dst) res.destination = dst
  const dwt = get([/DWT[:\s]+([\d,]+)/i])
  if (dwt) res.dwt = parseFloat(dwt.replace(',',''))
  const vt = get([/Ship Type[:\s]+([^\n]+)/i, /Type[:\s]+([^\n]+)/i])
  if (vt) res.vessel_type = vt
  const d2g = get([/Distance[:\s]+([\d,]+)\s*\/\s*([\d,]+)\s*NM/i])
  if (d2g) {
    const m = raw.match(/Distance[:\s]+([\d,]+)\s*\/\s*([\d,]+)\s*NM/i)
    if (m) { res.distance_to_go = parseFloat(m[1].replace(',','')); res.distance_total = parseFloat(m[2].replace(',','')) }
  }
  const etaStr = get([/ETA[:\s]+([^\n]+)/i])
  if (etaStr) {
    const d = new Date(etaStr.trim())
    if (!isNaN(d.getTime())) res.eta_utc = d.toISOString()
  }
  const lastAis = get([/Last AIS[:\s]+([^\n]+)/i, /AIS Update[:\s]+([^\n]+)/i])
  if (lastAis) {
    const d = new Date(lastAis.trim())
    if (!isNaN(d.getTime())) res.ais_timestamp_utc = d.toISOString()
  }
  return res
}
