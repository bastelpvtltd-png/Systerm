import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/router'
import { CheckCircle, Clock, User } from 'lucide-react'
import WorkerLayout from '@/components/worker/WorkerLayout'

interface Task {
  id: string
  task_type: string
  status: string
  notes: string
  shipment_id: string
  shipments?: { shipment_no: string }
}

interface Profile {
  username: string
  full_name: string
  role: string
}

export default function WorkerDashboard() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile|null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [tab, setTab] = useState<'pending'|'done'>('pending')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      setProfile(prof)

      const { data: t } = await supabase.from('worker_tasks')
        .select('*, shipments(shipment_no)')
        .eq('assigned_to', user.id)
        .order('created_at', { ascending: false })
      setTasks(t ?? [])
    }
    load()
  }, [])

  async function markDone(id: string) {
    await supabase.from('worker_tasks').update({ status: 'done' }).eq('id', id)
    setTasks(prev => prev.map(t => t.id === id ? {...t, status:'done'} : t))
  }

  const filtered = tasks.filter(t => t.status === tab)

  return (
    <WorkerLayout>
      <div className="p-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold">My Tasks</h1>
          <span className="flex items-center gap-1 text-xs text-gray-400"><User size={12}/>{profile?.full_name || profile?.username}</span>
        </div>
        <p className="text-gray-500 text-sm mb-6">{tasks.filter(t=>t.status==='pending').length} pending tasks</p>

        {/* Tabs */}
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

        {/* Tasks */}
        <div className="space-y-3">
          {filtered.map(task => (
            <div key={task.id} className="card flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">{task.task_type}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Shipment: <span className="font-mono text-brand-blue">{task.shipments?.shipment_no}</span>
                </div>
                {task.notes && <div className="text-xs text-gray-400 mt-1">{task.notes}</div>}
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
    </WorkerLayout>
  )
}
