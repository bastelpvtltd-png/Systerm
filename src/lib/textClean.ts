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

// Fixes consistent OCR misreads (e.g. "0" read for "O", wrong case) — rules
// are "find=>replace" pairs separated by commas, e.g. "0=>O, rn=>m".
export function applyReplacements(text: string, rulesCsv: string | undefined): string {
  if (!rulesCsv || !rulesCsv.trim()) return text
  let result = text
  for (const rule of rulesCsv.split(',').map(r => r.trim()).filter(Boolean)) {
    const arrow = rule.indexOf('=>')
    if (arrow === -1) continue
    const find = rule.slice(0, arrow).trim()
    const replace = rule.slice(arrow + 2).trim()
    if (find) result = result.split(find).join(replace)
  }
  return result
}

// Both corrections applied in one pass, in a fixed order: fix OCR misreads
// first, then strip noise words — so exclude-word matching sees corrected text.
export function applyTextRules(rawText: string, replacementsCsv: string | undefined, excludeWordsCsv: string | undefined): string {
  return stripExcludeWords(applyReplacements(rawText, replacementsCsv), excludeWordsCsv)
}
