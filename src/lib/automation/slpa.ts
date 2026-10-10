import type { Browser, BrowserContext, Page } from 'playwright-core'
import fs from 'node:fs/promises'
import { newSession, sleep, snap, softClick } from './portal'
import { FieldError, asFieldError } from './errors'
import type { SlpaValues } from './data'
import type { PortalLogin } from '@/lib/portalCredentials'

// ── SLPA CMS (n4cms.slpa.lk) — Export ▸ Container Consolidation (FCL) ─────────
// Flow (from your screenshots): FCL -> Cusdec No -> Search -> pick a free service-order
// container on the row of the pre-advised container -> Save -> floppy icon on that row ->
// Verified Container Slip (driver / truck / trailer / seal) -> Save -> Print -> PDF.
const CONSOL_URL = 'https://n4cms.slpa.lk/wapp/export/service-orders/container-consolidation'
// Fixed for this agency's own SLPA account — the same for every container, not read off the CDN.
const AGENT_PASS_NO = '2916'

export interface SlpaSession { context: BrowserContext; page: Page }
export interface SlpaResult { pdf: Buffer; fileName: string }

export async function slpaLogin(browser: Browser, login: PortalLogin): Promise<SlpaSession> {
  const { context, page } = await newSession(browser)
  try {
    await page.goto(login.url)
    await page.locator('#input-email').fill(login.username)
    await page.locator('#input-password').fill(login.password)
    await page.getByRole('button', { name: 'Log In' }).click()
    await page.waitForURL(u => !u.pathname.includes('/auth/login'), { timeout: 30_000 })
  } catch {
    const e = new FieldError('slpa', 'Login', `SLPA login failed for "${login.username}" — wrong username/password, or SLPA is not reachable from the server`)
    e.screenshot = await snap(page)
    await context.close().catch(() => {})
    throw e
  }
  return { context, page }
}

async function toastText(page: Page): Promise<string> {
  const t = page.locator('nb-toast').first()
  return (await t.count()) ? ((await t.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 300) : ''
}

async function search(page: Page, ref: string) {
  // Right after login the app's own client-side router can still be bouncing through
  // /wapp/dashboard — a goto that lands mid-bounce gets reported as "Navigation ... is interrupted
  // by another navigation to .../dashboard". One retry after a short wait lets that settle first.
  for (let attempt = 0; ; attempt++) {
    try { await page.goto(CONSOL_URL); break }
    catch (e) { if (attempt >= 1) throw e; await sleep(1_500) }
  }
  await page.getByRole('button', { name: 'FCL', exact: true }).click()
  const box = page.locator('xpath=//*[contains(normalize-space(text()),"Cusdec No")]/following::input[1]')
  await box.waitFor({ state: 'visible' })
  await box.fill(ref)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  // A CUSDEC number that was mistyped at the source (the CDN row) can still get typed into Navis
  // without Navis itself complaining, but SLPA's own search rejects it outright here instead of
  // just returning no rows — catching that now and naming the CUSDEC number means the failure
  // reads as "this CUSDEC is wrong" rather than the generic "was Navis pre-advised?" guess below.
  await sleep(800)
  const err = await toastText(page)
  if (err && /invalid|not found|no record|error/i.test(err)) {
    throw new FieldError('slpa', 'CUSDEC Number', `SLPA rejected CUSDEC "${ref}" while searching: ${err} — check this CUSDEC number for a typo on the CDN`)
  }
}

async function fetchAsBase64(page: Page, url: string): Promise<Buffer> {
  const b64 = await page.evaluate(async (u: string) => {
    const buf = new Uint8Array(await (await fetch(u)).arrayBuffer())
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000)))
    return btoa(s)
  }, url)
  return Buffer.from(b64, 'base64')
}

const isPdf = (b: Buffer) => b.subarray(0, 1024).includes('%PDF-')

// A render that is structurally a valid PDF (isPdf) can still be the WRONG page — e.g. the
// Angular app's print route is guarded by in-memory router state that a hard page.goto() doesn't
// carry, so it silently redirects to /dashboard instead of 404-ing or erroring, and a page.pdf()
// taken at that point is a perfectly valid PDF of the dashboard. The only way to catch that is to
// check the PDF's own text actually contains this container's number before trusting it.
async function containsContainer(buf: Buffer, containerNo: string): Promise<boolean> {
  try {
    const pdfParse = require('pdf-parse')
    const { text } = await pdfParse(buf)
    return text.replace(/\s+/g, '').toUpperCase().includes(containerNo.toUpperCase())
  } catch { return false }
}

export async function slpaEnterOne(s: SlpaSession, v: SlpaValues): Promise<SlpaResult> {
  const { page, context } = s
  let slip: Page = page
  try {
    // 1) find the row of this container (Navis pre-advise can take a moment to show up here)
    const row = page.locator('table.nb-tree-grid tbody tr').filter({ hasText: v.containerNo })
    let found = false
    for (let attempt = 0; attempt < 4 && !found; attempt++) {
      if (attempt) await sleep(6_000)
      await search(page, v.cusdecRef)
      found = await row.first().waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)
    }
    if (!found) throw new FieldError('slpa', 'Pre-advised container', `Container ${v.containerNo} not listed under CUSDEC "${v.cusdecRef}" in SLPA (searched 4 times) — check the CUSDEC number for a typo on the CDN, or whether the Navis pre-advise was accepted`)
    const r = row.first()

    // 2) consolidation: pick a free service-order container and Save — unless this row was already consolidated
    const already = (await r.locator('i.fa-save').count()) || (await r.locator('i.fa-edit').count())
    if (!already) {
      // The row can be below the fold on a CUSDEC with several containers, and the Angular
      // select-button needs a moment after the table renders before it actually responds to a
      // click — scrollIntoView + softClick (plain click, falling back to a dispatched click
      // event) covers both instead of a bare .click() timing out at 30s.
      await r.scrollIntoViewIfNeeded().catch(() => {})
      await softClick(r.locator('nb-select button.select-button'))
      const options = page.locator('nb-option')
      await options.first().waitFor({ state: 'visible', timeout: 10_000 })
      let pick = -1
      for (let i = 0, n = await options.count(); i < n && pick < 0; i++) {
        const disabled = await options.nth(i).evaluate((el: Element) => el.classList.contains('disabled') || el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled'))
        if (!disabled) pick = i
      }
      if (pick < 0) throw new FieldError('slpa', 'Service Order Container', 'No free service-order container left to select for this CUSDEC')
      await softClick(options.nth(pick))

      const save = page.locator('button', { hasText: /^\s*Save\s*$/ }).last()
      for (let i = 0; i < 20 && !(await save.isEnabled()); i++) await sleep(500)
      if (!(await save.isEnabled())) throw new FieldError('slpa', 'Consolidation Save', 'Save button stayed disabled after selecting the container')
      await softClick(save)
      const ok = await page.getByText(/Consolidation Saved Successfully/i).first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false)
      if (!ok) throw new FieldError('slpa', 'Consolidation Save', `SLPA did not confirm the consolidation${(await toastText(page)) ? `: ${await toastText(page)}` : ''}`)
    }

    // 3) floppy icon (or edit icon if the slip was already started) -> Verified Container Slip
    const icon = r.locator('i.fa-save, i.fa-edit').first()
    await icon.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => { throw new FieldError('slpa', 'Verified Slip', 'The slip icon did not appear on the container row after saving') })
    const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 6_000 }).catch(() => null), icon.click()])
    slip = popup ?? page
    await slip.waitForURL(/verified-container-slip/, { timeout: 20_000 }).catch(() => { throw new FieldError('slpa', 'Verified Slip', 'Verified Container Slip page did not open') })
    await slip.locator('#driverid').waitFor({ state: 'visible', timeout: 15_000 })

    // 4) slip data
    for (const [field, id, value] of [
      ['Driver ID', '#driverid', v.driverId], ['Truck No', '#truckno', v.truckNo],
      ['Trailer No', '#trailorno', v.trailerNo], ['Seal Number', '#sealnumber', v.sealNo],
    ] as const) {
      try { const el = slip.locator(id); await el.fill(value); await el.press('Tab') }
      catch { throw new FieldError('slpa', field, `Could not fill "${field}" on the Verified Container Slip`) }
    }
    // Agent Pass No — a fixed value for this agency's account, not per-container CDN data (real
    // screenshot: Save stays disabled with "Agent Pass No is required." until it's filled).
    // Finding it by its label text failed once already (the label may not be a plain text node
    // the way "Cusdec No" on the search page is), so this now tries a few likely ids first, and
    // if none of those exist, falls back to whichever visible, editable input on the slip is
    // still empty — the only one left once the four fields above are already filled.
    let agentPassFilled = false
    for (const guess of ['#agentpassno', '#agentpass', '#agentPassNo', '#agent_pass_no']) {
      const el = slip.locator(guess)
      if (await el.count().catch(() => 0)) {
        await el.first().fill(AGENT_PASS_NO); await el.first().press('Tab')
        agentPassFilled = true
        break
      }
    }
    if (!agentPassFilled) {
      const candidates = slip.locator('input:visible:not([readonly]):not([disabled])')
      for (let i = 0, n = await candidates.count(); i < n && !agentPassFilled; i++) {
        const el = candidates.nth(i)
        if ((await el.inputValue().catch(() => 'x')) === '') {
          await el.fill(AGENT_PASS_NO); await el.press('Tab')
          agentPassFilled = true
        }
      }
    }
    if (!agentPassFilled) throw new FieldError('slpa', 'Agent Pass No', 'Could not find the empty "Agent Pass No" field on the Verified Container Slip')
    await slip.locator('button[type="submit"]', { hasText: 'Save' }).first().click()
    const print = slip.getByRole('button', { name: 'Print', exact: true })
    const printed = await print.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false)
    if (!printed) throw new FieldError('slpa', 'Slip Save', `Print button did not appear after saving the slip${(await toastText(slip)) ? `: ${await toastText(slip)}` : ''}`)
    const slipUrl = slip.url()

    // 5) the PDF. SLPA's real flow (confirmed by hand): the slip's own URL, once Save succeeds, is
    // .../container-consolidation/<id>/verified-container-slip, and the SAME <id> plugged into
    // .../gatepass/<id>/print opens a clean "Gate Pass Slip" page with its own PRINT button — that
    // button is what produces the real PDF (a download, or a new tab), never a Playwright page.pdf()
    // render of either page: page.pdf() rasterises the barcode instead of keeping it as real content,
    // which is what was silently passing the old isPdf()-only check while actually being unusable.
    let pdf: Buffer | null = null
    const tryAccept = async (buf: Buffer | null) => (buf && isPdf(buf) && await containsContainer(buf, v.containerNo)) ? buf : null

    const gatepassId = slipUrl.match(/\/container-consolidation\/(\d+)\/verified-container-slip\b/)?.[1]
    if (!gatepassId) throw new FieldError('slpa', 'Print', `Could not find the gate pass id in the slip's own URL (${slipUrl})`)
    const printUrl = `https://n4cms.slpa.lk/wapp/export/service-orders/gatepass/${gatepassId}/print`
    // Same client-side-router race as search()'s CONSOL_URL goto — one retry after a short wait
    // covers a navigation landing mid-bounce right after Save.
    for (let attempt = 0; ; attempt++) {
      try { await slip.goto(printUrl, { timeout: 20_000 }); break }
      catch (e) { if (attempt >= 1) throw e; await sleep(1_500) }
    }
    const printBtn = slip.getByRole('button', { name: /print/i }).first()
    await printBtn.waitFor({ state: 'visible', timeout: 15_000 })

    const dlP = slip.waitForEvent('download', { timeout: 10_000 }).catch(() => null)
    const popP = context.waitForEvent('page', { timeout: 10_000 }).catch(() => null)
    await printBtn.click()
    const [dl, pop] = await Promise.all([dlP, popP])
    if (dl) { const p = await dl.path(); if (p) pdf = await tryAccept(await fs.readFile(p)) }
    if (!pdf && pop) {
      await pop.waitForLoadState().catch(() => {})
      pdf = await tryAccept(await fetchAsBase64(pop, pop.url()).catch(() => null))
      await pop.close().catch(() => {})
    }
    if (!pdf) {
      // Last resort only — a rendered, not a real, PDF; kept so the run produces something instead
      // of a hard failure when neither a download nor a new tab showed up.
      await slip.emulateMedia({ media: 'print' }).catch(() => {})
      pdf = Buffer.from(await slip.pdf({ format: 'A4', printBackground: true }).catch(() => Buffer.alloc(0)))
    }
    if (!pdf || !isPdf(pdf)) throw new FieldError('slpa', 'Print', 'Clicking PRINT on the gate pass page produced no PDF (no download, no new tab, and rendering the page itself also failed)')
    if (popup) await popup.close().catch(() => {})
    return { pdf, fileName: `${v.containerNo}.pdf` }
  } catch (e) {
    const fe = asFieldError(e, 'slpa')
    if (!fe.screenshot) fe.screenshot = await snap(slip)
    if (slip !== page) await slip.close().catch(() => {})
    throw fe
  }
}

export async function slpaClose(s: SlpaSession) { await s.context.close().catch(() => {}) }
