import { useEffect, useState } from 'react'
import AdminLayout from '@/components/admin/AdminLayout'
import { Database, ExternalLink, Trash2, Loader, AlertTriangle, RefreshCw } from 'lucide-react'

interface DriveFile { id: string; name: string; webViewLink?: string; modifiedTime?: string; size?: string }
interface FolderGroup { folder: string; files: DriveFile[] }

export default function DriveFilesPage() {
  const [folders, setFolders] = useState<FolderGroup[]>([])
  const [activeFolder, setActiveFolder] = useState<string>('Main')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/list-drive-files')
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load Drive files')
      setFolders(d.folders || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleDelete(fileId: string, name: string) {
    if (!confirm(`Delete "${name}" from Google Drive? This can't be undone.`)) return
    setDeletingId(fileId)
    try {
      const res = await fetch('/api/delete-drive-file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Delete failed')
      setFolders(prev => prev.map(f => ({ ...f, files: f.files.filter(file => file.id !== fileId) })))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setDeletingId(null)
    }
  }

  const current = folders.find(f => f.folder === activeFolder)

  return (
    <AdminLayout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Database size={22} className="text-brand-green"/>Drive Files</h1>
            <p className="text-gray-500 text-sm mt-0.5">View and delete PDFs stored in Google Drive, by folder</p>
          </div>
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            {loading ? <Loader size={13} className="animate-spin"/> : <RefreshCw size={13}/>} Refresh
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-1.5 bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-600">
            <AlertTriangle size={13}/>{error}
          </div>
        )}

        <div className="flex gap-2 mb-4 flex-wrap">
          {folders.map(f => (
            <button key={f.folder} onClick={() => setActiveFolder(f.folder)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                activeFolder === f.folder ? 'bg-brand-green text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}>
              {f.folder} ({f.files.length})
            </button>
          ))}
        </div>

        <div className="card overflow-hidden p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader size={20} className="animate-spin text-gray-400"/></div>
          ) : !current || current.files.length === 0 ? (
            <div className="text-center py-16 text-sm text-gray-400">No files in this folder</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['Name', 'Modified', 'Size', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {current.files.map(file => (
                  <tr key={file.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium max-w-xs truncate">{file.name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{file.modifiedTime ? new Date(file.modifiedTime).toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{file.size ? `${Math.round(Number(file.size) / 1024)} KB` : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {file.webViewLink && (
                          <a href={file.webViewLink} target="_blank" rel="noreferrer" className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="View">
                            <ExternalLink size={14}/>
                          </a>
                        )}
                        <button onClick={() => handleDelete(file.id, file.name)} disabled={deletingId === file.id}
                          className="p-1.5 rounded hover:bg-red-50 text-red-500 disabled:opacity-50" title="Delete">
                          {deletingId === file.id ? <Loader size={14} className="animate-spin"/> : <Trash2 size={14}/>}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AdminLayout>
  )
}
