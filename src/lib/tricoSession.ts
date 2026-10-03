// Logs in to Trico (s2.tricologi.net) with a given username/password and returns
// the session Cookie header. Same two-step flow trico-yard-sync.ts already uses
// (GET login page -> one-time "token" field -> POST login_validate.php), but
// takes the credentials as arguments so each shipper's own Trico login can be
// used instead of one hardcoded account.
const LOGIN_PAGE_URL = 'https://s2.tricologi.net/webuser/?option=user'
const LOGIN_ACTION_URL = 'https://s2.tricologi.net/webuser/user/login_validate.php'
export const TRICO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function getSetCookies(res: Response): string[] {
  const h = res.headers as any
  if (typeof h.getSetCookie === 'function') return h.getSetCookie()
  const single = res.headers.get('set-cookie')
  return single ? [single] : []
}

function mergeCookies(jar: Map<string, string>, headers: string[]) {
  for (const raw of headers) {
    const pair = raw.split(';')[0]
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
  }
}

const cookieHeader = (jar: Map<string, string>) => Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ')

export async function tricoLoginWith(username: string, password: string): Promise<string> {
  const jar = new Map<string, string>()
  const page = await fetch(LOGIN_PAGE_URL, { headers: { 'User-Agent': TRICO_UA }, cache: 'no-store' })
  mergeCookies(jar, getSetCookies(page))
  const html = await page.text()
  const token = html.match(/<input[^>]*name="token"[^>]*value="([^"]+)"/i)?.[1]
  if (!token) throw new Error('Could not find the login "token" field on the Trico login page — it may require a different flow now.')

  const res = await fetch(LOGIN_ACTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': TRICO_UA,
      Referer: LOGIN_PAGE_URL, Cookie: cookieHeader(jar),
    },
    body: new URLSearchParams({ login_user_id: username, login_password: password, token }).toString(),
    redirect: 'manual',
  })
  mergeCookies(jar, getSetCookies(res))

  // A bad password re-renders the login form with a 200; a good login redirects.
  if (res.status < 300 || res.status >= 400) {
    const body = await res.text().catch(() => '')
    if (/name="login_user_id"/.test(body)) throw new Error(`Trico login failed for "${username}" — check the saved username/password.`)
  }
  if (jar.size === 0) throw new Error('Trico login did not return any session cookie.')
  return cookieHeader(jar)
}
