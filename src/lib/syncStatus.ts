import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export type SyncPanel = 'vessel_trigger' | 'trico_yard'
const key = (p: SyncPanel) => `last_sync:${p}`

// Saved in the database (app_settings) so the "last triggered" time survives
// refreshes / redeploys and is the same for every user and for the cron.
export async function recordSync(panel: SyncPanel, summary: string) {
  try {
    await sb.from('app_settings').upsert({ key: key(panel), value: JSON.stringify({ at: new Date().toISOString(), summary }) })
  } catch (e) { console.error('[syncStatus] record failed', e) }
}

export async function readSync(panel: SyncPanel): Promise<{ at: string; summary: string } | null> {
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key', key(panel)).maybeSingle()
    return data?.value ? JSON.parse(data.value) : null
  } catch { return null }
}
