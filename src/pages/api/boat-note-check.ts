import type { NextApiRequest, NextApiResponse } from 'next'

// Public, no-login lookup on Trico's own site — confirmed live by fetching
// https://s2.tricologi.net/webuser/?option=etc&action=boatnote_check with a
// real browser User-Agent (it 403s a generic one) and inspecting its form:
// a single POST of cont_numebr to ?option=etc&action=boatnote_check_view
// returns an HTML fragment with the container/vessel and a status line in
// an alert-success/alert-warning/alert-danger div.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const containerNo = String(req.body.containerNo || '').trim().toUpperCase()
    if (!containerNo) return res.status(400).json({ error: 'Container number required' })

    const url = `https://s2.tricologi.net/webuser/?option=etc&action=boatnote_check_view&req_type=raw&rnd=${Math.random()}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body: `cont_numebr=${encodeURIComponent(containerNo)}`,
    })
    const html = await resp.text()

    const vessel = html.match(/Vessel\s*\/\s*Voyage:<\/span>\s*<span>([^<]*)<\/span>/i)?.[1]?.trim() || ''
    const statusMatch = html.match(/class="alert alert-(success|warning|danger)"[^>]*>([^<]*)</i)
    const statusText = statusMatch?.[2]?.trim() || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
    const level = statusMatch?.[1] || 'unknown'

    res.json({ containerNo, vessel, level, status: statusText })
  } catch (err: any) {
    console.error('[boat-note-check] error:', err)
    res.status(500).json({ error: err.message })
  }
}
