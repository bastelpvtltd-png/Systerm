import { createClient } from '@supabase/supabase-js'
import { decryptSecret } from '@/lib/credentialsCrypto'
import { shipperKey } from '@/lib/shipperName'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export type PortalName = 'navis' | 'slpa' | 'trico'
export interface PortalLogin { id: string; identity_name: string; url: string; username: string; password: string }
export interface ShipperMapRow {
  shipper_key: string; shipper_name: string
  navis_credential_id: string | null; slpa_credential_id: string | null; trico_credential_id: string | null
}

export async function loadShipperMap(): Promise<Map<string, ShipperMapRow>> {
  const { data } = await sb.from('shipper_portal_credentials').select('*')
  return new Map((data || []).map((r: any) => [r.shipper_key, r as ShipperMapRow]))
}

// Which portals have a login mapped for this shipper (no secrets involved) —
// used to show ready/missing badges and to refuse jobs that can't run.
export function mappedPortals(map: Map<string, ShipperMapRow>, shipperRaw: string | null | undefined): Record<PortalName, boolean> {
  const row = map.get(shipperKey(shipperRaw))
  return { navis: !!row?.navis_credential_id, slpa: !!row?.slpa_credential_id, trico: !!row?.trico_credential_id }
}

// Decrypts the mapped logins for a shipper. SERVER ONLY — callers must never
// forward these to a browser (the worker endpoint is the one deliberate exception,
// and it is protected by WORKER_SECRET).
export async function resolvePortalLogins(shipperRaw: string | null | undefined, portals: PortalName[]): Promise<Partial<Record<PortalName, PortalLogin>>> {
  const key = shipperKey(shipperRaw)
  const { data: row } = await sb.from('shipper_portal_credentials').select('*').eq('shipper_key', key).maybeSingle()
  const out: Partial<Record<PortalName, PortalLogin>> = {}
  if (!row) return out
  for (const p of portals) {
    const id = (row as any)[`${p}_credential_id`] as string | null
    if (!id) continue
    const { data: c } = await sb.from('automation_credentials').select('id, identity_name, url, username, password_encrypted').eq('id', id).maybeSingle()
    if (!c || !c.username || !c.password_encrypted) continue
    out[p] = { id: c.id, identity_name: c.identity_name, url: c.url, username: c.username, password: decryptSecret(c.password_encrypted) }
  }
  return out
}
