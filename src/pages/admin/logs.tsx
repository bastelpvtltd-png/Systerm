import { useEffect, useState } from 'react'
import AdminLayout from '@/components/admin/AdminLayout'
import { supabase } from '@/lib/supabase'
import { Shield, CheckCircle, XCircle } from 'lucide-react'
import { format } from 'date-fns'

interface Log {
  id: string
  username: string
  ip_address: string
  user_agent: string
  status: 'success'|'failed'
  created_at: string
}

export default function LogsPage() {
  const [logs, setLogs] = useState<Log[]>([])

  useEffect(() => {
    supabase.from('login_logs').select('*').order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => setLogs(data ?? []))
  }, [])

  return (
    <AdminLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Shield size={22} className="text-brand-green"/>Login Logs</h1>
          <p className="text-gray-500 text-sm">IP tracking and access history</p>
        </div>
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['Time','Username','IP Address','Status','User Agent'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logs.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      {format(new Date(log.created_at), 'dd MMM yyyy HH:mm:ss')}
                    </td>
                    <td className="px-4 py-3 font-medium">{log.username}</td>
                    <td className="px-4 py-3 font-mono text-brand-blue">{log.ip_address}</td>
                    <td className="px-4 py-3">
                      {log.status === 'success'
                        ? <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle size={12}/>Success</span>
                        : <span className="flex items-center gap-1 text-red-500 text-xs"><XCircle size={12}/>Failed</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 max-w-xs truncate">{log.user_agent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}
