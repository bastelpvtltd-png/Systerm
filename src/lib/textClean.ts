// Removes user-specified "noise" words/phrases from OCR'd text — e.g. printed
// form labels that get captured inside a hand-drawn box along with the real value.
export function stripExcludeWords(text: string, excludeWordsCsv: string | undefined): string {
  if (!excludeWordsCsv || !excludeWordsCsv.trim()) return text
  const words = excludeWordsCsv.split(',').map(w => w.trim()).filter(Boolean)
  let result = text
  for (const w of words) {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(escaped, 'gi'), '')
  }
  // Collapse repeated spaces/tabs within each line, but keep the line breaks —
  // a multi-line box (e.g. an address) should keep its original line layout.
  return result
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

// A tiny Excel-formula-like language for slicing a value out of a box's raw
// OCR text — lets two fields point at the same box (one crop, OCR'd once)
// and each pull a different piece out of it. Steps chain with "|", e.g.
// "LINE(2)|AFTER(:)" takes the 2nd line, then everything after the colon.
// Supported: LINE(n), LEFT(n), RIGHT(n), MID(start,len), AFTER(text),
// BEFORE(text), TRIM().
export function applyFormula(text: string, formula: string | undefined): string {
  if (!formula || !formula.trim()) return text
  let result = text
  for (const step of formula.split('|').map(s => s.trim()).filter(Boolean)) {
    const m = step.match(/^([A-Za-z]+)\((.*)\)$/)
    if (!m) continue
    const fn = m[1].toUpperCase()
    const args = m[2].length ? m[2].split(',').map(a => a.trim().replace(/^["']|["']$/g, '')) : []
    try {
      switch (fn) {
        case 'LINE': {
          const lines = result.split('\n')
          result = lines[parseInt(args[0], 10) - 1] ?? ''
          break
        }
        case 'LEFT': result = result.slice(0, parseInt(args[0], 10)); break
        case 'RIGHT': result = result.slice(-parseInt(args[0], 10)); break
        case 'MID': {
          const start = parseInt(args[0], 10) - 1
          result = result.slice(start, start + parseInt(args[1], 10))
          break
        }
        case 'AFTER': {
          const idx = result.indexOf(args[0])
          if (idx !== -1) result = result.slice(idx + args[0].length)
          break
        }
        case 'BEFORE': {
          const idx = result.indexOf(args[0])
          if (idx !== -1) result = result.slice(0, idx)
          break
        }
        case 'TRIM': result = result.trim(); break
        default: break
      }
    } catch { /* bad step — leave result as-is and keep going */ }
  }
  return result.trim()
}

// Both corrections applied in one pass: the formula slices out the relevant
// piece of the (possibly shared) box text first, then exclude-words cleans
// up any remaining noise from that slice.
export function applyTextRules(rawText: string, formula: string | undefined, excludeWordsCsv: string | undefined): string {
  return stripExcludeWords(applyFormula(rawText, formula), excludeWordsCsv)
}
