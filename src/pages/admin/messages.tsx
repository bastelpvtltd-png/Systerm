import { useEffect, useRef, useState } from 'react'
import AdminLayout from '@/components/admin/AdminLayout'
import { supabase } from '@/lib/supabase'
import { MessageSquare, Send, Loader } from 'lucide-react'

interface Msg {
  id: string
  sender_id: string
  body: string
  created_at: string
  profiles?: { full_name: string; username: string } | null
}

// One shared channel everyone (admin + every user) posts to and reads —
// simple company-wide board rather than 1:1 DMs, which is what was asked for.
export default function MessagesPage() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  async function load() {
    const { data } = await supabase
      .from('messages')
      .select('id, sender_id, body, created_at, profiles(full_name, username)')
      .order('created_at', { ascending: true })
      .limit(200)
    setMessages((data as any) || [])
    setLoading(false)
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id || null))
    load()
    const channel = supabase
      .channel('messages-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length])

  async function handleSend() {
    if (!body.trim() || !userId) return
    setSending(true)
    const { error } = await supabase.from('messages').insert({ sender_id: userId, body: body.trim() })
    if (!error) setBody('')
    setSending(false)
  }

  return (
      <div className="p-6 max-w-3xl mx-auto h-[calc(100vh-3rem)] flex flex-col">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><MessageSquare size={22} className="text-brand-green"/>Messages</h1>
          <p className="text-gray-500 text-sm mt-0.5">Shared board — everyone (admin and users) can see and post here</p>
        </div>

        <div className="card flex-1 flex flex-col overflow-hidden p-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {loading ? (
              <div className="flex items-center justify-center h-full"><Loader size={20} className="animate-spin text-gray-400"/></div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-gray-400">No messages yet — say hello</div>
            ) : (
              messages.map(m => {
                const mine = m.sender_id === userId
                const name = m.profiles?.full_name || m.profiles?.username || 'Unknown'
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${mine ? 'bg-brand-green text-white' : 'bg-gray-100 text-gray-800'}`}>
                      {!mine && <p className="text-xs font-semibold mb-0.5 opacity-70">{name}</p>}
                      <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                      <p className={`text-[10px] mt-1 ${mine ? 'text-white/70' : 'text-gray-400'}`}>
                        {new Date(m.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                )
              })
            )}
            <div ref={bottomRef}/>
          </div>

          <div className="border-t border-gray-100 p-3 flex items-center gap-2">
            <input value={body} onChange={e => setBody(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="Type a message..."
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
            <button onClick={handleSend} disabled={sending || !body.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={{background:'#22A87A'}}>
              {sending ? <Loader size={14} className="animate-spin"/> : <Send size={14}/>}
            </button>
          </div>
        </div>
      </div>
  )
}
MessagesPage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>
