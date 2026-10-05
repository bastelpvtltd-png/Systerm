// Browser for the automation runs. On Vercel there is no installed Chrome, so a small
// serverless Chromium (@sparticuz/chromium-min) is downloaded into /tmp on a cold start
// (~3 s) and driven with playwright-core.
import { chromium as pw, type Browser, type BrowserContext, type Page } from 'playwright-core'

const PACK_URL = process.env.CHROMIUM_PACK_URL
  || 'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar'

// @sparticuz/chromium-min decides which shared libraries Chromium needs by reading
// AWS_EXECUTION_ENV, and only knows Node 20.x / 22.x (Amazon Linux 2023). On a newer Node
// (e.g. 24.x) it picks the OLD Amazon Linux 2 libraries, so Chromium dies the moment it starts:
// "browserType.launch: Target page, context or browser has been closed". Vercel is always
// Amazon Linux 2023, so we tell the package so BEFORE it is loaded.
function forceAl2023Libs() {
  const env = process.env.AWS_EXECUTION_ENV || ''
  if (env.includes('AWS_Lambda_nodejs') && !/(20|22)\.x/.test(env)) process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs22.x'
  const js = process.env.AWS_LAMBDA_JS_RUNTIME || ''
  if (js.includes('nodejs') && !/(20|22)\.x/.test(js)) process.env.AWS_LAMBDA_JS_RUNTIME = 'nodejs22.x'
}

export async function launch(): Promise<Browser> {
  forceAl2023Libs()
  const chromium = (await import('@sparticuz/chromium-min')).default
  try {
    const executablePath = await chromium.executablePath(PACK_URL)
    return await pw.launch({ executablePath, args: chromium.args, headless: true })
  } catch (e: any) {
    // The real reason (missing library, no memory…) is in Playwright's "Browser logs" lines —
    // keep them on ONE line so the error panel shows them instead of just the first line.
    const logs = String(e?.message || e).split('\n').map(l => l.trim()).filter(Boolean).join(' | ').slice(0, 330)
    throw new Error(`[node ${process.version}; env ${process.env.AWS_EXECUTION_ENV || '-'}] ${logs}`)
  }
}

// A fresh, isolated context per portal login so two shippers' sessions never mix.
export async function newSession(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 850 } })
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  return { context, page }
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Small JPEG of the page (base64) for the error panel; '' if it can't be taken. */
export async function snap(page: Page | undefined | null): Promise<string> {
  if (!page || page.isClosed()) return ''
  try { return (await page.screenshot({ type: 'jpeg', quality: 55 })).toString('base64') } catch { return '' }
}
