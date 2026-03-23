'use client'

import React, { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, Tooltip, ZoomControl, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { VesselRow } from './types'

const TILE = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const ATTR = '©OpenStreetMap ©CARTO'

const PORT_COORDS: Record<string, [number, number]> = {
  'abu qir':    [31.32, 30.08],
  'amreyah':    [31.12, 29.84],
  'alexandria': [31.20, 29.92],
  'houston':    [29.74, -95.28],
  'tampa':      [27.94, -82.45],
  'wingate':    [28.38, -96.87],
  'nuh cement': [36.89, 35.73],
  'iskenderun': [36.59, 36.17],
  'vietnam':    [10.82, 106.63],
  'china':      [22.27, 114.16],
}

function portCoords(name: string | null | undefined): [number, number] | null {
  if (!name) return null
  const low = name.toLowerCase()
  for (const [k, v] of Object.entries(PORT_COORDS)) {
    if (low.includes(k)) return v
  }
  return null
}

function chtrColor(stage: string) {
  if (stage === 'EXECUTION') return '#6366f1'
  if (stage === 'FIXTURE')   return '#eab308'
  return '#f59e0b'
}

// Auto-fit map to vessel positions
function FitBounds({ vessels, selectedId }: { vessels: VesselRow[], selectedId: string | null }) {
  const map = useMap()
  useEffect(() => {
    if (selectedId) {
      // Zoom to selected vessel's route
      const sel = vessels.find(v => v.id === selectedId)
      if (!sel) return
      const points: [number, number][] = []
      if (sel.latitude != null && sel.longitude != null) points.push([sel.latitude, sel.longitude])
      const from = portCoords(sel.departed_from || sel.load_port)
      const to   = portCoords(sel.destination   || sel.discharge_port)
      if (from) points.push(from)
      if (to)   points.push(to)
      if (points.length >= 2) {
        const L = (window as any).L
        if (L) map.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 6 })
      } else if (points.length === 1) {
        map.setView(points[0], 5)
      }
      return
    }

    // All fleet: fit to vessels with AIS positions
    const hasPos = vessels.filter(v => v.latitude != null && v.longitude != null)
    if (hasPos.length > 0) {
      const L = (window as any).L
      if (!L) return
      const bounds = hasPos.map(v => [v.latitude!, v.longitude!] as [number, number])
      map.fitBounds(L.latLngBounds(bounds), { padding: [60, 80], maxZoom: 5 })
    } else {
      // Default: Atlantic / Abu Qir → Houston corridor
      map.setView([28, -25], 3)
    }
  }, [selectedId, vessels.length]) // eslint-disable-line

  return null
}

interface Props {
  vessels: VesselRow[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export default function MapClient({ vessels, selectedId, onSelect }: Props) {
  return (
    <MapContainer
      center={[28, -25]}
      zoom={3}
      style={{ width: '100%', height: '100%', background: '#0a1628' }}
      zoomControl={false}
    >
      <ZoomControl position="topleft" />
      <TileLayer url={TILE} attribution={ATTR} subdomains="abcd" maxZoom={18} />
      <FitBounds vessels={vessels} selectedId={selectedId} />

      {vessels.map(v => {
        const color  = chtrColor(v.planning_stage)
        const hasPos = v.latitude != null && v.longitude != null
        const isSel  = v.id === selectedId
        const currentPos: [number, number] | null = hasPos ? [v.latitude!, v.longitude!] : null
        const fromPos: [number, number] | null = currentPos
          ?? portCoords(v.departed_from || v.load_port)
        const toPos  = portCoords(v.destination || v.discharge_port)

        // Historical positions (oldest → newest, excluding the latest which is currentPos)
        const histPositions = (v.all_positions || []).slice(1).reverse() // [oldest, ..., second-latest]
        // Build past track: departure port → historical positions → current position
        const pastTrack: [number, number][] = []
        const depPort = portCoords(v.departed_from || v.load_port)
        if (depPort) pastTrack.push(depPort)
        for (const p of histPositions) pastTrack.push([p.latitude, p.longitude])
        if (currentPos) pastTrack.push(currentPos)

        return (
          <React.Fragment key={v.id}>
            {/* Past track — solid line (only for selected vessel) */}
            {isSel && pastTrack.length >= 2 && (
              <Polyline
                positions={pastTrack}
                pathOptions={{ color, weight: 2, opacity: 0.8 }}
              />
            )}

            {/* Future route — dashed line (only for selected vessel) */}
            {isSel && fromPos && toPos && (
              <Polyline
                positions={[fromPos, toPos]}
                pathOptions={{ color, weight: 2, opacity: 0.55, dashArray: '8 5' }}
              />
            )}

            {/* Historical position markers — dim, with timestamp tooltip */}
            {isSel && histPositions.map((hp, idx) => (
              <CircleMarker
                key={`hist-${hp.id ?? idx}`}
                center={[hp.latitude, hp.longitude]}
                radius={4}
                pathOptions={{
                  color: color,
                  fillColor: color,
                  fillOpacity: 0.25,
                  weight: 1,
                  opacity: 0.4,
                }}
              >
                <Tooltip permanent direction="top" offset={[0, -5]}
                  className="ais-hist-tip"
                >
                  <span style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'monospace' }}>
                    {hp.ais_timestamp_utc
                      ? new Date(hp.ais_timestamp_utc).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
                        ' ' + new Date(hp.ais_timestamp_utc).toUTCString().slice(17, 22)
                      : '—'}
                  </span>
                </Tooltip>
              </CircleMarker>
            ))}

            {/* Current AIS position marker */}
            {hasPos && (
              <CircleMarker
                center={[v.latitude!, v.longitude!]}
                radius={isSel ? 10 : 7}
                pathOptions={{
                  color: isSel ? '#ffffff' : 'rgba(255,255,255,0.35)',
                  fillColor: color,
                  fillOpacity: 1,
                  weight: isSel ? 2.5 : 1,
                }}
                eventHandlers={{ click: () => onSelect(v.id) }}
              >
                {/* Vessel name label — always visible */}
                <Tooltip permanent direction="top" offset={[0, -10]} className="vessel-name-tip">
                  <span style={{ fontSize: 10, fontWeight: 700, color: color, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                    {v.vessel_name}
                  </span>
                </Tooltip>
                <Popup>
                  <div style={{
                    background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
                    padding: '10px 12px', minWidth: 190, color: '#e2e8f0',
                    fontFamily: 'monospace', fontSize: 11, lineHeight: 1.7,
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 'bold', color: '#f8fafc', marginBottom: 5 }}>
                      {v.vessel_name}
                    </div>
                    <div style={{ color, fontSize: 10, marginBottom: 6 }}>
                      {v.ais_status || v.status}
                    </div>
                    {v.speed_knots != null && (
                      <div><span style={{ color: '#94a3b8' }}>Speed: </span>
                        <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>{v.speed_knots} kn</span>
                      </div>
                    )}
                    <div><span style={{ color: '#94a3b8' }}>Pos: </span>
                      {v.latitude?.toFixed(4)}°N / {Math.abs(v.longitude!).toFixed(4)}°{v.longitude! < 0 ? 'W' : 'E'}
                    </div>
                    {v.course_deg != null && (
                      <div><span style={{ color: '#94a3b8' }}>Course: </span>{v.course_deg}°</div>
                    )}
                    <div><span style={{ color: '#94a3b8' }}>From: </span>{v.departed_from || v.load_port || '—'}</div>
                    <div><span style={{ color: '#94a3b8' }}>To: </span>{v.destination || v.discharge_port || '—'}</div>
                    <div><span style={{ color: '#94a3b8' }}>Ref: </span>
                      <span style={{ color: '#60a5fa' }}>{v.cargo_ref}</span>
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            )}

            {/* Port placeholder dot — when no AIS, show departure port with vessel name */}
            {!hasPos && fromPos && (
              <CircleMarker
                center={fromPos}
                radius={isSel ? 6 : 4}
                pathOptions={{ color, fillColor: color, fillOpacity: 0.3, weight: 1, dashArray: '3' }}
                eventHandlers={{ click: () => onSelect(v.id) }}
              >
                <Tooltip permanent direction="top" offset={[0, -8]} className="vessel-name-tip">
                  <span style={{ fontSize: 10, fontWeight: 700, color: color, fontFamily: 'monospace', whiteSpace: 'nowrap', opacity: 0.65 }}>
                    {v.vessel_name}
                  </span>
                </Tooltip>
              </CircleMarker>
            )}
          </React.Fragment>
        )
      })}

      {/* Fleet legend */}
      <div style={{
        position: 'absolute', bottom: 14, left: 14, zIndex: 1000,
        background: 'rgba(6,14,26,0.92)', border: '1px solid #1e3a5f',
        borderRadius: 6, padding: '8px 12px', fontSize: 11, color: '#cbd5e1',
        pointerEvents: 'none',
      }}>
        <div style={{ fontWeight: 600, fontSize: 9, color: '#4a6080', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
          Fleet
        </div>
        {[['PLAN', '#f59e0b'], ['VOY', '#6366f1'], ['TC', '#eab308']].map(([label, c]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: c, display: 'inline-block' }} />
            <span style={{ color: '#94a3b8' }}>[{label}]</span>
          </div>
        ))}
      </div>
    </MapContainer>
  )
}
