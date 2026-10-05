// Which portal (navis / slpa / trico) a saved credential belongs to.
// Decided from the Login URL first (so names like "bastel navis" or
// "bastel slpa" still land in the right dropdown), falling back to the
// identity name if the URL is unrecognised.
export type PortalKey = 'navis' | 'slpa' | 'trico'

export const PORTAL_URL_HINTS: Record<PortalKey, string> = {
  navis: 'n4cap.slpa.lk',
  slpa: 'n4cms.slpa.lk',
  trico: 'tricologi.net',
}

export function portalOfCredential(c: { url?: string | null; identity_name?: string | null }): PortalKey | null {
  const url = (c.url || '').toLowerCase()
  for (const p of Object.keys(PORTAL_URL_HINTS) as PortalKey[]) {
    if (url.includes(PORTAL_URL_HINTS[p])) return p
  }
  const name = (c.identity_name || '').toLowerCase()
  for (const p of Object.keys(PORTAL_URL_HINTS) as PortalKey[]) {
    if (name.includes(p)) return p
  }
  return null
}
