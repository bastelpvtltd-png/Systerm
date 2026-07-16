import type { NextApiRequest, NextApiResponse } from "next"
import { createClient } from "@supabase/supabase-js"
import { requireAuth } from "@/lib/serverAuth"

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  try {
    if (req.method === "GET") {
      const { type } = req.query

      if (type === "profiles") {
        const { data, error } = await sb
          .from("user_profiles")
          .select("*, user:user_id(email, raw_user_meta_data)")
          .order("created_at")
        if (error) throw error
        return res.json({ profiles: data || [] })
      }

      if (type === "reports") {
        const { year, month, user_id } = req.query
        let q = sb.from("user_monthly_reports").select("*").order("year", { ascending: false }).order("month", { ascending: false })
        if (year) q = q.eq("year", Number(year))
        if (month) q = q.eq("month", Number(month))
        if (user_id) q = q.eq("user_id", String(user_id))
        const { data, error } = await q
        if (error) throw error
        return res.json({ reports: data || [] })
      }

      if (type === "my-report") {
        const now = new Date()
        const y = now.getFullYear(); const m = now.getMonth() + 1
        const { data, error } = await sb.from("user_monthly_reports").select("*")
          .eq("user_id", authed.user!.id).order("year", { ascending: false }).order("month", { ascending: false }).limit(12)
        if (error) throw error
        return res.json({ reports: data || [] })
      }

      return res.status(400).json({ error: "type required" })
    }

    if (req.method === "POST") {
      const { action } = req.body

      if (action === "generate-monthly") {
        const now = new Date()
        const year = req.body.year || now.getFullYear()
        const month = req.body.month || now.getMonth() + 1

        const { data: users } = await sb.from("user_profiles").select("user_id, hourly_rate")
        if (!users) return res.json({ generated: 0 })

        let generated = 0
        for (const u of users) {
          const startDate = `${year}-${String(month).padStart(2, "0")}-01`
          const endDate = new Date(year, month, 0).toISOString().slice(0, 10)

          const { count: totalTasks } = await sb.from("user_tasks").select("*", { count: "exact", head: true })
            .eq("user_id", u.user_id).gte("created_at", startDate).lte("created_at", endDate + "T23:59:59Z")
          const { count: completedTasks } = await sb.from("user_tasks").select("*", { count: "exact", head: true })
            .eq("user_id", u.user_id).eq("status", "done").gte("created_at", startDate).lte("created_at", endDate + "T23:59:59Z")

          const total_tasks = totalTasks || 0
          const completed_tasks = completedTasks || 0
          const earnings = Number(u.hourly_rate || 0) * completed_tasks * 0.5

          await sb.from("user_monthly_reports").upsert({
            user_id: u.user_id, year, month, total_tasks, completed_tasks,
            total_hours: completed_tasks * 0.5, earnings,
            generated_at: new Date().toISOString(),
          }, { onConflict: "user_id,year,month" })
          generated++
        }
        return res.json({ ok: true, generated, year, month })
      }

      if (action === "upsert-profile") {
        const { user_id, display_name, role, hourly_rate, monthly_target_hours, notes } = req.body
        if (!user_id) return res.status(400).json({ error: "user_id required" })
        const { error } = await sb.from("user_profiles").upsert(
          { user_id, display_name, role, hourly_rate, monthly_target_hours, notes, updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        )
        if (error) throw error
        return res.json({ ok: true })
      }

      return res.status(400).json({ error: "unknown action" })
    }

    res.status(405).end()
  } catch (e: any) {
    console.error("[user-reports]", e)
    res.status(500).json({ error: e.message })
  }
}
