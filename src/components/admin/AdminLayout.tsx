import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { supabase } from '@/lib/supabase'
import {
  LayoutDashboard, Ship, FileText, Package,
  BarChart2, Users, Settings, LogOut,
  ChevronLeft, ChevronRight, Shield, DollarSign, Anchor, ScanLine,
  Truck, Copy, Grid, Database, Upload, CheckCircle, Loader,
} from 'lucide-react'

// Single unified nav list — there is no separate admin/worker site anymore.
// Everyone signs into this same area; is_admin accounts see every tab, and
// everyone else sees only whichever hrefs are in their profile's allowed_tabs
// (granted per-user from the Users page), so access is per-tab, not per-role.
export const TAB_ITEMS = [
  { href: '/admin',                  icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/admin/my-tasks',         icon: CheckCircle,     label: 'My Tasks' },
  { href: '/admin/shipments',        icon: Ship,            label: 'Shipments' },
  { href: '/admin/doc-check',        icon: ScanLine,        label: 'Doc Check' },
  { href: '/admin/grid-map',         icon: Grid,            label: 'Grid Mapper' },
  { href: '/admin/cusdec',           icon: FileText,        label: 'CUSDEC' },
  { href: '/admin/cdn',              icon: Truck,           label: 'CDN' },
  { href: '/admin/documents',        icon: Package,         label: 'Documents' },
  { href: '/admin/documents-upload', icon: Upload,          label: 'Upload Docs' },
  { href: '/admin/boat-note',        icon: Anchor,          label: 'Boat Notes' },
  { href: '/admin/database',         icon: Database,        label: 'Database' },
  { href: '/admin/financials',       icon: DollarSign,      label: 'Financials' },
  { href: '/admin/reports',          icon: BarChart2,       label: 'Reports' },
  { href: '/admin/users',            icon: Users,           label: 'Users' },
  { href: '/admin/logs',             icon: Shield,          label: 'Login Logs' },
  { href: '/admin/settings',         icon: Settings,        label: 'Settings' },
]

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

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className={`sidebar flex flex-col transition-all duration-300 ${collapsed ? 'w-16' : 'w-56'}`}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:'#22A87A'}}>
            <Ship size={16} color="white"/>
          </div>
          {!collapsed && <span className="text-white font-bold text-sm">Export System</span>}
        </div>

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

        {/* Collapse + Logout */}
        <div className="p-2 border-t border-white/10 space-y-1">
          <button onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-red-300 hover:bg-white/10">
            <LogOut size={18}/>
            {!collapsed && <span>Logout</span>}
          </button>
          <button onClick={() => setCollapsed(!collapsed)}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-blue-200 hover:bg-white/10">
            {collapsed ? <ChevronRight size={18}/> : <ChevronLeft size={18}/>}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto bg-gray-50">
        {children}
      </main>
    </div>
  )
}
