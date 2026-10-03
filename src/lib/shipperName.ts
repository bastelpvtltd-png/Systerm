// CDN rows store the shipper as "NAME\nADDRESS LINE..." — the name is always the
// first line. Portal logins (Navis / SLPA / Trico) are mapped per shipper name,
// compared case-insensitively on that first line only.
export function shipperName(raw: string | null | undefined): string {
  return (raw || '').split('\n')[0].replace(/\s+/g, ' ').trim()
}

export function shipperKey(raw: string | null | undefined): string {
  return shipperName(raw).toLowerCase()
}
