'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const CARGO_STATUSES = [
  'PLANNED', 'OPEN_FOR_FIXTURE', 'VESSEL_NOMINATED', 'LAYCAN_NOMINATED',
  'FIXTURED', 'LOADING', 'SAILED', 'DISCHARGING', 'COMPLETED', 'CANCELLED',
]

const CARGO_COLS = [
  { name: 'Gray Portland Bulk',     short: 'Bulk GP' },
  { name: 'Gray Portland SS',       short: 'GP SS' },
  { name: 'Gray Masonry',           short: 'GM' },
  { name: 'White Masonry',          short: 'WM' },
  { name: 'White Portland',         short: 'WP' },
  { name: 'Slag',                   short: 'Slag' },
  { name: 'White Portland SS 525R', short: 'WP SS(525R)' },
  { name: 'White Portland SS C150', short: 'WP SS(C150)' },
  { name: 'White Masonry SS',       short: 'WM SS' },
  { name: 'Lime',                   short: 'Lime' },
]

const STATUS_COLOR: Record<string, string> = {
  PLANNED:           'bg-gray-600 text-gray-100',
  OPEN_FOR_FIXTURE:  'bg-blue-700 text-blue-100',
  VESSEL_NOMINATED:  'bg-yellow-600 text-yellow-100',
  LAYCAN_NOMINATED:  'bg-yellow-500 text-yellow-900',
  FIXTURED:          'bg-green-700 text-green-100',
  LOADING:           'bg-orange-500 text-orange-100',
  SAILED:            'bg-purple-600 text-purple-100',
  DISCHARGING:       'bg-orange-400 text-orange-900',
  COMPLETED:         'bg-green-800 text-green-100',
  CANCELLED:         'bg-red-700 text-red-100',
}

type CargoItem = { quantity_mt: number; cargo_types: { cargo_name: string } | null }
type CargoPlan = {
  id: string; cargo_ref: string; planning_stage: string; status: string
  shipper: string; consignee: string | null; charterer: string | null
  owner_operator: string | null; source_origin: string | null
  quantity_mt: number; load_port: string; discharge_port: string
  laycan_start: string | null; laycan_end: string | null
  discharge_eta: string | null; vessel_name: string | null
  notes: string | null; created_at: string
  cargo_plan_items: CargoItem[]
}

type EditForm = {
  cargo_ref: string; vessel_name: string; source_origin: string; load_port: string
  discharge_port: string; quarter: string; laycan_start: string; laycan_end: string
  consignee: string; owner_operator: string; shipper: string; charterer: string
  planning_stage: string; status: string; notes: string
  [key: string]: string
}

const blankForm = (): EditForm => ({
  cargo_ref: '', vessel_name: '', source_origin: '', load_port: '',
  discharge_port: '', quarter: '', laycan_start: '', laycan_end: '',
  consignee: '', owner_operator: '', shipper: '', charterer: '',
  planning_stage: 'PLANNING', status: 'PLANNED', notes: '',
  ...Object.fromEntries(CARGO_COLS.map(c => [c.name, ''])),
})

function addDays(d: string | null, n: number): string | null {
  if (!d) return null
  const dt = new Date(d); dt.setDate(dt.getDate() + n)
  return dt.toISOString().split('T')[0]
}
function fmt(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}
function getQuarter(notes: string | null) {
  if (!notes) return '—'
  const m = notes.match(/Quarter:\s*(.+?)(\s*\||$)/i)
  return m ? m[1].trim() : '—'
}
function getQty(items: CargoItem[], name: string): number | null {
  const it = items.find(i => {
    const ct = i.cargo_types as any
    return (Array.isArray(ct) ? ct[0]?.cargo_name : ct?.cargo_name) === name
  })
  return it ? it.quantity_mt : null
}
function planToForm(p: CargoPlan): EditForm {
  const qm = p.notes?.match(/Quarter:\s*(.+?)(\s*\||$)/i)
  return {
    cargo_ref: p.cargo_ref, vessel_name: p.vessel_name || '',
    source_origin: p.source_origin || '', load_port: p.load_port || '',
    discharge_port: p.discharge_port || '', quarter: qm ? qm[1].trim() : '',
    laycan_start: p.laycan_start || '', laycan_end: p.laycan_end || '',
    consignee: p.consignee || '', owner_operator: p.owner_operator || '',
    shipper: p.shipper || '', charterer: p.charterer || '',
    planning_stage: p.planning_stage, status: p.status, notes: '',
    ...Object.fromEntries(CARGO_COLS.map(c => [c.name, String(getQty(p.cargo_plan_items || [], c.name) ?? '')])),
  }
}

export default function CargoPlansPage() {
  const [plans, setPlans] = useState<CargoPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState<string | null>(null)   // null = new plan
  const [panelOpen, setPanelOpen] = useState(false)
  const [form, setForm] = useState<EditForm>(blankForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => { loadPlans() }, [])

  async function loadPlans() {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('cargo_plans')
      .select('id,cargo_ref,planning_stage,status,shipper,consignee,charterer,owner_operator,source_origin,quantity_mt,load_port,discharge_port,laycan_start,laycan_end,discharge_eta,vessel_name,notes,created_at,cargo_plan_items(quantity_mt,cargo_types(cargo_name))')
      .eq('is_archived', false)
      .order('laycan_start', { ascending: true })
    if (error) { setError(error.message); setLoading(false); return }
    setPlans((data || []) as unknown as CargoPlan[])
    setLoading(false)
  }

  function openNew() {
    setEditId(null); setForm(blankForm()); setError(''); setPanelOpen(true)
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }
  function openEdit(p: CargoPlan) {
    setEditId(p.id); setForm(planToForm(p)); setError(''); setPanelOpen(true)
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }
  function setF(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  function calcTotal() { return CARGO_COLS.reduce((s, c) => s + (parseFloat(form[c.name]) || 0), 0) }

  async function handleSave() {
    if (!form.cargo_ref.trim()) { setError('Cargo Ref required'); return }
    setSaving(true); setError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const totalQty = calcTotal()
    const noteParts = []
    if (form.quarter) noteParts.push(`Quarter: ${form.quarter}`)
    if (form.notes) noteParts.push(form.notes)

    const payload: Record<string, any> = {
      cargo_ref: form.cargo_ref.trim(),
      planning_stage: form.planning_stage, status: form.status,
      shipper: form.shipper, charterer: form.charterer || null,
      consignee: form.consignee || null, owner_operator: form.owner_operator || null,
      source_origin: form.source_origin || null,
      cargo_description: 'Bulk Cement',
      quantity_mt: totalQty || 0, load_port: form.load_port,
      discharge_port: form.discharge_port, terminal: form.discharge_port || '',
      laycan_start: form.laycan_start || null, laycan_end: form.laycan_end || null,
      discharge_eta: addDays(form.laycan_start, 32),
      vessel_name: form.vessel_name || null,
      notes: noteParts.join(' | ') || null,
    }

    let planId = editId
    if (editId) {
      const { error: e } = await supabase.from('cargo_plans').update(payload).eq('id', editId)
      if (e) { setError(e.message); setSaving(false); return }
    } else {
      const { data: ins, error: e } = await supabase.from('cargo_plans').insert(payload).select('id').single()
      if (e || !ins) { setError(e?.message || 'Insert failed'); setSaving(false); return }
      planId = ins.id
    }

    // Upsert cargo items
    const { data: cTypes } = await supabase.from('cargo_types').select('id,cargo_name')
    const ctMap = Object.fromEntries((cTypes || []).map(ct => [ct.cargo_name, ct.id]))
    for (const col of CARGO_COLS) {
      const qty = parseFloat(form[col.name]) || 0
      const typeId = ctMap[col.name]
      if (!typeId) continue
      if (qty > 0) {
        await supabase.from('cargo_plan_items').upsert(
          { cargo_plan_id: planId, cargo_type_id: typeId, quantity_mt: qty },
          { onConflict: 'cargo_plan_id,cargo_type_id', ignoreDuplicates: false }
        )
      } else if (editId) {
        await supabase.from('cargo_plan_items').delete()
          .eq('cargo_plan_id', planId!).eq('cargo_type_id', typeId)
      }
    }

    setPanelOpen(false); setSaving(false); loadPlans()
  }

  // Quick status change without opening panel
  async function quickStatus(planId: string, newStatus: string) {
    const supabase = createClient()
    await supabase.from('cargo_plans').update({ status: newStatus }).eq('id', planId)
    setPlans(ps => ps.map(p => p.id === planId ? { ...p, status: newStatus } : p))
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Nav */}
      <nav className="bg-gray-800 px-6 py-3 flex justify-between items-center border-b border-gray-700 sticky top-0 z-30">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/dashboard')} className="text-gray-400 hover:text-white text-sm">← Dashboard</button>
          <h1 className="text-lg font-bold">Cargo Plans</h1>
          {!loading && <span className="text-gray-500 text-sm">{plans.length} records</span>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => router.push('/dashboard/cargo-plans/import')}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm">
            Excel Import
          </button>
          <button onClick={openNew}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium">
            + New Plan
          </button>
        </div>
      </nav>

      {/* Edit / New Panel */}
      {panelOpen && (
        <div ref={panelRef} className="bg-gray-800 border-b border-gray-600 px-6 py-4 sticky top-[57px] z-20 shadow-xl">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold text-sm text-gray-200">
              {editId ? `✏️  Editing: ${form.cargo_ref}` : '➕  New Cargo Plan'}
            </h2>
            <button onClick={() => setPanelOpen(false)} className="text-gray-400 hover:text-white text-lg">✕</button>
          </div>

          <div className="grid grid-cols-6 gap-x-3 gap-y-2 text-xs">
            {/* Row 1: identity */}
            {[
              ['Cargo Ref *', 'cargo_ref'], ['Vessel', 'vessel_name'],
              ['Source', 'source_origin'], ['Load Port', 'load_port'],
              ['Disch Port', 'discharge_port'], ['Quarter', 'quarter'],
            ].map(([label, key]) => (
              <div key={key}>
                <p className="text-gray-500 mb-0.5">{label}</p>
                <input value={form[key]} onChange={e => setF(key, e.target.value)}
                  className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs focus:outline-none focus:border-blue-500" />
              </div>
            ))}

            {/* Row 2: dates + parties */}
            <div>
              <p className="text-gray-500 mb-0.5">Laycan Start</p>
              <input type="date" value={form.laycan_start} onChange={e => setF('laycan_start', e.target.value)}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <p className="text-gray-500 mb-0.5">Laycan End</p>
              <input type="date" value={form.laycan_end} onChange={e => setF('laycan_end', e.target.value)}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs focus:outline-none focus:border-blue-500" />
            </div>
            {[
              ['Consignee', 'consignee'], ['Owner / Operator', 'owner_operator'],
              ['Logistics/Shipper', 'shipper'],
            ].map(([label, key]) => (
              <div key={key}>
                <p className="text-gray-500 mb-0.5">{label}</p>
                <input value={form[key]} onChange={e => setF(key, e.target.value)}
                  className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs focus:outline-none focus:border-blue-500" />
              </div>
            ))}
            <div>
              <p className="text-gray-500 mb-0.5">Status</p>
              <select value={form.status} onChange={e => setF('status', e.target.value)}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs focus:outline-none focus:border-blue-500">
                {CARGO_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>

            {/* Row 3: cargo breakdown */}
            {CARGO_COLS.map(c => (
              <div key={c.name}>
                <p className="text-gray-500 mb-0.5">{c.short}</p>
                <input type="number" value={form[c.name]} onChange={e => setF(c.name, e.target.value)}
                  placeholder="0"
                  className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs font-mono focus:outline-none focus:border-teal-500" />
              </div>
            ))}
            {/* Total display */}
            <div className="flex items-end">
              <div className="w-full px-2 py-1 bg-teal-900/40 border border-teal-700/50 rounded text-xs">
                <p className="text-gray-500">Total</p>
                <p className="font-mono text-teal-300 font-semibold">{calcTotal() > 0 ? calcTotal().toLocaleString() : '—'}</p>
              </div>
            </div>
          </div>

          {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
          <div className="flex gap-2 mt-3">
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium disabled:opacity-50">
              {saving ? 'Saving...' : editId ? 'Save Changes' : 'Create Plan'}
            </button>
            <button onClick={() => setPanelOpen(false)}
              className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Global error */}
      {error && !panelOpen && <p className="text-red-400 px-4 pt-3 text-sm">{error}</p>}

      {/* Table */}
      <main className="p-4">
        {loading ? (
          <p className="text-gray-400 py-8">Loading...</p>
        ) : plans.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-lg mb-1">No cargo plans yet</p>
            <p className="text-sm">Use Excel Import or click + New Plan</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs whitespace-nowrap border-collapse">
              <thead>
                {/* Group header */}
                <tr className="bg-gray-800 text-gray-400 text-[10px]">
                  <th colSpan={2} className="px-2 py-1 text-center border border-gray-700">Vessel</th>
                  <th colSpan={2} className="px-2 py-1 text-center border border-gray-700">Origin</th>
                  <th colSpan={4} className="px-2 py-1 text-center border border-gray-700 bg-gray-700">Schedule</th>
                  <th colSpan={3} className="px-2 py-1 text-center border border-gray-700">Parties</th>
                  <th colSpan={CARGO_COLS.length + 2} className="px-2 py-1 text-center border border-gray-700 bg-teal-900/60">Cargo Breakdown (MT)</th>
                  <th colSpan={2} className="px-2 py-1 text-center border border-gray-700 bg-gray-700">Arrival</th>
                  <th colSpan={2} className="border border-gray-700" />
                </tr>
                {/* Column header */}
                <tr className="bg-gray-800 text-gray-400 text-[11px]">
                  <th className="px-2 py-2 text-left border border-gray-700">Cargo Ref</th>
                  <th className="px-2 py-2 text-left border border-gray-700">Vessel</th>
                  <th className="px-2 py-2 text-left border border-gray-700">Source</th>
                  <th className="px-2 py-2 text-left border border-gray-700">Quarter</th>
                  <th className="px-2 py-2 text-left border border-gray-700 bg-gray-700/50">Laycan Start</th>
                  <th className="px-2 py-2 text-left border border-gray-700 bg-gray-700/50">Laycan End</th>
                  <th className="px-2 py-2 text-left border border-gray-700 bg-gray-700/50">ATB</th>
                  <th className="px-2 py-2 text-left border border-gray-700 bg-gray-700/50">Disch Port</th>
                  <th className="px-2 py-2 text-left border border-gray-700">Consignee</th>
                  <th className="px-2 py-2 text-left border border-gray-700">Owner/Op</th>
                  <th className="px-2 py-2 text-left border border-gray-700">Logistics</th>
                  <th className="px-2 py-2 text-right border border-gray-700 bg-teal-900/40">Total GP</th>
                  {CARGO_COLS.map(c => (
                    <th key={c.name} className="px-2 py-2 text-right border border-gray-700 bg-teal-900/30">{c.short}</th>
                  ))}
                  <th className="px-2 py-2 text-right border border-gray-700 bg-teal-900/60 font-semibold">Total</th>
                  <th className="px-2 py-2 text-left border border-gray-700 bg-gray-700/50">ATA</th>
                  <th className="px-2 py-2 text-left border border-gray-700 bg-gray-700/50">Arrival Date</th>
                  <th className="px-2 py-2 text-left border border-gray-700">Status</th>
                  <th className="px-2 py-2 border border-gray-700" />
                </tr>
              </thead>
              <tbody>
                {plans.map(p => {
                  const items = p.cargo_plan_items || []
                  const totalItems = items.reduce((s, i) => s + (i.quantity_mt || 0), 0)
                  const gpTotal = items.filter(i => {
                    const ct = i.cargo_types as any
                    return (Array.isArray(ct) ? ct[0]?.cargo_name : ct?.cargo_name)?.startsWith('Gray Portland')
                  }).reduce((s, i) => s + (i.quantity_mt || 0), 0)
                  const arrStart = addDays(p.laycan_start, 32)
                  const arrEnd = addDays(p.laycan_end, 32)
                  const isEditing = panelOpen && editId === p.id

                  return (
                    <tr key={p.id}
                      className={`border-b border-gray-800 ${isEditing ? 'bg-blue-900/20' : 'hover:bg-gray-800/40'}`}>
                      <td className="px-2 py-1.5 border border-gray-800 font-mono text-blue-400">{p.cargo_ref}</td>
                      <td className="px-2 py-1.5 border border-gray-800 text-gray-200">{p.vessel_name || 'TBN'}</td>
                      <td className="px-2 py-1.5 border border-gray-800 text-gray-300">{p.source_origin || p.load_port || '—'}</td>
                      <td className="px-2 py-1.5 border border-gray-800 text-yellow-400">{getQuarter(p.notes)}</td>
                      <td className="px-2 py-1.5 border border-gray-800 text-gray-300">{fmt(p.laycan_start)}</td>
                      <td className="px-2 py-1.5 border border-gray-800 text-gray-300">{fmt(p.laycan_end)}</td>
                      <td className="px-2 py-1.5 border border-gray-800 text-gray-500">—</td>
                      <td className="px-2 py-1.5 border border-gray-800 text-orange-400">{p.discharge_port || '—'}</td>
                      <td className="px-2 py-1.5 border border-gray-800">{p.consignee || '—'}</td>
                      <td className="px-2 py-1.5 border border-gray-800 text-gray-300">{p.owner_operator || '—'}</td>
                      <td className="px-2 py-1.5 border border-gray-800 text-gray-300">{p.shipper || '—'}</td>
                      {/* Total GP */}
                      <td className="px-2 py-1.5 border border-gray-800 text-right font-mono bg-teal-900/20">
                        {gpTotal > 0 ? gpTotal.toLocaleString() : totalItems > 0 ? totalItems.toLocaleString() : p.quantity_mt > 0 ? p.quantity_mt.toLocaleString() : '—'}
                      </td>
                      {/* Cargo types */}
                      {CARGO_COLS.map(c => {
                        const qty = getQty(items, c.name)
                        return (
                          <td key={c.name} className="px-2 py-1.5 border border-gray-800 text-right font-mono bg-teal-900/10">
                            {qty ? qty.toLocaleString() : ''}
                          </td>
                        )
                      })}
                      {/* Grand total */}
                      <td className="px-2 py-1.5 border border-gray-800 text-right font-mono font-semibold bg-teal-900/30 text-teal-300">
                        {totalItems > 0 ? totalItems.toLocaleString() : p.quantity_mt > 0 ? p.quantity_mt.toLocaleString() : '—'}
                      </td>
                      <td className="px-2 py-1.5 border border-gray-800 text-gray-500">—</td>
                      <td className="px-2 py-1.5 border border-gray-800 text-yellow-300 text-[10px]">
                        {arrStart && arrEnd ? `${fmt(arrStart)} – ${fmt(arrEnd)}` : fmt(p.discharge_eta)}
                      </td>
                      {/* Status — inline dropdown */}
                      <td className="px-2 py-1.5 border border-gray-800">
                        <select
                          value={p.status}
                          onChange={e => quickStatus(p.id, e.target.value)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-white/20 ${STATUS_COLOR[p.status] || 'bg-gray-600 text-gray-100'}`}
                        >
                          {CARGO_STATUSES.map(s => (
                            <option key={s} value={s} className="bg-gray-800 text-white text-xs">{s}</option>
                          ))}
                        </select>
                      </td>
                      {/* Edit button */}
                      <td className="px-2 py-1.5 border border-gray-800">
                        <button onClick={() => openEdit(p)}
                          className={`px-2 py-0.5 rounded text-[11px] ${isEditing ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}>
                          {isEditing ? 'Editing' : 'Edit'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>

              {/* Footer totals */}
              {plans.length > 0 && (() => {
                const all = plans.flatMap(p => p.cargo_plan_items || [])
                const grand = all.reduce((s, i) => s + (i.quantity_mt || 0), 0)
                const gpGrand = all.filter(i => {
                  const ct = i.cargo_types as any
                  return (Array.isArray(ct) ? ct[0]?.cargo_name : ct?.cargo_name)?.startsWith('Gray Portland')
                }).reduce((s, i) => s + (i.quantity_mt || 0), 0)
                return (
                  <tfoot>
                    <tr className="bg-gray-700/80 font-semibold text-[11px]">
                      <td colSpan={11} className="px-2 py-2 border border-gray-600 text-right text-gray-400">Total</td>
                      <td className="px-2 py-2 border border-gray-600 text-right font-mono bg-teal-900/40 text-teal-200">
                        {gpGrand > 0 ? gpGrand.toLocaleString() : '—'}
                      </td>
                      {CARGO_COLS.map(c => {
                        const t = all.filter(i => {
                          const ct = i.cargo_types as any
                          return (Array.isArray(ct) ? ct[0]?.cargo_name : ct?.cargo_name) === c.name
                        }).reduce((s, i) => s + (i.quantity_mt || 0), 0)
                        return (
                          <td key={c.name} className="px-2 py-2 border border-gray-600 text-right font-mono bg-teal-900/20 text-teal-300">
                            {t > 0 ? t.toLocaleString() : ''}
                          </td>
                        )
                      })}
                      <td className="px-2 py-2 border border-gray-600 text-right font-mono text-teal-300 bg-teal-900/50">
                        {grand > 0 ? grand.toLocaleString() : '—'}
                      </td>
                      <td colSpan={4} className="border border-gray-600" />
                    </tr>
                  </tfoot>
                )
              })()}
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
