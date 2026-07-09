// CUSDEC dates arrive in whatever format the source used (ISO from Excel
// import, DD/MM/YYYY or DD.MM.YYYY from PDF-extraction regexes) — this
// parses the common shapes into a real Date so year-extraction and
// date-comparison logic doesn't silently break on the "wrong" format.
export function parseFlexibleDate(raw: string): Date | null {
  const s = (raw || '').trim()
  if (!s) return null

  // ISO: 2026-07-08 or 2026-07-08T10:23:00
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))

  // DD/MM/YYYY or DD.MM.YYYY (also matches D/M/YY with 2-digit year)
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/)
  if (m) {
    let year = Number(m[3])
    if (year < 100) year += 2000
    return new Date(year, Number(m[2]) - 1, Number(m[1]))
  }

  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export function yearOf(raw: string): string {
  const d = parseFlexibleDate(raw)
  return d ? String(d.getFullYear()) : ''
}
