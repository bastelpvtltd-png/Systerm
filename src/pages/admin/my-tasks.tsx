import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { CheckCircle, DollarSign, Plus, Loader, TrendingUp, TrendingDown } from 'lucide-react'

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

export default function MyTasksPage() {
  return <MyTasksContent/>
}
MyTasksPage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>

function MyTasksContent() {
  const { has } = usePermission()
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
