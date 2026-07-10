import { useState } from 'react'
import { X, Loader, Save, Mail, Bell, AlertTriangle } from 'lucide-react'
import { authHeader } from '@/lib/supabase'
import EmailPdfModal, { type EmailAttachment } from './EmailPdfModal'

// The Upload Docs "Send" workflow: Save is ticked by default (matches the
// old one-click Save behavior), Mail/Notify are opt-in. Nothing touches
// Drive or the main tables until this modal's Done is clicked — onSave only
// runs (persisting to Drive + uploaded_documents + the structured table)
// if the Save tick is still checked at that point.
export default function SendModal({ fileName, onSave, onGetDriveLink, onClose, onDone }: {
  fileName: string
  onSave: () => Promise<{ ok: boolean; driveLink?: string; error?: string }>
  onGetDriveLink: () => Promise<string>
  onClose: () => void
  onDone: () => void
}) {
  const [save, setSave] = useState(true)
  const [mail, setMail] = useState(false)
  const [notify, setNotify] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [emailAttachments, setEmailAttachments] = useState<EmailAttachment[] | null>(null)

  async function handleDone() {
    setBusy(true); setError('')
    try {
      let driveLink = ''
      if (save) {
        const r = await onSave()
        if (!r.ok) throw new Error(r.error || 'Save failed')
        driveLink = r.driveLink || ''
      } else if (mail || notify) {
        // Mail/Notify still need a real, viewable file even when Save is
        // unticked — upload to Drive without touching uploaded_documents or
        // the structured table.
        driveLink = await onGetDriveLink()
      }

      const docRes = await fetch('/api/document-uploads', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ file_name: fileName, drive_url: driveLink, is_saved_to_db: save }),
      })
      const doc = await docRes.json()
      if (!docRes.ok) throw new Error(doc.error || 'Could not record this send')

      if (notify && doc.document?.id) {
        await fetch('/api/dashboard-notifications', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
          body: JSON.stringify({ document_id: doc.document.id }),
        })
      }

      if (mail && driveLink) {
        setEmailAttachments([{ filename: fileName, url: driveLink }])
        return // EmailPdfModal takes over; onDone() fires when it's closed
      }

      onDone()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (emailAttachments) {
    return <EmailPdfModal attachments={emailAttachments} onClose={() => { setEmailAttachments(null); onDone() }}/>
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-bold text-gray-900">Send</h2>
          <button onClick={onClose}><X size={20}/></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-gray-500 truncate">{fileName}</p>
          <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 cursor-pointer hover:bg-gray-50">
            <input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} className="w-4 h-4"/>
            <Save size={15} className="text-gray-500"/>
            <span className="text-sm text-gray-800">Save (to Drive + Database)</span>
          </label>
          <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 cursor-pointer hover:bg-gray-50">
            <input type="checkbox" checked={mail} onChange={e => setMail(e.target.checked)} className="w-4 h-4"/>
            <Mail size={15} className="text-gray-500"/>
            <span className="text-sm text-gray-800">Mail</span>
          </label>
          <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 cursor-pointer hover:bg-gray-50">
            <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} className="w-4 h-4"/>
            <Bell size={15} className="text-gray-500"/>
            <span className="text-sm text-gray-800">Notify (everyone's Dashboard)</span>
          </label>
          {error && <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle size={13}/>{error}</p>}
        </div>
        <div className="flex gap-3 p-5 border-t">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={handleDone} disabled={busy || (!save && !mail && !notify)} className="btn-primary flex-1 flex items-center justify-center gap-2">
            {busy ? <Loader size={14} className="animate-spin"/> : null}Done
          </button>
        </div>
      </div>
    </div>
  )
}
