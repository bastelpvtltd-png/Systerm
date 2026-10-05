// Every failure is a FieldError so the Dashboard's "Automate Errors" panel can say WHERE it
// failed (step) and on WHICH data (field), not just "failed".
export type Step = 'prepare' | 'navis' | 'slpa' | 'finalize' | 'trico'

export class FieldError extends Error {
  screenshot?: string   // base64 jpeg of the page at the moment of failure
  debug?: string        // extra diagnostics (e.g. the list of input ids found on the Navis panel)
  constructor(public step: Step, public field: string, message: string) { super(message) }
}

export function asFieldError(e: unknown, step: Step, field = ''): FieldError {
  if (e instanceof FieldError) return e
  const msg = e instanceof Error ? e.message : String(e)
  const lines = msg.split('\n').map(l => l.trim()).filter(Boolean)
  // Playwright timeouts: first line says WHAT timed out, the call log says on WHICH element and WHY
  // (e.g. "<div class=\"z-apply-mask\"> intercepts pointer events"). Keep both, drop the rest.
  const why = lines.slice(1).filter(l => /locator\(|intercepts|not visible|not enabled|waiting for/i.test(l)).slice(0, 2).join(' | ')
  return new FieldError(step, field, (lines[0] + (why ? ' — ' + why : '')).slice(0, 800))
}