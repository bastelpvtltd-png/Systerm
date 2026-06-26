import { useState, useEffect } from 'react'
import AdminLayout from '@/components/admin/AdminLayout'
import { Settings, Database, Trash2, Loader, RefreshCw, ExternalLink, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type Tab = 'general' | 'database'

interface DbRecord {
  id: string; doc_type: string; file_name: string; drive_url: string; created_at: string
}

const TYPE_LABELS: Record<string, string> = {
  cusdec: 'CUSDEC', cdn: 'CDN', barcode: 'Barcode',
  boat_note: 'Boat Note', party_copy: "Party's Copy", bill: 'Bill',
}

export default function SettingsPage() {
  const [tab, setTab]             = useState<Tab>('general')
  const [records, setRecords]     = useState<DbRecord[]>([])
  const [loading, setLoading]     = useState(false)
  const [deleting, setDeleting]   = useState<string | null>(null)
  const [filterType, setFilterType] = useState('all')
  const [confirmId, setConfirmId] = useState<string | null>(null)

  useEffect(() => { if (tab === 'database') loadRecords() }, [tab, filterType])

  async function loadRecords() {
    setLoading(true)
    try {
      const url = filterType === 'all'
        ? '/api/list-documents'
        : `/api/list-documents?doc_type=${filterType}`
      const res = await fetch(url)
      if (res.ok) { const d = await res.json(); setRecords(d.records || []) }
    } finally { setLoading(false) }
  }

  async function deleteRecord(id: string) {
    setDeleting(id)
    try {
      const res = await fetch(`/api/delete-document?id=${id}`, { method: 'DELETE' })
      if (res.ok) setRecords(prev => prev.filter(r => r.id !== id))
    } finally { setDeleting(null); setConfirmId(null) }
  }

  return (
    <AdminLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-500 text-sm mt-1">System configuration · Database management</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
          {([['general', Settings, 'General'], ['database', Database, 'Database']] as const).map(([key, Icon, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              <Icon size={14}/>{label}
            </button>
          ))}
        </div>

        {/* General tab */}
        {tab === 'general' && (
          <div className="card max-w-xl">
            <h2 className="font-semibold text-gray-900 mb-4">System Info</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b border-gray-50">
                <span className="text-gray-500">Version</span>
                <span className="font-medium text-gray-800">1.0.0</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-50">
                <span className="text-gray-500">Database</span>
                <span className="font-medium text-green-600">Supabase · Connected</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-50">
                <span className="text-gray-500">Storage</span>
                <span className="font-medium text-green-600">Supabase Storage · export-docs</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-gray-500">Google Drive</span>
                <span className="font-medium text-amber-600">OAuth not configured</span>
              </div>
            </div>
          </div>
        )}

        {/* Database tab — admin only */}
        {tab === 'database' && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Database size={16} className="text-gray-500"/> Uploaded Documents
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">{records.length} records · Admin only</p>
              </div>
              <div className="flex items-center gap-2">
                <select value={filterType} onChange={e => setFilterType(e.target.value)}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600">
                  <option value="all">All types</option>
                  {Object.entries(TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <button onClick={loadRecords} className="text-gray-400 hover:text-gray-700">
                  <RefreshCw size={14}/>
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex justify-center py-10"><Loader size={20} className="animate-spin text-gray-400"/></div>
            ) : records.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">No records</div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-3 py-2 text-xs text-gray-500 font-medium">Type</th>
                      <th className="px-3 py-2 text-xs text-gray-500 font-medium">File</th>
                      <th className="px-3 py-2 text-xs text-gray-500 font-medium">Date</th>
                      <th className="px-3 py-2 text-xs text-gray-500 font-medium">Link</th>
                      <th className="px-3 py-2 text-xs text-gray-500 font-medium w-16">Delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map(rec => (
                      <tr key={rec.id} className="border-t border-gray-50 hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium">
                            {TYPE_LABELS[rec.doc_type] || rec.doc_type}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-700 max-w-[200px] truncate">{rec.file_name}</td>
                        <td className="px-3 py-2 text-gray-400 text-xs whitespace-nowrap">
                          {new Date(rec.created_at).toLocaleDateString('en-GB')}
                        </td>
                        <td className="px-3 py-2">
                          {rec.drive_url ? (
                            <a href={rec.drive_url} target="_blank" rel="noreferrer"
                              className="text-blue-500 hover:text-blue-700">
                              <ExternalLink size={13}/>
                            </a>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          {confirmId === rec.id ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => deleteRecord(rec.id)}
                                className="text-xs text-red-600 font-medium hover:text-red-800">
                                {deleting === rec.id ? <Loader size={12} className="animate-spin"/> : 'Yes'}
                              </button>
                              <button onClick={() => setConfirmId(null)} className="text-xs text-gray-400">No</button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmId(rec.id)}
                              className="text-gray-300 hover:text-red-500 transition-colors">
                              <Trash2 size={14}/>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4 flex items-center gap-2 text-xs text-amber-600 bg-amber-50 p-3 rounded-lg">
              <AlertTriangle size={13}/>
              Deleted records cannot be recovered. File in storage will remain.
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
