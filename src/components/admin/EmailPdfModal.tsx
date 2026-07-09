import { useEffect, useState } from 'react'
import { Mail, X, Loader, AlertTriangle } from 'lucide-react'

export interface EmailAttachment { filename: string; url: string }

// Shared "email this PDF" popup — used from Upload Docs (right after save,
// and again later from the Uploaded/Preview list if the first send didn't
// happen), and from Shipment Overview's document picker. Always sends via
// the docs.bastel@gmail.com mailbox (useDocsAccount), and remembers both the
// recipient (saved_recipients) and the last subject used (email_settings)
// so neither has to be retyped next time.
export default function EmailPdfModal({ attachments, defaultSubject, onClose }: {
  attachments: EmailAttachment[]
  defaultSubject?: string
  onClose: () => void
}) {
  const [emails, setEmails] = useState<string[]>([])
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState(defaultSubject || '')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    fetch('/api/saved-recipients').then(r => r.json()).then(d => setEmails(d.emails || [])).catch(() => {})
    if (!defaultSubject) {
      fetch('/api/email-settings').then(r => r.json()).then(d => { if (d.lastSubject) setSubject(d.lastSubject) }).catch(() => {})
    }
  }, [defaultSubject])

  async function send() {
    if (!to.trim() || !subject.trim()) return
    setSending(true); setError('')
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim(), subject: subject.trim(), body, attachments, useDocsAccount: true }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      fetch('/api/saved-recipients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: to.trim() }) }).catch(() => {})
      fetch('/api/email-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lastSubject: subject.trim() }) }).catch(() => {})
      setSent(true)
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
            <p className="text-sm text-green-600">✓ Sent to {to}</p>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                <input value={to} onChange={e => setTo(e.target.value)} list="saved-recipient-emails" placeholder="recipient@email.com"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
                <datalist id="saved-recipient-emails">{emails.map(e => <option key={e} value={e}/>)}</datalist>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
                <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Message (optional)</label>
                <textarea value={body} onChange={e => setBody(e.target.value)} rows={4} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
              </div>
              <p className="text-xs text-gray-400">Attaching: {attachments.map(a => a.filename).join(', ')}</p>
              {error && <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle size={13}/>{error}</p>}
            </>
          )}
        </div>
        <div className="flex gap-3 p-5 border-t">
          <button onClick={onClose} className="btn-secondary flex-1">{sent ? 'Close' : 'Cancel'}</button>
          {!sent && (
            <button onClick={send} disabled={sending || !to.trim() || !subject.trim()} className="btn-primary flex-1 flex items-center justify-center gap-2">
              {sending ? <Loader size={14} className="animate-spin"/> : <Mail size={14}/>}Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
