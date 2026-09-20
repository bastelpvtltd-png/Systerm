import { useState, useEffect, useRef } from 'react'
import { X, Loader, Save, Mail, Bell, AlertTriangle, Link2 } from 'lucide-react'
import { authHeader } from '@/lib/supabase'
import EmailPdfModal, { type EmailAttachment } from './EmailPdfModal'

export interface SendResultFile { fileName: string; driveLink: string; docType?: string; cusdecId?: string }

// The Upload Docs "Send" workflow: Save is ticked by default (matches the
// old one-click Save behavior), Mail/Notify are opt-in. Nothing touches
// Drive or the main tables until this modal's Done is clicked — onSave only
// runs (persisting to Drive + uploaded_documents + the structured table)
// if the Save tick is still checked at that point. Works for one file or a
// whole "Send All" batch — each file still gets its own document_uploads
// row (so Notify/Pick tracks them individually), but a batch Mail sends
// everything in one message.
const REASON_OPTIONS = ['', 'CUSDEC Passed', 'Container Moved', 'Boat Note Passed', 'Final Document', 'Other']

export default function SendModal({ label, uploaderName, docType, cusdecId, cusdecNumber, onSave, onGetDriveLinks, onGetMailFiles, onClose, onDone, notifyDisabled, notifyDisabledReason, hideSaveAndNotify, restrictToSaveOnly, requireReason }: {
  label: string
  uploaderName?: string
  docType?: string
  // Manual Entry has no CUSDEC to save the Drive link against (Save writes
  // to cusdec_document_links, which needs a cusdec_id) — Download already
  // works independently of this modal, so only Mail makes sense here.
  hideSaveAndNotify?: boolean
  // Only known when the caller is in Database mode with a CUSDEC picked —
  // lets a "Final Document" send create its pending-approval task (see
  // final_document_tasks). Reason-tagged sends with no CUSDEC (Manual
  // Entry) just skip that — there's nothing to attach the task to.
  cusdecId?: string
  cusdecNumber?: string
  onSave: (referenceOverride?: string, choices?: { save: boolean; mail: boolean; notify: boolean; reason: string; reasonNote: string }) => Promise<{ ok: boolean; results?: SendResultFile[]; error?: string }>
  onGetDriveLinks: () => Promise<SendResultFile[]>
  // Optional. When given, a Mail-only send with nothing saved (Save and
  // Notify both off) attaches the PDF bytes straight to the email instead of
  // uploading a temporary copy to Drive — nothing is stored anywhere, so there
  // is no temporary file to clean up afterwards, and the recipient always
  // gets the real file (not a Drive web page). Callers that don't pass it keep
  // the old Drive-link behaviour.
  onGetMailFiles?: () => Promise<{ filename: string; base64: string }[]>
  onClose: () => void
  // Fires once this Send is truly finished — Save + Mail + Notify all done
  // (or skipped). Carries the files that actually went all the way through,
  // so the caller (Upload Docs) can auto-clear exactly those from its list
  // instead of leaving them sitting there until someone clicks Delete All.
  // A batch send that defers some files for retry passes an empty array
  // here — those files aren't done yet, so nothing should be cleared until
  // the deferred pass (elsewhere) actually finishes them.
  onDone: (files?: SendResultFile[]) => void
  // Lets a caller with its own business rules (e.g. Party's Copy: no
  // notifying once the CUSDEC is Green/Blue, or once a link is already
  // saved) lock Notify off without forking this modal.
  notifyDisabled?: boolean
  notifyDisabledReason?: string
  // This Send panel is reopened purely to fix-and-resave a file that's
  // already sitting on an error (a format warning, a duplicate, a CAP
  // conflict) — Mail/Notify/Reason are hidden, only Save runs. Ticking
  // Mail/Notify here on top of what the original Send (or the batch this
  // file belongs to) already has pending would send/notify that one file
  // twice, so this isn't a real choice at this point — just a retry.
  restrictToSaveOnly?: boolean
  // Upload Docs' Send flow wants Reason picked every time, not left at
  // "— None —" — other callers of this modal don't ask for this, so it
  // defaults off.
  requireReason?: boolean
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
  // Only shown for "CUSDEC Passed" — the Save tick is the only thing that
  // decides whether this is a real save, never overridden automatically.
  // Reference only does anything when Save is also ticked: picking an open
  // Shipment Entry here merges the save into that entry too (see
  // matchAndMergeShipment) instead of standing alone. Off by default (a
  // toggle, not always shown) since most CUSDEC Passed sends aren't tied to
  // one — one Shipment Entry only ever matches one CUSDEC, so once it's
  // picked and merged it disappears from this list for everyone else.
  const [useReference, setUseReference] = useState(false)
  const [reference, setReference] = useState('')
  const [shipments, setShipments] = useState<{ id: string; reference: string; shipper: string; invoice_number: string }[]>([])
  const isCusdecPassed = reason === 'CUSDEC Passed'

  useEffect(() => {
    if (!useReference) return
    authHeader().then(h => fetch('/api/temp-shipments', { headers: h }))
      .then(r => r.json())
      .then(d => setShipments((d.shipments || []).filter((s: any) => s.reference)))
      .catch(() => {})
  }, [useReference])

  // Some reasons tick (and thereby lock) Save/Notify for you. That lock must
  // follow the reason, not stick around: remember what the ticks were before a
  // forcing reason took over, and put them back the moment a reason that
  // doesn't force anything is picked (Boat Note Passed, Other, None...). A
  // tick the person changes by hand afterwards is theirs — it's kept.
  const preForce = useRef<{ save: boolean; notify: boolean } | null>(null)
  function setNotifyChecked(checked: boolean) {
    preForce.current = null
    setNotify(checked)
    if (checked) setSave(true)
  }
  function setReasonChecked(value: string) {
    const forcing = value === 'CUSDEC Passed' || value === 'Container Moved' || value === 'Final Document'
    if (forcing && !preForce.current) preForce.current = { save, notify }
    if (!forcing && preForce.current) {
      setSave(preForce.current.save); setNotify(preForce.current.notify)
      preForce.current = null
    }
    setReason(value)
    if (value === 'CUSDEC Passed') {
      setSave(true)
    } else {
      setUseReference(false); setReference('')
      if (value === 'Container Moved' || value === 'Final Document') { setNotify(true); setSave(true) }
    }
  }
  const [error, setError] = useState('')
  const [emailAttachments, setEmailAttachments] = useState<EmailAttachment[] | null>(null)

  async function handleDone() {
    if (!restrictToSaveOnly && requireReason && !reason) { setError('Pick a Reason before sending'); return }
    if (reason === 'Other' && !reasonNote.trim()) { setError('Type a reason for "Other"'); return }
    setBusy(true); setError('')
    try {
      let files: SendResultFile[] = []
      // Save is exactly what the Save tick says — an unticked Save never
      // touches the database (so no duplicate check either), even for CUSDEC
      // Passed. Notify only works for a saved file, so Notify wanted with Save
      // unticked is an error shown right here in this panel (it stays open):
      // tick Save to notify, or drop Notify to send by Mail only.
      const wantsNotify = !restrictToSaveOnly && (notify || isCusdecPassed) && !notifyDisabled
      if (!restrictToSaveOnly && !hideSaveAndNotify && !save && wantsNotify) {
        setError(isCusdecPassed
          ? "Notify can't be done without Save — tick Save as well to notify. (Notify is always on for CUSDEC Passed; pick another Reason for a Mail-only send.)"
          : "Notify can't be done without Save — tick Save as well to notify, or untick Notify to send by Mail only.")
        return
      }
      const effectiveSave = save
      const effectiveMail = restrictToSaveOnly ? false : mail
      const effectiveNotify = wantsNotify
      let matchedReference: string | undefined
      if (effectiveSave && !restrictToSaveOnly && isCusdecPassed && reference.trim()) {
        try {
          const r = await fetch(`/api/temp-shipments?reference=${encodeURIComponent(reference.trim())}`, { headers: await authHeader() })
          const d = await r.json()
          if (r.ok && d.shipments?.length) matchedReference = reference.trim()
        } catch { /* lookup failure just falls through — saves without a shipment merge */ }
      }
      if (effectiveSave) {
        const r = await onSave(matchedReference, { save: effectiveSave, mail: effectiveMail, notify: effectiveNotify, reason: restrictToSaveOnly ? '' : reason, reasonNote: restrictToSaveOnly ? '' : reasonNote })
        if (!r.ok) throw new Error(r.error || 'Save failed')
        files = r.results || []
      } else if (effectiveMail && !effectiveNotify && onGetMailFiles) {
        // Mail only, nothing saved: the PDF goes straight onto the email —
        // no Drive upload, no database row, so nothing is left behind to
        // delete once the mail is out.
        const mailFiles = await onGetMailFiles()
        if (!mailFiles.length) throw new Error('Nothing to mail')
        setEmailAttachments(mailFiles.map(f => ({ filename: f.filename, url: '', base64: f.base64 })))
        return // EmailPdfModal takes over; onDone fires when it's closed
      } else if (effectiveMail || effectiveNotify) {
        // Mail/Notify still need a real, viewable file even when Save is
        // unticked — upload to Drive without touching uploaded_documents or
        // the structured table.
        files = await onGetDriveLinks()
      }

      // One file's bookkeeping doesn't depend on another's — running them
      // together instead of one-at-a-time is most of what made "Done" feel
      // slow on a multi-file Send All.
      // (Skipped entirely when there is nothing to register — e.g. Upload Docs'
      // background Send returns no files — so Done closes this panel at once
      // instead of waiting on an auth round-trip it doesn't need.)
      const registerable = files.filter(f => f.driveLink)
      const auth = registerable.length ? await authHeader() : {}
      await Promise.all(registerable.map(f =>
        fetch('/api/document-uploads', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
          body: JSON.stringify({
            file_name: f.fileName, drive_url: f.driveLink, is_saved_to_db: effectiveSave, notify: effectiveNotify, uploaded_by_name: uploaderName,
            reason: restrictToSaveOnly ? undefined : (reason || undefined), reason_note: !restrictToSaveOnly && reason === 'Other' ? reasonNote.trim() : undefined,
            doc_type: f.docType || docType || undefined,
            // f.cusdecId (the row this specific file's Save just created/matched)
            // is only known per-file for a fresh upload — the cusdecId PROP is
            // only ever populated by callers already working an existing saved
            // CUSDEC (e.g. Database mode's Party's Copy), not Upload Docs' own
            // Save flow, so prefer the per-file id when both are present.
            cusdec_id: f.cusdecId || cusdecId || undefined, cusdec_number: cusdecNumber || undefined,
          }),
        })
      ))

      if (effectiveMail && files.length) {
        setEmailAttachments(files.map(f => ({ filename: f.fileName, url: f.driveLink })))
        return // EmailPdfModal takes over; onDone(files) fires when it's closed
      }

      onDone(files)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (emailAttachments) {
    return (
      <EmailPdfModal attachments={emailAttachments}
        documentReason={reason || undefined} documentReasonNote={reason === 'Other' ? reasonNote : undefined}
        onClose={() => { const done = emailAttachments.map(a => ({ fileName: a.filename, driveLink: a.url })); setEmailAttachments(null); onDone(done) }}/>
    )
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
          {restrictToSaveOnly && (
            <p className="text-[11px] text-amber-600 -mt-1">Fixing a save error — this just retries Save for this file. The Reason / Mail / Notify you already chose will run automatically once it (and the rest of its batch) is saved.</p>
          )}
          {!hideSaveAndNotify && (
            <label className={`flex items-center gap-3 p-3 rounded-lg border border-gray-100 ${notify ? 'opacity-60' : 'cursor-pointer hover:bg-gray-50'}`}>
              <input type="checkbox" checked={save} disabled={notify} onChange={e => { preForce.current = null; setSave(e.target.checked) }} className="w-4 h-4"/>
              <Save size={15} className="text-gray-500"/>
              <span className="text-sm text-gray-800">Save (to Drive + Database)</span>
            </label>
          )}
          {!restrictToSaveOnly && (
            <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 cursor-pointer hover:bg-gray-50">
              <input type="checkbox" checked={mail} onChange={e => setMail(e.target.checked)} className="w-4 h-4"/>
              <Mail size={15} className="text-gray-500"/>
              <span className="text-sm text-gray-800">Mail</span>
            </label>
          )}
          {!hideSaveAndNotify && !restrictToSaveOnly && (
            <>
              <label className={`flex items-center gap-3 p-3 rounded-lg border border-gray-100 ${(isCusdecPassed || notifyDisabled) ? 'opacity-60' : 'cursor-pointer hover:bg-gray-50'}`}>
                <input type="checkbox" checked={(notify || isCusdecPassed) && !notifyDisabled} disabled={isCusdecPassed || notifyDisabled} onChange={e => setNotifyChecked(e.target.checked)} className="w-4 h-4"/>
                <Bell size={15} className="text-gray-500"/>
                <span className="text-sm text-gray-800">Notify (everyone's Dashboard)</span>
              </label>
              {notifyDisabled && <p className="text-[11px] text-amber-600 -mt-1">{notifyDisabledReason || 'Notify is not available for this item.'}</p>}
              {!notifyDisabled && notify && !isCusdecPassed && <p className="text-[11px] text-gray-400 -mt-1">Notify requires Save — locked on while Notify is ticked.</p>}
              {!notifyDisabled && isCusdecPassed && <p className="text-[11px] text-green-600 -mt-1">CUSDEC Passed — Notify is on, and Notify needs Save, so keep Save ticked.</p>}
              {!notifyDisabled && !save && (notify || isCusdecPassed) && <p className="text-[11px] text-red-600 -mt-1">Notify can't be done without Save — tick Save first.</p>}
            </>
          )}

          {!restrictToSaveOnly && (
          <div className="pt-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Reason{requireReason ? ' (required)' : ' (optional)'}</label>
            <select value={reason} onChange={e => setReasonChecked(e.target.value)} className="input text-sm">
              {REASON_OPTIONS.map(r => <option key={r} value={r}>{r || '— None —'}</option>)}
            </select>
            {reason === 'Other' && (
              <input value={reasonNote} onChange={e => setReasonNote(e.target.value)} placeholder="Type the reason..." className="input text-sm mt-1.5"/>
            )}
            {isCusdecPassed && (
              <>
                <button type="button" onClick={() => { setUseReference(x => !x); setReference('') }}
                  className={`w-full flex items-center gap-2 mt-1.5 px-3 py-2 rounded-lg text-xs font-medium border ${
                    useReference ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}>
                  <Link2 size={13}/> Attach to a Shipment Entry {useReference ? '(on)' : '(off)'}
                </button>
                {useReference && (
                  <select value={reference} onChange={e => setReference(e.target.value)} className="input text-sm mt-1.5">
                    <option value="">— Select Shipment Entry —</option>
                    {shipments.map(s => (
                      <option key={s.id} value={s.reference}>{s.reference} — {s.shipper} ({s.invoice_number})</option>
                    ))}
                  </select>
                )}
                {reference && <p className="text-[11px] text-gray-500 mt-1">{`Attached to "${reference}"`}</p>}
              </>
            )}
          </div>
          )}

          {error && <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle size={13}/>{error}</p>}
        </div>
        <div className="flex gap-3 p-5 border-t">
          <button onClick={onClose} disabled={busy} className="btn-secondary flex-1 disabled:opacity-50">Cancel</button>
          <button onClick={() => handleDone()} disabled={busy || (restrictToSaveOnly ? !save : (!save && !mail && !notify && !isCusdecPassed)) || (!restrictToSaveOnly && requireReason && !reason)} className="btn-primary flex-1 flex items-center justify-center gap-2">
            {busy ? <Loader size={14} className="animate-spin"/> : null}Done
          </button>
        </div>
      </div>
    </div>
  )
}