import { useEffect, useState } from 'react'
import AdminLayout from '@/components/admin/AdminLayout'
import { supabase } from '@/lib/supabase'
import { Ship, FileText, Package, Clock, CheckCircle, AlertCircle, DollarSign } from 'lucide-react'

interface Summary {
  totalShipments: number
  pendingCusdec: number
  pendingBoatNote: number
  pendingCdn: number
  pendingRelease: number
}

export default function AdminDashboard() {
  const [summary, setSummary] = useState<Summary>({
    totalShipments: 0, pendingCusdec: 0,
    pendingBoatNote: 0, pendingCdn: 0, pendingRelease: 0
  })

  useEffect(() => {
    async function load() {
      const [{ count: total }, { count: cusdec }, { count: bn }, { count: cdn }, { count: rel }] = await Promise.all([
        supabase.from('shipments').select('*', { count: 'exact', head: true }),
        supabase.from('cusdec').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('boat_notes').select('*', { count: 'exact', head: true }),
        supabase.from('cdn').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('shipments').select('*', { count: 'exact', head: true }).eq('status', 'processing'),
      ])
      setSummary({
        totalShipments: total ?? 0,
        pendingCusdec: cusdec ?? 0,
        pendingBoatNote: bn ?? 0,
        pendingCdn: cdn ?? 0,
        pendingRelease: rel ?? 0,
      })
    }
    load()
  }, [])

  const stats = [
    { label: 'Total Shipments',      value: summary.totalShipments, icon: Ship,        color: '#1B3A5C' },
    { label: 'CUSDEC Pending',       value: summary.pendingCusdec,  icon: FileText,    color: '#f59e0b' },
    { label: 'Boat Note Pending',    value: summary.pendingBoatNote,icon: Package,     color: '#3b82f6' },
    { label: 'CDN Pending',          value: summary.pendingCdn,     icon: Clock,       color: '#8b5cf6' },
    { label: 'Export Release Pending',value: summary.pendingRelease,icon: AlertCircle, color: '#ef4444' },
  ]

  return (
    <AdminLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Export Management Overview</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
          {stats.map(({label, value, icon: Icon, color}) => (
            <div key={label} className="card">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{background: color+'20'}}>
                  <Icon size={18} style={{color}}/>
                </div>
              </div>
              <div className="text-2xl font-bold text-gray-900">{value}</div>
              <div className="text-xs text-gray-500 mt-1">{label}</div>
            </div>
          ))}
        </div>

        {/* Pending Work Summary */}
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Clock size={18} className="text-brand-green"/>
            Pending Work Summary
          </h2>
          <div className="space-y-3">
            {[
              { label: 'CUSDEC Pending',        count: summary.pendingCusdec,  color: 'yellow' },
              { label: 'Boat Note Pending',     count: summary.pendingBoatNote,color: 'blue' },
              { label: 'CDN Pending',           count: summary.pendingCdn,     color: 'purple' },
              { label: 'Export Release Pending',count: summary.pendingRelease, color: 'red' },
            ].map(({label, count, color}) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-gray-50">
                <span className="text-sm text-gray-700">{label}</span>
                <span className={`badge-pending text-${color}-800 bg-${color}-100`}>{count} pending</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}
