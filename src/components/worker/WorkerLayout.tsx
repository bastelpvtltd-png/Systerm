import Link from 'next/link'
import { useRouter } from 'next/router'
import { supabase } from '@/lib/supabase'
import { Ship, LogOut, ClipboardList, FileText } from 'lucide-react'

const navItems = [
  { href: '/worker',           icon: ClipboardList, label: 'My Tasks' },
  { href: '/worker/documents', icon: FileText,      label: 'Documents' },
]

export default function WorkerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="text-white px-6 py-4 flex items-center justify-between" style={{ background: 'linear-gradient(90deg,#0D1B2A,#1B3A5C)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#22A87A' }}>
            <Ship size={16} color="white"/>
          </div>
          <span className="font-bold">Export System</span>
          <nav className="flex items-center gap-1 ml-4">
            {navItems.map(({ href, icon: Icon, label }) => {
              const active = router.pathname === href
              return (
                <Link key={href} href={href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    active ? 'bg-white/15 text-white' : 'text-blue-200 hover:bg-white/10'
                  }`}>
                  <Icon size={14}/>{label}
                </Link>
              )
            })}
          </nav>
        </div>
        <button onClick={handleLogout} className="flex items-center gap-1 text-red-300 text-sm hover:text-red-200">
          <LogOut size={14}/>Logout
        </button>
      </header>
      {children}
    </div>
  )
}
