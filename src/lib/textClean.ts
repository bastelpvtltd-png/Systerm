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
  return result.replace(/\s+/g, ' ').trim()
}
