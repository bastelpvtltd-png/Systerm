// Browser for the automation runs. On Vercel there is no installed Chrome, so a small
// serverless Chromium (@sparticuz/chromium-min) is downloaded into /tmp on a cold start
// (~3 s) and driven with playwright-core.
import chromium from '@sparticuz/chromium-min'
import { chromium as pw, type Browser, type BrowserContext, type Page } from 'playwright-core'

const PACK_URL = process.env.CHROMIUM_PACK_URL
  || 'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar'

export async function launch(): Promise<Browser> {
  const executablePath = await chromium.executablePath(PACK_URL)
  return pw.launch({ executablePath, args: chromium.args, headless: true })
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
