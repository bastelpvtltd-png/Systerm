import type { Browser, BrowserContext, Page } from 'playwright-core'
import { newSession, sleep, snap } from './portal'
import { FieldError, asFieldError } from './errors'
import { fillText, pickCombo, input, visibleZkError, dumpInputs, softClick, type Sel } from './zk'
import { pickByCode, pickPortOption, pickVesselOption, type NavisValues } from './data'
import type { PortalLogin } from '@/lib/portalCredentials'

// ── NAVIS CAP (n4cap.slpa.lk) — Gate ▸ Pre-advise Export ──────────────────────
// Fields are addressed by the END of their ZK id (see zk.ts), taken from the HTML you sent.
const HOME_URL = 'https://n4cap.slpa.lk/apex/capHomeView.zul'

// The vessel input's id was not in the HTML you sent. Until NAVIS_VESSEL_ID_SUFFIX (Vercel env
// var, e.g. "pn0-real") is set, it is located by its "Vessel" label instead; if that fails the
// error carries a list of every input id on the panel so the real one can be read off it.
const VESSEL: Sel = process.env.NAVIS_VESSEL_ID_SUFFIX?.trim()
  || { xpath: '(//*[normalize-space(text())="Vessel" or starts-with(normalize-space(text()),"Vessel")]/following::input[contains(@class,"z-combobox-input")])[1]' }

export const NAVIS = {
  fields: {
    containerNo: 'mm0',
    conType: 'qm0-real',
    grossMass: 'fn0',
    coc: 'jn0-real',
    truck: 'ho0-real',        // readonly combobox, always "Truck"
    owner: '1q0-real',        // shows "--" by default, always "PRVT (PRIVATE TRUCKING COMPANY)"
    voc: 'no0-real',
    loadPort: 'mr0-real',     // always LKCMB (Colombo)
    dischargePort: 'bs0-real',
    cargoType: 'hu0-real',    // readonly combobox, always "FCL (Full Container)"
    cusdecRef: 'yv0',
  },
  saveButton: 'button.carina-save-button',
}

export interface NavisSession { context: BrowserContext; page: Page; needsReopen: boolean }

export async function navisLogin(browser: Browser, login: PortalLogin): Promise<NavisSession> {
  const { context, page } = await newSession(browser)
  try {
    await page.goto(login.url)
    const user = page.locator('input.z-textbox[type="text"]:visible').first()
    await user.waitFor({ state: 'visible' })
    await user.fill(login.username); await user.press('Tab')
    const pass = page.locator('input[type="password"]:visible').first()
    await pass.fill(login.password); await pass.press('Tab')
    await page.getByRole('button', { name: 'Log In' }).click()
    await page.waitForURL(/capHomeView\.zul/, { timeout: 30_000 })
  } catch {
    const e = new FieldError('navis', 'Login', `Navis login did not reach the home page for "${login.username}" — wrong username/password, or Navis is not reachable from the server`)
    e.screenshot = await snap(page)
    await context.close().catch(() => {})
    throw e
  }
  return { context, page, needsReopen: true }
}

// Gate ▸ Pre-advise Export. The menu label is "G̲ate" (G + a combining underline).
async function openPreAdvise(s: NavisSession) {
  const { page } = s
  if (!page.url().includes('capHomeView.zul')) await page.goto(HOME_URL)
  await page.waitForLoadState('domcontentloaded').catch(() => {})
  const gate = page.locator('.z-menu-text').filter({ hasText: /^\s*G\u0332?ate\s*$/ }).first()
  await gate.waitFor({ state: 'attached', timeout: 20_000 })
  await softClick(gate)
  const pre = page.locator('.z-menuitem-text', { hasText: 'Pre-advise Export' }).first()
  await pre.waitFor({ state: 'attached', timeout: 10_000 })
  await softClick(pre)
  await input(page, NAVIS.fields.containerNo).waitFor({ state: 'visible', timeout: 20_000 })
  s.needsReopen = false
}

/**
 * Enters one container into Pre-advise Export and saves it. Throws FieldError on any problem
 * (the caller records it and moves on to the next CDN — nothing is retried here).
 * dryRun: fills every field, takes a screenshot, and stops BEFORE Save.
 */
export async function navisEnterOne(s: NavisSession, v: NavisValues, opts: { dryRun: boolean }): Promise<{ saved: boolean; screenshot?: string }> {
  const { page } = s
  const F = NAVIS.fields
  let stage = 'Open Gate > Pre-advise Export'
  try {
    if (s.needsReopen) await openPreAdvise(s)
    stage = 'Fill form'

    await fillText(page, 'Container No', F.containerNo, v.containerNo)
    await pickCombo(page, 'Con Type', F.conType, { type: v.conType, choose: o => pickByCode(o, v.conType) })
    await fillText(page, 'Gross Mass', F.grossMass, v.grossMass)
    await pickCombo(page, 'COC', F.coc, { type: v.coc, choose: o => pickByCode(o, v.coc, 'Line Operator') })
    await pickCombo(page, 'Truck', F.truck, { readonly: true, choose: o => pickByCode(o, 'Truck') })
    await pickCombo(page, 'Owner (PRVT)', F.owner, { type: '*PRVT', choose: o => pickByCode(o, 'PRVT') })
    await pickCombo(page, 'VOC', F.voc, { type: v.voc, choose: o => pickByCode(o, v.voc) })

    // Vessel: clear the "--", type "*" + the voyage, and take the entry whose voyage matches exactly.
    await pickCombo(page, 'Vessel / Voyage', VESSEL, { type: `*${v.voyage}`, choose: o => pickVesselOption(o, v.vessel, v.voyage) })
    await pickCombo(page, 'Port of Load', F.loadPort, { type: '*LKCMB', choose: o => pickByCode(o, 'LKCMB') })
    await pickCombo(page, 'Port of Discharge', F.dischargePort, { type: `*${v.dischargePort}`, choose: o => pickPortOption(o, v.dischargePort) })
    await pickCombo(page, 'Cargo Type (FCL)', F.cargoType, { readonly: true, choose: o => pickByCode(o, 'FCL') })
    await fillText(page, 'CUSDEC Reference', F.cusdecRef, v.cusdecRef)

    if (opts.dryRun) {
      const screenshot = await snap(page)
      s.needsReopen = true            // form is dirty — start clean for the next container
      await page.goto(HOME_URL).catch(() => {})
      return { saved: false, screenshot }
    }

    stage = 'Save button'
    await softClick(page.locator(`${NAVIS.saveButton}:visible`).first())

    // Success = the panel clears (the container box becomes empty). Failure = a ZK error box.
    const box = input(page, F.containerNo)
    const deadline = Date.now() + 25_000
    while (Date.now() < deadline) {
      const err = await visibleZkError(page)
      if (err) throw new FieldError('navis', 'Save', `Navis rejected the entry: ${err}`)
      const cleared = await box.inputValue().then(x => x.trim() === '', () => true)
      if (cleared) return { saved: true }
      await sleep(400)
    }
    throw new FieldError('navis', 'Save', 'Clicked Save but Navis neither cleared the form nor showed an error within 25 s — check Navis by hand before re-running')
  } catch (e) {
    const fe = asFieldError(e, 'navis', stage)
    if (!fe.screenshot) fe.screenshot = await snap(page)
    if (!fe.debug && /not found|No dropdown/.test(fe.message)) fe.debug = await dumpInputs(page)
    s.needsReopen = true              // never carry a half-filled form into the next container
    await page.goto(HOME_URL).catch(() => {})
    throw fe
  }
}

export async function navisClose(s: NavisSession) { await s.context.close().catch(() => {}) }