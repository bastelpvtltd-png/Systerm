import { useState, useEffect } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { Settings, Database, Trash2, Loader, RefreshCw, ExternalLink, AlertTriangle, Shield, CheckCircle, XCircle, Key, Save } from 'lucide-react'
import { supabase, authHeader } from '@/lib/supabase'

type Tab = 'general' | 'database' | 'logs' | 'credentials'

interface Credential { id: string; identity_name: string; url: string; username: string | null; created_at: string }
const KNOWN_SITES = [
  { identity_name: 'Navis', url: 'https://n4cap.slpa.lk/apex/cap.zul', afterLoginUrl: 'https://n4cap.slpa.lk/apex/capHomeView.zul' },
  { identity_name: 'SLPA', url: 'https://n4cms.slpa.lk/auth/login', afterLoginUrl: 'https://n4cms.slpa.lk/wapp/export/service-orders/container-consolidation' },
  { identity_name: 'Trico', url: 'https://s2.tricologi.net/webuser/?option=user', afterLoginUrl: 'https://s2.tricologi.net/webuser/?option=gatepass&action=gatepass_exp' },
]

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  )
}

// Moved here from the Automation tab so all automation config/API
// keys/credentials live in one centralized panel, per the spec — the
// Automation tab's other sub-tabs (Trico Gate Passes, etc.) still read
// these same saved credentials, just no longer manage them locally.
function CredentialsSettings() {
  const [creds, setCreds] = useState<Credential[]>([])
  const [form, setForm] = useState({ identity_name: '', url: '', username: '', password: '' })
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  async function load() {
    try {
      const res = await fetch('/api/automation-credentials', { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) setCreds(d.credentials || [])
    } catch {}
  }
  useEffect(() => { load() }, [])

  async function save() {
    setError('')
    if (!form.identity_name || !form.url) { setError('Identity Name and URL are required'); return }
    try {
      const res = await fetch('/api/automation-credentials', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify(form),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setStatus(`✓ Saved "${form.identity_name}"`)
      setForm({ identity_name: '', url: '', username: '', password: '' })
      load()
    } catch (e: any) { setError(e.message) }
  }

  async function remove(id: string) {
    if (!confirm('Delete this credential?')) return
    await fetch(`/api/automation-credentials?id=${id}`, { method: 'DELETE', headers: await authHeader() })
    load()
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="card">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">Add / Update Login</h2>
        <p className="text-xs text-gray-500 mb-3">Asycuda has no automated-login benefit, so it's left out on purpose. Pick an Identity Name below and it auto-fills the known URL.</p>
        {error && <div className="mb-3 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2"><AlertTriangle size={13}/>{error}</div>}
        {status && <p className="text-xs text-green-600 mb-3">{status}</p>}
        <div className="space-y-3">
          <Field label="Identity Name">
            <select value={form.identity_name} onChange={e => {
              const site = KNOWN_SITES.find(s => s.identity_name === e.target.value)
              setForm(f => ({ ...f, identity_name: e.target.value, url: site?.url || f.url }))
            }} className="input">
              <option value="">Choose or type below...</option>
              {KNOWN_SITES.map(s => <option key={s.identity_name} value={s.identity_name}>{s.identity_name}</option>)}
            </select>
            <input value={form.identity_name} onChange={e => setForm(f => ({ ...f, identity_name: e.target.value }))} placeholder="or type a custom name" className="input mt-1.5"/>
          </Field>
          <Field label="Login URL"><input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} className="input"/></Field>
          <Field label="Username"><input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} className="input"/></Field>
          <Field label="Password"><input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="input"/></Field>
        </div>
        <button onClick={save} className="btn-primary mt-4 flex items-center gap-2"><Save size={14}/>Save Credential</button>
      </div>

      <div className="card">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">Saved Logins</h2>
        <div className="space-y-2">
          {creds.map(c => {
            const site = KNOWN_SITES.find(s => s.identity_name === c.identity_name)
            return (
              <div key={c.id} className="border border-gray-100 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-sm text-gray-800">{c.identity_name}</p>
                  <button onClick={() => remove(c.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={14}/></button>
                </div>
                <p className="text-xs text-gray-500 mt-1">Login URL: <a href={c.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{c.url}</a></p>
                {site && <p className="text-xs text-gray-400">After login: {site.afterLoginUrl}</p>}
                <p className="text-xs text-gray-400">Username: {c.username || '—'} · Password: ••••••••</p>
              </div>
            )
          })}
          {creds.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No credentials saved yet</p>}
        </div>
      </div>
    </div>
  )
}

interface DbRecord {
  id: string; doc_type: string; file_name: string; drive_url: string; created_at: string
}

interface LoginLog {
  id: string; username: string; ip_address: string; user_agent: string
  status: 'success' | 'failed'; created_at: string
}

const TYPE_LABELS: Record<string, string> = {
  cusdec: 'CUSDEC', cdn: 'CDN', barcode: 'Barcode',
  boat_note: 'Boat Note', party_copy: "Party's Copy", bill: 'Bill',
}

// getLayout (see _app.tsx) keeps AdminLayout mounted across navigations
// instead of remounting the sidebar on every tab click.
export default function SettingsPage() {
  return <SettingsContent/>
}
SettingsPage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>

function SettingsContent() {
  const { has, isAdmin } = usePermission()
  const canGeneral = has('section:settings.general')
  const canDatabase = has('section:settings.database')
  const canLogs = has('section:settings.logs')
  const canCredentials = has('section:settings.credentials')
  const [tab, setTab]             = useState<Tab>(canGeneral ? 'general' : canDatabase ? 'database' : canLogs ? 'logs' : 'credentials')
  const [records, setRecords]     = useState<DbRecord[]>([])
  const [loading, setLoading]     = useState(false)
  const [deleting, setDeleting]   = useState<string | null>(null)
  const [filterType, setFilterType] = useState('all')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [logs, setLogs] = useState<LoginLog[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [clearingLogs, setClearingLogs] = useState(false)
  const [myUsername, setMyUsername] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data } = await supabase.from('profiles').select('username').eq('id', user.id).single()
      setMyUsername(data?.username || '')
    })
  }, [])

  useEffect(() => { if (tab === 'database') loadRecords() }, [tab, filterType])
  useEffect(() => { if (tab === 'logs' && (isAdmin || myUsername)) loadLogs() }, [tab, isAdmin, myUsername])

  // Admin sees everyone's login activity; everyone else only ever sees their
  // own — logging in as another account isn't something a regular user
  // should be able to observe.
  async function loadLogs() {
    setLoadingLogs(true)
    try {
      let query = supabase.from('login_logs').select('*').order('created_at', { ascending: false }).limit(200)
      if (!isAdmin) query = query.eq('username', myUsername)
      const { data } = await query
      setLogs(data ?? [])
    } finally {
      setLoadingLogs(false)
    }
  }

  async function clearLogs() {
    if (!confirm('Login logs okkoma permanent widihata clear karannada? Meka undo karanna bæ.')) return
    setClearingLogs(true)
    try {
      await supabase.from('login_logs').delete().gte('created_at', '1970-01-01')
      setLogs([])
    } finally {
      setClearingLogs(false)
    }
  }

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
      const res = await fetch(`/api/delete-document?id=${id}`, { method: 'DELETE', headers: await authHeader() })
      if (res.ok) setRecords(prev => prev.filter(r => r.id !== id))
    } finally { setDeleting(null); setConfirmId(null) }
  }

  return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-500 text-sm mt-1">System configuration · Database management</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
          {([['general', Settings, 'General'], ['database', Database, 'Database'], ['logs', Shield, 'Login Logs'], ['credentials', Key, 'Credentials']] as const)
            .filter(([key]) => key === 'general' ? canGeneral : key === 'database' ? canDatabase : key === 'logs' ? canLogs : canCredentials)
            .map(([key, Icon, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              <Icon size={14}/>{label}
            </button>
          ))}
        </div>

        {/* General tab */}
        {tab === 'general' && canGeneral && (
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
        {tab === 'database' && canDatabase && (
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

        {/* Login Logs tab — everyone with access can view; only admin can clear */}
        {tab === 'logs' && canLogs && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Shield size={16} className="text-gray-500"/> Login Logs
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  IP tracking and access history · {logs.length} entries{!isAdmin && ' · your activity only'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={loadLogs} className="text-gray-400 hover:text-gray-700"><RefreshCw size={14}/></button>
                {isAdmin && (
                  <button onClick={clearLogs} disabled={clearingLogs || !logs.length}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-40">
                    {clearingLogs ? <Loader size={13} className="animate-spin"/> : <Trash2 size={13}/>} Clear All
                  </button>
                )}
              </div>
            </div>

            {loadingLogs ? (
              <div className="flex justify-center py-10"><Loader size={20} className="animate-spin text-gray-400"/></div>
            ) : logs.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">No login activity yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      {['Time', 'Username', 'IP Address', 'Status', 'User Agent'].map(h => (
                        <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-gray-600 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {logs.map(log => (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString('en-GB')}
                        </td>
                        <td className="px-3 py-2 font-medium">{log.username}</td>
                        <td className="px-3 py-2 font-mono text-brand-blue">{log.ip_address}</td>
                        <td className="px-3 py-2">
                          {log.status === 'success'
                            ? <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle size={12}/>Success</span>
                            : <span className="flex items-center gap-1 text-red-500 text-xs"><XCircle size={12}/>Failed</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-400 max-w-xs truncate">{log.user_agent}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Credentials tab — automation portal logins, moved here from Automation */}
        {tab === 'credentials' && canCredentials && <CredentialsSettings/>}
      </div>
  )
}
