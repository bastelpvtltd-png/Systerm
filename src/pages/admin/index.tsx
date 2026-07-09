import { useEffect, useState } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { supabase, authHeader } from '@/lib/supabase'
import { Ship, FileText, Package, Clock, AlertCircle, ChevronDown } from 'lucide-react'

interface PendingGroup<T> { count: number; items: T[] }
interface Summary {
  totalShipments: number
  shipmentsPending: PendingGroup<{ id: string; reference: string; shipper: string; invoice_number: string; packing_number: string; created_at: string }>
  cdnPending: PendingGroup<{ cusdecId: string; number: string; exporter: string; cap: number; cdnCount: number }>
  boatNotePending: PendingGroup<{ cusdecId: string; number: string; exporter: string; cap: number | null; cdnCount: number; passedCount: number }>
  releasePending: PendingGroup<{ cusdecId: string; number: string; exporter: string }>
}
const emptyGroup = { count: 0, items: [] }

// getLayout (see _app.tsx) keeps AdminLayout mounted across navigations
// instead of remounting the sidebar on every tab click.
export default function AdminDashboard() {
  return <DashboardContent/>
}
AdminDashboard.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>

function DashboardContent() {
  const [summary, setSummary] = useState<Summary>({
    totalShipments: 0, shipmentsPending: emptyGroup, cdnPending: emptyGroup, boatNotePending: emptyGroup, releasePending: emptyGroup,
  })
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { count: total } = await supabase.from('temporary_shipments').select('*', { count: 'exact', head: true })
      const res = await fetch('/api/dashboard-summary', { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) {
        setSummary({
          totalShipments: total ?? 0,
          shipmentsPending: d.shipmentsPending || emptyGroup,
          cdnPending: d.cdnPending || emptyGroup,
          boatNotePending: d.boatNotePending || emptyGroup,
          releasePending: d.releasePending || emptyGroup,
        })
      }
    }
    load()
  }, [])

  const { has } = usePermission()

  const stats = [
    { key: 'section:dashboard.total-shipments',  id: 'total',    label: 'Total Shipments',        value: summary.totalShipments,          icon: Ship,        color: '#1B3A5C' },
    { key: 'section:dashboard.cusdec-pending',   id: 'shipments',label: 'Shipments Pending (no CUSDEC yet)', value: summary.shipmentsPending.count, icon: FileText,    color: '#f59e0b' },
    { key: 'section:dashboard.cdn-pending',      id: 'cdn',      label: 'CDN Pending (CAP not complete)',    value: summary.cdnPending.count,       icon: Clock,       color: '#8b5cf6' },
    { key: 'section:dashboard.boatnote-pending', id: 'boatnote', label: 'Boat Note Pending',       value: summary.boatNotePending.count,    icon: Package,     color: '#3b82f6' },
    { key: 'section:dashboard.release-pending',  id: 'release',  label: 'Export Release Pending',  value: summary.releasePending.count,     icon: AlertCircle, color: '#ef4444' },
  ].filter(s => has(s.key))

  return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Export Management Overview</p>
        </div>

        {stats.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-4">
            {stats.map(({ id, label, value, icon: Icon, color }) => (
              <button key={id} onClick={() => id !== 'total' && setExpanded(x => x === id ? null : id)}
                className={`card text-left ${id !== 'total' ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: color + '20' }}>
                    <Icon size={18} style={{ color }}/>
                  </div>
                  {id !== 'total' && <ChevronDown size={14} className={`text-gray-300 transition-transform ${expanded === id ? 'rotate-180' : ''}`}/>}
                </div>
                <div className="text-2xl font-bold text-gray-900">{value}</div>
                <div className="text-xs text-gray-500 mt-1">{label}</div>
              </button>
            ))}
          </div>
        )}

        {expanded === 'shipments' && (
          <div className="card mb-4">
            <h2 className="font-semibold text-gray-900 mb-3 text-sm">Shipments opened with no CUSDEC uploaded/matched yet</h2>
            {summary.shipmentsPending.items.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">None — every open Shipment has a matching CUSDEC</p>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {summary.shipmentsPending.items.map(s => (
                  <div key={s.id} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg p-2.5">
                    <div>
                      <p className="font-medium text-gray-800">{s.shipper} · Inv: {s.invoice_number}</p>
                      <p className="text-gray-400">Ref: {s.reference || '—'} · Packing: {s.packing_number || '—'}</p>
                    </div>
                    <a href="/admin/shipment-entry" className="text-blue-600 hover:underline flex-shrink-0">Open Shipment Entry →</a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {expanded === 'cdn' && (
          <div className="card mb-4">
            <h2 className="font-semibold text-gray-900 mb-3 text-sm">CUSDECs whose CAP isn't filled yet</h2>
            {summary.cdnPending.items.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">None — every CUSDEC's CAP is complete</p>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {summary.cdnPending.items.map(c => (
                  <div key={c.cusdecId} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg p-2.5">
                    <div>
                      <p className="font-medium text-gray-800">E {c.number}</p>
                      <p className="text-gray-400 truncate max-w-[240px]">{c.exporter}</p>
                    </div>
                    <span className="font-medium text-purple-700">{c.cdnCount}/{c.cap} CDN</span>
                    <a href="/admin/drive-files" className="text-blue-600 hover:underline flex-shrink-0">View →</a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {expanded === 'boatnote' && (
          <div className="card mb-4">
            <h2 className="font-semibold text-gray-900 mb-3 text-sm">CAP complete, still waiting on Boat Note</h2>
            {summary.boatNotePending.items.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">None — every CAP-complete CUSDEC has passed Boat Note</p>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {summary.boatNotePending.items.map(c => (
                  <div key={c.cusdecId} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg p-2.5">
                    <div>
                      <p className="font-medium text-gray-800">E {c.number}</p>
                      <p className="text-gray-400 truncate max-w-[240px]">{c.exporter}</p>
                    </div>
                    <span className="font-medium text-blue-700">{c.passedCount}/{c.cdnCount} passed</span>
                    <a href="/admin/automation?tab=boat-note-check" className="text-blue-600 hover:underline flex-shrink-0">Check →</a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {expanded === 'release' && (
          <div className="card mb-4">
            <h2 className="font-semibold text-gray-900 mb-3 text-sm">Boat Note passed (blue), waiting on Export Release</h2>
            {summary.releasePending.items.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">None — every Boat Note-passed CUSDEC has been released</p>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {summary.releasePending.items.map(c => (
                  <div key={c.cusdecId} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg p-2.5">
                    <div>
                      <p className="font-medium text-gray-800">E {c.number}</p>
                      <p className="text-gray-400 truncate max-w-[240px]">{c.exporter}</p>
                    </div>
                    <a href="/admin/automation?tab=export-release" className="text-blue-600 hover:underline flex-shrink-0">Check →</a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
  )
}
