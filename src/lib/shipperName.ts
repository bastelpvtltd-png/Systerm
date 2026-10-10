// CDN rows store the shipper as "NAME\nADDRESS LINE..." — the name is always the
// first line. Portal logins (Navis / SLPA / Trico) are mapped per shipper name,
// compared case-insensitively on that first line only.
export function shipperName(raw: string | null | undefined): string {
  return (raw || '').split('\n')[0].replace(/\s+/g, ' ').trim()
}

// Spacing is inconsistent across documents for the same company ("AM TRADING"
// vs "A M TRADING" — both appear in real CDN rows for the one shipper) — the
// key used to look up a shipper's Navis/SLPA/Trico login strips spaces too,
// not just case, so a CDN with either spelling finds the same mapping instead
// of silently being treated as a different, unmapped shipper.
export function shipperKey(raw: string | null | undefined): string {
  return shipperName(raw).toLowerCase().replace(/\s+/g, '')
}
