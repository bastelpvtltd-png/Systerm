import { useEffect, useState } from "react"
import AdminLayout, { usePermission } from "@/components/admin/AdminLayout"
import { authHeader, supabase } from "@/lib/supabase"
import { BarChart2, Users, FileText, RefreshCw, Loader, ChevronDown, Save, AlertTriangle } from "lucide-react"

interface UserProfile {
  id: string; user_id: string; display_name: string | null; role: string
  hourly_rate: number; monthly_target_hours: number; notes: string | null
  user?: { email: string; raw_user_meta_data?: { full_name?: string } }
}

interface MonthlyReport {
  id: string; user_id: string; year: number; month: number
  total_tasks: number; completed_tasks: number; total_hours: number
  earnings: number; notes: string | null; generated_at: string
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

function AdminReportsTab() {
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [reports, setReports] = useState<MonthlyReport[]>([])
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState("")
  const [editProfile, setEditProfile] = useState<Partial<UserProfile> & { user_id: string } | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)

  async function loadProfiles() {
    const h = await authHeader()
    const r = await fetch("/api/user-reports?type=profiles", { headers: h })
    if (r.ok) { const d = await r.json(); setProfiles(d.profiles || []) }
  }

  async function loadReports() {
    setLoading(true)
    try {
      const h = await authHeader()
      const r = await fetch("/api/user-reports?type=reports&year=" + year + "&month=" + month, { headers: h })
      if (r.ok) { const d = await r.json(); setReports(d.reports || []) }
    } finally { setLoading(false) }
  }

  useEffect(() => { loadProfiles() }, [])
  useEffect(() => { loadReports() }, [year, month])

  async function generateMonthly() {
    setGenerating(true); setStatus("")
    try {
      const h = await authHeader()
      const r = await fetch("/api/user-reports", {
        method: "POST", headers: { "Content-Type": "application/json", ...h },
        body: JSON.stringify({ action: "generate-monthly", year, month }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setStatus("Generated for " + d.generated + " users")
      loadReports()
    } catch (e: any) { setStatus("Error: " + e.message) }
    finally { setGenerating(false) }
  }

  async function saveProfile() {
    if (!editProfile) return
    setSavingProfile(true)
    try {
      const h = await authHeader()
      const r = await fetch("/api/user-reports", {
        method: "POST", headers: { "Content-Type": "application/json", ...h },
        body: JSON.stringify({ action: "upsert-profile", ...editProfile }),
      })
      if (!r.ok) throw new Error("Save failed")
      setEditProfile(null)
      loadProfiles()
    } finally { setSavingProfile(false) }
  }

  const profileMap = Object.fromEntries(profiles.map(p => [p.user_id, p]))

  return (
    <div className="space-y-6">
      {/* User Profiles */}
      <div className="card">
        <h2 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2"><Users size={15}/>User Profiles</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-gray-100 text-gray-500">
              <th className="text-left pb-2 pr-3">User</th>
              <th className="text-left pb-2 pr-3">Role</th>
              <th className="text-left pb-2 pr-3">Hourly Rate</th>
              <th className="text-left pb-2 pr-3">Target Hrs/mo</th>
              <th className="pb-2 w-12"></th>
            </tr></thead>
            <tbody>
              {profiles.map(p => (
                <tr key={p.id} className="border-b border-gray-50">
                  <td className="py-1.5 pr-3 font-medium text-gray-800">{p.display_name || p.user?.email || p.user_id.slice(0,8)}</td>
                  <td className="py-1.5 pr-3 text-gray-500">{p.role}</td>
                  <td className="py-1.5 pr-3">LKR {Number(p.hourly_rate || 0).toLocaleString()}</td>
                  <td className="py-1.5 pr-3">{p.monthly_target_hours}h</td>
                  <td className="py-1.5">
                    <button onClick={() => setEditProfile({ ...p })} className="text-blue-500 hover:underline text-[11px]">Edit</button>
                  </td>
                </tr>
              ))}
              {profiles.length === 0 && <tr><td colSpan={5} className="py-4 text-gray-400 text-center">No user profiles yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthly Reports */}
      <div className="card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><FileText size={15}/>Monthly Reports</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={year} onChange={e => setYear(Number(e.target.value))} className="input text-xs w-24">
              {[2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={month} onChange={e => setMonth(Number(e.target.value))} className="input text-xs w-28">
              {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
            <button onClick={loadReports} className="btn-secondary flex items-center gap-1 text-xs"><RefreshCw size={12}/>Load</button>
            <button onClick={generateMonthly} disabled={generating} className="btn-primary flex items-center gap-1 text-xs">
              {generating ? <Loader size={12} className="animate-spin"/> : <BarChart2 size={12}/>}Generate
            </button>
          </div>
        </div>
        {status && <p className={`text-xs mb-2 ${status.startsWith("Error") ? "text-red-500" : "text-green-600"}`}>{status}</p>}
        {loading ? <div className="flex justify-center py-8"><Loader size={16} className="animate-spin text-gray-300"/></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-100 text-gray-500">
                <th className="text-left pb-2 pr-3">User</th>
                <th className="text-left pb-2 pr-3">Month</th>
                <th className="text-left pb-2 pr-3">Tasks</th>
                <th className="text-left pb-2 pr-3">Done</th>
                <th className="text-left pb-2 pr-3">Hours</th>
                <th className="text-left pb-2">Earnings</th>
              </tr></thead>
              <tbody>
                {reports.map(r => {
                  const p = profileMap[r.user_id]
                  return (
                    <tr key={r.id} className="border-b border-gray-50">
                      <td className="py-1.5 pr-3 font-medium">{p?.display_name || r.user_id.slice(0,8)}</td>
                      <td className="py-1.5 pr-3">{MONTHS[r.month-1]} {r.year}</td>
                      <td className="py-1.5 pr-3">{r.total_tasks}</td>
                      <td className="py-1.5 pr-3 text-green-600 font-medium">{r.completed_tasks}</td>
                      <td className="py-1.5 pr-3">{Number(r.total_hours).toFixed(1)}h</td>
                      <td className="py-1.5 font-semibold text-blue-700">LKR {Number(r.earnings).toLocaleString()}</td>
                    </tr>
                  )
                })}
                {reports.length === 0 && <tr><td colSpan={6} className="py-4 text-gray-400 text-center">No reports for {MONTHS[month-1]} {year} — click Generate</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit profile modal */}
      {editProfile && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-3">
            <h2 className="font-semibold text-gray-900 text-sm">Edit Profile</h2>
            {[["display_name","Display Name","text"],["role","Role","text"],["hourly_rate","Hourly Rate (LKR)","number"],["monthly_target_hours","Target Hours/Month","number"]].map(([key, label, type]) => (
              <div key={key}>
                <label className="block text-xs text-gray-500 mb-0.5">{label}</label>
                <input type={type} value={(editProfile as any)[key] || ""}
                  onChange={e => setEditProfile(p => p ? { ...p, [key]: type === "number" ? Number(e.target.value) : e.target.value } : p)}
                  className="input text-xs"/>
              </div>
            ))}
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Notes</label>
              <textarea value={editProfile.notes || ""} onChange={e => setEditProfile(p => p ? { ...p, notes: e.target.value } : p)} className="input text-xs h-16 resize-none"/>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={saveProfile} disabled={savingProfile} className="btn-primary flex items-center gap-1.5 flex-1 justify-center text-xs">
                {savingProfile ? <Loader size={12} className="animate-spin"/> : <Save size={12}/>}Save
              </button>
              <button onClick={() => setEditProfile(null)} className="flex-1 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MyReportTab() {
  const [reports, setReports] = useState<MonthlyReport[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const h = await authHeader()
      const r = await fetch("/api/user-reports?type=my-report", { headers: h })
      if (r.ok) { const d = await r.json(); setReports(d.reports || []) }
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div className="flex justify-center py-16"><Loader size={16} className="animate-spin text-gray-300"/></div>

  if (reports.length === 0) return (
    <div className="card text-center py-16">
      <BarChart2 size={40} className="text-gray-200 mx-auto mb-3"/>
      <p className="text-sm text-gray-400">No reports yet — reports are generated on the 10th of each month</p>
    </div>
  )

  return (
    <div className="space-y-3">
      {reports.map(r => (
        <div key={r.id} className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 text-sm">{MONTHS[r.month-1]} {r.year}</h3>
            <span className="text-[11px] text-gray-400">Generated {new Date(r.generated_at).toLocaleDateString()}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[["Tasks Assigned", r.total_tasks, "text-gray-700"], ["Tasks Completed", r.completed_tasks, "text-green-600"],
              ["Hours Logged", Number(r.total_hours).toFixed(1) + "h", "text-blue-600"],
              ["Earnings", "LKR " + Number(r.earnings).toLocaleString(), "text-purple-600"]].map(([label, val, color]) => (
              <div key={label as string} className="bg-gray-50 rounded-xl p-3">
                <p className="text-[11px] text-gray-400 mb-0.5">{label}</p>
                <p className={"text-lg font-bold " + color}>{val}</p>
              </div>
            ))}
          </div>
          {r.notes && <p className="text-xs text-gray-500 mt-3 border-t border-gray-50 pt-3">{r.notes}</p>}
        </div>
      ))}
    </div>
  )
}

export default function ReportsPage() {
  const { isAdmin } = usePermission()
  const [tab, setTab] = useState<"my" | "admin">("my")

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><BarChart2 size={20} className="text-blue-500"/>Reports</h1>
        <p className="text-gray-500 text-sm mt-0.5">Monthly work summaries and earnings</p>
      </div>

      {isAdmin && (
        <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl w-fit">
          <button onClick={() => setTab("my")} className={"px-4 py-2 rounded-lg text-sm font-medium " + (tab === "my" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>My Reports</button>
          <button onClick={() => setTab("admin")} className={"px-4 py-2 rounded-lg text-sm font-medium " + (tab === "admin" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>All Users</button>
        </div>
      )}

      {tab === "my" || !isAdmin ? <MyReportTab/> : <AdminReportsTab/>}
    </div>
  )
}
ReportsPage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>
