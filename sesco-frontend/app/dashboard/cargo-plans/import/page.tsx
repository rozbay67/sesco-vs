'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import * as XLSX from 'xlsx'

type ParsedRow = {
  cargo_ref: string
  vessel_name: string | null
  source_origin: string | null
  load_port: string | null
  discharge_port: string | null
  owner_operator: string | null
  quarter: string | null
  laycan_start: string | null
  laycan_end: string | null
  consignee: string | null
  shipper: string | null
  quantity_mt: number | null
  quantity_st: number | null
  discharge_eta: string | null
  items: { cargo_name: string; quantity_mt: number }[]
  errors: string[]
}

const CARGO_COLS: { key: string; col: number }[] = [
  { key: 'Gray Portland Bulk', col: 47 },
  { key: 'Gray Portland SS', col: 48 },
  { key: 'Gray Masonry', col: 49 },
  { key: 'White Masonry', col: 50 },
  { key: 'White Portland', col: 51 },
  { key: 'Slag', col: 52 },
  { key: 'White Portland SS 525R', col: 53 },
  { key: 'White Portland SS C150', col: 54 },
  { key: 'White Masonry SS', col: 55 },
  { key: 'Lime', col: 56 },
]

function excelDateToISO(val: any): string | null {
  if (!val) return null
  if (val instanceof Date) return val.toISOString().split('T')[0]
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val)
    if (!d) return null
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}/)) return val.split('T')[0]
  return null
}

function addDays(dateStr: string | null, days: number): string | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function shortName(name: string): string {
  return name
    .replace('Gray Portland', 'GP')
    .replace('White Portland', 'WP')
    .replace('Masonry', 'M')
}

export default function ImportPage() {
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ success: number; errors: string[] } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const router = useRouter()

  function parseFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer)
      const wb = XLSX.read(data, { type: 'array', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
      const dataRows = raw.slice(4).filter(r => r[0] || r[12])

      const parsed: ParsedRow[] = dataRows.map((r) => {
        const errors: string[] = []
        const cargo_ref = r[12] ? String(r[12]) : null
        if (!cargo_ref) errors.push('Cargo Ref missing')
        const laycan_start = excelDateToISO(r[23])
        const laycan_end = excelDateToISO(r[24])
        const qty_mt = r[14] ? Number(r[14]) : null
        const discharge_eta = addDays(laycan_start, 32)
        const items = CARGO_COLS
          .filter(c => r[c.col] && Number(r[c.col]) > 0)
          .map(c => ({ cargo_name: c.key, quantity_mt: Number(r[c.col]) }))
        return {
          cargo_ref: cargo_ref || '',
          vessel_name: r[4] ? String(r[4]) : null,
          source_origin: r[0] ? String(r[0]) : null,
          load_port: r[16] ? String(r[16]) : null,
          discharge_port: r[32] ? String(r[32]) : null,
          owner_operator: r[3] ? String(r[3]) : null,
          quarter: r[46] ? String(r[46]) : null,
          laycan_start,
          laycan_end,
          consignee: r[10] ? String(r[10]) : null,
          shipper: r[1] ? String(r[1]) : null,
          quantity_mt: qty_mt,
          quantity_st: r[13] ? Number(r[13]) : null,
          discharge_eta,
          items,
          errors,
        }
      })
      setRows(parsed)
      setResult(null)
    }
    reader.readAsArrayBuffer(file)
  }

  function handleFile(file: File) {
    if (!file.name.match(/\.xlsx?$/i)) {
      alert('Please upload an .xlsx or .xls file only')
      return
    }
    parseFile(file)
  }

  async function handleImport() {
    setImporting(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: cargoTypes } = await supabase.from('cargo_types').select('id, cargo_name')
    const cargoTypeMap = Object.fromEntries((cargoTypes || []).map(ct => [ct.cargo_name, ct.id]))

    let success = 0
    const errors: string[] = []

    for (const row of rows) {
      if (row.errors.length > 0) {
        errors.push(`${row.cargo_ref}: ${row.errors.join(', ')}`)
        continue
      }

      const planPayload = {
        cargo_ref: row.cargo_ref,
        planning_stage: 'PLANNING',
        status: 'PLANNED',
        shipper: row.shipper || '',
        consignee: row.consignee || null,
        cargo_description: 'Bulk Cement',
        quantity_mt: row.quantity_mt || 0,
        quantity_st: row.quantity_st || null,
        terminal: row.discharge_port || '',
        load_port: row.load_port || '',
        discharge_port: row.discharge_port || '',
        source_origin: row.source_origin || null,
        owner_operator: row.owner_operator || null,
        laycan_start: row.laycan_start,
        laycan_end: row.laycan_end,
        vessel_name: row.vessel_name || null,
        discharge_eta: row.discharge_eta,
        notes: row.quarter ? `Quarter: ${row.quarter}` : null,
      }

      const { data: plan, error: planErr } = await supabase
        .from('cargo_plans')
        .upsert(planPayload, { onConflict: 'cargo_ref', ignoreDuplicates: false })
        .select('id')
        .single()

      if (planErr || !plan) {
        errors.push(`${row.cargo_ref}: ${planErr?.message || 'plan insert error'}`)
        continue
      }

      for (const item of row.items) {
        const typeId = cargoTypeMap[item.cargo_name]
        if (!typeId) {
          errors.push(`${row.cargo_ref}: cargo type not found — ${item.cargo_name}`)
          continue
        }
        const { error: itemErr } = await supabase
          .from('cargo_plan_items')
          .upsert(
            { cargo_plan_id: plan.id, cargo_type_id: typeId, quantity_mt: item.quantity_mt },
            { onConflict: 'cargo_plan_id,cargo_type_id', ignoreDuplicates: false }
          )
        if (itemErr) errors.push(`${row.cargo_ref} / ${item.cargo_name}: ${itemErr.message}`)
      }
      success++
    }

    setResult({ success, errors })
    setImporting(false)
  }

  const validRows = rows.filter(r => r.errors.length === 0)
  const invalidRows = rows.filter(r => r.errors.length > 0)

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <nav className="bg-gray-800 px-6 py-4 flex items-center gap-4 border-b border-gray-700">
        <button onClick={() => router.push('/dashboard/cargo-plans')} className="text-gray-400 hover:text-white text-sm">
          &larr; Cargo Plans
        </button>
        <h1 className="text-xl font-bold">Excel Import</h1>
      </nav>

      <main className="p-6 max-w-6xl mx-auto">

        {/* Drop Zone */}
        {rows.length === 0 && (
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault()
              setDragOver(false)
              const f = e.dataTransfer.files[0]
              if (f) handleFile(f)
            }}
            className={`border-2 border-dashed rounded-lg p-16 text-center cursor-pointer transition-colors ${dragOver ? 'border-blue-500 bg-blue-500/10' : 'border-gray-600 hover:border-gray-400'}`}
            onClick={() => document.getElementById('fileInput')?.click()}
          >
            <p className="text-2xl mb-2">📂</p>
            <p className="text-lg font-medium mb-1">Drag & drop your Excel file here</p>
            <p className="text-gray-400 text-sm">or click to browse (.xlsx / .xls)</p>
            <input
              id="fileInput"
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
          </div>
        )}

        {/* Preview Table */}
        {rows.length > 0 && !result && (
          <>
            <div className="flex justify-between items-center mb-4">
              <div>
                <span className="text-green-400 font-medium">{validRows.length} valid rows</span>
                {invalidRows.length > 0 && (
                  <span className="text-red-400 ml-4">{invalidRows.length} rows with errors</span>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setRows([])}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                >
                  New File
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing || validRows.length === 0}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium disabled:opacity-50"
                >
                  {importing ? 'Importing...' : `Import ${validRows.length} rows`}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700">
                    <th className="text-left py-2 pr-3">Cargo Ref</th>
                    <th className="text-left py-2 pr-3">Vessel</th>
                    <th className="text-left py-2 pr-3">Load Port</th>
                    <th className="text-left py-2 pr-3">Disch Port</th>
                    <th className="text-left py-2 pr-3">Laycan</th>
                    <th className="text-left py-2 pr-3">ETA</th>
                    <th className="text-right py-2 pr-3">Qty (MT)</th>
                    <th className="text-left py-2 pr-3">Consignee</th>
                    <th className="text-left py-2 pr-3">Cargo Types</th>
                    <th className="text-left py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={i}
                      className={`border-b border-gray-800 ${r.errors.length > 0 ? 'bg-red-900/20' : 'hover:bg-gray-800/50'}`}
                    >
                      <td className="py-2 pr-3 font-mono text-blue-400">{r.cargo_ref || '—'}</td>
                      <td className="py-2 pr-3">{r.vessel_name || '—'}</td>
                      <td className="py-2 pr-3">{r.load_port || '—'}</td>
                      <td className="py-2 pr-3 text-orange-400">{r.discharge_port || '—'}</td>
                      <td className="py-2 pr-3 text-gray-300">{r.laycan_start} → {r.laycan_end}</td>
                      <td className="py-2 pr-3 text-yellow-400">{r.discharge_eta || '—'}</td>
                      <td className="py-2 pr-3 text-right font-mono">{r.quantity_mt?.toLocaleString() || '—'}</td>
                      <td className="py-2 pr-3">{r.consignee || '—'}</td>
                      <td className="py-2 pr-3">
                        {r.items.map(it => (
                          <span key={it.cargo_name} className="inline-block bg-gray-700 rounded px-1 mr-1 mb-1">
                            {shortName(it.cargo_name)}: {it.quantity_mt.toLocaleString()}
                          </span>
                        ))}
                      </td>
                      <td className="py-2">
                        {r.errors.length > 0
                          ? <span className="text-red-400">{r.errors.join(', ')}</span>
                          : <span className="text-green-400">✓</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Result */}
        {result && (
          <div className="text-center py-12">
            <p className="text-3xl font-bold text-green-400 mb-2">
              {result.success} records imported
            </p>
            {result.errors.length > 0 && (
              <div className="mt-4 text-left max-w-lg mx-auto">
                <p className="text-red-400 font-medium mb-2">{result.errors.length} errors:</p>
                {result.errors.map((e, i) => (
                  <p key={i} className="text-red-300 text-sm">{e}</p>
                ))}
              </div>
            )}
            <div className="flex gap-3 justify-center mt-6">
              <button
                onClick={() => { setRows([]); setResult(null) }}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                New Import
              </button>
              <button
                onClick={() => router.push('/dashboard/cargo-plans')}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm"
              >
                Back to Cargo Plans
              </button>
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
