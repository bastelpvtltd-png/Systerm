import { NextApiRequest, NextApiResponse } from 'next'
import { supabase } from '@/lib/supabase'

const LOGIN_PAGE_URL = 'https://s2.tricologi.net/webuser/?option=user'
const LOGIN_ACTION_URL = 'https://s2.tricologi.net/webuser/user/login_validate.php'
// The visible yard page renders empty and fills rows in via this JS-driven
// AJAX endpoint — that's the one that actually carries the data.
const DATA_JSON_URL = 'https://s2.tricologi.net/webuser/?option=tv&action=cont_in_yard_load_json_ajax&req_type=raw'
const DATA_PAGE_URL = 'https://s2.tricologi.net/webuser/?option=tv&action=cont_in_yard_tv&req_type=raw'
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

async function tricoLogin(): Promise<{ cookie: string; debug: any }> {
  const jar = new Map<string, string>()

  // Step 1: GET the login page — this issues the session cookie AND embeds
  // a one-time "token" hidden field that login_validate.php requires.
  const loginPageRes = await fetch(LOGIN_PAGE_URL, {
    method: 'GET',
    headers: { 'User-Agent': UA },
    cache: 'no-store',
  })
  const getCookies = getSetCookies(loginPageRes)
  mergeCookies(jar, getCookies)
  const loginPageHtml = await loginPageRes.text()

  const tokenMatch = loginPageHtml.match(/<input[^>]*name="token"[^>]*value="([^"]+)"/i)
  const token = tokenMatch ? tokenMatch[1] : null
  if (!token) {
    throw Object.assign(new Error('Could not find the login "token" field on the Trico login page — it may require a different flow now.'), {
      debug: { getStatus: loginPageRes.status, getCookieCount: getCookies.length, loginPageSnippet: loginPageHtml.slice(0, 300) },
    })
  }

  // Step 2: POST credentials + token to the real form action
  // (login_validate.php), carrying the session cookie from step 1.
  const body = new URLSearchParams({
    login_user_id: TRICO_USERNAME,
    login_password: TRICO_PASSWORD,
    token,
  })

  const loginRes = await fetch(LOGIN_ACTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      'Referer': LOGIN_PAGE_URL,
      'Cookie': cookieHeader(jar),
    },
    body: body.toString(),
    redirect: 'manual',
  })
  const postCookies = getSetCookies(loginRes)
  mergeCookies(jar, postCookies)

  let postBodySnippet = ''
  let postBodyFull = ''
  if (loginRes.status < 300 || loginRes.status >= 400) {
    try {
      postBodyFull = await loginRes.text()
      postBodySnippet = postBodyFull.slice(0, 300)
    } catch { /* ignore */ }
  }

  const stillShowsLoginForm = /name="login_user_id"/.test(postBodyFull)
  const bodyMentionsInvalid = /invalid|incorrect|failed|wrong/i.test(postBodyFull)

  const debug = {
    tokenFound: true,
    getStatus: loginPageRes.status,
    getCookieCount: getCookies.length,
    postStatus: loginRes.status,
    postLocation: loginRes.headers.get('location') || null,
    postCookieCount: postCookies.length,
    finalJarKeys: Array.from(jar.keys()),
    postBodySnippet,
    stillShowsLoginForm,
    bodyMentionsInvalid,
  }

  if (jar.size === 0) {
    throw Object.assign(new Error('Trico login did not return any session cookie.'), { debug })
  }
  return { cookie: cookieHeader(jar), debug }
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

// We don't know Trico's exact JSON key names yet (never seen a real payload —
// every earlier attempt hit the login page instead). This tries a handful of
// likely candidates per field so a first real run has the best chance of
// mapping correctly; the handler also logs a raw sample for calibration.
function pick(item: any, candidates: string[]): string {
  for (const key of candidates) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== '') return String(item[key])
  }
  return ''
}

function mapJsonItem(item: any): YardRow {
  const released = pick(item, ['released', 'is_released'])
  const examination = pick(item, ['examination', 'is_examination'])
  let status = pick(item, ['status'])
  if (!status) {
    if (released === 'R' || released === '1' || released === 'true') status = 'R'
    else if (examination === 'E' || examination === '1' || examination === 'true') status = 'E'
  }

  return {
    veh_no: pick(item, ['cont_vehno', 'veh_no', 'vehicle_no', 'vehno', 'VehNo']),
    container_no: pick(item, ['cont_number', 'container_no', 'container_number', 'ContainerNo']),
    cusdec_no: pick(item, ['cusdec_no', 'cusdec_number', 'cusdec', 'CusdecNo']),
    cdn: pick(item, ['cdn_number', 'cdn_no', 'cdn', 'Cdn']),
    shipper: pick(item, ['shipper_name', 'shipper', 'Shipper']),
    time_in: pick(item, ['time_in', 'timein', 'TimeIn']),
    duration: pick(item, ['duration', 'Duration']),
    status,
    updated_at: new Date().toISOString(),
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { cookie, debug: loginDebug } = await tricoLogin()

    const response = await fetch(DATA_JSON_URL, {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': DATA_PAGE_URL,
        'Cookie': cookie,
      },
      cache: 'no-store',
    })

    const text = await response.text()

    if (!text.trim().startsWith('[') && !text.trim().startsWith('{')) {
      return res.status(400).json({
        error: 'Logged in, but the JSON endpoint did not return JSON — session may not be recognized there, or the endpoint changed.',
        snippet: text.slice(0, 200),
        loginDebug,
      })
    }

    const rawData = JSON.parse(text)
    const rawItems: any[] = Array.isArray(rawData) ? rawData
      : Array.isArray(rawData.data) ? rawData.data
      : Array.isArray(rawData.items) ? rawData.items
      : Array.isArray(rawData.rows) ? rawData.rows
      : []

    if (rawItems.length === 0) {
      return res.status(200).json({ message: 'No containers found in Trico yard.', fetched: 0, rawSample: rawData })
    }

    const containers = rawItems.map(mapJsonItem).filter(c => c.container_no !== '')

    if (containers.length === 0) {
      // Rows came back but our field-name guesses matched nothing — surface
      // a raw sample so the mapping can be corrected in one shot.
      return res.status(200).json({
        message: `Got ${rawItems.length} raw item(s) but could not map any container_no — field names likely differ.`,
        fetched: 0,
        rawSample: rawItems.slice(0, 2),
      })
    }

    // Duplicate අයින් කිරීම (Container + Cusdec + CDN)
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
    return res.status(500).json({ error: error.message || 'Sync failed', loginDebug: error.debug })
  }
}