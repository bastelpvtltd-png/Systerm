import type { NextApiRequest, NextApiResponse } from "next"
import { createClient } from "@supabase/supabase-js"
import { requireAuth } from "@/lib/serverAuth"

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  const q = String(req.query.q || "").trim()
  if (!q) return res.json({ records: [] })

  try {
    const { data, error } = await sb
      .from("cusdec")
      .select("id, code, number, exporter, consignee, vessel, voyage_no")
      .or(`code.ilike.%${q}%,number.ilike.%${q}%,exporter.ilike.%${q}%,vessel.ilike.%${q}%`)
      .order("created_at", { ascending: false })
      .limit(20)
    if (error) throw error
    res.json({ records: data || [] })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
