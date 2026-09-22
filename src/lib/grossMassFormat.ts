// lib/grossMassFormat.ts
//
// PDF/Drive extraction of gross_mass (CDN, CUSDEC, Boat Note) comes back in
// inconsistent formats depending on the source doc:
//   "20 190.00"   (space as thousands separator)
//   "20,190.00"   (correct — comma thousands, dot decimal)
//   "20.190.00"   (dot used as BOTH thousands and decimal)
//   "20190"       (no separator at all)
//   "20190 00"    (space instead of decimal point)
//   "20190,00"    (comma used as decimal, European style)
// All six of the above must normalize to "20,190.00".
//
// A container's gross weight can never exceed 35,000 kg — that ceiling is
// used as a sanity check to correct misparsed values (stray extra digit,
// duplicated group, OCR artifact) rather than as a hard validation error.

export interface GrossMassResult {
  formatted: string   // "20,190.00" — ready to drop straight into a cell
  numeric: number      // 20190 — for math / comparisons
  ok: boolean          // false if we could not get it under 35,000kg
}

export function normalizeGrossMass(raw: string | number | null | undefined): GrossMassResult {
  const empty: GrossMassResult = { formatted: '', numeric: 0, ok: true }
  if (raw === null || raw === undefined) return empty
  let s = String(raw).trim()
  if (!s) return empty

  // Keep only digits and the three possible separator characters.
  s = s.replace(/[^\d.,\s]/g, '')
  if (!s) return empty

  const segments = s.split(/[.,\s]+/).filter(Boolean)
  if (segments.length === 0) return empty

  let intPart: string
  let decPart: string

  if (segments.length === 1) {
    // No separators at all, e.g. "20190"
    intPart = segments[0]
    decPart = '00'
  } else {
    const last = segments[segments.length - 1]
    if (last.length === 2) {
      // Last group of exactly 2 digits -> it's the decimal part, whatever
      // separator preceded it (comma or dot both used inconsistently).
      decPart = last
      intPart = segments.slice(0, -1).join('')
    } else {
      // Last group isn't 2 digits (e.g. "190" or "000") -> it's a
      // thousands group, not a decimal — treat the whole thing as a
      // whole-number kg value.
      intPart = segments.join('')
      decPart = '00'
    }
  }

  intPart = intPart.replace(/^0+(?=\d)/, '') || '0'
  let numeric = parseFloat(`${intPart}.${decPart}`)

  // Sanity cap: gross weight is never > 35,000kg. If parsing produced
  // something bigger, strip trailing digits off the integer part (stray
  // duplicated/extra digit) until it's back in range.
  let ok = true
  while (numeric > 35000 && intPart.length > 1) {
    intPart = intPart.slice(0, -1)
    numeric = parseFloat(`${intPart}.${decPart}`)
  }
  if (numeric > 35000) {
    // Couldn't bring it into range without guessing wrongly — flag it and
    // fall back to the original raw string so a human can check.
    return { formatted: s, numeric, ok: false }
  }

  const formatted = numeric.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  return { formatted, numeric, ok }
}
