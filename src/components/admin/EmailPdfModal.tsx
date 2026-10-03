import { useEffect, useState } from 'react'
import { Mail, X, Loader, AlertTriangle, BookUser, Trash2, Plus } from 'lucide-react'
import { authHeader, supabase } from '@/lib/supabase'

export interface EmailAttachment {
  filename: string
  url: string
  // Optional — the PDF's bytes (base64), for a file that isn't stored
  // anywhere (a Mail-only send with nothing saved) or when the caller would
  // rather not depend on the Drive link being downloadable. send-email.ts
  // uses this first and only falls back to `url` when it's missing.
  base64?: string
  // Optional — lets a caller hand over a file that should still be listed
  // (so it's visible and can be added back with one tap) but not selected
  // to send by default. Used for batch Save/Mail/Notify sends where some of
  // the files were duplicate-replaces: Notify already skips those
  // automatically, and Mail should default to the same set while still
  // letting the person tick a duplicate back on if they actually want it
  // mailed. Missing/undefined behaves exactly like `true` (today's default).
  checkedByDefault?: boolean
}

type RecipientKind = 'to' | 'cc' | 'bcc'
interface SavedRecipient { id: string; email: string; kind: RecipientKind }
const KIND_LABEL: Record<RecipientKind, string> = { to: 'To', cc: 'Cc', bcc: 'Bcc' }
const splitAddresses = (s: string) => s.split(/[;,]/).map(e => e.trim()).filter(Boolean)

// Shared "email this PDF" popup — used from Upload Docs (right after save,
// and again later from the Uploaded/Preview list if the first send didn't
// happen), and from Shipment Overview's document picker. Always sends via
// the docs.bastel@gmail.com mailbox (useDocsAccount), and remembers both the
// recipients (user_saved_recipients — private per user, remembered as
// To / Cc / Bcc) and the last subject used (email_settings) so neither has
// to be retyped next time. "To" accepts more than one address
// (comma-separated), plus CC/BCC.
export default function EmailPdfModal({ attachments, defaultSubject, documentReason, documentReasonNote, onClose, onSent }: {
  attachments: EmailAttachment[]
  defaultSubject?: string
  documentReason?: string | null
  documentReasonNote?: string | null
  onClose: () => void
  onSent?: () => void
}) {
  // Saved mails are per user (see /api/saved-recipients) — only this user's own
  // addresses ever show up here, each remembered with its To / Cc / Bcc slot.
  const [saved, setSaved] = useState<SavedRecipient[]>([])
  const [showSaved, setShowSaved] = useState(false)
  const [newSavedEmail, setNewSavedEmail] = useState('')
  const [newSavedKind, setNewSavedKind] = useState<RecipientKind>('to')
  const [savedError, setSavedError] = useState('')
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [showCcBcc, setShowCcBcc] = useState(false)
  const [subject, setSubject] = useState(defaultSubject || '')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  // Which of the passed-in attachments actually go out — defaults to all of
  // them, but a batch send hands this modal every file it just saved, and
  // the person may want to mail only some of those right now.
  const [included, setIncluded] = useState<boolean[]>(() => attachments.map(a => a.checkedByDefault !== false))
  const selectedAttachments = attachments.filter((_, i) => included[i])

  useEffect(() => {
    loadSaved()
    if (!defaultSubject) {
      // Subject is "<sender name> - <document reason>" when the caller knows
      // why this document was sent (e.g. "CUSDEC Passed", picked from the
      // reason typed at upload time) — that's a far more useful default than
      // whatever subject line happened to be typed last time. Falls back to
      // just the sender's name when no reason is available for this send.
      supabase.auth.getUser().then(async ({ data: { user } }) => {
        if (!user) return ''
        const { data } = await supabase.from('profiles').select('username, full_name').eq('id', user.id).single()
        return data?.full_name || data?.username || ''
      }).catch(() => '').then(name => {
        const reasonText = documentReason ? `${documentReason}${documentReasonNote ? ` (${documentReasonNote})` : ''}` : ''
        setSubject(reasonText ? (name ? `${name} - ${reasonText}` : reasonText) : name)
      })
    }
  }, [defaultSubject, documentReason, documentReasonNote])

  async function loadSaved() {
    try {
      const r = await fetch('/api/saved-recipients', { headers: await authHeader() })
      const d = await r.json()
      setSaved(d.recipients || [])
    } catch { /* suggestions are optional */ }
  }

  function fieldValue(kind: RecipientKind) { return kind === 'to' ? to : kind === 'cc' ? cc : bcc }
  function setField(kind: RecipientKind, v: string) { (kind === 'to' ? setTo : kind === 'cc' ? setCc : setBcc)(v) }

  // Adds saved address(es) into the matching field without duplicating one
  // that is already typed there.
  function addToField(kind: RecipientKind, emails: string[]) {
    const current = splitAddresses(fieldValue(kind))
    const have = new Set(current.map(e => e.toLowerCase()))
    const merged = [...current, ...emails.filter(e => !have.has(e.toLowerCase()))]
    setField(kind, merged.join(', '))
    if (kind !== 'to') setShowCcBcc(true)
  }

  async function addSavedManually() {
    const email = newSavedEmail.trim()
    if (!email) return
    setSavedError('')
    try {
      const r = await fetch('/api/saved-recipients', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ email, kind: newSavedKind }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setNewSavedEmail('')
      loadSaved()
    } catch (e: any) { setSavedError(e.message) }
  }

  async function removeSaved(id: string) {
    setSaved(prev => prev.filter(s => s.id !== id))
    try { await fetch(`/api/saved-recipients?id=${id}`, { method: 'DELETE', headers: await authHeader() }) } catch { /* ignore */ }
  }

  async function send() {
    const toAddr = to.trim()
    if (!toAddr || !subject.trim() || !selectedAttachments.length) return
    setSending(true); setError('')
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ to: toAddr, cc: cc.trim() || undefined, bcc: bcc.trim() || undefined, subject: subject.trim(), body, attachments: selectedAttachments, useDocsAccount: true }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      // Remember each address for THIS user, in the slot it was used in
      // (To / Cc / Bcc) — saved automatically, one row per address.
      const entries = ([['to', toAddr], ['cc', cc], ['bcc', bcc]] as [RecipientKind, string][])
        .flatMap(([kind, value]) => splitAddresses(value).map(email => ({ email, kind })))
      if (entries.length) {
        authHeader().then(h => fetch('/api/saved-recipients', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify({ entries }) }))
          .then(() => loadSaved()).catch(() => {})
      }
      authHeader().then(h => fetch('/api/email-settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify({ lastSubject: subject.trim() }) })).catch(() => {})
      setSent(true)
      onSent?.()
    } catch (e: any) { setError(e.message) }
    finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-bold text-gray-900 flex items-center gap-2"><Mail size={16}/>Email Document{attachments.length > 1 ? 's' : ''}</h2>
          <button onClick={onClose}><X size={20}/></button>
        </div>
        <div className="p-5 space-y-3">
          {sent ? (
            <p className="text-sm text-green-600">✓ Sent {selectedAttachments.length} file{selectedAttachments.length !== 1 ? 's' : ''} to {to}</p>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">To <span className="text-gray-400 font-normal">(comma-separate for more than one)</span></label>
                <input value={to} onChange={e => setTo(e.target.value)} placeholder="recipient@email.com, another@email.com"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
              </div>
              <div>
                <button type="button" onClick={() => setShowSaved(s => !s)} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                  <BookUser size={12}/>Saved mails ({saved.length}) {showSaved ? '▲' : '▼'}
                </button>
                {showSaved && (
                  <div className="mt-2 border border-gray-200 rounded-lg p-3 space-y-3 bg-gray-50">
                    {(['to', 'cc', 'bcc'] as RecipientKind[]).map(kind => {
                      const list = saved.filter(s => s.kind === kind)
                      return (
                        <div key={kind}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-semibold text-gray-600">{KIND_LABEL[kind]}</span>
                            {list.length > 1 && (
                              <button type="button" onClick={() => addToField(kind, list.map(s => s.email))} className="text-[11px] text-blue-600 hover:underline">Use all</button>
                            )}
                          </div>
                          {list.length === 0 ? (
                            <p className="text-[11px] text-gray-400">Nothing saved for {KIND_LABEL[kind]} yet — addresses you send to are saved here automatically.</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {list.map(s => (
                                <span key={s.id} className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-full pl-2.5 pr-1.5 py-0.5 text-xs">
                                  <button type="button" onClick={() => addToField(kind, [s.email])} className="hover:text-blue-600">{s.email}</button>
                                  <button type="button" onClick={() => removeSaved(s.id)} title="Remove from saved" className="text-gray-300 hover:text-red-500"><Trash2 size={11}/></button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                    <div className="flex gap-2 pt-2 border-t border-gray-200">
                      <input value={newSavedEmail} onChange={e => setNewSavedEmail(e.target.value)} placeholder="Save an address..."
                        className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-400"/>
                      <select value={newSavedKind} onChange={e => setNewSavedKind(e.target.value as RecipientKind)} className="border border-gray-200 rounded-lg px-1 py-1 text-xs">
                        <option value="to">To</option><option value="cc">Cc</option><option value="bcc">Bcc</option>
                      </select>
                      <button type="button" onClick={addSavedManually} disabled={!newSavedEmail.trim()} className="px-2 rounded-lg bg-gray-900 text-white text-xs disabled:opacity-40"><Plus size={13}/></button>
                    </div>
                    {savedError && <p className="text-[11px] text-red-600">{savedError}</p>}
                  </div>
                )}
              </div>
              {!showCcBcc ? (
                <button onClick={() => setShowCcBcc(true)} className="text-xs text-blue-600 hover:underline">+ Cc / Bcc</button>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Cc</label>
                    <input value={cc} onChange={e => setCc(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Bcc</label>
                    <input value={bcc} onChange={e => setBcc(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
                  </div>
                </>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
                <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Message (optional)</label>
                <textarea value={body} onChange={e => setBody(e.target.value)} rows={4} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Attaching ({selectedAttachments.length}/{attachments.length})</label>
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                  {attachments.map((a, i) => (
                    <label key={a.filename + i} className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" checked={included[i]} onChange={e => setIncluded(prev => prev.map((v, j) => j === i ? e.target.checked : v))} className="w-3.5 h-3.5"/>
                      <span className={included[i] ? 'text-gray-700' : 'text-gray-400 line-through'}>{a.filename}</span>
                    </label>
                  ))}
                </div>
                {!selectedAttachments.length && <p className="text-[11px] text-red-600 mt-1">Pick at least one file to mail.</p>}
              </div>
              {error && <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle size={13}/>{error}</p>}
            </>
          )}
        </div>
        <div className="flex gap-3 p-5 border-t">
          <button onClick={onClose} className="btn-secondary flex-1">{sent ? 'Close' : 'Cancel'}</button>
          {!sent && (
            <button onClick={send} disabled={sending || !to.trim() || !subject.trim() || !selectedAttachments.length} className="btn-primary flex-1 flex items-center justify-center gap-2">
              {sending ? <Loader size={14} className="animate-spin"/> : <Mail size={14}/>}Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}