import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { supabase } from '@/lib/supabase'
import {
  LayoutDashboard, Ship, FileText, Package,
  BarChart2, Users, Settings, LogOut,
  ChevronLeft, ChevronRight, Shield, DollarSign, Anchor
} from 'lucide-react'

const navItems = [
  { href: '/admin',            icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/admin/shipments',  icon: Ship,            label: 'Shipments' },
  { href: '/admin/documents',  icon: Package,         label: 'Documents' },
  { href: '/admin/boat-note',  icon: Anchor,          label: 'Boat Notes' },
  { href: '/admin/financials', icon: DollarSign,      label: 'Financials' },
  { href: '/admin/reports',    icon: BarChart2,       label: 'Reports' },
  { href: '/admin/users',      icon: Users,           label: 'Users' },
  { href: '/admin/logs',       icon: Shield,          label: 'Login Logs' },
  { href: '/admin/settings',   icon: Settings,        label: 'Settings' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/')
  }

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
          {navItems.map(({href, icon: Icon, label}) => {
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
