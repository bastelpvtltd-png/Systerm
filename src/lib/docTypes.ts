// Shared between Templates (the Document Type dropdown) and Docs Create (which
// tabs should always exist regardless of whether a template row has been
// saved for them yet). Keeping one list means adding a built-in type here
// makes it available in both places automatically.
export const BUILTIN_DOC_TYPES = [
  { value: 'boat_note',    label: 'Boat Note' },
  { value: 'invoice',      label: 'Invoice' },
  { value: 'packing_list', label: 'Packing List' },
  { value: 'co',           label: 'CO (Certificate of Origin)' },
  { value: 'pytho',        label: 'Phyto (Phytosanitary)' },
  { value: 'cusdec_xml',   label: 'Cusdec XML' },
  { value: 'cdn_text',     label: 'CDN Text' },
]

// Types with their own dedicated, hardcoded Docs Create tab (Boat Note's
// CUSDEC/Manual toggle, Invoice/Packing List's form, Cusdec XML's uploader,
// CDN Text's OCR panel) — a template saved under one of these, or the type
// itself, should never also spawn a duplicate generic/custom tab.
export const DEDICATED_TAB_TYPES = new Set(['boat_note', 'invoice', 'packing_list', 'cusdec_xml', 'cdn_text'])

// Built-in types that DON'T have a dedicated tab yet (CO, Phyto) — these
// always get a Docs Create tab even before anyone has saved a template for
// them, so the tab (and its "not configured yet" message) is there to find.
export const ALWAYS_TAB_TYPES = BUILTIN_DOC_TYPES.filter(t => !DEDICATED_TAB_TYPES.has(t.value))
