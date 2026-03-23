export type PositionEntry = {
  id: string
  latitude: number
  longitude: number
  speed_knots: number | null
  course_deg: number | null
  ais_status: string | null
  ais_timestamp_utc: string | null
}

export type VesselRow = {
  // identity (from cargo_plans)
  id: string
  cargo_ref: string
  planning_stage: string
  status: string
  vessel_name: string
  owner_operator: string | null
  charterer: string | null
  shipper: string | null
  consignee: string | null
  load_port: string
  discharge_port: string
  laycan_start: string | null
  laycan_end: string | null
  discharge_eta: string | null
  quantity_mt: number
  cp_ref: string | null
  // AIS — latest position
  latitude: number | null
  longitude: number | null
  speed_knots: number | null
  course_deg: number | null
  ais_status: string | null
  ais_timestamp_utc: string | null
  vessel_type: string | null
  dwt: number | null
  departed_from: string | null
  sailed_at: string | null
  destination: string | null
  draft: number | null
  distance_to_go: number | null
  distance_total: number | null
  imo_number: string | null
  eta_utc: string | null
  voyage_status: string | null
  // ais_timestamp_utc is part of VesselRow (from position) AND returned by parseMTText
  vessel_position_id: string | null
  // All historical positions (newest first)
  all_positions: PositionEntry[]
}
