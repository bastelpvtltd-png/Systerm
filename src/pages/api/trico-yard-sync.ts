import { NextApiRequest, NextApiResponse } from 'next'
import { supabase } from '@/lib/supabase'

const LOGIN_URL = 'https://s2.tricologi.net/webuser/?option=user'
const DATA_URL = 'https://s2.tricologi.net/webuser/?option=tv&action=cont_in_yard_tv&req_type=raw'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// Trico credentials — move these to env vars (TRICO_USERNAME / TRICO_PASSWORD)
// as soon as you can; hardcoded here only so the flow can be verified first.
const TRICO_USERNAME = process.env.TRICO_USERNAME || 'TV'
const TRICO_PASSWORD = process.env.TRICO_PASSWORD || '1tv@'

// Node's fetch (undici) exposes multiple Set-Cookie headers via getSetCookie().
// Fall back to a single header read for older runtimes.
function getSetCookies(res: Response): string[] {
  const anyHeaders = res.headers as any
  if (typeof anyHeaders.getSetCookie === 'function') return anyHeaders.getSetCookie()
  const single = res.headers.get('set-cookie')
  return single ? [single] : []
}

// Simple cookie jar: merges new Set-Cookie values into the existing jar
// (same-named cookies get overwritten) and returns the jar's Cookie header.
function mergeCookies(jar: Map<string, string>, setCookieHeaders: string[]): void {
  for (const raw of setCookieHeaders) {
    const pair = raw.split(';')[0] // "name=value"
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    jar.set(name, value)
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
}

async function tricoLogin(): Promise<string> {
  const jar = new Map<string, string>()

  // Step 1: GET the login page first — Trico issues a session cookie here,
  // and the login POST below must carry it so the login attaches to THIS
  // session rather than creating an orphaned one.
  const loginPageRes = await fetch(LOGIN_URL, {
    method: 'GET',
    headers: { 'User-Agent': UA },
    cache: 'no-store',
  })
  mergeCookies(jar, getSetCookies(loginPageRes))

  // Step 2: POST credentials, carrying the session cookie from step 1.
  const body = new URLSearchParams({
    login_user_id: TRICO_USERNAME,
    login_password: TRICO_PASSWORD,
    btn_login: 'Login',
  })

  const loginRes = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      'Referer': LOGIN_URL,
      'Cookie': cookieHeader(jar),
    },
    body: body.toString(),
    redirect: 'manual', // logins often 302-redirect; we only need the Set-Cookie from this response
  })
  mergeCookies(jar, getSetCookies(loginRes))

  if (jar.size === 0) {
    throw new Error('Trico login did not return any session cookie — check username/password or login field names.')
  }
  return cookieHeader(jar)
}

interface YardRow {
  veh_no: string
  container_no: string
  cusdec_no: string
  cdn: string
  shipper: string
  time_in: string
  duration: string
  status: string
  updated_at: string
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
}

// Parses the yard carousel HTML into row objects. The page repeats the same
// table across several "carousel-slide" divs, so we just parse every <tr>
// we find — exact duplicates collapse naturally at the upsert dedupe step.
function parseYardHtml(html: string): YardRow[] {
  const rows: YardRow[] = []
  const rowRe = /<tr class="border-b border-gray-200[^"]*">([\s\S]*?)<\/tr>/g
  let rowMatch: RegExpExecArray | null

  while ((rowMatch = rowRe.exec(html)) !== null) {
    const rowHtml = rowMatch[1]
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g
    const cells: string[] = []
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) cells.push(cellMatch[1])

    if (cells.length < 8) continue // malformed/partial row, skip

    const statusSpanMatch = cells[7].match(/<span[^>]*>([^<]*)<\/span>/)
    const status = statusSpanMatch ? statusSpanMatch[1].trim() : ''

    rows.push({
      veh_no: stripTags(cells[0]),
      container_no: stripTags(cells[1]),
      cusdec_no: stripTags(cells[2]),
      cdn: stripTags(cells[3]),
      shipper: stripTags(cells[4]),
      time_in: stripTags(cells[5]),
      duration: stripTags(cells[6]),
      status,
      updated_at: new Date().toISOString(),
    })
  }

  return rows
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const cookie = await tricoLogin()

    const response = await fetch(DATA_URL, {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': DATA_URL,
        'Cookie': cookie,
      },
      cache: 'no-store',
    })

    const html = await response.text()

    if (!html.includes('container-table')) {
      return res.status(400).json({
        error: 'Logged in but the yard table was not found in the response — Trico page structure may have changed.',
        snippet: html.slice(0, 200),
      })
    }

    const containers = parseYardHtml(html).filter(c => c.container_no !== '')

    if (containers.length === 0) {
      return res.status(200).json({ message: 'No containers found in Trico yard.', fetched: 0 })
    }

    // Duplicate අයින් කිරීම (Container + Cusdec + CDN) — collapses the
    // repeated carousel slides, which share identical rows within THIS fetch.
    const uniqueMap = new Map<string, YardRow>()
    containers.forEach(c => {
      const uniqueKey = `${c.container_no}-${c.cusdec_no}-${c.cdn}`
      if (!uniqueMap.has(uniqueKey)) uniqueMap.set(uniqueKey, c)
    })
    const uniqueContainers = Array.from(uniqueMap.values())

    // Skip rows that are ALREADY saved from a previous sync (same
    // container_no + cusdec_no + cdn combo) so a re-run every 20 min doesn't
    // keep re-touching records that haven't actually changed. Only genuinely
    // new (or changed) combos get written.
    const containerNos = uniqueContainers.map(c => c.container_no)
    const { data: existingRows, error: fetchError } = await supabase
      .from('trico_yard')
      .select('container_no, cusdec_no, cdn')
      .in('container_no', containerNos)

    if (fetchError) throw fetchError

    const existingKeys = new Set(
      (existingRows || []).map((r: any) => `${r.container_no}-${r.cusdec_no}-${r.cdn}`)
    )

    const newOrChanged = uniqueContainers.filter(
      c => !existingKeys.has(`${c.container_no}-${c.cusdec_no}-${c.cdn}`)
    )

    if (newOrChanged.length === 0) {
      return res.status(200).json({
        message: `No new containers — all ${uniqueContainers.length} already saved.`,
        fetched: 0,
        skipped: uniqueContainers.length,
      })
    }

    const { error: upsertError } = await supabase
      .from('trico_yard')
      .upsert(newOrChanged, { onConflict: 'container_no' })

    if (upsertError) throw upsertError

    return res.status(200).json({
      message: `Synced ${newOrChanged.length} new/changed container(s), skipped ${uniqueContainers.length - newOrChanged.length} already-saved.`,
      fetched: newOrChanged.length,
      skipped: uniqueContainers.length - newOrChanged.length,
    })
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Sync failed' })
  }
}