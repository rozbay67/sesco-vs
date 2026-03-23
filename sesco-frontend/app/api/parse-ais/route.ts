import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY not set in .env.local' },
      { status: 500 }
    )
  }

  const { image, mimeType } = await req.json()
  if (!image) return NextResponse.json({ error: 'No image provided' }, { status: 400 })

  const prompt = `Extract vessel AIS data from this MarineTraffic screenshot.
Return ONLY a JSON object (no markdown, no explanation) with these fields if visible:
{
  "vessel_name": string,
  "imo_number": string,
  "mmsi": string,
  "ais_status": string,
  "latitude": number (decimal degrees, positive=N negative=S — convert DMS to decimal if needed),
  "longitude": number (decimal degrees, positive=E negative=W — convert DMS to decimal if needed),
  "speed_knots": number,
  "course_deg": number,
  "draft": number (meters),
  "departed_from": string (port name),
  "sailed_at": string (ISO datetime YYYY-MM-DDTHH:MM:SSZ if visible),
  "destination": string (port name),
  "distance_to_go": number (NM, first number in "X / Y NM" format),
  "distance_total": number (NM, second number in "X / Y NM" format),
  "eta_utc": string (ISO datetime YYYY-MM-DDTHH:MM:SSZ, or YYYY-MM-DDT00:00:00Z if only date visible),
  "ais_timestamp_utc": string (ISO datetime of Last AIS timestamp if visible, YYYY-MM-DDTHH:MM:SSZ),
  "dwt": number,
  "vessel_type": string
}
IMPORTANT: latitude and longitude must be plain decimal numbers (e.g. 24.2249, -87.4236). Convert any DMS format to decimal. Longitude west of 0° must be negative.
Omit fields that are not visible. Return only valid JSON.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/png', data: image } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      return NextResponse.json({ error: data.error?.message || 'API error' }, { status: 500 })
    }

    const text = data.content?.[0]?.text || ''
    const match = text.match(/\{[\s\S]+\}/)
    if (!match) return NextResponse.json({ error: 'No JSON in response', raw: text }, { status: 400 })

    const parsed = JSON.parse(match[0])
    return NextResponse.json({ parsed })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
