import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '@/lib/supabase'
import { Ship, LogOut, Loader } from 'lucide-react'

// Deliberately separate from AdminLayout — a shipper account is not staff,
// so this never shares the admin sidebar, the admin permission model, or
// any admin API route. Guards against a non-shipper (or an admin) landing
// here directly, same spirit as AdminLayout guarding /admin/* for non-admins.
export default function ShipperLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [shipperName, setShipperName] = useState('')

  useEffect(() => {
    let cancelled = false
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/'); return }
      const { data: prof } = await supabase.from('profiles').select('is_shipper, shipper_name, full_name, username').eq('id', user.id).maybeSingle()
      if (cancelled) return
      if (!prof?.is_shipper) { router.replace('/'); return }
      setShipperName(prof.full_name || prof.username || prof.shipper_name || '')
      setChecking(false)
    }
    check()
    return () => { cancelled = true }
  }, [router])

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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="text-white" style={{ background: '#1B3A5C' }}>
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Ship size={20}/>
            <span className="font-bold">Bastel — Shipper Portal</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-blue-100">{shipperName}</span>
            <button onClick={handleLogout} className="flex items-center gap-1 text-sm text-blue-100 hover:text-white">
              <LogOut size={14}/>Logout
            </button>
          </div>
        </div>
      </div>
      <div className="max-w-4xl mx-auto p-5">{children}</div>
    </div>
  )
}
