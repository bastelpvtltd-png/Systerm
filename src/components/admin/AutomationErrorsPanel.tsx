import { useEffect, useState } from 'react'
import { authHeader } from '@/lib/supabase'
import { AlertCircle, Loader, X, ExternalLink } from 'lucide-react'

interface AutoError {
  id: string; kind: string; container_no: string; cusdec_number: string; shipper: string
  error: string; error_step: string | null; error_field: string | null
  attempts: number; created_by_name: string | null; finished_at: string | null; navis_done?: boolean | null; has_screenshot?: boolean
}

const STEP_LABEL: Record<string, string> = {
  prepare: 'Data check', navis: 'Navis', slpa: 'SLPA', finalize: 'Saving barcode document', trico: 'Trico',
}
const STEP_COLOR: Record<string, string> = {
  prepare: 'bg-amber-100 text-amber-800', navis: 'bg-blue-100 text-blue-800', slpa: 'bg-purple-100 text-purple-800',
  finalize: 'bg-rose-100 text-rose-800', trico: 'bg-teal-100 text-teal-800',
}
const KIND_LABEL: Record<string, string> = { barcode_enter: 'Barcode Enter', trico_gate_pass: 'Trico Gate Pass' }
async function openShot(jobId: string) {
  const w = window.open('', '_blank')
  try {
    const res = await fetch(`/api/automation-screenshot?id=${jobId}`, { headers: await authHeader() })
    const d = await res.json()
    if (!res.ok) throw new Error(d.error)
    const html = `<body style="margin:0;font-family:monospace;background:#111;color:#eee">${d.screenshot ? `<img src="data:image/jpeg;base64,${d.screenshot}" style="max-width:100%">` : ''}${d.debug ? `<pre style="padding:12px;white-space:pre-wrap">${String(d.debug).replace(/</g, '&lt;')}</pre>` : ''}</body>`
    if (w) { w.document.write(html); w.document.close() }
  } catch (err: any) { if (w) { w.document.write(`<pre>${err.message}</pre>`); w.document.close() } }
}

const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

// Dashboard card: automation jobs that failed, saying which step and which field. The CDN that
// failed was skipped (nothing was entered for it, or only Navis was); fix the cause, then run it
// again from Automation → Barcode Enter. Mounted hidden while collapsed so the card count stays live.
export default function AutomationErrorsPanel({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const [errors, setErrors] = useState<AutoError[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const res = await fetch('/api/automation-errors', { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) { setErrors(d.errors || []); onCountChange?.((d.errors || []).length); setMsg('') }
      else setMsg(d.error || 'Could not load')
    } finally { if (!silent) setLoading(false) }
  }
  useEffect(() => { load(); const t = setInterval(() => load(true), 15_000); return () => clearInterval(t) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function dismiss(body: { id?: string; all?: boolean }) {
    setBusy(body.id || 'all')
    try {
      await fetch('/api/automation-errors', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) }, body: JSON.stringify(body) })
      await load(true)
    } finally { setBusy('') }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><AlertCircle size={15} className="text-red-700"/>Automate Errors</h2>
        {errors.length > 1 && (
          <button onClick={() => dismiss({ all: true })} disabled={busy === 'all'} className="text-xs text-gray-500 hover:text-red-600 flex items-center gap-1">
            {busy === 'all' ? <Loader size={12} className="animate-spin"/> : <X size={12}/>}Dismiss all
          </button>
        )}
      </div>
      <p className="text-xs text-gray-400 mb-3">A CDN that hits an error is skipped — the rest of the batch carries on. Fix the cause, then run that CDN again from Automation → Barcode Enter (running it again clears its error here).</p>
      {msg && <p className="text-xs text-red-600 mb-2">{msg}</p>}
      {loading ? <Loader size={16} className="animate-spin text-gray-400"/> : errors.length === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center">No automation errors</p>
      ) : (
        <div className="space-y-2 max-h-[28rem] overflow-y-auto">
          {errors.map(e => {
            const step = e.error_step || 'navis'
            return (
              <div key={e.id} className="border border-red-100 bg-red-50/50 rounded-lg p-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-800">
                      <span className="font-mono">{e.container_no}</span>
                      <span className="text-gray-400 font-normal"> · {e.cusdec_number} · {KIND_LABEL[e.kind] || e.kind}</span>
                    </p>
                    <p className="text-gray-500 truncate">{(e.shipper || '').split('\n')[0]}</p>
                  </div>
                  <button onClick={() => dismiss({ id: e.id })} disabled={busy === e.id} title="Dismiss" className="text-gray-300 hover:text-red-500 flex-shrink-0">
                    {busy === e.id ? <Loader size={13} className="animate-spin"/> : <X size={14}/>}
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full font-medium ${STEP_COLOR[step] || 'bg-gray-100 text-gray-700'}`}>{STEP_LABEL[step] || step}</span>
                  {e.error_field && <span className="px-2 py-0.5 rounded-full bg-white border border-red-200 text-red-700 font-medium">Field: {e.error_field}</span>}
                  {e.navis_done && <span className="px-2 py-0.5 rounded-full bg-green-50 border border-green-200 text-green-700">Navis already entered — a re-run skips it</span>}
                </div>
                <p className="text-red-700 mt-2 break-words">{e.error}</p>
                <p className="text-gray-400 mt-1.5">{fmt(e.finished_at)}{e.created_by_name ? ` · started by ${e.created_by_name}` : ''}{e.has_screenshot && <> · <button onClick={() => openShot(e.id)} className="text-blue-600 hover:underline">screenshot</button></>}</p>
              </div>
            )
          })}
        </div>
      )}
      <a href="/admin/automation?tab=barcode" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-3">Open Barcode Enter <ExternalLink size={11}/></a>
    </div>
  )
}
