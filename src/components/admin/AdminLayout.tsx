import { createContext, useContext, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { supabase } from '@/lib/supabase'
import {
  LayoutDashboard, Ship, Upload,
  BarChart2, Users, Settings, LogOut,
  ChevronLeft, ChevronRight, Shield, DollarSign, Anchor,
  Database, Loader, MessageSquare, CheckCircle, FileStack, Zap, Clock,
} from 'lucide-react'
import { formatSLDateTime } from '@/lib/slTime'

// Ticks every second in Sri Lanka time (Asia/Colombo) regardless of the
// viewer's own timezone/device clock — a plain "load-time" timestamp would
// go stale the moment the page was left open, so this actually re-renders.
function SidebarClock({ collapsed }: { collapsed: boolean }) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const time = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const date = now.toLocaleDateString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', year: 'numeric' })
  return (
    <div className="px-3 py-2.5 border-t border-white/10 text-blue-100 flex items-center gap-2">
      <Clock size={14} className="flex-shrink-0"/>
      {!collapsed && <div className="text-xs leading-tight"><div className="font-semibold tabular-nums">{time}</div><div className="text-blue-300">{date} · SLT</div></div>}
    </div>
  )
}

// Single unified nav list — there is no separate admin/worker site anymore.
// Everyone signs into this same area; is_admin accounts see every tab, and
// everyone else sees only whichever hrefs are in their profile's allowed_tabs
// (granted per-user from the Users page), so access is per-tab, not per-role.
// The full box/template editor lives inside "Upload Docs"' Admin Edit panel
// (gated by section:documents-upload.admin-edit) — there's no separate
// "Documents" tab anymore.
export const TAB_ITEMS = [
  { href: '/admin',                  icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/admin/my-tasks',         icon: CheckCircle,     label: 'My Tasks' },
  { href: '/admin/shipment-entry',   icon: Ship,            label: 'Shipment Entry' },
  { href: '/admin/documents-upload', icon: Upload,          label: 'Upload Docs' },
  { href: '/admin/drive-files',      icon: Database,        label: 'Shipment Overview' },
  { href: '/admin/boat-note',        icon: FileStack,       label: 'Docs Create' },
  { href: '/admin/templates',        icon: FileStack,       label: 'Templates' },
  { href: '/admin/automation',       icon: Zap,             label: 'Automation' },
  { href: '/admin/messages',         icon: MessageSquare,   label: 'Messages' },
  { href: '/admin/database',         icon: Database,        label: 'Database' },
  { href: '/admin/financials',       icon: DollarSign,      label: 'Financials' },
  { href: '/admin/reports',          icon: BarChart2,       label: 'Reports' },
  { href: '/admin/users',            icon: Users,           label: 'Users' },
  { href: '/admin/settings',         icon: Settings,        label: 'Settings' },
]

// Finer-grained pieces inside a tab — the Dashboard's stat cards, for example,
// can each be individually granted instead of all-or-nothing with the tab.
// Keys are namespaced "section:<page>.<piece>" so they never collide with a
// tab href, and live in the same allowed_tabs array. tabHref ties each
// section back to the tab it lives on, so the Users page can show "which
// cards on THIS tab" once that tab itself is granted.
export const SECTION_ITEMS = [
  // Dashboard
  { key: 'section:dashboard.total-shipments', tabHref: '/admin', label: 'Total Shipments card' },
  { key: 'section:dashboard.cusdec-pending',  tabHref: '/admin', label: 'CUSDEC Pending card' },
  { key: 'section:dashboard.boatnote-pending',tabHref: '/admin', label: 'Boat Note Pending card' },
  { key: 'section:dashboard.cdn-pending',     tabHref: '/admin', label: 'CDN Pending card' },
  { key: 'section:dashboard.release-pending', tabHref: '/admin', label: 'Export Release Pending card' },
  { key: 'section:dashboard.pending-summary', tabHref: '/admin', label: 'Pending Work Summary panel' },
  { key: 'section:dashboard.incoming',        tabHref: '/admin', label: 'Incoming (Notify) panel' },
  { key: 'section:dashboard.my-picked-tasks', tabHref: '/admin', label: 'My Picked Tasks panel' },
  // Shipment Entry
  { key: 'section:shipment-entry.form', tabHref: '/admin/shipment-entry', label: 'Shipment entry form' },
  // Templates
  { key: 'section:templates.manage', tabHref: '/admin/templates', label: 'Template upload & fill' },
  // My Tasks
  { key: 'section:my-tasks.daily-cost',      tabHref: '/admin/my-tasks', label: 'Daily Cost entry (add cost)' },
  { key: 'section:my-tasks.balance-update',  tabHref: '/admin/my-tasks', label: 'Balance deposit/top-up (accountant/owner only)' },
  // Upload Docs
  { key: 'section:documents-upload.upload',     tabHref: '/admin/documents-upload', label: 'Upload PDFs card' },
  { key: 'section:documents-upload.uploaded',   tabHref: '/admin/documents-upload', label: 'Uploaded list card (normal access)' },
  { key: 'section:documents-upload.preview',    tabHref: '/admin/documents-upload', label: 'All Documents preview panel' },
  { key: 'section:documents-upload.admin-edit', tabHref: '/admin/documents-upload', label: 'Full Access Edit panel (box/template editor)' },
  // Settings
  { key: 'section:settings.general',  tabHref: '/admin/settings', label: 'General Info tab' },
  { key: 'section:settings.database', tabHref: '/admin/settings', label: 'Document Records tab' },
  { key: 'section:settings.logs',     tabHref: '/admin/settings', label: 'Login Logs tab (view-only; clearing is admin-only)' },
  // Docs Create (Invoice / Packing List / Boat Note)
  { key: 'section:boat-note.invoice',       tabHref: '/admin/boat-note', label: 'Invoice panel' },
  { key: 'section:boat-note.packing-list',  tabHref: '/admin/boat-note', label: 'Packing List panel' },
  { key: 'section:boat-note.select-cusdec', tabHref: '/admin/boat-note', label: 'Boat Note: Select CUSDEC card' },
  { key: 'section:boat-note.select-cdn',     tabHref: '/admin/boat-note', label: 'Boat Note: Select Containers (CDN) card' },
  { key: 'section:boat-note.output',         tabHref: '/admin/boat-note', label: 'Boat Note: Download / Email card' },
  // Database — per table, since some tables (Users/Profiles, PDF Templates) are more sensitive than others
  { key: 'section:database.cusdec',             tabHref: '/admin/database', label: 'CUSDEC table' },
  { key: 'section:database.cdn',                tabHref: '/admin/database', label: 'CDN table' },
  { key: 'section:database.barcode',            tabHref: '/admin/database', label: 'Barcode table' },
  { key: 'section:database.boat_notes',         tabHref: '/admin/database', label: 'Boat Notes table' },
  { key: 'section:database.uploaded_documents', tabHref: '/admin/database', label: 'Uploaded Documents table' },
  { key: 'section:database.pdf_templates',      tabHref: '/admin/database', label: 'PDF Templates table' },
  { key: 'section:database.messages',           tabHref: '/admin/database', label: 'Messages table' },
  { key: 'section:database.profiles',           tabHref: '/admin/database', label: 'Users (Profiles) table' },
  // Automation
  { key: 'section:automation.xml-generator',      tabHref: '/admin/automation', label: 'Cusdec XML Generator' },
  { key: 'section:automation.cdn-text',            tabHref: '/admin/automation', label: 'CDN Text Extractor & Database' },
  { key: 'section:automation.barcode-enter',       tabHref: '/admin/automation', label: 'Barcode Enter' },
  { key: 'section:automation.trico-gate-pass',     tabHref: '/admin/automation', label: 'Trico Gate Passes' },
  { key: 'section:automation.data-updates',        tabHref: '/admin/automation', label: 'Data Updates' },
  { key: 'section:automation.boat-note-create',    tabHref: '/admin/automation', label: 'Boat Note Create' },
  { key: 'section:automation.boat-note-check',     tabHref: '/admin/automation', label: 'Boat Note Check' },
  { key: 'section:automation.export-release-check',tabHref: '/admin/automation', label: 'Export Release Check' },
  { key: 'section:automation.credentials',         tabHref: '/admin/automation', label: 'Credentials Settings' },
  { key: 'section:automation.notes',               tabHref: '/admin/automation', label: 'System Logic & Integration Notes' },
]

interface PermissionValue { isAdmin: boolean; has: (key: string) => boolean }
const PermissionContext = createContext<PermissionValue>({ isAdmin: false, has: () => false })
export function usePermission() {
  return useContext(PermissionContext)
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [checking, setChecking] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [allowedTabs, setAllowedTabs] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/'); return }
      const { data: prof } = await supabase.from('profiles').select('is_admin, allowed_tabs').eq('id', user.id).single()
      if (cancelled) return
      const admin = !!prof?.is_admin
      const allowed: string[] = prof?.allowed_tabs || []
      setIsAdmin(admin)
      setAllowedTabs(allowed)
      setChecking(false)

      if (!admin && allowed.length && !allowed.includes(router.pathname)) {
        router.replace(allowed[0])
      }
    }
    check()
    return () => { cancelled = true }
  }, [router.pathname])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader size={20} className="animate-spin text-gray-400"/>
      </div>
    )
  }

  if (!isAdmin && !allowedTabs.length) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-3 text-center px-6">
        <Shield size={28} className="text-gray-300"/>
        <p className="text-gray-600 text-sm font-medium">No tabs have been assigned to your account yet.</p>
        <p className="text-gray-400 text-xs">Ask an admin to grant you access from the Users page.</p>
        <button onClick={handleLogout} className="flex items-center gap-1 text-red-500 text-sm hover:text-red-600 mt-2">
          <LogOut size={14}/>Logout
        </button>
      </div>
    )
  }

  const visibleItems = isAdmin ? TAB_ITEMS : TAB_ITEMS.filter(t => allowedTabs.includes(t.href))
  const permValue: PermissionValue = { isAdmin, has: (key: string) => isAdmin || allowedTabs.includes(key) }

  return (
    <PermissionContext.Provider value={permValue}>
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className={`sidebar flex flex-col transition-all duration-300 ${collapsed ? 'w-16' : 'w-56'}`}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:'#22A87A'}}>
            <Ship size={16} color="white"/>
          </div>
          {!collapsed && <span className="text-white font-bold text-sm">Bastel Official System</span>}
        </div>

        {/* Collapse toggle — right above the tab list */}
        <button onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-3 px-3 py-2 mx-2 mt-2 rounded-lg text-sm text-blue-200 hover:bg-white/10 flex-shrink-0">
          {collapsed ? <ChevronRight size={18}/> : <ChevronLeft size={18}/>}
          {!collapsed && <span>Collapse</span>}
        </button>

        {/* Nav */}
        <nav className="flex-1 py-4 space-y-1 px-2">
          {visibleItems.map(({href, icon: Icon, label}) => {
            const active = router.pathname === href
            return (
              <Link key={href} href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  active ? 'bg-brand-green text-white' : 'text-blue-100 hover:bg-white/10'
                }`}>
                <Icon size={18} className="flex-shrink-0"/>
                {!collapsed && <span>{label}</span>}
              </Link>
            )
          })}
        </nav>

        {/* Live Sri Lanka time — runs continuously, not just at page load */}
        <SidebarClock collapsed={collapsed}/>

        {/* Collapse + Logout */}
        <div className="p-2 border-t border-white/10 space-y-1">
          <Link href="/profile"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
              router.pathname === '/profile' ? 'bg-brand-green text-white' : 'text-blue-100 hover:bg-white/10'
            }`}>
            <Users size={18} className="flex-shrink-0"/>
            {!collapsed && <span>My Profile</span>}
          </Link>
          <button onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-red-300 hover:bg-white/10">
            <LogOut size={18}/>
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto bg-gray-50">
        {children}
      </main>
    </div>
    </PermissionContext.Provider>
  )
}
