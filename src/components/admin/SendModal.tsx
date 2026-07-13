import { useState } from 'react'
import { X, Loader, Save, Mail, Bell, AlertTriangle } from 'lucide-react'
import { authHeader } from '@/lib/supabase'
import EmailPdfModal, { type EmailAttachment } from './EmailPdfModal'

export interface SendResultFile { fileName: string; driveLink: string }

// The Upload Docs "Send" workflow: Save is ticked by default (matches the
// old one-click Save behavior), Mail/Notify are opt-in. Nothing touches
// Drive or the main tables until this modal's Done is clicked — onSave only
// runs (persisting to Drive + uploaded_documents + the structured table)
// if the Save tick is still checked at that point. Works for one file or a
// whole "Send All" batch — each file still gets its own document_uploads
// row (so Notify/Pick tracks them individually), but a batch Mail sends
// everything in one message.
const REASON_OPTIONS = ['', 'CUSDEC Passed', 'Container Moved', 'Boat Note Passed', 'Other']

export default function SendModal({ label, uploaderName, onSave, onGetDriveLinks, onClose, onDone }: {
  label: string
  uploaderName?: string
  onSave: () => Promise<{ ok: boolean; results?: SendResultFile[]; error?: string }>
  onGetDriveLinks: () => Promise<SendResultFile[]>
  onClose: () => void
  onDone: () => void
}) {
  const [save, setSave] = useState(true)
  const [mail, setMail] = useState(false)
  const [notify, setNotify] = useState(false)
  const [busy, setBusy] = useState(false)
  // An additional tag on top of Save/Mail/Notify — "CUSDEC Passed" forces
  // Notify on (everyone should see it). Save stays a real, independent
  // choice: if left unticked this send is temporary (Drive + Notify only,
  // no structured-table save) and gets deleted the moment whoever picks it
  // does Mail/Download (see delete-reason-document.ts + My Picked Tasks) —
  // but if Save is ticked, it goes through the normal Save pipeline (Drive +
  // the structured table, with the usual duplicate-match/replace flow) and
  // is no longer temporary. Every other reason is just a label on an
  // otherwise completely normal send.
  const [reason, setReason] = useState('')
  const [reasonNote, setReasonNote] = useState('')
  const isTemporaryReason = reason === 'CUSDEC Passed'

  // Notify requires Save (you can't let people Pick something that was never
  // actually persisted) — Mail has no such requirement. Ticking Notify forces
  // Save on and locks it; unticking Notify frees Save again. Doesn't apply
  // when reason is CUSDEC Passed — Notify there is already forced on by the
  // reason itself, independent of whatever Save is set to.
  function setNotifyChecked(checked: boolean) {
    setNotify(checked)
    if (checked && !isTemporaryReason) setSave(true)
  }
  // Save has its own default (ticked) that carries over from whatever it was
  // before — but "CUSDEC Passed" specifically means "temporary unless I say
  // otherwise", so picking that reason resets Save to unticked instead of
  // leaving it on from the default. The user still has full control to tick
  // it back on right after; this only changes what it starts as.
  function setReasonChecked(value: string) {
    setReason(value)
    if (value === 'CUSDEC Passed') setSave(false)
  }
  const [error, setError] = useState('')
  const [emailAttachments, setEmailAttachments] = useState<EmailAttachment[] | null>(null)

  async function handleDone() {
    if (reason === 'Other' && !reasonNote.trim()) { setError('Type a reason for "Other"'); return }
    setBusy(true); setError('')
    try {
      let files: SendResultFile[] = []
      const effectiveSave = save
      const effectiveNotify = notify || isTemporaryReason
      if (effectiveSave) {
        const r = await onSave()
        if (!r.ok) throw new Error(r.error || 'Save failed')
        files = r.results || []
      } else if (mail || effectiveNotify) {
        // Mail/Notify still need a real, viewable file even when Save is
        // unticked — upload to Drive without touching uploaded_documents or
        // the structured table.
        files = await onGetDriveLinks()
      }

      // One file's bookkeeping doesn't depend on another's — running them
      // together instead of one-at-a-time is most of what made "Done" feel
      // slow on a multi-file Send All.
      const auth = await authHeader()
      await Promise.all(files.filter(f => f.driveLink).map(f =>
        fetch('/api/document-uploads', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
          body: JSON.stringify({
            file_name: f.fileName, drive_url: f.driveLink, is_saved_to_db: effectiveSave, notify: effectiveNotify, uploaded_by_name: uploaderName,
            reason: reason || undefined, reason_note: reason === 'Other' ? reasonNote.trim() : undefined,
          }),
        })
      ))

      if (mail && files.length) {
        setEmailAttachments(files.map(f => ({ filename: f.fileName, url: f.driveLink })))
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
          {/* Closing this while busy used to silently swallow the Mail step —
              handleDone's setEmailAttachments landed on an already-unmounted
              modal, so the Mail window that should've popped up right after
              Save finished just never appeared. Disabled instead of hidden,
              so it's clear this is temporary, not gone. */}
          <button onClick={onClose} disabled={busy}><X size={20} className={busy ? 'opacity-30' : ''}/></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-gray-500 truncate">{label}</p>
          <label className={`flex items-center gap-3 p-3 rounded-lg border border-gray-100 ${notify ? 'opacity-60' : 'cursor-pointer hover:bg-gray-50'}`}>
            <input type="checkbox" checked={save} disabled={notify && !isTemporaryReason} onChange={e => setSave(e.target.checked)} className="w-4 h-4"/>
            <Save size={15} className="text-gray-500"/>
            <span className="text-sm text-gray-800">Save (to Drive + Database)</span>
          </label>
          <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 cursor-pointer hover:bg-gray-50">
            <input type="checkbox" checked={mail} onChange={e => setMail(e.target.checked)} className="w-4 h-4"/>
            <Mail size={15} className="text-gray-500"/>
            <span className="text-sm text-gray-800">Mail</span>
          </label>
          <label className={`flex items-center gap-3 p-3 rounded-lg border border-gray-100 ${isTemporaryReason ? 'opacity-60' : 'cursor-pointer hover:bg-gray-50'}`}>
            <input type="checkbox" checked={notify || isTemporaryReason} disabled={isTemporaryReason} onChange={e => setNotifyChecked(e.target.checked)} className="w-4 h-4"/>
            <Bell size={15} className="text-gray-500"/>
            <span className="text-sm text-gray-800">Notify (everyone's Dashboard)</span>
          </label>
          {notify && !isTemporaryReason && <p className="text-[11px] text-gray-400 -mt-1">Notify requires Save — locked on while Notify is ticked.</p>}
          {isTemporaryReason && <p className="text-[11px] text-gray-400 -mt-1">Notify is always on for "CUSDEC Passed".</p>}

          <div className="pt-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Reason (optional)</label>
            <select value={reason} onChange={e => setReasonChecked(e.target.value)} className="input text-sm">
              {REASON_OPTIONS.map(r => <option key={r} value={r}>{r || '— None —'}</option>)}
            </select>
            {reason === 'Other' && (
              <input value={reasonNote} onChange={e => setReasonNote(e.target.value)} placeholder="Type the reason..." className="input text-sm mt-1.5"/>
            )}
            {isTemporaryReason && (
              save ? (
                <p className="text-[11px] text-gray-500 mt-1.5">Save is ticked — this will be saved to Drive + the database like a normal document, and won't be deleted after Mail/Download.</p>
              ) : (
                <p className="text-[11px] text-amber-600 mt-1.5">"CUSDEC Passed" sends this to Drive + Notify only (tick Save above to also save it to the database) — if Save stays off, it gets deleted the moment whoever picks it does Mail/Download.</p>
              )
            )}
          </div>

          {error && <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle size={13}/>{error}</p>}
        </div>
        <div className="flex gap-3 p-5 border-t">
          <button onClick={onClose} disabled={busy} className="btn-secondary flex-1 disabled:opacity-50">Cancel</button>
          <button onClick={handleDone} disabled={busy || (!save && !mail && !notify && !isTemporaryReason)} className="btn-primary flex-1 flex items-center justify-center gap-2">
            {busy ? <Loader size={14} className="animate-spin"/> : null}Done
          </button>
        </div>
      </div>
    </div>
  )
}
