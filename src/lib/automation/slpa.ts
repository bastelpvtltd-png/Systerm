import type { Browser, BrowserContext, Page } from 'playwright-core'
import fs from 'node:fs/promises'
import { newSession, sleep, snap } from './portal'
import { FieldError, asFieldError } from './errors'
import type { SlpaValues } from './data'
import type { PortalLogin } from '@/lib/portalCredentials'

// ── SLPA CMS (n4cms.slpa.lk) — Export ▸ Container Consolidation (FCL) ─────────
// Flow (from your screenshots): FCL -> Cusdec No -> Search -> pick a free service-order
// container on the row of the pre-advised container -> Save -> floppy icon on that row ->
// Verified Container Slip (driver / truck / trailer / seal) -> Save -> Print -> PDF.
const CONSOL_URL = 'https://n4cms.slpa.lk/wapp/export/service-orders/container-consolidation'

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
  await page.goto(CONSOL_URL)
  await page.getByRole('button', { name: 'FCL', exact: true }).click()
  const box = page.locator('xpath=//*[contains(normalize-space(text()),"Cusdec No")]/following::input[1]')
  await box.waitFor({ state: 'visible' })
  await box.fill(ref)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
}

async function fetchAsBase64(page: Page, url: string): Promise<Buffer> {
  const b64 = await page.evaluate(async (u: string) => {
    const buf = new Uint8Array(await (await fetch(u)).arrayBuffer())
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    return btoa(s)
  }, url)
  return Buffer.from(b64, 'base64')
}

const isPdf = (b: Buffer) => b.subarray(0, 1024).includes('%PDF-')

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
    if (!found) throw new FieldError('slpa', 'Pre-advised container', `Container ${v.containerNo} not listed under CUSDEC ${v.cusdecRef} in SLPA (searched 4 times) — was the Navis pre-advise accepted?`)
    const r = row.first()

    // 2) consolidation: pick a free service-order container and Save — unless this row was already consolidated
    const already = (await r.locator('i.fa-save').count()) || (await r.locator('i.fa-edit').count())
    if (!already) {
      await r.locator('nb-select button.select-button').click()
      const options = page.locator('nb-option')
      await options.first().waitFor({ state: 'visible', timeout: 10_000 })
      let pick = -1
      for (let i = 0, n = await options.count(); i < n && pick < 0; i++) {
        const disabled = await options.nth(i).evaluate((el: Element) => el.classList.contains('disabled') || el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled'))
        if (!disabled) pick = i
      }
      if (pick < 0) throw new FieldError('slpa', 'Service Order Container', 'No free service-order container left to select for this CUSDEC')
      await options.nth(pick).click()

      const save = page.locator('button', { hasText: /^\s*Save\s*$/ }).last()
      for (let i = 0; i < 20 && !(await save.isEnabled()); i++) await sleep(500)
      if (!(await save.isEnabled())) throw new FieldError('slpa', 'Consolidation Save', 'Save button stayed disabled after selecting the container')
      await save.click()
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
    await slip.locator('button[type="submit"]', { hasText: 'Save' }).first().click()
    const print = slip.getByRole('button', { name: 'Print', exact: true })
    const printed = await print.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false)
    if (!printed) throw new FieldError('slpa', 'Slip Save', `Print button did not appear after saving the slip${(await toastText(slip)) ? `: ${await toastText(slip)}` : ''}`)

    // 5) the PDF: a download, a PDF tab, or (if the button only calls window.print) render the page itself
    await slip.evaluate(() => { (window as any).__printCalls = 0; window.print = () => { (window as any).__printCalls++ } })
    const dlP = slip.waitForEvent('download', { timeout: 7_000 }).catch(() => null)
    const popP = context.waitForEvent('page', { timeout: 7_000 }).catch(() => null)
    await print.click()
    const [dl, pop] = await Promise.all([dlP, popP])
    let pdf: Buffer | null = null
    if (dl) { const p = await dl.path(); if (p) pdf = await fs.readFile(p) }
    if (!pdf && pop) { await pop.waitForLoadState().catch(() => {}); pdf = await fetchAsBase64(pop, pop.url()).catch(() => null); await pop.close().catch(() => {}) }
    if (!pdf || !isPdf(pdf)) {
      if (await slip.evaluate(() => (window as any).__printCalls > 0).catch(() => false)) {
        await slip.emulateMedia({ media: 'print' })
        pdf = Buffer.from(await slip.pdf({ format: 'A4', printBackground: true }))
      }
    }
    if (!pdf || !isPdf(pdf)) throw new FieldError('slpa', 'Print', 'Print produced no PDF (no download, no PDF tab, no print call)')
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
