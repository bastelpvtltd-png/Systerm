// Helpers for the Navis CAP portal, which is a ZK (zul) application.
//
// ZK generates element ids at runtime ("b7zPmm0": a per-session prefix + a component counter).
// The prefix changes on every login, so fields are matched on the END of the id
// (input[id$="mm0"]), never the whole id.
import type { Page } from 'playwright-core'
import { FieldError, asFieldError, type Step } from './errors'
import { sleep, snap, softClick } from './portal'
export { softClick }
import type { Pick } from './data'

const clean = (s: string) => s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
const STEP: Step = 'navis'

/** A field is either the end of its ZK id, or an XPath (used when the id isn't known). */
export type Sel = string | { xpath: string }
const locate = (page: Page, sel: Sel) =>
  typeof sel === 'string' ? page.locator(`input[id$="${sel}"]:visible`).first() : page.locator(`xpath=${sel.xpath}`).first()
export const input = locate

/** "id | value | label" for every visible input — attached to "field not found" errors so the
 *  real ids can be read straight off the Automate Errors panel. */
export async function dumpInputs(page: Page): Promise<string> {
  try {
    const rows = await page.evaluate(() => {
      const out: string[] = []
      document.querySelectorAll('input').forEach(el => {
        const r = (el as HTMLElement).getBoundingClientRect()
        if (!r.width || !r.height || (el as HTMLInputElement).type === 'hidden') return
        let label = ''
        let n: Element | null = el.closest('td,div')
        for (let i = 0; i < 4 && n && !label; i++, n = n.parentElement) {
          let p = n.previousElementSibling
          while (p && !label) { label = (p.textContent || '').trim().slice(0, 30); p = label ? null : p.previousElementSibling }
        }
        out.push(`${el.id || '(no id)'} | ${(el as HTMLInputElement).value.slice(0, 20)} | ${label}`)
      })
      return out
    })
    return rows.join('\n').slice(0, 4000)
  } catch { return '' }
}

async function need(page: Page, field: string, sel: Sel) {
  const el = locate(page, sel)
  try { await el.waitFor({ state: 'visible', timeout: 15_000 }) }
  catch {
    const e = new FieldError(STEP, field, `Field "${field}" not found on the Pre-advise Export panel (${typeof sel === 'string' ? `id ending "${sel}"` : 'by label'}) — the panel may not have opened, or ZK ids changed`)
    e.debug = await dumpInputs(page); e.screenshot = await snap(page)
    throw e
  }
  return el
}

/** Plain textbox: type, then Tab so ZK registers the change. */
async function fillTextRaw(page: Page, field: string, sel: Sel, value: string) {
  const el = await need(page, field, sel)
  await el.click({ timeout: 8_000 }).catch(() => el.focus())
  await el.press('Control+A'); await el.press('Backspace')
  await el.pressSequentially(value, { delay: 25 })
  await el.press('Tab')
  const got = (await el.inputValue()).trim()
  if (got.toUpperCase() !== value.toUpperCase()) throw new FieldError(STEP, field, `"${field}" shows "${got}" after typing "${value}"`)
}

/**
 * ZK combobox: optionally clear it (several start with "--"), type `type`, wait for the dropdown,
 * read every option's text, let `choose` pick one, click it, and confirm the box really holds a
 * value afterwards. `readonly` boxes (Truck, FCL) are opened by clicking.
 */
async function pickComboRaw(page: Page, field: string, sel: Sel, o: { type?: string; readonly?: boolean; choose: (options: string[]) => Pick }) {
  const el = await need(page, field, sel)
  const items = page.locator('li.z-comboitem:visible')
  await el.click({ timeout: 8_000 }).catch(() => el.focus())
  if (!o.readonly) {
    // Three different keyboard-based clear strategies all lost this race against ZK (three real
    // screenshots: fill('')+type -> "--076N", fill('')+settle-wait+type -> "--*26076N",
    // Control+A+type -> "--76N" — "--" survives every time, and keystrokes go missing too, which
    // points at the box not reliably being focused/ready when pressSequentially starts, not just
    // at ZK re-inserting "--"). Stop relying on synthetic keyboard events for the clear+set part:
    // write the final value straight into the DOM (via the native input value setter, so no
    // framework-level override intercepts it) and fire its own input event. Then replay just the
    // LAST character as a real keystroke (Backspace, retype) — one genuine keyup is what ZK's
    // live-filter AJAX actually listens for, and this restores the exact same final value.
    if (o.type) {
      const value = o.type
      await el.evaluate((node: HTMLInputElement, v: string) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        setter.call(node, v)
        node.dispatchEvent(new Event('input', { bubbles: true }))
      }, value)
      await sleep(150)
      await el.press('Backspace')
      await el.pressSequentially(value.slice(-1), { delay: 70 })
    }
  }
  let opened = await items.first().waitFor({ state: 'visible', timeout: o.readonly ? 2_500 : 9_000 }).then(() => true, () => false)
  if (!opened && o.readonly) {
    await softClick(el.locator('xpath=following-sibling::a').first()).catch(() => {})
    opened = await items.first().waitFor({ state: 'visible', timeout: 6_000 }).then(() => true, () => false)
  }
  if (!opened) throw new FieldError(STEP, field, `No dropdown options appeared for "${field}"${o.type ? ` after typing "${o.type}"` : ''}`)
  // The dropdown first shows the FULL list and is filtered a moment later (the typed text goes to the
  // server and back). Reading it too early gives an unfiltered list ("No option for ONE. Options:
  // BTL | 414 | AAL1 …"). So keep re-reading until the wanted option appears AND the list has stopped
  // changing, for up to ~10 s, and only then click it.
  const readOptions = async () => (await items.locator('.z-comboitem-text').allInnerTexts().catch(() => [] as string[])).map(clean)
  const deadline = Date.now() + (o.readonly ? 3_000 : 10_000)
  let options: string[] = [], choice: Pick = 'No options read'
  while (true) {
    await sleep(o.readonly ? 300 : 450)
    options = await readOptions()
    choice = options.length ? o.choose(options) : `The dropdown list is empty${o.type ? ` after typing "${o.type}"` : ''}`
    if (typeof choice === 'number') {
      await sleep(350)
      const again = await readOptions()
      if (again.length === options.length && again[choice] === options[choice]) break   // stable → safe to click
      choice = 'The dropdown list kept changing'
    }
    if (Date.now() > deadline) break
  }
  if (typeof choice === 'string') throw new FieldError(STEP, field, choice)
  await softClick(items.nth(choice))
  await sleep(400)
  const value = (await el.inputValue()).trim()
  if (!value || value === '--') throw new FieldError(STEP, field, `"${field}": option "${options[choice]}" was clicked but the box is still empty`)
  return value
}

/** Text of any ZK error/notification box currently on screen ("" if none). */
export async function visibleZkError(page: Page): Promise<string> {
  const loc = page.locator('.z-errbox:visible, .z-notification:visible, .z-messagebox-window:visible').first()
  if (!(await loc.count())) return ''
  return clean((await loc.innerText().catch(() => '')) || '').slice(0, 300)
}

// Any raw Playwright error (timeout etc.) is tagged with the field it happened on, so the
// Automate Errors panel says e.g. field "COC" instead of an anonymous "locator.click: Timeout".
export async function fillText(page: Page, field: string, sel: Sel, value: string) {
  try { return await fillTextRaw(page, field, sel, value) } catch (e) { throw asFieldError(e, STEP, field) }
}
export async function pickCombo(page: Page, field: string, sel: Sel, o: { type?: string; readonly?: boolean; choose: (options: string[]) => Pick }) {
  try { return await pickComboRaw(page, field, sel, o) } catch (e) { throw asFieldError(e, STEP, field) }
}