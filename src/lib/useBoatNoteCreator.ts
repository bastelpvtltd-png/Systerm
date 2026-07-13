import { useState, useEffect } from 'react'
import { authHeader } from '@/lib/supabase'

// Same CUSDEC -> CDN -> Boat Note generation logic as Docs Create's Boat Note
// tab (src/pages/admin/boat-note.tsx) — pulled into a hook so the Automation
// tab's "Boat Note Create" option can offer the identical workflow without
// forking the PDF-layout code (which stays authored once, in boat-note.tsx,
// and is imported from there for the actual PDF drawing).
export interface CusdecRec { id: string; number: string; exporter: string; consignee: string; vessel: string; voyage_no: string; bl_no: string; gross_mass: string; net_mass: string; discharge_port: string; location_of_goods: string; created_at: string }
export interface CdnRec { id: string; cdn_no: string; container_no: string; driver_name: string; cusdec_number: string; goods_description: string; gross_mass: string; vessel: string; voyage: string; voyage_date: string; bl_no: string; slpa_no: string; voc: string; coc: string; lorry_no: string; trailer_no: string; loading_port: string; discharge_port: string; location: string; pkg_no: string; pkg_type: string; volume: string; seal_no: string; con_type: string; marks: string }
export interface BoatNote { shipper: string; consignee: string; entry_no: string; bl_no: string; slpa_no: string; voyage: string; voyage_date: string; vessel: string; terminal: string; lorry_no: string; trailer_no: string; driver_name: string; container_no: string; con_type: string; seal_no: string; goods: string; gross_mass: string; net_mass: string; cdn_no: string; pkg_no: string; pkg_type: string; voc: string; coc: string; loading_port: string; discharge_port: string; volume: string; marks: string }

export function useBoatNoteCreator() {
  const [cusdecs, setCusdecs] = useState<CusdecRec[]>([])
  const [cdns, setCdns] = useState<CdnRec[]>([])
  const [selCusdec, setSelCusdec] = useState('')
  const [selCdns, setSelCdns] = useState<string[]>([])
  const [boatNotes, setBoatNotes] = useState<BoatNote[]>([])
  const [cusdecNo, setCusdecNo] = useState('')
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [emailTo, setEmailTo] = useState('bathiyapradeep7788@gmail.com')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    loadCusdecs()
    // Live — the CUSDEC picker stays current without a refresh; the current
    // selection/generated boat notes below are separate state, untouched.
    const t = setInterval(() => loadCusdecs(true), 20000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => { if (selCusdec) loadCdns() }, [selCusdec])

  async function loadCusdecs(silent = false) {
    if (!silent) setLoading(true)
    try {
      const r = await fetch('/api/list-records?table=cusdec&limit=200')
      if (r.ok) { const d = await r.json(); setCusdecs(d.records || []) }
    } finally { if (!silent) setLoading(false) }
  }

  async function loadCdns() {
    const cur = cusdecs.find(c => c.id === selCusdec)
    if (!cur) return
    try {
      const r = await fetch(`/api/list-records?table=cdn&filter=cusdec_number&value=${cur.number}`)
      if (r.ok) { const d = await r.json(); setCdns(d.records || []) }
    } catch {}
  }

  const toggleCdn = (id: string) => setSelCdns(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  async function generate() {
    if (!selCusdec || !selCdns.length) { setStatus('⚠ Select CUSDEC and containers'); return }
    setGenerating(true); setBoatNotes([])
    try {
      const r = await fetch('/api/generate-boat-note', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ cusdec_id: selCusdec, cdn_ids: selCdns }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setBoatNotes(d.boat_notes || [])
      setCusdecNo(d.cusdec_no || '')
      setStatus(`✓ ${d.boat_notes.length} boat note(s) ready`)
    } catch (e: any) { setStatus(`✗ ${e.message}`) }
    finally { setGenerating(false) }
  }

  async function sendEmail() {
    if (!boatNotes.length || !emailTo) return
    setSending(true)
    try {
      const r = await fetch('/api/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: emailTo,
          subject: `BOAT NOTES - CUSDEC ${cusdecNo} - ${new Date().toLocaleDateString('en-GB')}`,
          body: `Please find the boat notes for CUSDEC ${cusdecNo}.\n\nContainers:\n${boatNotes.map((b, i) => `${i + 1}. ${b.container_no} | CDN: ${b.cdn_no} | ${b.goods} | ${b.gross_mass} Kg`).join('\n')}`,
          boatNotes, cusdecNo,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setStatus('✓ Email sent to ' + emailTo)
    } catch (e: any) { setStatus(`✗ Email: ${e.message}`) }
    finally { setSending(false) }
  }

  return {
    cusdecs, cdns, selCusdec, setSelCusdec, selCdns, setSelCdns, toggleCdn,
    boatNotes, cusdecNo, loading, generating, emailTo, setEmailTo, sending, status,
    loadCusdecs, generate, sendEmail,
  }
}
