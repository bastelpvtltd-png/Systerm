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

// The day-of-week/month/day pattern found after a CDN/CUSDEC voyage code —
// e.g. "26053N Sun Jul 12 00:00". Shared by VOYAGECODE()/VOYAGEDATE() below.
const VOYAGE_DATE_PATTERN = /(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Za-z]{3})\s+(\d{1,2})/i
const MONTHS: Record<string, string> = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' }

// A tiny Excel-formula-like language for slicing a value out of a box's raw
// OCR text — lets two fields point at the same box (one crop, OCR'd once)
// and each pull a different piece out of it. Steps chain with "|", e.g.
// "LINE(2)|AFTER(:)" takes the 2nd line, then everything after the colon.
// Supported: LINE(n), LEFT(n), RIGHT(n), MID(start,len), AFTER(text),
// BEFORE(text), TRIM(), VOYAGECODE(), VOYAGEDATE(), CONTAINERNO().
// Standard container number shape (ISO 6346): 4 letters + 7 digits, 11
// characters total, no space — e.g. "MSCU1234567". OCR/raw text often has a
// stray space between the letters and digits ("MSCU 1234567"); this matches
// either shape and always emits the clean, space-free 11-character form.
const CONTAINER_NO_PATTERN = /([A-Z]{4})\s?(\d{7})/

// Same rule as CONTAINERNO() above, exposed directly for the regex-fallback
// extractor (extract-pdf.ts's extractCdnFields) which doesn't go through a
// saved box/formula at all.
export function cleanContainerNo(text: string): string {
  const m = (text || '').toUpperCase().match(CONTAINER_NO_PATTERN)
  return m ? `${m[1]}${m[2]}` : (text || '').trim()
}

// CDN Gross Mass is typed into the source form with an inconsistent
// separator before the decimal — comma, space, or even a second dot — but
// always ends in a 2-digit decimal, e.g. "21,810.00", "21 350.00",
// "27.870.00", "3125 00" should all become "21810.00", "21350.00",
// "27870.00", "3125.00". Only the LAST separator (right before the final
// 2 digits) is treated as the decimal point; everything before it is a
// thousands separator and gets stripped. A value with no decimal at all
// ("21810") gets ".00" appended, matching how every other value in this
// column is stored.
export function cleanGrossMass(text: string): string {
  const raw = (text || '').trim()
  if (!raw) return raw
  const m = raw.match(/^([\d,.\s]+?)[.,\s](\d{2})$/)
  const intPart = (m ? m[1] : raw).replace(/[^\d]/g, '')
  if (!intPart) return raw
  const decPart = m ? m[2] : '00'
  return `${intPart}.${decPart}`
}
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
        // A box shared by "voyage" and "voyage_date" often captures a whole
        // line like "26053N Sun Jul 12 00:00" — the code is everything
        // before the weekday abbreviation, the date is the weekday/month/day
        // that follows it (no year in the source, so it defaults to the
        // current year, same as the regex-fallback extractor).
        case 'VOYAGECODE': {
          const vm = result.match(new RegExp(`^([\\s\\S]*?)\\s*${VOYAGE_DATE_PATTERN.source}`, 'i'))
          if (vm) result = vm[1].trim()
          break
        }
        case 'VOYAGEDATE': {
          const vm = result.match(VOYAGE_DATE_PATTERN)
          if (vm) result = `${vm[3].padStart(2, '0')}.${MONTHS[vm[2]] || '01'}.${new Date().getFullYear()}`
          break
        }
        case 'CONTAINERNO': {
          const cm = result.toUpperCase().match(CONTAINER_NO_PATTERN)
          if (cm) result = `${cm[1]}${cm[2]}`
          break
        }
        case 'GROSSMASS': result = cleanGrossMass(result); break
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
