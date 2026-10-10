// Browser for the automation runs. On Vercel there is no installed Chrome, so a small
// serverless Chromium (@sparticuz/chromium-min) is downloaded into /tmp on a cold start
// (~3 s) and driven with playwright-core.
import { chromium as pw, type Browser, type BrowserContext, type Page } from 'playwright-core'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The Chromium "pack" MUST be the same version as the installed @sparticuz/chromium-min package
// (a v131 pack under a newer package = Chromium dies on start: "Target page, context or browser
// has been closed"). So the pack URL is built from the installed package version; set
// CHROMIUM_PACK_URL on Vercel only to force a specific one.
function packUrl(): string {
  if (process.env.CHROMIUM_PACK_URL) return process.env.CHROMIUM_PACK_URL
  let ver = '131.0.1'
  try {
    ver = JSON.parse(readFileSync(join(process.cwd(), 'node_modules/@sparticuz/chromium-min/package.json'), 'utf8')).version || ver
  } catch { /* keep default */ }
  const major = parseInt(ver.split('.')[0], 10)
  return `https://github.com/Sparticuz/chromium/releases/download/v${ver}/chromium-v${ver}-pack${major >= 138 ? '.x64' : ''}.tar`
}

// Vercel runs Amazon Linux 2023, but older @sparticuz/chromium-min versions only recognise that via
// AWS_EXECUTION_ENV (which is NOT set on Vercel, e.g. on Node 24) — then the system libraries
// Chromium needs (libnss3 …) are never unpacked and Chromium dies instantly. Tell the package.
// This must happen BEFORE the package is loaded (hence the dynamic import below).
function forceAl2023Libs() {
  if (!process.env.VERCEL && !process.env.AWS_EXECUTION_ENV && !process.env.AWS_LAMBDA_JS_RUNTIME) return   // local PC
  if (!/(20|22|24)\.x/.test(process.env.AWS_EXECUTION_ENV || '')) process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs22.x'
}

export async function launch(): Promise<Browser> {
  forceAl2023Libs()
  const chromium = (await import('@sparticuz/chromium-min')).default
  const url = packUrl()
  try {
    const executablePath = await chromium.executablePath(url)
    return await pw.launch({ executablePath, args: chromium.args, headless: true })
  } catch (e: any) {
    // Playwright puts the real reason in its "Browser logs" lines — keep the END of them (the
    // last lines hold the actual error, e.g. "error while loading shared libraries: …").
    const raw = String(e?.message || e).split('\n').map(l => l.trim()).filter(Boolean)
    const head = raw[0]
    const tail = raw.slice(-4).join(' | ')
    throw new Error(`[node ${process.version}; pack ${url.split('/').slice(-2, -1)[0]}] ${head} || ${tail}`.slice(0, 700))
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

/** Both the Navis (ZK) and SLPA (Nebular/Angular) portals sometimes leave an invisible mask,
 *  tooltip or in-flight animation over an element for a moment, which makes a normal Playwright
 *  click wait out its full timeout even though the element is really there and really clickable.
 *  Try a normal click for a few seconds, then fall back to sending the click event straight to
 *  the element (which is what both frameworks' own listeners respond to either way). */
export async function softClick(loc: import('playwright-core').Locator, tries = 6_000) {
  try { await loc.click({ timeout: tries }) }
  catch {
    await loc.waitFor({ state: 'attached', timeout: 5_000 })
    await loc.scrollIntoViewIfNeeded().catch(() => {})
    await loc.dispatchEvent('click')
  }
}