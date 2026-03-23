'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'

type CargoItem = {
  item_id: string
  quantity_mt: number
  cargo_types: { cargo_name: string } | null
}

type CargoPlan = {
  id: string; cargo_ref: string; planning_stage: string; status: string
  shipper: string | null; consignee: string | null; charterer: string | null
  owner_operator: string | null; source_origin: string | null
  cargo_description: string | null; quantity_mt: number
  load_port: string | null; discharge_port: string | null
  laycan_start: string | null; laycan_end: string | null
  discharge_eta: string | null; vessel_name: string | null
  vessel_id: string | null; cp_ref: string | null
  freight_rate: number | null; load_rate: number | null
  disch_rate: number | null; etd: string | null; ets: string | null
  estimated_demurrage_exposure: number | null
  load_agent: string | null; discharge_agent: string | null
  notes: string | null; created_at: string
  cargo_plan_items: CargoItem[]
}

const STATUS_COLOR: Record<string, string> = {
  PLANNED:                'bg-gray-600 text-gray-100',
  CONFIRMED_FOR_FIXTURE:  'bg-blue-700 text-blue-100',
  LAYCAN_NOMINATED:       'bg-yellow-500 text-yellow-900',
  VESSEL_NOMINATED:       'bg-orange-500 text-orange-100',
  VESSEL_ACCEPTED:        'bg-green-700 text-green-100',
  LOADED:                 'bg-purple-600 text-purple-100',
  DISCHARGED:             'bg-indigo-500 text-indigo-100',
  COMPLETED:              'bg-green-800 text-green-100',
  CANCELLED:              'bg-red-700 text-red-100',
  OPEN_FOR_FIXTURE:       'bg-blue-700 text-blue-100',
  FIXTURED:               'bg-green-700 text-green-100',
}

function fmt(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtTs(ts: string | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function CargoDetailPage() {
  const router = useRouter()
  const params = useParams()
  const planId = params.id as string

  const [plan, setPlan] = useState<CargoPlan | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadPlan() }, [planId])

  async function loadPlan() {
    setLoading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data, error } = await supabase
      .from('cargo_plans')
      .select('id,cargo_ref,planning_stage,status,shipper,consignee,charterer,owner_operator,source_origin,cargo_description,quantity_mt,load_port,discharge_port,laycan_start,laycan_end,discharge_eta,vessel_name,vessel_id,cp_ref,freight_rate,load_rate,disch_rate,etd,ets,estimated_demurrage_exposure,load_agent,discharge_agent,notes,created_at,cargo_plan_items(item_id,quantity_mt,cargo_types(cargo_name))')
      .eq('id', planId)
      .single()

    if (error || !data) { setLoading(false); return }
    setPlan(data as unknown as CargoPlan)
    setLoading(false)
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )
  if (!plan) return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <p className="text-red-400">Cargo plan not found.</p>
    </div>
  )

  const totalQty = (plan.cargo_plan_items || []).reduce((s, i) => s + (i.quantity_mt || 0), 0)

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Nav */}
      <nav className="bg-gray-800 px-6 py-3 flex items-center gap-4 border-b border-gray-700 sticky top-0 z-30">
        <button onClick={() => router.push('/dashboard/cargo-plans')} className="text-gray-400 hover:text-white text-sm">
          ← Cargo Plans
        </button>
        <span className="text-gray-600">/</span>
        <span className="font-mono text-blue-400 font-semibold">{plan.cargo_ref}</span>
        <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${STATUS_COLOR[plan.status] || 'bg-gray-600 text-gray-100'}`}>
          {plan.status}
        </span>
      </nav>

      <main className="p-6 max-w-5xl space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Vessel', value: plan.vessel_name || 'TBN' },
            { label: 'Quantity MT', value: (totalQty || plan.quantity_mt || 0).toLocaleString() },
            { label: 'Laycan', value: plan.laycan_start ? `${fmt(plan.laycan_start)} – ${fmt(plan.laycan_end)}` : '—' },
            { label: 'Plan ETA', value: fmt(plan.discharge_eta) },
          ].map(c => (
            <div key={c.label} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
              <p className="text-gray-500 text-[10px] uppercase tracking-wide">{c.label}</p>
              <p className="text-white text-sm font-medium mt-1">{c.value}</p>
            </div>
          ))}
        </div>

        {/* Parties */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Parties</h3>
          <dl className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
            {[
              ['Shipper / Logistics', plan.shipper],
              ['Charterer',           plan.charterer],
              ['Consignee',           plan.consignee],
              ['Owner / Operator',    plan.owner_operator],
              ['Source / Origin',     plan.source_origin],
              ['CP Reference',        plan.cp_ref],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-gray-500 text-xs">{k}</dt>
                <dd className="text-gray-200 mt-0.5">{v || '—'}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Ports & Schedule */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Ports & Schedule</h3>
          <dl className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
            {[
              ['Load Port',              plan.load_port],
              ['Discharge Port',         plan.discharge_port],
              ['Load Agent',             plan.load_agent],
              ['Discharge Agent',        plan.discharge_agent],
              ['Laycan Start',           fmt(plan.laycan_start)],
              ['Laycan End',             fmt(plan.laycan_end)],
              ['ETD',                    fmt(plan.etd)],
              ['ETS',                    fmt(plan.ets)],
              ['Plan ETA (Discharge)',   fmt(plan.discharge_eta)],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-gray-500 text-xs">{k}</dt>
                <dd className="text-gray-200 mt-0.5">{v || '—'}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Rates */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Rates & Commercial</h3>
          <dl className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
            {[
              ['Freight Rate',        plan.freight_rate                  ? `$${plan.freight_rate.toLocaleString()}/MT`         : '—'],
              ['Load Rate',           plan.load_rate                     ? `${plan.load_rate.toLocaleString()} MT/day`          : '—'],
              ['Disch Rate',          plan.disch_rate                    ? `${plan.disch_rate.toLocaleString()} MT/day`         : '—'],
              ['Est. Demurrage Exp.', plan.estimated_demurrage_exposure  ? `$${plan.estimated_demurrage_exposure.toLocaleString()}` : '—'],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-gray-500 text-xs">{k}</dt>
                <dd className="text-gray-200 mt-0.5 font-mono">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Cargo breakdown */}
        {(plan.cargo_plan_items || []).length > 0 && (
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Cargo Breakdown</h3>
            <table className="text-sm w-full">
              <thead>
                <tr className="text-gray-500 text-xs border-b border-gray-700">
                  <th className="text-left pb-2">Type</th>
                  <th className="text-right pb-2">Quantity (MT)</th>
                </tr>
              </thead>
              <tbody>
                {plan.cargo_plan_items.map(i => {
                  const ct = i.cargo_types as any
                  const name = Array.isArray(ct) ? ct[0]?.cargo_name : ct?.cargo_name
                  return (
                    <tr key={i.item_id} className="border-b border-gray-700/50">
                      <td className="py-1.5 text-gray-200">{name || '—'}</td>
                      <td className="py-1.5 text-right font-mono text-teal-300">{i.quantity_mt?.toLocaleString() ?? '—'}</td>
                    </tr>
                  )
                })}
                <tr className="font-semibold">
                  <td className="pt-2 text-gray-400">Total</td>
                  <td className="pt-2 text-right font-mono text-teal-200">{totalQty.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {plan.notes && (
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Notes</h3>
            <p className="text-gray-300 text-sm whitespace-pre-wrap">{plan.notes}</p>
          </div>
        )}

        <p className="text-gray-600 text-xs">Created {fmtTs(plan.created_at)}</p>
      </main>
    </div>
  )
}
