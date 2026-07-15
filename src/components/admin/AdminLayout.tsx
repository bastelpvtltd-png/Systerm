import { createContext, useContext, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { supabase } from '@/lib/supabase'
import {
  LayoutDashboard, Ship, Upload,
  BarChart2, Users, Settings, LogOut,
  ChevronLeft, ChevronRight, Shield, DollarSign, Anchor,
  Database, Loader, MessageSquare, CheckCircle, FileStack, Zap, Clock, Sun, Moon,
  Send, X, Bell, Anchor as AnchorIcon, Trash2,
} from 'lucide-react'
import { formatSLDateTime } from '@/lib/slTime'

function SidebarClock({ collapsed }: { collapsed: boolean }) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const time = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const date = now.toLocaleDateString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', year: 'numeric' })
  return (
    <div className="px-3 py-2.5 border-t border-white/10 text-blue-100 flex items-center gap-2">
      <Clock size={14} className="flex-shrink-0"/>
      {!collapsed && <div className="text-xs leading-tight"><div className="font-semibold tabular-nums">{time}</div><div className="text-blue-300">{date} · SLT</div></div>}
    </div>
  )
}

// ─── Trigger Timestamp Widget (sidebar) ─────────────────────────────────────
function TriggerTimestamps({ collapsed }: { collapsed: boolean }) {
  const [data, setData] = useState<any>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const res = await fetch('/api/trigger-timestamps', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (res.ok) setData(await res.json())
      } catch {}
    }
    load()
    const id = setInterval(load, 60000)
    return () => clearInterval(id)
  }, [])

  function fmt(iso: string | null | undefined) {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    } catch { return iso }
  }

  if (collapsed) {
    return (
      <div className="px-3 py-2 border-t border-white/10">
        <button onClick={() => setOpen(o => !o)} className="text-blue-200 hover:text-white">
          <Bell size={15}/>
        </button>
        {open && (
          <div className="absolute left-16 bottom-40 w-64 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-3 z-50 text-xs text-gray-300 space-y-2">
            <p className="font-semibold text-white mb-2 flex items-center gap-1"><Bell size={12}/> Trigger Times</p>
            <div><span className="text-gray-500">Boat Note:</span> <span className="text-green-400">{fmt(data?.boatNote?.time)}</span></div>
            <div><span className="text-gray-500">Export Release:</span> <span className="text-blue-400">{fmt(data?.exportRelease?.time)}</span></div>
            <div><span className="text-gray-500">Vessel ETB:</span> <span className="text-yellow-400">{data?.vessel?.vessel ? `${data.vessel.vessel} — ${fmt(data.vessel.etb)}` : '—'}</span></div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="px-3 py-2.5 border-t border-white/10">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-xs text-blue-200 hover:text-white w-full">
        <Bell size={13} className="flex-shrink-0"/>
        <span className="font-medium">Trigger Times</span>
        <ChevronRight size={11} className={`ml-auto transition-transform ${open ? 'rotate-90' : ''}`}/>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 text-[11px]">
          <div className="bg-white/5 rounded-lg px-2 py-1.5">
            <p className="text-gray-400">Boat Note</p>
            <p className="text-green-400 font-medium tabular-nums">{fmt(data?.boatNote?.time)}</p>
            {data?.boatNote?.container && <p className="text-gray-500 font-mono">{data.boatNote.container}</p>}
          </div>
          <div className="bg-white/5 rounded-lg px-2 py-1.5">
            <p className="text-gray-400">Export Release</p>
            <p className="text-blue-400 font-medium tabular-nums">{fmt(data?.exportRelease?.time)}</p>
            {data?.exportRelease?.cusdec && <p className="text-gray-500 font-mono">E {data.exportRelease.cusdec}</p>}
          </div>
          <div className="bg-white/5 rounded-lg px-2 py-1.5">
            <p className="text-gray-400">Next Vessel ETB</p>
            <p className="text-yellow-400 font-medium">{data?.vessel?.vessel || '—'}</p>
            {data?.vessel?.etb && <p className="text-gray-500 tabular-nums">{fmt(data.vessel.etb)}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Floating Chat Widget ────────────────────────────────────────────────────
interface Msg {
  id: string; sender_id: string; body: string; created_at: string
  recipient_id?: string | null
  profiles?: { full_name: string; username: string }[] | null
  reads?: { user_id: string }[]
}
interface ChatUser { id: string; full_name: string; username: string; last_active_at?: string | null }

function FloatingChat() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [allMsgs, setAllMsgs] = useState<Msg[]>([]) // admin: all messages unfiltered
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [users, setUsers] = useState<ChatUser[]>([])
  const [recipientId, setRecipientId] = useState<string>('') // '' = all, '__admin__' = admin overview
  const [unread, setUnread] = useState(0)
  const [lastSeen, setLastSeen] = useState<string>(() =>
    typeof window !== 'undefined' ? localStorage.getItem('chat_last_seen') || '' : '')
  const bottomRef = useRef<HTMLDivElement>(null)

  const ONLINE_THRESHOLD = 3 * 60 * 1000 // 3 minutes

  function isOnline(u: ChatUser) {
    if (!u.last_active_at) return false
    return Date.now() - new Date(u.last_active_at).getTime() < ONLINE_THRESHOLD
  }

  async function pingActive() {
    if (!userId) return
    await supabase.from('profiles').update({ last_active_at: new Date().toISOString() }).eq('id', userId)
  }

  async function loadAll() {
    const [{ data: { user } }, { data: uRows }, { data: mRows }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from('profiles').select('id, full_name, username, last_active_at').order('full_name'),
      supabase.from('messages')
        .select('id, sender_id, body, created_at, recipient_id, profiles(full_name, username), reads:message_reads(user_id)')
        .order('created_at', { ascending: true })
        .limit(120),
    ])
    const me = user?.id || null
    setUserId(me)
    setUsers((uRows || []) as ChatUser[])
    const rawMsgs = (mRows || []) as Msg[]
    setAllMsgs(rawMsgs) // admin overview: unfiltered
    // Filter: show only messages that are broadcast OR sent/received by me
    const filtered = rawMsgs.filter(m =>
      m.recipient_id === null || m.recipient_id === undefined ||
      m.sender_id === me || m.recipient_id === me
    )
    setMsgs(filtered)
    // Check admin status
    if (me) {
      const { data: prof } = await supabase.from('profiles').select('is_admin').eq('id', me).single()
      setIsAdmin(!!prof?.is_admin)
    }
  }

  useEffect(() => {
    loadAll()
    const ch = supabase.channel('float-chat-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reads' }, () => loadAll())
      .subscribe()
    // Ping active every 60s
    const pingId = setInterval(() => pingActive(), 60000)
    // Poll users list every 30s to keep online indicators fresh
    const pollId = setInterval(() => {
      supabase.from('profiles').select('id, full_name, username, last_active_at').order('full_name')
        .then(({ data }) => { if (data) setUsers(data as ChatUser[]) })
    }, 30000)
    return () => { supabase.removeChannel(ch); clearInterval(pingId); clearInterval(pollId) }
  }, [])

  // Ping immediately when userId resolves
  useEffect(() => { if (userId) pingActive() }, [userId])

  // Count unread broadcast + DMs to me
  useEffect(() => {
    if (open) {
      const latest = msgs[msgs.length - 1]?.created_at || ''
      localStorage.setItem('chat_last_seen', latest)
      setLastSeen(latest)
      setUnread(0)
      // Mark all visible as read
      msgs.forEach(m => {
        if (userId && m.sender_id !== userId) {
          const alreadyRead = (m.reads || []).some(r => r.user_id === userId)
          if (!alreadyRead) {
            supabase.from('message_reads').insert({ message_id: m.id, user_id: userId }).then(() => {})
          }
        }
      })
    } else {
      setUnread(msgs.filter(m => m.created_at > lastSeen && m.sender_id !== userId).length)
    }
  }, [msgs, open])

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, open])

  async function send() {
    if (!body.trim() || !userId) return
    setSending(true)
    const { error } = await supabase.from('messages').insert({
      sender_id: userId,
      body: body.trim(),
      recipient_id: recipientId || null,
    })
    if (!error) setBody('')
    setSending(false)
  }

  async function deleteMsg(id: string) {
    await supabase.from('messages').delete().eq('id', id)
  }

  function fmt(iso: string) {
    try { return new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit' }) }
    catch { return '' }
  }

  const onlineUsers = users.filter(u => u.id !== userId && isOnline(u))
  const selectedRecipient = users.find(u => u.id === recipientId)
  const isAdminView = recipientId === '__admin__'

  // Visible messages filtered by chosen recipient tab
  const visibleMsgs = isAdminView
    ? allMsgs // admin sees everything
    : recipientId
      ? msgs.filter(m => (m.sender_id === userId && m.recipient_id === recipientId) || (m.sender_id === recipientId && m.recipient_id === userId))
      : msgs.filter(m => !m.recipient_id)

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-5 right-5 z-[51] w-12 h-12 rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-110"
        style={{ background: '#22A87A' }}
      >
        {open
          ? <X size={20} color="white"/>
          : <>
              <MessageSquare size={20} color="white"/>
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </>
        }
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-20 right-5 z-50 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 flex flex-col overflow-hidden"
          style={{ height: '480px' }}>

          {/* Header */}
          <div className="px-4 py-3 flex items-center gap-2 border-b flex-shrink-0" style={{ background: '#22A87A' }}>
            <MessageSquare size={15} color="white"/>
            <span className="text-white font-semibold text-sm flex-1">
              {selectedRecipient ? `Chat · ${selectedRecipient.full_name || selectedRecipient.username}` : 'Company Chat'}
            </span>
            <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white">
              <X size={16}/>
            </button>
          </div>

          {/* Online users strip */}
          {onlineUsers.length > 0 && (
            <div className="px-3 py-1.5 bg-green-50 border-b border-green-100 flex items-center gap-1.5 flex-shrink-0 overflow-x-auto">
              <span className="text-[10px] text-green-600 font-medium flex-shrink-0">Online:</span>
              {onlineUsers.map(u => (
                <span key={u.id} className="text-[10px] bg-green-100 text-green-700 rounded-full px-2 py-0.5 flex-shrink-0 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"/>
                  {u.full_name || u.username}
                </span>
              ))}
            </div>
          )}

          {/* Recipient tabs */}
          <div className="px-2 py-1.5 border-b bg-gray-50 flex gap-1 overflow-x-auto flex-shrink-0">
            <button onClick={() => setRecipientId('')}
              className={`text-[11px] px-2.5 py-1 rounded-lg flex-shrink-0 font-medium transition-colors ${
                recipientId === '' ? 'bg-green-600 text-white' : 'text-gray-500 hover:bg-gray-200'}`}>
              All
            </button>
            {users.filter(u => u.id !== userId).map(u => (
              <button key={u.id} onClick={() => setRecipientId(u.id)}
                className={`text-[11px] px-2.5 py-1 rounded-lg flex-shrink-0 font-medium transition-colors flex items-center gap-1 ${
                  recipientId === u.id ? 'bg-green-600 text-white' : 'text-gray-500 hover:bg-gray-200'}`}>
                {isOnline(u) && <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block"/>}
                {(u.full_name || u.username).split(' ')[0]}
              </button>
            ))}
            {isAdmin && (
              <button onClick={() => setRecipientId('__admin__')}
                className={`text-[11px] px-2.5 py-1 rounded-lg flex-shrink-0 font-medium transition-colors ${
                  isAdminView ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-200'}`}
                title="Admin: view all conversations">
                👁
              </button>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-gray-50">
            {visibleMsgs.length === 0 && (
              <p className="text-center text-gray-400 text-xs py-4">No messages{recipientId ? ' with this person' : ' yet'}</p>
            )}
            {visibleMsgs.map(m => {
              const isMe = m.sender_id === userId
              const senderProfile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
              const name = senderProfile?.full_name || senderProfile?.username || 'User'
              const readBy = (m.reads || []).filter(r => r.user_id !== m.sender_id)
              const seenNames = readBy.map(r => {
                const u = users.find(x => x.id === r.user_id)
                return u ? (u.full_name || u.username).split(' ')[0] : null
              }).filter(Boolean)
              return (
                <div key={m.id} className={`flex flex-col group ${isMe ? 'items-end' : 'items-start'}`}>
                  {!isMe && (
                    <div className="flex items-center gap-1.5 mb-0.5 px-1">
                      <span className="text-[10px] text-gray-400">{name}</span>
                      {isAdminView && !isMe && m.sender_id && (
                        <button onClick={() => setRecipientId(m.sender_id!)}
                          className="text-[9px] text-blue-400 hover:text-blue-600 underline">Reply →</button>
                      )}
                    </div>
                  )}
                  <div className="flex items-end gap-1">
                    {isMe && isAdmin && (
                      <button onClick={() => deleteMsg(m.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-red-300 hover:text-red-500 mb-1">
                        <Trash2 size={11}/>
                      </button>
                    )}
                    <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm break-words ${
                      isMe ? 'text-white rounded-br-sm' : 'bg-white text-gray-800 border border-gray-100 rounded-bl-sm'
                    }`}
                    style={isMe ? { background: '#22A87A' } : {}}>
                      {isAdminView && !isMe && m.recipient_id && m.recipient_id !== userId && (
                        <span className="block text-[9px] text-gray-400 mb-0.5">
                          → {users.find(u => u.id === m.recipient_id)?.full_name?.split(' ')[0] || 'DM'}
                        </span>
                      )}
                      {m.body}
                    </div>
                    {!isMe && isAdmin && (
                      <button onClick={() => deleteMsg(m.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-red-300 hover:text-red-500 mb-1">
                        <Trash2 size={11}/>
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1 px-1 mt-0.5">
                    <span className="text-[9px] text-gray-300">{fmt(m.created_at)}</span>
                    {isMe && seenNames.length > 0 && (
                      <span className="text-[9px] text-green-400">· Seen {seenNames.join(', ')}</span>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef}/>
          </div>

          {/* Input */}
          {isAdminView ? (
            <div className="p-3 border-t bg-gray-50 text-center flex-shrink-0">
              <p className="text-[11px] text-gray-400">Click a user tab or <b>Reply →</b> on a message to send a DM</p>
            </div>
          ) : (
            <div className="p-3 border-t bg-white flex gap-2 flex-shrink-0">
              <input
                value={body}
                onChange={e => setBody(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder={recipientId ? `Message ${selectedRecipient?.full_name?.split(' ')[0] || ''}…` : 'Message everyone…'}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:border-green-400"
              />
              <button onClick={send} disabled={sending || !body.trim()}
                className="w-8 h-8 rounded-xl flex items-center justify-center disabled:opacity-40 text-white flex-shrink-0"
                style={{ background: '#22A87A' }}>
                {sending ? <Loader size={13} className="animate-spin"/> : <Send size={13}/>}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}

// ─── In-App Notifications Bell ──────────────────────────────────────────────
interface UserNotif { id: string; type: string; title: string; body: string; link_href?: string; created_at: string; read_at?: string | null }

function InAppNotifications() {
  const [notifs, setNotifs] = useState<UserNotif[]>([])
  const [open, setOpen] = useState(false)
  const router = useRouter()

  async function load() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch('/api/user-notifications', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) { const d = await res.json(); setNotifs(d.notifications || []) }
    } catch {}
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [])

  async function markAllRead() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      await fetch('/api/user-notifications', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ mark_read: true }),
      })
      setNotifs([])
      setOpen(false)
    } catch {}
  }

  const unread = notifs.filter(n => !n.read_at).length

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-5 right-[72px] z-[51] w-10 h-10 rounded-full shadow-xl flex items-center justify-center transition-all hover:scale-110"
        style={{ background: unread > 0 ? '#ef4444' : '#6b7280' }}
        title="In-App Notifications"
      >
        <Bell size={16} color="white"/>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 rounded-full flex items-center justify-center text-white text-[9px] font-bold">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed bottom-20 right-[72px] z-[51] w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden"
          style={{ maxHeight: '360px' }}>
          <div className="px-4 py-3 flex items-center gap-2 border-b" style={{ background: '#1B3A5C' }}>
            <Bell size={14} color="white"/>
            <span className="text-white font-semibold text-sm flex-1">Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-blue-200 hover:text-white">Mark all read</button>
            )}
            <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white ml-1"><X size={15}/></button>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: '300px' }}>
            {notifs.length === 0 ? (
              <p className="text-center text-gray-400 text-xs py-8">No new notifications</p>
            ) : (
              notifs.map(n => (
                <div key={n.id}
                  className={`px-4 py-3 border-b border-gray-50 cursor-pointer hover:bg-gray-50 ${n.type === 'conflict' ? 'border-l-4 border-l-orange-400' : ''}`}
                  onClick={() => { if (n.link_href) router.push(n.link_href); setOpen(false) }}>
                  <p className="text-xs font-semibold text-gray-800">{n.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-snug">{n.body}</p>
                  <p className="text-[10px] text-gray-300 mt-1">{new Date(n.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ─── Tab definitions ──────────────────────────────────────────────────────────
export const TAB_ITEMS = [
  { href: '/admin',                  icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/admin/my-tasks',         icon: CheckCircle,     label: 'My Tasks' },
  { href: '/admin/shipment-entry',   icon: Ship,            label: 'Shipment Entry' },
  { href: '/admin/documents-upload', icon: Upload,          label: 'Upload Docs' },
  { href: '/admin/drive-files',      icon: Database,        label: 'Shipment Overview' },
  { href: '/admin/boat-note',        icon: FileStack,       label: 'Docs Create' },
  { href: '/admin/templates',        icon: FileStack,       label: 'Templates' },
  { href: '/admin/automation',       icon: Zap,             label: 'Automation' },
  { href: '/admin/database',         icon: Database,        label: 'Database' },
  { href: '/admin/financials',       icon: DollarSign,      label: 'Financials' },
  { href: '/admin/reports',          icon: BarChart2,       label: 'Reports' },
  { href: '/admin/users',            icon: Users,           label: 'Users' },
  { href: '/admin/settings',         icon: Settings,        label: 'Settings' },
]

export const SECTION_ITEMS = [
  { key: 'section:dashboard.total-shipments',  tabHref: '/admin', label: 'Total Shipments card' },
  { key: 'section:dashboard.cusdec-pending',   tabHref: '/admin', label: 'CUSDEC Pending card' },
  { key: 'section:dashboard.boatnote-pending', tabHref: '/admin', label: 'Boat Note Pending card' },
  { key: 'section:dashboard.cdn-pending',      tabHref: '/admin', label: 'CDN Pending card' },
  { key: 'section:dashboard.release-pending',  tabHref: '/admin', label: 'Export Release Pending card' },
  { key: 'section:dashboard.closing-passed',   tabHref: '/admin', label: 'Closing Time Passed warning card' },
  { key: 'section:dashboard.pending-summary',  tabHref: '/admin', label: 'Pending Work Summary panel' },
  { key: 'section:dashboard.incoming',         tabHref: '/admin', label: 'Incoming (Notify) panel' },
  { key: 'section:dashboard.my-picked-tasks',  tabHref: '/admin', label: 'My Picked Tasks panel' },
  { key: 'section:dashboard.pick-history',     tabHref: '/admin', label: 'Pick History panel' },
  { key: 'section:pick-history.delete',        tabHref: '/admin', label: 'Pick History: delete entries' },
  { key: 'section:shipment-entry.form',        tabHref: '/admin/shipment-entry', label: 'Shipment entry form' },
  { key: 'section:templates.manage',           tabHref: '/admin/templates', label: 'Template upload & fill' },
  { key: 'section:my-tasks.balance',           tabHref: '/admin/my-tasks', label: 'Balance panel' },
  { key: 'section:my-tasks.payments',          tabHref: '/admin/my-tasks', label: 'Payments panel' },
  { key: 'section:my-tasks.daily-cost',        tabHref: '/admin/my-tasks', label: 'Daily Cost entry' },
  { key: 'section:my-tasks.balance-update',    tabHref: '/admin/my-tasks', label: 'Balance deposit/top-up' },
  { key: 'section:documents-upload.upload',    tabHref: '/admin/documents-upload', label: 'Upload PDFs card' },
  { key: 'section:documents-upload.uploaded',  tabHref: '/admin/documents-upload', label: 'Uploaded list card' },
  { key: 'section:documents-upload.preview',   tabHref: '/admin/documents-upload', label: 'All Documents preview panel' },
  { key: 'section:documents-upload.admin-edit',tabHref: '/admin/documents-upload', label: 'Full Access Edit panel' },
  { key: 'section:settings.general',           tabHref: '/admin/settings', label: 'General Info tab' },
  { key: 'section:settings.database',          tabHref: '/admin/settings', label: 'Document Records tab' },
  { key: 'section:settings.logs',              tabHref: '/admin/settings', label: 'Login Logs tab' },
  { key: 'section:settings.credentials',       tabHref: '/admin/settings', label: 'Credentials tab' },
  { key: 'section:boat-note.invoice',          tabHref: '/admin/boat-note', label: 'Invoice panel' },
  { key: 'section:boat-note.packing-list',     tabHref: '/admin/boat-note', label: 'Packing List panel' },
  { key: 'section:boat-note.select-cusdec',    tabHref: '/admin/boat-note', label: 'Boat Note: Select CUSDEC card' },
  { key: 'section:boat-note.select-cdn',       tabHref: '/admin/boat-note', label: 'Boat Note: Select Containers card' },
  { key: 'section:boat-note.output',           tabHref: '/admin/boat-note', label: 'Boat Note: Download / Email card' },
  { key: 'section:boat-note.done',             tabHref: '/admin/boat-note', label: 'Done Boat Note archive tab' },
  { key: 'section:boat-note.cusdec-xml',       tabHref: '/admin/boat-note', label: 'Docs Create: Cusdec XML tab' },
  { key: 'section:boat-note.cdn-text',         tabHref: '/admin/boat-note', label: 'Docs Create: CDN Text tab' },
  { key: 'section:boat-note.parties-copy',     tabHref: '/admin/boat-note', label: "Docs Create: Party's Copy tab" },
  { key: 'section:database.cusdec',              tabHref: '/admin/database', label: 'CUSDEC table' },
  { key: 'section:database.cdn',                 tabHref: '/admin/database', label: 'CDN table' },
  { key: 'section:database.barcode',             tabHref: '/admin/database', label: 'Barcode table' },
  { key: 'section:database.boat_notes',          tabHref: '/admin/database', label: 'Boat Notes table' },
  { key: 'section:database.temporary_shipments', tabHref: '/admin/database', label: 'Shipment Entry table' },
  { key: 'section:database.uploaded_documents',  tabHref: '/admin/database', label: 'Uploaded Documents table' },
  { key: 'section:database.pdf_templates',       tabHref: '/admin/database', label: 'PDF Templates table' },
  { key: 'section:database.messages',            tabHref: '/admin/database', label: 'Messages table' },
  { key: 'section:database.profiles',            tabHref: '/admin/database', label: 'Users (Profiles) table' },
  { key: 'section:database.delete',              tabHref: '/admin/database', label: 'Delete/Restore/Purge rows' },
  { key: 'section:my-tasks.other-work',          tabHref: '/admin/my-tasks', label: 'Other Work panel' },
  { key: 'section:automation.xml-generator',       tabHref: '/admin/automation', label: 'Cusdec XML Generator' },
  { key: 'section:automation.cdn-text',             tabHref: '/admin/automation', label: 'CDN Text Extractor & Database' },
  { key: 'section:automation.barcode-enter',        tabHref: '/admin/automation', label: 'Barcode Enter' },
  { key: 'section:automation.trico-gate-pass',      tabHref: '/admin/automation', label: 'Trico Gate Passes' },
  { key: 'section:automation.data-updates',         tabHref: '/admin/automation', label: 'Data Updates' },
  { key: 'section:automation.boat-note-create',     tabHref: '/admin/automation', label: 'Boat Note Create' },
  { key: 'section:automation.boat-note-check',      tabHref: '/admin/automation', label: 'Boat Note Check' },
  { key: 'section:automation.export-release-check', tabHref: '/admin/automation', label: 'Export Release Check' },
  { key: 'section:automation.vessel-trigger',       tabHref: '/admin/automation', label: 'Vessel Triggers' },
  { key: 'section:automation.conflict-review',       tabHref: '/admin/automation', label: 'Conflict Review panel (admin)' },
  { key: 'section:automation.cdn-approval',          tabHref: '/admin/automation', label: 'CDN Approval (admin)' },
  { key: 'section:automation.notes',                tabHref: '/admin/automation', label: 'System Logic & Integration Notes' },
]

interface PermissionValue { isAdmin: boolean; has: (key: string) => boolean }
const PermissionContext = createContext<PermissionValue>({ isAdmin: false, has: () => false })
export function usePermission() { return useContext(PermissionContext) }

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [checking, setChecking]   = useState(true)
  const [isAdmin, setIsAdmin]     = useState(false)
  const [allowedTabs, setAllowedTabs] = useState<string[]>([])
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('theme') : null
    const isDark = saved === 'dark'
    setDark(isDark)
    document.documentElement.classList.toggle('dark', isDark)
  }, [])

  function toggleTheme() {
    setDark(d => {
      const next = !d
      document.documentElement.classList.toggle('dark', next)
      localStorage.setItem('theme', next ? 'dark' : 'light')
      return next
    })
  }

  useEffect(() => {
    let cancelled = false
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/'); return }
      const { data: prof } = await supabase.from('profiles').select('is_admin, allowed_tabs').eq('id', user.id).single()
      if (cancelled) return
      const admin = !!prof?.is_admin
      const allowed: string[] = prof?.allowed_tabs || []
      setIsAdmin(admin)
      setAllowedTabs(allowed)
      setChecking(false)
      if (!admin && allowed.length && !allowed.includes(router.pathname)) {
        router.replace(allowed[0])
      }
    }
    check()
    return () => { cancelled = true }
  }, [router.pathname])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader size={20} className="animate-spin text-gray-400"/>
      </div>
    )
  }

  if (!isAdmin && !allowedTabs.length) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-3 text-center px-6">
        <Shield size={28} className="text-gray-300"/>
        <p className="text-gray-600 text-sm font-medium">No tabs have been assigned to your account yet.</p>
        <p className="text-gray-400 text-xs">Ask an admin to grant you access from the Users page.</p>
        <button onClick={handleLogout} className="flex items-center gap-1 text-red-500 text-sm hover:text-red-600 mt-2">
          <LogOut size={14}/>Logout
        </button>
      </div>
    )
  }

  const visibleItems = isAdmin ? TAB_ITEMS : TAB_ITEMS.filter(t => allowedTabs.includes(t.href))
  const permValue: PermissionValue = { isAdmin, has: (key: string) => isAdmin || allowedTabs.includes(key) }

  return (
    <PermissionContext.Provider value={permValue}>
      <div className="flex min-h-screen">
        {/* Sidebar */}
        <aside className={`sidebar flex flex-col transition-all duration-300 ${collapsed ? 'w-16' : 'w-56'}`}>
          <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:'#22A87A'}}>
              <Ship size={16} color="white"/>
            </div>
            {!collapsed && <span className="text-white font-bold text-sm">Bastel Official System</span>}
          </div>

          <button onClick={() => setCollapsed(!collapsed)}
            className="flex items-center gap-3 px-3 py-2 mx-2 mt-2 rounded-lg text-sm text-blue-200 hover:bg-white/10 flex-shrink-0">
            {collapsed ? <ChevronRight size={18}/> : <ChevronLeft size={18}/>}
            {!collapsed && <span>Collapse</span>}
          </button>

          <button onClick={toggleTheme}
            className="flex items-center gap-3 px-3 py-2 mx-2 mt-1 rounded-lg text-sm text-blue-200 hover:bg-white/10 flex-shrink-0">
            {dark ? <Sun size={18}/> : <Moon size={18}/>}
            {!collapsed && <span>{dark ? 'Light Mode' : 'Dark Mode'}</span>}
          </button>

          <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
            {visibleItems.map(({href, icon: Icon, label}) => {
              const active = router.pathname === href
              return (
                <Link key={href} href={href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    active ? 'bg-brand-green text-white' : 'text-blue-100 hover:bg-white/10'
                  }`}>
                  <Icon size={18} className="flex-shrink-0"/>
                  {!collapsed && <span>{label}</span>}
                </Link>
              )
            })}
          </nav>

          {/* Trigger timestamps widget */}
          <TriggerTimestamps collapsed={collapsed}/>

          <SidebarClock collapsed={collapsed}/>

          <div className="p-2 border-t border-white/10 space-y-1">
            <Link href="/profile"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                router.pathname === '/profile' ? 'bg-brand-green text-white' : 'text-blue-100 hover:bg-white/10'
              }`}>
              <Users size={18} className="flex-shrink-0"/>
              {!collapsed && <span>My Profile</span>}
            </Link>
            <button onClick={handleLogout}
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-red-300 hover:bg-white/10">
              <LogOut size={18}/>
              {!collapsed && <span>Logout</span>}
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-auto bg-gray-50">
          {children}
        </main>
      </div>

      {/* Floating chat — always visible across all pages */}
      <FloatingChat/>
      {/* In-app notification bell */}
      <InAppNotifications/>
    </PermissionContext.Provider>
  )
}
