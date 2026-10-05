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
  return new FieldError(step, field, msg.split('\n')[0].slice(0, 800))   // Playwright timeouts are noisy — first line only
}
