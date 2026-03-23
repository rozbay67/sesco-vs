import { NextRequest, NextResponse } from 'next/server'

// fileType: 'image' | 'pdf' | 'text'
// image + mimeType  → image block (vision)
// pdf + image       → document block (Claude PDF support)
// text              → text-only

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set in .env.local' }, { status: 500 })
  }

  const { image, mimeType, text, fileType } = await req.json()
  if (!image && !text) {
    return NextResponse.json({ error: 'Provide image or text' }, { status: 400 })
  }

  const prompt = `Extract vessel Q88 questionnaire / nomination data from the provided content.
Return ONLY a JSON object (no markdown, no explanation) with these fields if visible:
{
  "vessel_name": string,
  "imo_number": string,
  "mmsi": string,
  "call_sign": string,
  "flag": string,
  "year_built": string (4-digit year as string),
  "vessel_type": string,
  "dwt": string (numeric value only, metric tons),
  "loa": string (numeric value only, meters),
  "beam": string (numeric value only, meters),
  "max_draft": string (numeric value only, meters),
  "holds_count": string (integer as string),
  "gear_description": string (e.g. "4 x 30t cranes"),
  "class_society": string,
  "p_and_i_club": string
}
Omit fields that are not visible. Return only valid JSON.`

  const content: object[] = []

  if (image && fileType === 'pdf') {
    // Claude native PDF document support
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: image },
    })
  } else if (image) {
    // Image (PNG/JPG) — vision
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mimeType || 'image/png', data: image },
    })
  }

  content.push({
    type: 'text',
    text: text ? `${prompt}\n\nText to parse:\n${text}` : prompt,
  })

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content }],
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      return NextResponse.json({ error: data.error?.message || 'API error' }, { status: 500 })
    }

    const txt = data.content?.[0]?.text || ''
    const match = txt.match(/\{[\s\S]+\}/)
    if (!match) return NextResponse.json({ error: 'No JSON in response', raw: txt }, { status: 400 })

    const parsed = JSON.parse(match[0])
    return NextResponse.json({ parsed })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
