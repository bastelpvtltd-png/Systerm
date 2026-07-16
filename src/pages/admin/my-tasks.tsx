import { useEffect, useState } from 'react'
import { supabase, authHeader } from '@/lib/supabase'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { CheckCircle, DollarSign, Plus, Loader, TrendingUp, TrendingDown, Send, Check, X, Trash2, Users as UsersIcon, BarChart2, ChevronDown, ChevronRight, Save, Undo2, Briefcase } from 'lucide-react'

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
interface OtherWorkItem {
  id: string; user_id: string; user_name: string | null; description: string
  amount: number; status: 'pending' | 'approved' | 'rejected'
  created_by: string | null; created_at: string; approved_at: string | null
}
type CostFilter = 'cdn' | 'cap' | null

function SalaryPayments({ userId, isAdmin, showBalance, showPayments }: { userId: string | null; isAdmin: boolean; showBalance: boolean; showPayments: boolean }) {
  // ── data ──────────────────────────────────────────────────────────────────
  const [payments,    setPayments]    = useState<SalaryPayment[]>([])
  const [users,       setUsers]       = useState<Profile[]>([])
  const [myWorkRows,  setMyWorkRows]  = useState<WorkCountRow[]>([])
  const [allWorkRows, setAllWorkRows] = useState<WorkCountRow[]>([])
  const [rates,       setRates]       = useState<WorkRates>({ cdn_rate: 0, cap_rate: 0 })
  const [myOtherWork,  setMyOtherWork]  = useState<OtherWorkItem[]>([])
  const [allOtherWork, setAllOtherWork] = useState<OtherWorkItem[]>([])
  // ── ui state ──────────────────────────────────────────────────────────────
  const [showCost,     setShowCost]     = useState(false)
  const [showReceived, setShowReceived] = useState(false)
  const [costFilter,   setCostFilter]   = useState<CostFilter>(null)
  const [showAdminAll, setShowAdminAll] = useState(false)
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  // ── payment form ──────────────────────────────────────────────────────────
  const [toUserId,     setToUserId]     = useState('')
  const [toOther,      setToOther]      = useState('')
  const [amount,       setAmount]       = useState('')
  const [saving,       setSaving]       = useState(false)
  const [respondingId, setRespondingId] = useState<string | null>(null)
  const [deletingId,   setDeletingId]   = useState<string | null>(null)
  const [returningId,  setReturningId]  = useState<string | null>(null)
  const [error,        setError]        = useState('')
  // ── other work admin ──────────────────────────────────────────────────────
  const [approvingId,  setApprovingId]  = useState<string | null>(null)
  const [deletingOwId, setDeletingOwId] = useState<string | null>(null)
  // ── rate edit (admin) ─────────────────────────────────────────────────────
  const [rateDraft,   setRateDraft]   = useState<WorkRates | null>(null)
  const [savingRates, setSavingRates] = useState(false)

  async function load() {
    try {
      const h = await authHeader()
      const [sp, wc, wr, ow] = await Promise.all([
        fetch('/api/salary-payments', { headers: h }).then(r => r.json()),
        fetch('/api/work-counts', { headers: h }).then(r => r.json()),
        fetch('/api/work-rates', { headers: h }).then(r => r.json()),
        fetch('/api/other-work', { headers: h }).then(r => r.json()),
      ])
      if (sp.payments) setPayments(sp.payments)
      if (wc.rows) setMyWorkRows(wc.rows)
      if (wr.cdn_rate !== undefined) setRates(wr)
      if (ow.items) setMyOtherWork(ow.items)
    } catch {}
  }

  async function loadAllWork() {
    try {
      const h = await authHeader()
      const [wc, ow] = await Promise.all([
        fetch('/api/work-counts?all=1', { headers: h }).then(r => r.json()),
        fetch('/api/other-work?all=1', { headers: h }).then(r => r.json()),
      ])
      if (wc.rows) setAllWorkRows(wc.rows || [])
      if (ow.items) setAllOtherWork(ow.items || [])
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

  async function deletePayment(id: string, returning = false) {
    returning ? setReturningId(id) : setDeletingId(id)
    try {
      const res = await fetch(`/api/salary-payments?id=${id}`, { method: 'DELETE', headers: await authHeader() })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setPayments(prev => prev.filter(p => p.id !== id))
    } catch (e: any) { setError(e.message) }
    finally { returning ? setReturningId(null) : setDeletingId(null) }
  }

  async function approveOtherWork(id: string, status: 'approved' | 'rejected') {
    setApprovingId(id)
    try {
      const res = await fetch('/api/other-work', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ id, status }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setAllOtherWork(prev => prev.map(x => x.id === id ? d.item : x))
      if (status === 'approved') setMyOtherWork(prev => prev.map(x => x.id === id ? d.item : x))
      await load()
    } catch (e: any) { setError(e.message) }
    finally { setApprovingId(null) }
  }

  async function deleteOtherWork(id: string) {
    setDeletingOwId(id)
    try {
      const res = await fetch(`/api/other-work?id=${id}`, { method: 'DELETE', headers: await authHeader() })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setAllOtherWork(prev => prev.filter(x => x.id !== id))
      setMyOtherWork(prev => prev.filter(x => x.id !== id))
    } catch (e: any) { setError(e.message) }
    finally { setDeletingOwId(null) }
  }

  async function saveRates() {
    if (!rateDraft) return
    setSavingRates(true)
    try {
      const res = await fetch('/api/work-rates', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify(rateDraft),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setRates({ cdn_rate: d.cdn_rate, cap_rate: d.cap_rate })
      setRateDraft(null)
    } catch (e: any) { setError(e.message) }
    finally { setSavingRates(false) }
  }

  // Current user computed values
  const myCdn = myWorkRows.reduce((s, r) => s + (r.cdn_inc || 0), 0)
  const myCap = myWorkRows.reduce((s, r) => s + (r.cap_inc || 0), 0)
  const myCountWorkEarned = myCdn * rates.cdn_rate + myCap * rates.cap_rate
  const myApprovedOtherWork = myOtherWork.filter(x => x.status === 'approved')
  const myOtherWorkEarned = myApprovedOtherWork.reduce((s, x) => s + Number(x.amount), 0)
  const myEarned = myCountWorkEarned + myOtherWorkEarned
  const myReceivedPayments = payments.filter(p => p.to_user_id === userId && p.status === 'confirmed')
  const myReceived = myReceivedPayments.reduce((s, p) => s + Number(p.amount), 0)
  const myBalance = myReceived - myEarned
  const myPendingOtherWork = myOtherWork.filter(x => x.status === 'pending')

  // Admin: per-user work earned from allWorkRows
  const workByUser = allWorkRows.reduce((acc, r) => {
    if (!acc[r.user_name]) acc[r.user_name] = { cdn: 0, cap: 0 }
    acc[r.user_name].cdn += r.cdn_inc || 0
    acc[r.user_name].cap += r.cap_inc || 0
    return acc
  }, {} as Record<string, { cdn: number; cap: number }>)

  // Admin: per-user other work (approved)
  const otherWorkByUserId = allOtherWork.reduce((acc, x) => {
    if (!acc[x.user_id]) acc[x.user_id] = { approved: 0, pending: [] }
    if (x.status === 'approved') acc[x.user_id].approved += Number(x.amount)
    if (x.status === 'pending') acc[x.user_id].pending.push(x)
    return acc
  }, {} as Record<string, { approved: number; pending: OtherWorkItem[] }>)

  const awaitingMyResponse = payments.filter(p => p.to_user_id === userId && p.status === 'pending')
  const sentByMe = payments.filter(p => p.from_user_id === userId)

  const statusBadge = (s: SalaryPayment['status']) =>
    s === 'confirmed' ? <span className="text-[11px] font-medium text-green-700 flex items-center gap-1"><Check size={11}/>Landed</span>
    : s === 'declined' ? <span className="text-[11px] font-medium text-red-600 flex items-center gap-1"><X size={11}/>Declined</span>
    : <span className="text-[11px] font-medium text-amber-600">Pending</span>

  return (
    <>
      {/* ═══ Panel 1 — Balance ═══ */}
      {showBalance && <div className="card mb-5">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">Balance</h2>

        {/* Cost | Received | Balance row */}
        <div className="flex items-center gap-5 mb-3 flex-wrap">
          <button onClick={() => { setShowCost(x => !x); setCostFilter(null) }}
            className="text-left hover:opacity-70 transition-opacity">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Cost {showCost ? '▲' : '▾'}</p>
            <p className="font-bold text-gray-800 text-sm">Rs. {fmtLKR(myEarned)}</p>
          </button>
          <div className="w-px h-7 bg-gray-200 flex-shrink-0"/>
          <button onClick={() => setShowReceived(x => !x)}
            className="text-left hover:opacity-70 transition-opacity">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Received {showReceived ? '▲' : '▾'}</p>
            <p className="font-bold text-green-700 text-sm">Rs. {fmtLKR(myReceived)}</p>
          </button>
          <div className="w-px h-7 bg-gray-200 flex-shrink-0"/>
          <div className="text-left">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Balance</p>
            <p className={`font-bold text-sm ${myBalance >= 0 ? 'text-amber-700' : 'text-red-600'}`}>Rs. {fmtLKR(myBalance)}</p>
          </div>
        </div>

        {/* Cost breakdown */}
        {showCost && (
          <div className="mb-3 bg-blue-50 rounded-xl p-3 space-y-3">
            {/* Count Work */}
            <div>
              <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide mb-2">Count Work</p>
              {myCdn === 0 && myCap === 0 ? (
                <p className="text-xs text-gray-400">No count work yet.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <button
                      onClick={() => setCostFilter(f => f === 'cdn' ? null : 'cdn')}
                      className={`rounded-lg p-2.5 text-center transition-all border-2 ${costFilter === 'cdn' ? 'bg-green-100 border-green-400' : 'bg-white border-transparent hover:border-green-200'}`}>
                      <p className="text-xl font-bold text-green-700">{myCdn}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">CDN</p>
                      <p className="text-[9px] text-green-600">{costFilter === 'cdn' ? '▲ hide' : '▼ details'}</p>
                    </button>
                    <button
                      onClick={() => setCostFilter(f => f === 'cap' ? null : 'cap')}
                      className={`rounded-lg p-2.5 text-center transition-all border-2 ${costFilter === 'cap' ? 'bg-purple-100 border-purple-400' : 'bg-white border-transparent hover:border-purple-200'}`}>
                      <p className="text-xl font-bold text-purple-700">{myCap}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">CAP</p>
                      <p className="text-[9px] text-purple-600">{costFilter === 'cap' ? '▲ hide' : '▼ details'}</p>
                    </button>
                  </div>
                  {costFilter && (() => {
                    const isCdn = costFilter === 'cdn'
                    const filtered = myWorkRows.filter(r => isCdn ? r.cdn_inc > 0 : r.cap_inc > 0)
                    return (
                      <div className="mb-2 rounded-xl border overflow-hidden" style={{ borderColor: isCdn ? '#bbf7d0' : '#e9d5ff' }}>
                        <div className="px-3 py-1.5" style={{ background: isCdn ? '#f0fdf4' : '#faf5ff' }}>
                          <span className="text-[11px] font-semibold" style={{ color: isCdn ? '#15803d' : '#7e22ce' }}>
                            {isCdn ? 'CDN — Container Moved' : 'CAP — CUSDEC Passed'}
                          </span>
                        </div>
                        {filtered.length === 0 ? (
                          <p className="text-xs text-gray-400 px-3 py-2">No records</p>
                        ) : (
                          <div className="max-h-44 overflow-y-auto divide-y divide-gray-50 bg-white">
                            {filtered.map((r, i) => (
                              <div key={r.id} className="flex items-center justify-between px-3 py-2 text-xs">
                                <div className="flex-1 min-w-0">
                                  <p className="text-gray-800 truncate font-medium">{r.file_name || '—'}</p>
                                  <p className="text-gray-400">{new Date(r.created_at).toLocaleDateString('en-GB')} · {r.action}</p>
                                </div>
                                <span className="ml-2 flex-shrink-0 text-[11px] font-bold" style={{ color: isCdn ? '#16a34a' : '#9333ea' }}>#{i + 1}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })()}
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>CDN × Rs.{fmtLKR(rates.cdn_rate)} + CAP × Rs.{fmtLKR(rates.cap_rate)}</span>
                    <span className="font-semibold text-gray-800">Rs. {fmtLKR(myCountWorkEarned)}</span>
                  </div>
                </>
              )}
            </div>

            {/* Other Work */}
            {(myApprovedOtherWork.length > 0 || myPendingOtherWork.length > 0) && (
              <div className="border-t border-blue-100 pt-3">
                <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide mb-2">Other Work</p>
                {myApprovedOtherWork.map(x => (
                  <div key={x.id} className="flex items-center justify-between text-xs py-1">
                    <span className="text-gray-700 flex items-center gap-1"><Briefcase size={10} className="text-indigo-500"/>{x.description}</span>
                    <span className="font-semibold text-indigo-700">Rs. {fmtLKR(Number(x.amount))}</span>
                  </div>
                ))}
                {myPendingOtherWork.length > 0 && (
                  <div className="mt-1.5">
                    <p className="text-[10px] text-amber-600 font-semibold mb-1">Pending approval (not counted yet)</p>
                    {myPendingOtherWork.map(x => (
                      <div key={x.id} className="flex items-center justify-between text-xs py-1 opacity-50">
                        <span className="text-gray-500 flex items-center gap-1"><Briefcase size={10}/>{x.description}</span>
                        <span className="text-gray-400">Rs. {fmtLKR(Number(x.amount))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Total */}
            <div className="border-t border-blue-200 pt-2 flex items-center justify-between text-xs font-bold">
              <span className="text-blue-800">Total Cost</span>
              <span className="text-blue-800">Rs. {fmtLKR(myEarned)}</span>
            </div>
          </div>
        )}

        {/* Received history */}
        {showReceived && (
          <div className="mb-3 bg-gray-50 rounded-xl p-3">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Payment History (Received)</p>
            {myReceivedPayments.length === 0 ? (
              <p className="text-xs text-gray-400">No payments received yet</p>
            ) : (
              <div className="space-y-0.5 max-h-40 overflow-y-auto">
                {myReceivedPayments.map(p => (
                  <div key={p.id} className="flex items-center justify-between text-xs py-1.5 border-t border-gray-100 first:border-0">
                    <span className="text-gray-600">{p.from_user_name} · {new Date(p.created_at).toLocaleDateString('en-GB')}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-green-700">Rs. {fmtLKR(Number(p.amount))}</span>
                      {isAdmin && <button onClick={() => deletePayment(p.id)} disabled={deletingId === p.id}
                        className="text-gray-300 hover:text-red-500 disabled:opacity-50"><Trash2 size={11}/></button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Admin section */}
        {isAdmin && (
          <div className="mt-2 pt-3 border-t border-gray-100">
            <button onClick={() => { setShowAdminAll(x => !x); if (!showAdminAll) loadAllWork() }}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 mb-2">
              <UsersIcon size={13}/>{showAdminAll ? 'Hide' : 'Show'} all users (Admin)
            </button>
            {showAdminAll && (
              <div className="space-y-4 mt-2">

                {/* Rate settings */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Payment Rates</p>
                  <div className="flex items-end gap-3 flex-wrap">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-gray-500">CDN Rate (Rs.)</span>
                      <input type="number" min={0} step="0.01"
                        value={rateDraft ? rateDraft.cdn_rate : rates.cdn_rate}
                        onChange={e => setRateDraft(prev => ({ ...(prev || rates), cdn_rate: Number(e.target.value) || 0 }))}
                        className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right focus:outline-none focus:border-green-400"/>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-gray-500">CAP Rate (Rs.)</span>
                      <input type="number" min={0} step="0.01"
                        value={rateDraft ? rateDraft.cap_rate : rates.cap_rate}
                        onChange={e => setRateDraft(prev => ({ ...(prev || rates), cap_rate: Number(e.target.value) || 0 }))}
                        className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right focus:outline-none focus:border-purple-400"/>
                    </label>
                    {rateDraft && (
                      <button onClick={saveRates} disabled={savingRates}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50" style={{ background: '#22A87A' }}>
                        {savingRates ? <Loader size={11} className="animate-spin"/> : <Save size={11}/>}Save Rates
                      </button>
                    )}
                  </div>
                </div>

                {/* Per-user summary */}
                {users.map(u => {
                  const name = u.full_name || u.username
                  const userWork = workByUser[name] || { cdn: 0, cap: 0 }
                  const countCost = userWork.cdn * rates.cdn_rate + userWork.cap * rates.cap_rate
                  const owData = otherWorkByUserId[u.id] || { approved: 0, pending: [] }
                  const totalCost = countCost + owData.approved
                  const userConfirmedPayments = payments.filter(p => (p.to_user_id === u.id || p.to_display_name === name) && p.status === 'confirmed')
                  const received = userConfirmedPayments.reduce((s, p) => s + Number(p.amount), 0)
                  const bal = received - totalCost
                  const isExpanded = expandedUser === u.id
                  return (
                    <div key={u.id} className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="px-3 py-2.5 bg-gray-50">
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="font-semibold text-gray-800 text-xs">{name}</p>
                          <span className={`text-xs font-bold ${bal >= 0 ? 'text-amber-700' : 'text-red-600'}`}>Balance: Rs. {fmtLKR(bal)}</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs flex-wrap">
                          <span className="text-gray-500">CDN: <b className="text-green-700">{userWork.cdn}</b> · CAP: <b className="text-purple-700">{userWork.cap}</b></span>
                          <span className="text-gray-500">Cost: <b className="text-gray-800">Rs. {fmtLKR(totalCost)}</b></span>
                          {owData.approved > 0 && <span className="text-indigo-600">Other: <b>Rs. {fmtLKR(owData.approved)}</b></span>}
                          {owData.pending.length > 0 && <span className="text-amber-500">Pending: {owData.pending.length}</span>}
                          <button onClick={() => setExpandedUser(isExpanded ? null : u.id)}
                            className="text-gray-500 hover:text-gray-700 flex items-center gap-1">
                            Received: <b className="text-green-700 ml-1">Rs. {fmtLKR(received)}</b>
                            {userConfirmedPayments.length > 0 && <span className="text-gray-400 ml-0.5">▾</span>}
                          </button>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="divide-y divide-gray-50 max-h-40 overflow-y-auto">
                          {userConfirmedPayments.length === 0 ? (
                            <p className="text-xs text-gray-400 p-3">No payments yet</p>
                          ) : userConfirmedPayments.map(p => (
                            <div key={p.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                              <span className="text-gray-600">{p.from_user_name} · {new Date(p.created_at).toLocaleDateString('en-GB')}</span>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-green-700">Rs. {fmtLKR(Number(p.amount))}</span>
                                <button onClick={() => deletePayment(p.id)} disabled={deletingId === p.id}
                                  className="text-gray-300 hover:text-red-500 disabled:opacity-50"><Trash2 size={11}/></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}

              </div>
            )}
          </div>
        )}
      </div>

      }

      {/* ═══ Panel 2 — Payments (unchanged below) ═══ */}
      {showPayments && <div className="card mb-5">
        <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2 mb-3"><Send size={15}/>Payments</h2>

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
                  <span><b>{p.from_user_name}</b> says they paid you <b>Rs. {fmtLKR(Number(p.amount))}</b></span>
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

        {/* Payments you've sent */}
        {sentByMe.length > 0 && (
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Payments you've sent</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {sentByMe.map(p => (
                <div key={p.id} className="flex items-center justify-between text-xs py-1 border-t border-gray-50">
                  <span className="text-gray-600">{p.to_display_name} — Rs. {fmtLKR(Number(p.amount))}</span>
                  <div className="flex items-center gap-2">
                    {statusBadge(p.status)}
                    <button onClick={() => { if (confirm('Return this payment?')) deletePayment(p.id, true) }}
                      disabled={returningId === p.id}
                      className="flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-amber-600 disabled:opacity-40">
                      {returningId === p.id ? <Loader size={10} className="animate-spin"/> : <Undo2 size={10}/>}Return
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>}
    </>
  )
}

interface WorkCountRow {
  id: string; user_id: string; user_name: string; document_id: string; file_name: string
  reason: string; action: string; cdn_inc: number; cusdec_inc: number; cap_inc: number
  created_at: string
}
interface WorkRates { cdn_rate: number; cap_rate: number }

function fmtLKR(n: number) {
  return n.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function InvoiceBlock({ cdn, cap, rates }: { cdn: number; cap: number; rates: WorkRates }) {
  const cdnTotal = cdn * rates.cdn_rate
  const capTotal = cap * rates.cap_rate
  const grand = cdnTotal + capTotal
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden text-xs">
      <div className="bg-gray-50 px-3 py-1.5 flex items-center justify-between">
        <span className="font-semibold text-gray-600 uppercase tracking-wide text-[10px]">Invoice</span>
        <span className="font-bold text-amber-700 text-sm">Rs. {fmtLKR(grand)}</span>
      </div>
      <div className="divide-y divide-gray-100">
        <div className="px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block"/>
            <span className="text-gray-700">CDN <span className="font-bold text-green-700">{cdn}</span></span>
            <span className="text-gray-400">× Rs. {fmtLKR(rates.cdn_rate)}</span>
          </div>
          <span className="font-semibold text-gray-800">Rs. {fmtLKR(cdnTotal)}</span>
        </div>
        <div className="px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-500 inline-block"/>
            <span className="text-gray-700">CAP <span className="font-bold text-purple-700">{cap}</span></span>
            <span className="text-gray-400">× Rs. {fmtLKR(rates.cap_rate)}</span>
          </div>
          <span className="font-semibold text-gray-800">Rs. {fmtLKR(capTotal)}</span>
        </div>
      </div>
    </div>
  )
}

function OtherWorkPanel({ userId, isAdmin }: { userId: string | null; isAdmin: boolean }) {
  const [myItems, setMyItems]   = useState<OtherWorkItem[]>([])
  const [allItems, setAllItems] = useState<OtherWorkItem[]>([])
  const [users, setUsers]       = useState<Profile[]>([])
  const [error, setError]       = useState('')

  // form
  const [owTargetUser, setOwTargetUser] = useState('')
  const [owDesc, setOwDesc]             = useState('')
  const [owItem, setOwItem]             = useState('')
  const [owCost, setOwCost]             = useState('')
  const [owAmount, setOwAmount]         = useState('')
  const [owSaving, setOwSaving]         = useState(false)
  const [approvingId, setApprovingId]   = useState<string | null>(null)
  const [deletingId, setDeletingId]     = useState<string | null>(null)

  async function load() {
    const h = await authHeader()
    const [mine, all] = await Promise.all([
      fetch('/api/other-work', { headers: h }).then(r => r.json()),
      isAdmin ? fetch('/api/other-work?all=1', { headers: h }).then(r => r.json()) : Promise.resolve({ items: [] }),
    ])
    setMyItems(mine.items || [])
    if (isAdmin) {
      setAllItems(all.items || [])
      const { data } = await supabase.from('profiles').select('id, username, full_name')
      setUsers((data as any) || [])
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function addWork() {
    const computedAmount = Number(owAmount) || (Number(owItem) * Number(owCost))
    const targetId = isAdmin ? owTargetUser : userId
    if (!targetId || !owDesc.trim() || !computedAmount) { setError('Fill description and amount'); return }
    setOwSaving(true); setError('')
    try {
      const targetUser = isAdmin ? users.find(u => u.id === targetId) : null
      const descWithCalc = (owItem && owCost)
        ? `${owDesc.trim()} (${owItem} × Rs.${fmtLKR(Number(owCost))})`
        : owDesc.trim()
      const res = await fetch('/api/other-work', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ user_id: targetId, user_name: targetUser ? (targetUser.full_name || targetUser.username) : undefined, description: descWithCalc, amount: computedAmount }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setOwTargetUser(''); setOwDesc(''); setOwItem(''); setOwCost(''); setOwAmount('')
      await load()
    } catch (e: any) { setError(e.message) }
    finally { setOwSaving(false) }
  }

  async function approve(id: string, status: 'approved' | 'rejected') {
    setApprovingId(id)
    try {
      const res = await fetch('/api/other-work', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ id, status }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setAllItems(prev => prev.map(x => x.id === id ? d.item : x))
      setMyItems(prev => prev.map(x => x.id === id ? d.item : x))
    } catch (e: any) { setError(e.message) }
    finally { setApprovingId(null) }
  }

  async function deleteItem(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/other-work?id=${id}`, { method: 'DELETE', headers: await authHeader() })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setAllItems(prev => prev.filter(x => x.id !== id))
      setMyItems(prev => prev.filter(x => x.id !== id))
    } catch (e: any) { setError(e.message) }
    finally { setDeletingId(null) }
  }

  const pendingAll = allItems.filter(x => x.status === 'pending')

  return (
    <div className="card mb-5">
      <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2 mb-3"><Briefcase size={15}/>Other Work</h2>

      {/* Add form — all users */}
      <div className="bg-indigo-50 rounded-xl p-3 mb-4">
        <p className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wide mb-2">
          {isAdmin ? 'Add Other Work (for any user)' : 'Add Other Work (for yourself)'}
        </p>
        <div className={`grid gap-2 mb-2 ${isAdmin ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
          {isAdmin && (
            <select value={owTargetUser} onChange={e => setOwTargetUser(e.target.value)} className="input text-sm">
              <option value="">— Select user —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
            </select>
          )}
          <input value={owDesc} onChange={e => setOwDesc(e.target.value)} placeholder="Description" className="input text-sm"/>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="number" value={owItem} onChange={e => { setOwItem(e.target.value); setOwAmount(String(Number(e.target.value) * Number(owCost))) }}
            placeholder="Qty" className="input text-sm w-20"/>
          <span className="text-gray-400 text-sm">×</span>
          <input type="number" value={owCost} onChange={e => { setOwCost(e.target.value); setOwAmount(String(Number(owItem) * Number(e.target.value))) }}
            placeholder="Unit cost" className="input text-sm w-28"/>
          <span className="text-gray-400 text-sm">=</span>
          <input type="number" value={owAmount} onChange={e => { setOwAmount(e.target.value); setOwItem(''); setOwCost('') }}
            placeholder="Total (Rs.)" className="input text-sm w-28 bg-white font-semibold"/>
          <button onClick={addWork} disabled={owSaving} className="btn-primary flex items-center justify-center gap-1.5 text-sm ml-auto">
            {owSaving ? <Loader size={13} className="animate-spin"/> : <Plus size={13}/>}Add
          </button>
        </div>
        {!isAdmin && <p className="text-[10px] text-indigo-500 mt-1.5">Submitted as pending — admin needs to approve before it counts in your balance.</p>}
        {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
      </div>

      {/* Admin: pending approvals */}
      {isAdmin && pendingAll.length > 0 && (
        <div className="border border-amber-200 rounded-xl overflow-hidden mb-4">
          <div className="px-3 py-1.5 bg-amber-50">
            <p className="text-[11px] font-semibold text-amber-700">Pending Approval ({pendingAll.length})</p>
          </div>
          <div className="divide-y divide-gray-50">
            {pendingAll.map(x => (
              <div key={x.id} className="flex items-center justify-between px-3 py-2 text-xs">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-800">{x.user_name || x.user_id}</p>
                  <p className="text-gray-500">{x.description} · Rs. {fmtLKR(Number(x.amount))}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => approve(x.id, 'approved')} disabled={approvingId === x.id}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-white text-[11px] font-medium disabled:opacity-50" style={{ background: '#22A87A' }}>
                    {approvingId === x.id ? <Loader size={10} className="animate-spin"/> : <Check size={10}/>}Approve
                  </button>
                  <button onClick={() => approve(x.id, 'rejected')} disabled={approvingId === x.id}
                    className="flex items-center gap-1 px-2 py-1 rounded-md border border-red-300 text-red-600 text-[11px] font-medium disabled:opacity-50 hover:bg-red-50">
                    <X size={10}/>Reject
                  </button>
                  <button onClick={() => deleteItem(x.id)} disabled={deletingId === x.id}
                    className="text-gray-300 hover:text-red-500 disabled:opacity-50"><Trash2 size={11}/></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* My items */}
      {myItems.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Your Other Work</p>
          <div className="divide-y divide-gray-50 border border-gray-100 rounded-xl overflow-hidden">
            {myItems.map(x => (
              <div key={x.id} className="flex items-center justify-between px-3 py-2 text-xs">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-800 truncate">{x.description}</p>
                  <p className="text-gray-400">{new Date(x.created_at).toLocaleDateString('en-GB')}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-semibold text-indigo-700">Rs. {fmtLKR(Number(x.amount))}</span>
                  {x.status === 'approved' && <span className="text-[10px] text-green-600 font-medium flex items-center gap-0.5"><Check size={10}/>Approved</span>}
                  {x.status === 'pending'  && <span className="text-[10px] text-amber-600 font-medium">Pending</span>}
                  {x.status === 'rejected' && <span className="text-[10px] text-red-500 font-medium flex items-center gap-0.5"><X size={10}/>Rejected</span>}
                  {isAdmin && (
                    <button onClick={() => deleteItem(x.id)} disabled={deletingId === x.id}
                      className="text-gray-300 hover:text-red-500 disabled:opacity-50"><Trash2 size={11}/></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {myItems.length === 0 && !isAdmin && (
        <p className="text-xs text-gray-400">No other work added yet.</p>
      )}
    </div>
  )
}

function CountWork({ userId, isAdmin }: { userId: string | null; isAdmin: boolean }) {
  const [rows, setRows] = useState<WorkCountRow[]>([])
  const [allRows, setAllRows] = useState<WorkCountRow[]>([])
  const [rates, setRates] = useState<WorkRates>({ cdn_rate: 0, cap_rate: 0 })
  const [rateDraft, setRateDraft] = useState<WorkRates | null>(null)
  const [savingRates, setSavingRates] = useState(false)
  const [detailFilter, setDetailFilter] = useState<'cdn' | 'cap' | null>(null)
  const [adminView, setAdminView] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editDrafts, setEditDrafts] = useState<Record<string, Partial<WorkCountRow>>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const cdnCount = rows.reduce((s, x) => s + (x.cdn_inc || 0), 0)
  const capCount = rows.reduce((s, x) => s + (x.cap_inc || 0), 0)

  async function load() {
    try {
      const h = await authHeader()
      const [wc, wr] = await Promise.all([
        fetch('/api/work-counts', { headers: h }).then(r => r.json()),
        fetch('/api/work-rates', { headers: h }).then(r => r.json()),
      ])
      setRows(wc.rows || [])
      if (wr.cdn_rate !== undefined) setRates(wr)
    } catch {}
  }

  async function loadAll() {
    try {
      const res = await fetch('/api/work-counts?all=1', { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) setAllRows(d.rows || [])
    } catch {}
  }

  async function saveRates() {
    if (!rateDraft) return
    setSavingRates(true); setError('')
    try {
      const res = await fetch('/api/work-rates', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify(rateDraft),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setRates({ cdn_rate: d.cdn_rate, cap_rate: d.cap_rate })
      setRateDraft(null)
    } catch (e: any) { setError(e.message) }
    finally { setSavingRates(false) }
  }

  async function deleteRow(id: string) {
    setDeletingId(id); setError('')
    try {
      const res = await fetch(`/api/work-counts?id=${id}`, { method: 'DELETE', headers: await authHeader() })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setAllRows(prev => prev.filter(r => r.id !== id))
      setRows(prev => prev.filter(r => r.id !== id))
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
      const updated = { ...draft, cdn_inc: Number(draft.cdn_inc ?? 0), cap_inc: Number(draft.cap_inc ?? 0) }
      setAllRows(prev => prev.map(r => r.id === id ? { ...r, ...updated } : r))
      setEditDrafts(prev => { const n = { ...prev }; delete n[id]; return n })
    } catch (e: any) { setError(e.message) }
    finally { setSavingId(null) }
  }

  function setDraft(id: string, key: string, value: string) {
    setEditDrafts(prev => ({ ...prev, [id]: { ...prev[id], [key]: value as any } }))
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Group allRows by user for admin view
  const byUser = allRows.reduce((acc, r) => {
    if (!acc[r.user_name]) acc[r.user_name] = { name: r.user_name, cdn: 0, cap: 0, rows: [] }
    acc[r.user_name].cdn += r.cdn_inc || 0
    acc[r.user_name].cap += r.cap_inc || 0
    acc[r.user_name].rows.push(r)
    return acc
  }, {} as Record<string, { name: string; cdn: number; cap: number; rows: WorkCountRow[] }>)

  const noData = cdnCount === 0 && capCount === 0

  return (
    <div className="card mb-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><BarChart2 size={15}/>Count Work</h2>
      </div>

      {noData ? (
        <p className="text-xs text-gray-400">No processed documents yet — counts increment when you Mail or Download a document from My Picked Tasks.</p>
      ) : (
        <>
          {/* Summary tiles — click to toggle detail list */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <button
              onClick={() => setDetailFilter(f => f === 'cdn' ? null : 'cdn')}
              className={`rounded-lg p-3 text-center transition-all border-2 ${detailFilter === 'cdn' ? 'bg-green-100 border-green-400' : 'bg-green-50 border-transparent hover:border-green-200'}`}>
              <p className="text-2xl font-bold text-green-700">{cdnCount}</p>
              <p className="text-xs text-gray-500 mt-1">CDN (Container Moved)</p>
              <p className="text-[10px] text-green-600 mt-0.5">{detailFilter === 'cdn' ? '▲ hide' : '▼ details'}</p>
            </button>
            <button
              onClick={() => setDetailFilter(f => f === 'cap' ? null : 'cap')}
              className={`rounded-lg p-3 text-center transition-all border-2 ${detailFilter === 'cap' ? 'bg-purple-100 border-purple-400' : 'bg-purple-50 border-transparent hover:border-purple-200'}`}>
              <p className="text-2xl font-bold text-purple-700">{capCount}</p>
              <p className="text-xs text-gray-500 mt-1">CAP (CUSDEC Passed)</p>
              <p className="text-[10px] text-purple-600 mt-0.5">{detailFilter === 'cap' ? '▲ hide' : '▼ details'}</p>
            </button>
          </div>

          {/* Detail rows — filtered by tile click */}
          {detailFilter && (() => {
            const isCdn = detailFilter === 'cdn'
            const filtered = rows.filter(r => isCdn ? r.cdn_inc > 0 : r.cap_inc > 0)
            return (
              <div className="mb-3 rounded-xl border overflow-hidden" style={{ borderColor: isCdn ? '#bbf7d0' : '#e9d5ff' }}>
                <div className="px-3 py-1.5 flex items-center justify-between" style={{ background: isCdn ? '#f0fdf4' : '#faf5ff' }}>
                  <span className="text-[11px] font-semibold" style={{ color: isCdn ? '#15803d' : '#7e22ce' }}>
                    {isCdn ? 'CDN Documents — Container Moved' : 'CAP Documents — CUSDEC Passed'}
                  </span>
                  <span className="text-[10px]" style={{ color: isCdn ? '#16a34a' : '#9333ea' }}>{filtered.length} records</span>
                </div>
                {filtered.length === 0 ? (
                  <p className="text-xs text-gray-400 px-3 py-2">No records</p>
                ) : (
                  <div className="max-h-52 overflow-y-auto divide-y divide-gray-50">
                    {filtered.map((r, i) => (
                      <div key={r.id} className="flex items-center justify-between px-3 py-2 text-xs">
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-800 truncate font-medium">{r.file_name || '—'}</p>
                          <p className="text-gray-400">{new Date(r.created_at).toLocaleDateString('en-GB')} · {r.action}</p>
                        </div>
                        <span className="ml-2 flex-shrink-0 text-[11px] font-bold" style={{ color: isCdn ? '#16a34a' : '#9333ea' }}>#{i + 1}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Invoice block */}
          <InvoiceBlock cdn={cdnCount} cap={capCount} rates={rates}/>
        </>
      )}

      {/* Admin panel */}
      {isAdmin && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">

          {/* Rate settings */}
          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Payment Rates (Global)</p>
            <div className="flex items-end gap-3 flex-wrap">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-gray-500">CDN Rate (Rs.)</span>
                <input type="number" min={0} step="0.01"
                  value={rateDraft ? rateDraft.cdn_rate : rates.cdn_rate}
                  onChange={e => setRateDraft(prev => ({ ...(prev || rates), cdn_rate: Number(e.target.value) || 0 }))}
                  className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right focus:outline-none focus:border-green-400"/>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-gray-500">CAP Rate (Rs.)</span>
                <input type="number" min={0} step="0.01"
                  value={rateDraft ? rateDraft.cap_rate : rates.cap_rate}
                  onChange={e => setRateDraft(prev => ({ ...(prev || rates), cap_rate: Number(e.target.value) || 0 }))}
                  className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right focus:outline-none focus:border-purple-400"/>
              </label>
              {rateDraft && (
                <button onClick={saveRates} disabled={savingRates}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50" style={{ background: '#22A87A' }}>
                  {savingRates ? <Loader size={11} className="animate-spin"/> : <Save size={11}/>}Save Rates
                </button>
              )}
            </div>
          </div>

          {/* Per-user view */}
          <div>
            <button onClick={() => { setAdminView(x => !x); if (!adminView) loadAll() }}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
              <UsersIcon size={13}/>{adminView ? 'Hide' : 'Show'} all users
            </button>
            {adminView && (
              <div className="mt-3 space-y-4">
                {Object.values(byUser).length === 0 && <p className="text-xs text-gray-400">No data yet</p>}
                {Object.values(byUser).map(u => (
                  <div key={u.name} className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="px-3 py-2 bg-gray-50">
                      <p className="font-semibold text-gray-800 text-xs mb-2">{u.name}</p>
                      <InvoiceBlock cdn={u.cdn} cap={u.cap} rates={rates}/>
                    </div>
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
                                <label className="flex flex-col items-center gap-0.5">
                                  <span className="text-[10px] text-gray-400">CDN</span>
                                  <input type="number" min={0}
                                    value={draft.cdn_inc !== undefined ? draft.cdn_inc : r.cdn_inc}
                                    onChange={e => setDraft(r.id, 'cdn_inc', e.target.value)}
                                    className="w-12 border border-gray-200 rounded px-1 py-0.5 text-center text-xs focus:outline-none focus:border-green-400"/>
                                </label>
                                <label className="flex flex-col items-center gap-0.5">
                                  <span className="text-[10px] text-gray-400">CAP</span>
                                  <input type="number" min={0}
                                    value={draft.cap_inc !== undefined ? draft.cap_inc : r.cap_inc}
                                    onChange={e => setDraft(r.id, 'cap_inc', e.target.value)}
                                    className="w-12 border border-gray-200 rounded px-1 py-0.5 text-center text-xs focus:outline-none focus:border-purple-400"/>
                                </label>
                                {isDirty && (
                                  <button onClick={() => saveEdit(r.id)} disabled={savingId === r.id}
                                    className="flex items-center gap-0.5 px-2 py-1 rounded-md text-[11px] font-medium text-white disabled:opacity-50 mt-3.5" style={{ background: '#22A87A' }}>
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


      <SalaryPayments userId={userId} isAdmin={isAdmin}
        showBalance={isAdmin || has('section:my-tasks.balance')}
        showPayments={isAdmin || has('section:my-tasks.payments')}
      />

      <OtherWorkPanel userId={userId} isAdmin={isAdmin}/>

      {(isAdmin || has('section:my-tasks.upload-count')) && (
        <UploadCountPanel userId={userId} isAdmin={isAdmin}/>
      )}

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

// ── Upload Count Panel ───────────────────────────────────────────────────────
// Shows per-user CDN (Container Moved) and CUSDEC (CUSDEC Passed) upload
// counts. Counts are inserted at upload time by document-uploads.ts with
// action='upload'. View-only for regular users; admin can delete rows.

function UploadCountPanel({ userId, isAdmin }: { userId: string | null; isAdmin: boolean }) {
  const [myRows,  setMyRows]  = useState<WorkCountRow[]>([])
  const [allRows, setAllRows] = useState<WorkCountRow[]>([])
  const [users,   setUsers]   = useState<Profile[]>([])
  const [showAll, setShowAll] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function load() {
    try {
      const h = await authHeader()
      const r = await fetch('/api/work-counts', { headers: h })
      const d = await r.json()
      if (d.rows) setMyRows((d.rows as WorkCountRow[]).filter(r => r.action === 'upload'))
    } catch {}
  }

  async function loadAll() {
    try {
      const h = await authHeader()
      const r = await fetch('/api/work-counts?all=1', { headers: h })
      const d = await r.json()
      if (d.rows) setAllRows((d.rows as WorkCountRow[]).filter(r => r.action === 'upload'))
      const { data } = await supabase.from('profiles').select('id, username, full_name')
      setUsers((data as any) || [])
    } catch {}
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function deleteRow(id: string) {
    setDeletingId(id)
    try {
      const h = await authHeader()
      const r = await fetch(`/api/work-counts?id=${id}`, { method: 'DELETE', headers: h })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setMyRows(prev => prev.filter(x => x.id !== id))
      setAllRows(prev => prev.filter(x => x.id !== id))
    } catch (e: any) { setError(e.message) }
    finally { setDeletingId(null) }
  }

  const myCdn    = myRows.reduce((s, r) => s + (r.cdn_inc || 0), 0)
  const myCusdec = myRows.reduce((s, r) => s + (r.cusdec_inc || 0), 0)

  // Group all rows by user for admin summary
  const byUser = allRows.reduce((acc, r) => {
    const name = r.user_name || 'Unknown'
    if (!acc[name]) acc[name] = { cdn: 0, cusdec: 0, rows: [] }
    acc[name].cdn    += r.cdn_inc    || 0
    acc[name].cusdec += r.cusdec_inc || 0
    acc[name].rows.push(r)
    return acc
  }, {} as Record<string, { cdn: number; cusdec: number; rows: WorkCountRow[] }>)

  return (
    <div className="card mb-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
          <BarChart2 size={15} className="text-indigo-500"/>Upload Count
        </h2>
        {isAdmin && (
          <button onClick={() => { setShowAll(x => !x); if (!showAll) loadAll() }}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
            <UsersIcon size={12}/>{showAll ? 'Hide' : 'Show all users'}
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {/* My counts */}
      {!showAll && (
        <>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-green-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-green-700">{myCdn}</p>
              <p className="text-[11px] text-green-600 mt-0.5">Container Moved (CDN)</p>
            </div>
            <div className="bg-blue-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-blue-700">{myCusdec}</p>
              <p className="text-[11px] text-blue-600 mt-0.5">CUSDEC Passed</p>
            </div>
          </div>

          {myRows.length > 0 && (
            <div className="border border-gray-100 rounded-lg overflow-hidden">
              <div className="max-h-44 overflow-y-auto divide-y divide-gray-50">
                {myRows.map(r => (
                  <div key={r.id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <div>
                      <p className="text-gray-700 font-medium truncate max-w-xs">{r.file_name || '—'}</p>
                      <p className="text-gray-400">{r.reason} · {new Date(r.created_at).toLocaleDateString('en-GB')}</p>
                    </div>
                    <span className={`font-bold text-sm ${r.cdn_inc ? 'text-green-600' : 'text-blue-600'}`}>
                      {r.cdn_inc ? `CDN +${r.cdn_inc}` : `CUSDEC +${r.cusdec_inc}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {myRows.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No uploads counted yet</p>}
        </>
      )}

      {/* Admin: all users */}
      {isAdmin && showAll && (
        <div className="space-y-3">
          {Object.entries(byUser).map(([name, data]) => (
            <div key={name} className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-800">{name}</span>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-green-600">CDN: <b>{data.cdn}</b></span>
                  <span className="text-blue-600">CUSDEC: <b>{data.cusdec}</b></span>
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto divide-y divide-gray-50">
                {data.rows.map(r => (
                  <div key={r.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                    <div>
                      <p className="text-gray-700 truncate max-w-sm">{r.file_name || '—'}</p>
                      <p className="text-gray-400">{r.reason} · {new Date(r.created_at).toLocaleDateString('en-GB')}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`font-semibold ${r.cdn_inc ? 'text-green-600' : 'text-blue-600'}`}>
                        {r.cdn_inc ? `CDN +${r.cdn_inc}` : `CUSDEC +${r.cusdec_inc}`}
                      </span>
                      <button onClick={() => deleteRow(r.id)} disabled={deletingId === r.id}
                        className="text-gray-300 hover:text-red-500 disabled:opacity-40">
                        {deletingId === r.id ? <Loader size={11} className="animate-spin"/> : <Trash2 size={11}/>}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {Object.keys(byUser).length === 0 && <p className="text-xs text-gray-400 text-center py-4">No upload records yet</p>}
        </div>
      )}
    </div>
  )
}
