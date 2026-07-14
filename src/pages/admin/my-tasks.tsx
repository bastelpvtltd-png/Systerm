import { useEffect, useState } from 'react'
import { supabase, authHeader } from '@/lib/supabase'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { CheckCircle, DollarSign, Plus, Loader, TrendingUp, TrendingDown, Send, Check, X, Trash2, Users as UsersIcon, BarChart2, ChevronDown, ChevronRight, Save } from 'lucide-react'

interface Task {
  id: string
  task_type: string
  status: string
  notes: string
  amount: number | null
  shipment_id: string
  shipments?: { shipment_no: string }
}

interface BalanceEntry {
  id: string
  entry_type: 'cost' | 'deposit'
  amount: number
  note: string | null
  entry_date: string
  created_at: string
}

interface SalaryPayment {
  id: string
  from_user_id: string
  from_user_name: string | null
  to_user_id: string | null
  to_other_name: string | null
  to_display_name: string
  amount: number
  status: 'pending' | 'confirmed' | 'declined'
  created_at: string
  responded_at: string | null
}
interface Profile { id: string; username: string; full_name: string }

// Peer-to-peer "I paid you" log — anyone can record a payment they made (to
// another user or an "Other" name), only the recipient can confirm it
// actually landed (or say it didn't), and only the recipient's confirmed
// total counts toward their Balance. Once responded to, an entry is locked
// for everyone except Admin (see the admin-only monitoring panel below).
function SalaryPayments({ userId, isAdmin }: { userId: string | null; isAdmin: boolean }) {
  const [payments, setPayments] = useState<SalaryPayment[]>([])
  const [workCounts, setWorkCounts] = useState<Record<string, number>>({})
  const [users, setUsers] = useState<Profile[]>([])
  const [toUserId, setToUserId] = useState('')
  const [toOther, setToOther] = useState('')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [respondingId, setRespondingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [showAdminPanel, setShowAdminPanel] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch('/api/salary-payments', { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) { setPayments(d.payments || []); setWorkCounts(d.workCounts || {}) }
    } catch {}
  }
  useEffect(() => {
    load()
    supabase.from('profiles').select('id, username, full_name').then(({ data }) => setUsers((data as any) || []))
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function recordPayment() {
    setError('')
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return }
    if (!toUserId && !toOther.trim()) { setError('Pick a recipient or type an Other name'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/salary-payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ to_user_id: toUserId || undefined, to_other_name: toUserId ? undefined : toOther.trim(), amount: amt }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setToUserId(''); setToOther(''); setAmount('')
      await load()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function respond(id: string, status: 'confirmed' | 'declined') {
    setRespondingId(id)
    try {
      const res = await fetch('/api/salary-payments', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ id, status }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setPayments(prev => prev.map(p => p.id === id ? d.payment : p))
    } catch (e: any) { setError(e.message) }
    finally { setRespondingId(null) }
  }

  async function deletePayment(id: string) {
    if (!confirm('Permanently remove this payment record? This cannot be undone.')) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/salary-payments?id=${id}`, { method: 'DELETE', headers: await authHeader() })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setPayments(prev => prev.filter(p => p.id !== id))
    } catch (e: any) { setError(e.message) }
    finally { setDeletingId(null) }
  }

  const awaitingMyResponse = payments.filter(p => p.to_user_id === userId && p.status === 'pending')
  const myConfirmedTotal = payments.filter(p => p.to_user_id === userId && p.status === 'confirmed').reduce((s, p) => s + Number(p.amount), 0)
  const sentByMe = payments.filter(p => p.from_user_id === userId)

  const statusBadge = (s: SalaryPayment['status']) =>
    s === 'confirmed' ? <span className="text-[11px] font-medium text-green-700 flex items-center gap-1"><Check size={11}/>Landed</span>
    : s === 'declined' ? <span className="text-[11px] font-medium text-red-600 flex items-center gap-1"><X size={11}/>Declined</span>
    : <span className="text-[11px] font-medium text-amber-600">Pending</span>

  return (
    <div className="card mb-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><Send size={15}/>Salary Payments</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Your confirmed balance</span>
          <span className="text-lg font-bold text-green-700">{myConfirmedTotal.toLocaleString('en-LK', { minimumFractionDigits: 2 })}</span>
        </div>
      </div>

      {/* Record a payment */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-2">
        <select value={toUserId} onChange={e => { setToUserId(e.target.value); if (e.target.value) setToOther('') }} className="input text-sm">
          <option value="">— Select user —</option>
          {users.filter(u => u.id !== userId).map(u => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
        </select>
        <input value={toOther} onChange={e => { setToOther(e.target.value); if (e.target.value) setToUserId('') }}
          placeholder="...or type an Other name" className="input text-sm"/>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount" className="input text-sm"/>
        <button onClick={recordPayment} disabled={saving} className="btn-primary flex items-center justify-center gap-2 text-sm">
          {saving ? <Loader size={14} className="animate-spin"/> : <Plus size={14}/>}Record
        </button>
      </div>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {/* Awaiting my response */}
      {awaitingMyResponse.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-medium text-gray-600 mb-1.5">Awaiting your response</p>
          <div className="space-y-1.5">
            {awaitingMyResponse.map(p => (
              <div key={p.id} className="flex items-center justify-between text-xs border border-amber-200 bg-amber-50 rounded-lg px-3 py-2">
                <span><b>{p.from_user_name}</b> says they paid you <b>{Number(p.amount).toLocaleString('en-LK', { minimumFractionDigits: 2 })}</b></span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => respond(p.id, 'confirmed')} disabled={respondingId === p.id}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-white font-medium disabled:opacity-50" style={{ background: '#22A87A' }}>
                    <Check size={12}/>Yes, landed
                  </button>
                  <button onClick={() => respond(p.id, 'declined')} disabled={respondingId === p.id}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-red-300 text-red-600 font-medium disabled:opacity-50 hover:bg-red-50">
                    <X size={12}/>No
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* What I've sent */}
      {sentByMe.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-600 mb-1.5">Payments you've sent</p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {sentByMe.map(p => (
              <div key={p.id} className="flex items-center justify-between text-xs py-1 border-t border-gray-50">
                <span className="text-gray-600">{p.to_display_name} — {Number(p.amount).toLocaleString('en-LK', { minimumFractionDigits: 2 })}</span>
                {statusBadge(p.status)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin-only: everyone's salary activity + processed-document work count */}
      {isAdmin && (
        <div className="mt-5 pt-4 border-t border-gray-100">
          <button onClick={() => setShowAdminPanel(x => !x)}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
            <UsersIcon size={13}/> {showAdminPanel ? 'Hide' : 'Show'} everyone's salary + work (Admin only)
          </button>
          {showAdminPanel && (
            <div className="mt-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                {users.map(u => {
                  const name = u.full_name || u.username
                  const confirmed = payments.filter(p => p.to_display_name === name && p.status === 'confirmed').reduce((s, p) => s + Number(p.amount), 0)
                  const pending = payments.filter(p => p.to_display_name === name && p.status === 'pending').length
                  return (
                    <div key={u.id} className="border border-gray-100 rounded-lg px-3 py-2 text-xs">
                      <p className="font-semibold text-gray-800">{name}</p>
                      <p className="text-gray-500">Confirmed: <b className="text-green-700">{confirmed.toLocaleString('en-LK', { minimumFractionDigits: 2 })}</b> {pending > 0 && `· ${pending} pending`}</p>
                      <p className="text-gray-400">Documents processed: {workCounts[name] || 0}</p>
                    </div>
                  )
                })}
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {payments.map(p => (
                  <div key={p.id} className="flex items-center justify-between text-xs border-t border-gray-50 py-1.5">
                    <span className="text-gray-600">{p.from_user_name} → {p.to_display_name} — {Number(p.amount).toLocaleString('en-LK', { minimumFractionDigits: 2 })} · {new Date(p.created_at).toLocaleDateString('en-GB')}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {statusBadge(p.status)}
                      <button onClick={() => deletePayment(p.id)} disabled={deletingId === p.id}
                        className="text-gray-300 hover:text-red-500 disabled:opacity-50"><Trash2 size={12}/></button>
                    </div>
                  </div>
                ))}
                {payments.length === 0 && <p className="text-center text-gray-400 py-4">No salary payments recorded yet</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface WorkCountRow {
  id: string; user_id: string; user_name: string; document_id: string; file_name: string
  reason: string; action: string; cdn_inc: number; cusdec_inc: number; cap_inc: number
  amount: number; created_at: string
}
interface WorkTotals { cdn_count: number; cusdec_count: number; cap_count: number; total_amount: number }

function CountWork({ userId, isAdmin }: { userId: string | null; isAdmin: boolean }) {
  const [totals, setTotals] = useState<WorkTotals>({ cdn_count: 0, cusdec_count: 0, cap_count: 0, total_amount: 0 })
  const [rows, setRows] = useState<WorkCountRow[]>([])
  const [allRows, setAllRows] = useState<WorkCountRow[]>([])
  const [expanded, setExpanded] = useState(false)
  const [adminView, setAdminView] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editDrafts, setEditDrafts] = useState<Record<string, Partial<WorkCountRow>>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function load() {
    try {
      const res = await fetch('/api/work-counts', { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) {
        const r: WorkCountRow[] = d.rows || []
        setRows(r)
        setTotals({
          cdn_count:    r.reduce((s, x) => s + (x.cdn_inc || 0), 0),
          cusdec_count: r.reduce((s, x) => s + (x.cusdec_inc || 0), 0),
          cap_count:    r.reduce((s, x) => s + (x.cap_inc || 0), 0),
          total_amount: r.reduce((s, x) => s + Number(x.amount || 0), 0),
        })
      }
    } catch {}
  }

  async function loadAll() {
    try {
      const res = await fetch('/api/work-counts?all=1', { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) setAllRows(d.rows || [])
    } catch {}
  }

  async function deleteRow(id: string) {
    setDeletingId(id); setError('')
    try {
      const res = await fetch(`/api/work-counts?id=${id}`, { method: 'DELETE', headers: await authHeader() })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setAllRows(prev => prev.filter(r => r.id !== id))
      setRows(prev => prev.filter(r => r.id !== id))
      await load()
    } catch (e: any) { setError(e.message) }
    finally { setDeletingId(null) }
  }

  async function saveEdit(id: string) {
    const draft = editDrafts[id]
    if (!draft) return
    setSavingId(id)
    try {
      const res = await fetch('/api/work-counts', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ id, ...draft }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setAllRows(prev => prev.map(r => r.id === id ? { ...r, ...draft } : r))
      setEditDrafts(prev => { const n = { ...prev }; delete n[id]; return n })
      await load()
    } catch (e: any) { setError(e.message) }
    finally { setSavingId(null) }
  }

  function setDraft(id: string, key: string, value: string) {
    setEditDrafts(prev => ({ ...prev, [id]: { ...prev[id], [key]: value } }))
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Group allRows by user for admin summary
  const byUser = allRows.reduce((acc, r) => {
    if (!acc[r.user_name]) acc[r.user_name] = { name: r.user_name, cdn: 0, cusdec: 0, cap: 0, amount: 0, rows: [] }
    acc[r.user_name].cdn += r.cdn_inc || 0
    acc[r.user_name].cusdec += r.cusdec_inc || 0
    acc[r.user_name].cap += r.cap_inc || 0
    acc[r.user_name].amount += Number(r.amount || 0)
    acc[r.user_name].rows.push(r)
    return acc
  }, {} as Record<string, { name: string; cdn: number; cusdec: number; cap: number; amount: number; rows: WorkCountRow[] }>)

  const noData = totals.cdn_count === 0 && totals.cusdec_count === 0 && totals.cap_count === 0 && totals.total_amount === 0

  return (
    <div className="card mb-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><BarChart2 size={15}/>Count Work</h2>
        <button onClick={() => setExpanded(x => !x)} className="text-gray-400 hover:text-gray-600">
          {expanded ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}
        </button>
      </div>

      {noData ? (
        <p className="text-xs text-gray-400">No processed documents yet — counts increment when you Mail or Download a document from My Picked Tasks.</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-3 mb-3">
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-700">{totals.cdn_count}</p>
              <p className="text-xs text-gray-500 mt-1">CDN Count</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-blue-700">{totals.cusdec_count}</p>
              <p className="text-xs text-gray-500 mt-1">Cusdec Count</p>
            </div>
            <div className="bg-purple-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-purple-700">{totals.cap_count}</p>
              <p className="text-xs text-gray-500 mt-1">CAP Count</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-amber-700">{totals.total_amount.toLocaleString('en-LK', { minimumFractionDigits: 2 })}</p>
              <p className="text-xs text-gray-500 mt-1">Total Earned</p>
            </div>
          </div>

          {/* My rows — read-only for users, shows amount per entry */}
          {expanded && (
            <div className="mt-2">
              {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {rows.map(r => (
                  <div key={r.id} className="flex items-center justify-between text-xs py-1.5 border-t border-gray-50">
                    <div className="flex-1 min-w-0">
                      <span className="text-gray-700 truncate block">{r.file_name || r.document_id}</span>
                      <span className="text-gray-400">{r.reason} · {r.action} · {new Date(r.created_at).toLocaleDateString('en-GB')}</span>
                    </div>
                    <div className="flex items-center gap-2 ml-2 flex-shrink-0 text-right">
                      {r.cdn_inc > 0 && <span className="text-green-600 font-medium">CDN+{r.cdn_inc}</span>}
                      {r.cusdec_inc > 0 && <span className="text-blue-600 font-medium">C+{r.cusdec_inc}</span>}
                      {r.cap_inc > 0 && <span className="text-purple-600 font-medium">CAP+{r.cap_inc}</span>}
                      {Number(r.amount) > 0 && (
                        <span className="text-amber-700 font-semibold">{Number(r.amount).toLocaleString('en-LK', { minimumFractionDigits: 2 })}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Admin: edit counts + amounts for all users */}
      {isAdmin && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <button onClick={() => { setAdminView(x => !x); if (!adminView) loadAll() }}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
            <UsersIcon size={13}/>{adminView ? 'Hide' : 'Show'} all users (Admin)
          </button>
          {adminView && (
            <div className="mt-3 space-y-4">
              {Object.values(byUser).length === 0 && <p className="text-xs text-gray-400">No data yet</p>}
              {Object.values(byUser).map(u => (
                <div key={u.name} className="border border-gray-200 rounded-xl overflow-hidden">
                  {/* Per-user header */}
                  <div className="flex items-center justify-between px-3 py-2 bg-gray-50 text-xs">
                    <span className="font-semibold text-gray-800">{u.name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-green-700">CDN <b>{u.cdn}</b></span>
                      <span className="text-blue-700">C <b>{u.cusdec}</b></span>
                      <span className="text-purple-700">CAP <b>{u.cap}</b></span>
                      <span className="text-amber-700 font-bold">{u.amount.toLocaleString('en-LK', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                  {/* Per-row editable entries */}
                  <div className="divide-y divide-gray-50">
                    {u.rows.map(r => {
                      const draft = editDrafts[r.id] || {}
                      const isDirty = Object.keys(draft).length > 0
                      return (
                        <div key={r.id} className="px-3 py-2 text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-gray-700 truncate font-medium">{r.file_name || '—'}</p>
                              <p className="text-gray-400">{r.reason} · {r.action} · {new Date(r.created_at).toLocaleDateString('en-GB')}</p>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {/* Editable: cdn_inc */}
                              <label className="flex flex-col items-center gap-0.5">
                                <span className="text-[10px] text-gray-400">CDN</span>
                                <input type="number" min={0}
                                  value={draft.cdn_inc !== undefined ? draft.cdn_inc : r.cdn_inc}
                                  onChange={e => setDraft(r.id, 'cdn_inc', e.target.value)}
                                  className="w-12 border border-gray-200 rounded px-1 py-0.5 text-center text-xs focus:outline-none focus:border-green-400"/>
                              </label>
                              {/* Editable: cusdec_inc */}
                              <label className="flex flex-col items-center gap-0.5">
                                <span className="text-[10px] text-gray-400">C</span>
                                <input type="number" min={0}
                                  value={draft.cusdec_inc !== undefined ? draft.cusdec_inc : r.cusdec_inc}
                                  onChange={e => setDraft(r.id, 'cusdec_inc', e.target.value)}
                                  className="w-12 border border-gray-200 rounded px-1 py-0.5 text-center text-xs focus:outline-none focus:border-blue-400"/>
                              </label>
                              {/* Editable: cap_inc */}
                              <label className="flex flex-col items-center gap-0.5">
                                <span className="text-[10px] text-gray-400">CAP</span>
                                <input type="number" min={0}
                                  value={draft.cap_inc !== undefined ? draft.cap_inc : r.cap_inc}
                                  onChange={e => setDraft(r.id, 'cap_inc', e.target.value)}
                                  className="w-12 border border-gray-200 rounded px-1 py-0.5 text-center text-xs focus:outline-none focus:border-purple-400"/>
                              </label>
                              {/* Editable: amount */}
                              <label className="flex flex-col items-center gap-0.5">
                                <span className="text-[10px] text-gray-400">Amount</span>
                                <input type="number" min={0} step="0.01"
                                  value={draft.amount !== undefined ? draft.amount : (r.amount || 0)}
                                  onChange={e => setDraft(r.id, 'amount', e.target.value)}
                                  className="w-24 border border-amber-300 rounded px-1 py-0.5 text-right text-xs focus:outline-none focus:border-amber-500 bg-amber-50"/>
                              </label>
                              {isDirty && (
                                <button onClick={() => saveEdit(r.id)} disabled={savingId === r.id}
                                  className="flex items-center gap-0.5 px-2 py-1 rounded-md text-[11px] font-medium text-white disabled:opacity-50" style={{ background: '#22A87A' }}>
                                  {savingId === r.id ? <Loader size={10} className="animate-spin"/> : <Save size={10}/>}
                                </button>
                              )}
                              <button onClick={() => deleteRow(r.id)} disabled={deletingId === r.id}
                                className="text-gray-300 hover:text-red-500 disabled:opacity-50 mt-3.5"><Trash2 size={11}/></button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function MyTasksPage() {
  return <MyTasksContent/>
}
MyTasksPage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>

function MyTasksContent() {
  const { has, isAdmin } = usePermission()
  const canAddCost = has('section:my-tasks.daily-cost')
  const canDeposit = has('section:my-tasks.balance-update')
  const [tasks, setTasks] = useState<Task[]>([])
  const [tab, setTab] = useState<'pending'|'done'>('pending')
  const [userId, setUserId] = useState<string | null>(null)
  const [entries, setEntries] = useState<BalanceEntry[]>([])
  const [costAmount, setCostAmount] = useState('')
  const [costNote, setCostNote] = useState('')
  const [depositAmount, setDepositAmount] = useState('')
  const [depositNote, setDepositNote] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)
      const { data: t } = await supabase.from('worker_tasks')
        .select('*, shipments(shipment_no)')
        .eq('assigned_to', user.id)
        .order('created_at', { ascending: false })
      setTasks(t ?? [])
      const { data: e } = await supabase.from('worker_balance_entries')
        .select('*').eq('user_id', user.id).order('entry_date', { ascending: false }).limit(60)
      setEntries(e ?? [])
    }
    load()
  }, [])

  async function markDone(id: string) {
    await supabase.from('worker_tasks').update({ status: 'done' }).eq('id', id)
    setTasks(prev => prev.map(t => t.id === id ? {...t, status:'done'} : t))
  }

  async function addEntry(type: 'cost' | 'deposit') {
    if (!userId) return
    const amountStr = type === 'cost' ? costAmount : depositAmount
    const note = type === 'cost' ? costNote : depositNote
    const amount = Number(amountStr)
    if (!amount || amount <= 0) return
    setAdding(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase.from('worker_balance_entries')
        .insert({ user_id: userId, entry_type: type, amount, note: note || null, created_by: user?.id })
        .select().single()
      if (!error && data) {
        setEntries(prev => [data, ...prev])
        if (type === 'cost') { setCostAmount(''); setCostNote('') } else { setDepositAmount(''); setDepositNote('') }
      }
    } finally {
      setAdding(false)
    }
  }

  const filtered = tasks.filter(t => t.status === tab)
  const billTasks = tasks.filter(t => t.task_type?.toLowerCase().includes('bill') && t.amount != null)
  const totalBillAmount = billTasks.reduce((sum, t) => sum + Number(t.amount || 0), 0)
  const balance = entries.reduce((sum, e) => sum + (e.entry_type === 'deposit' ? Number(e.amount) : -Number(e.amount)), 0)

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-1">My Tasks</h1>
      <p className="text-gray-500 text-sm mb-6">{tasks.filter(t=>t.status==='pending').length} pending tasks</p>

      {billTasks.length > 0 && (
        <div className="card mb-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:'#22A87A20'}}>
            <DollarSign size={18} style={{color:'#22A87A'}}/>
          </div>
          <div>
            <p className="text-xs text-gray-500">Bill tasks total</p>
            <p className="text-lg font-bold text-gray-900">{totalBillAmount.toLocaleString('en-LK', { minimumFractionDigits: 2 })}</p>
          </div>
        </div>
      )}

      {(canAddCost || canDeposit) && (
        <div className="card mb-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 text-sm">Balance</h2>
            <span className={`text-lg font-bold ${balance < 0 ? 'text-red-600' : 'text-green-700'}`}>
              {balance.toLocaleString('en-LK', { minimumFractionDigits: 2 })}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {canAddCost && (
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1.5 flex items-center gap-1"><TrendingDown size={12} className="text-red-500"/>Add today's cost</p>
                <div className="flex gap-2">
                  <input type="number" value={costAmount} onChange={e => setCostAmount(e.target.value)} placeholder="Amount"
                    className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
                  <input value={costNote} onChange={e => setCostNote(e.target.value)} placeholder="Note (optional)"
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
                  <button onClick={() => addEntry('cost')} disabled={adding || !costAmount}
                    className="px-3 rounded-lg text-white disabled:opacity-40" style={{background:'#ef4444'}}>
                    {adding ? <Loader size={14} className="animate-spin"/> : <Plus size={14}/>}
                  </button>
                </div>
              </div>
            )}
            {canDeposit && (
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1.5 flex items-center gap-1"><TrendingUp size={12} className="text-green-600"/>Add deposit (accountant/owner)</p>
                <div className="flex gap-2">
                  <input type="number" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} placeholder="Amount"
                    className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
                  <input value={depositNote} onChange={e => setDepositNote(e.target.value)} placeholder="Note (optional)"
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
                  <button onClick={() => addEntry('deposit')} disabled={adding || !depositAmount}
                    className="px-3 rounded-lg text-white disabled:opacity-40" style={{background:'#22A87A'}}>
                    {adding ? <Loader size={14} className="animate-spin"/> : <Plus size={14}/>}
                  </button>
                </div>
              </div>
            )}
          </div>

          {entries.length > 0 && (
            <div className="mt-4 space-y-1 max-h-40 overflow-y-auto">
              {entries.map(e => (
                <div key={e.id} className="flex items-center justify-between text-xs py-1 border-t border-gray-50">
                  <span className="text-gray-500">{new Date(e.entry_date).toLocaleDateString('en-GB')} {e.note ? `· ${e.note}` : ''}</span>
                  <span className={e.entry_type === 'deposit' ? 'text-green-700 font-medium' : 'text-red-600 font-medium'}>
                    {e.entry_type === 'deposit' ? '+' : '-'}{Number(e.amount).toLocaleString('en-LK', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <CountWork userId={userId} isAdmin={isAdmin}/>

      <SalaryPayments userId={userId} isAdmin={isAdmin}/>

      <div className="flex gap-2 mb-4">
        {(['pending','done'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t ? 'text-white' : 'bg-white text-gray-600 border border-gray-200'
            }`}
            style={tab === t ? {background:'#22A87A'} : {}}>
            {t === 'pending' ? `Pending (${tasks.filter(x=>x.status==='pending').length})` : 'Completed'}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map(task => (
          <div key={task.id} className="card flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">{task.task_type}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                Shipment: <span className="font-mono text-brand-blue">{task.shipments?.shipment_no}</span>
              </div>
              {task.notes && <div className="text-xs text-gray-400 mt-1">{task.notes}</div>}
              {task.amount != null && (
                <div className="text-xs font-semibold text-green-700 mt-1">Amount: {Number(task.amount).toLocaleString('en-LK', { minimumFractionDigits: 2 })}</div>
              )}
            </div>
            {task.status === 'pending' && (
              <button onClick={() => markDone(task.id)}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-green-300 text-green-700 hover:bg-green-50">
                <CheckCircle size={14}/>Mark Done
              </button>
            )}
            {task.status === 'done' && (
              <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle size={14}/>Done</span>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            {tab === 'pending' ? 'No pending tasks 🎉' : 'No completed tasks yet'}
          </div>
        )}
      </div>
    </div>
  )
}
