import { useState, useEffect } from 'react'
import AdminLayout from '@/components/admin/AdminLayout'
import { Anchor, Loader, RefreshCw, CheckSquare, Square, FileDown, Mail } from 'lucide-react'

interface CusdecRec { id: string; number: string; exporter: string; consignee: string; vessel: string; voyage_no: string; bl_no: string; gross_mass: string; net_mass: string; discharge_port: string; location_of_goods: string; created_at: string }
interface CdnRec    { id: string; cdn_no: string; container_no: string; driver_name: string; cusdec_number: string; goods_description: string; gross_mass: string; vessel: string; voyage: string; voyage_date: string; bl_no: string; slpa_no: string; voc: string; coc: string; lorry_no: string; trailer_no: string; loading_port: string; discharge_port: string; location: string; pkg_no: string; pkg_type: string; volume: string; seal_no: string; con_type: string; marks: string }

interface BoatNote { shipper: string; consignee: string; entry_no: string; bl_no: string; slpa_no: string; voyage: string; voyage_date: string; vessel: string; terminal: string; lorry_no: string; trailer_no: string; driver_name: string; container_no: string; con_type: string; seal_no: string; goods: string; gross_mass: string; net_mass: string; cdn_no: string; pkg_no: string; pkg_type: string; voc: string; coc: string; loading_port: string; discharge_port: string; volume: string; marks: string }

// Company constants from Excel b2 sheet
const COMPANY = {
  name:       'PRIYANTHI AGENCY',
  declarant:  'H A B P KUMRA',
  ca_no:      '706266609',
  tel:        '',
}

export default function BoatNotePage() {
  const [cusdecs, setCusdecs]   = useState<CusdecRec[]>([])
  const [cdns, setCdns]         = useState<CdnRec[]>([])
  const [selCusdec, setSelCusdec] = useState('')
  const [selCdns, setSelCdns]   = useState<string[]>([])
  const [boatNotes, setBoatNotes] = useState<BoatNote[]>([])
  const [cusdecNo, setCusdecNo] = useState('')
  const [loading, setLoading]   = useState(false)
  const [generating, setGen]    = useState(false)
  const [emailTo, setEmailTo]   = useState('bathiyapradeep7788@gmail.com')
  const [sending, setSending]   = useState(false)
  const [status, setStatus]     = useState('')

  useEffect(() => { loadCusdecs() }, [])
  useEffect(() => { if (selCusdec) loadCdns() }, [selCusdec])

  async function loadCusdecs() {
    setLoading(true)
    try {
      const r = await fetch('/api/list-records?table=cusdec&limit=200')
      if (r.ok) { const d = await r.json(); setCusdecs(d.records || []) }
    } finally { setLoading(false) }
  }

  async function loadCdns() {
    const cur = cusdecs.find(c => c.id === selCusdec)
    if (!cur) return
    try {
      const r = await fetch(`/api/list-records?table=cdn&filter=cusdec_number&value=${cur.number}`)
      if (r.ok) { const d = await r.json(); setCdns(d.records || []) }
    } catch {}
  }

  const toggleCdn = (id: string) =>
    setSelCdns(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  async function generate() {
    if (!selCusdec || !selCdns.length) { setStatus('⚠ Select CUSDEC and containers'); return }
    setGen(true); setBoatNotes([])
    try {
      const r = await fetch('/api/generate-boat-note', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cusdec_id: selCusdec, cdn_ids: selCdns }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setBoatNotes(d.boat_notes || [])
      setCusdecNo(d.cusdec_no || '')
      setStatus(`✓ ${d.boat_notes.length} boat note(s) ready`)
    } catch (e: any) { setStatus(`✗ ${e.message}`) }
    finally { setGen(false) }
  }

  async function downloadPdf() {
    if (!boatNotes.length) return
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

    const PW = 277  // landscape A4 width - margins
    const M  = 10   // margin

    boatNotes.forEach((bn, pi) => {
      if (pi > 0) doc.addPage()

      let y = M

      // ── Title ──────────────────────────────────────────────────────────
      doc.setFontSize(10).setFont('helvetica', 'bold')
      doc.text('SHIPPING NOTE / BOAT NOTE  -  Exp 3a', M + PW / 2, y + 4, { align: 'center' })
      y += 8

      // ── Helper functions ───────────────────────────────────────────────
      const box = (x: number, yy: number, w: number, h: number) => doc.rect(x, yy, w, h)

      const label = (x: number, yy: number, txt: string) => {
        doc.setFont('helvetica', 'bold').setFontSize(6.5)
        doc.text(txt, x + 1, yy + 3.5)
      }

      const val = (x: number, yy: number, txt: string, maxW = 60) => {
        doc.setFont('helvetica', 'normal').setFontSize(8)
        const lines = doc.splitTextToSize(txt || '', maxW)
        doc.text(lines.slice(0, 2), x + 1.5, yy + 8)
      }

      const cell = (x: number, yy: number, w: number, h: number, lbl: string, v: string, maxW?: number) => {
        box(x, yy, w, h)
        label(x, yy, lbl)
        val(x, yy, v, maxW || w - 2)
      }

      // ── Row 1: Shipper (col 0..99) | Entry No (100..159) | B/L No (160..286) ──
      const h1 = 18, h2 = 12, h3 = 10

      cell(M,       y, 99, h1, '1.  Shipper (Name and Address)  3336/7', bn.shipper.replace(/\r?\n/g,' '), 96)
      cell(M+99,    y, 60, h1, '9.  Custom Entry No.', bn.entry_no)
      cell(M+159,   y, 60, h1, '10.  SN(B/L) No.', bn.bl_no)
      y += h1

      // ── Row 2: (shipper cont blank) | Exporter Reg | SLPA No ──
      box(M,     y, 99, h2); label(M,     y, '')
      cell(M+99,  y, 60, h2, '11.  Exporter\'s Registration No.', '')
      cell(M+159, y, 60, h2, '12.  SLPA No.', bn.slpa_no)
      y += h2

      // ── Row 3: Consignee | Shipping Line ──
      cell(M,     y, 99, h1, '2.  Consignee (Name and Address)  3132/3', bn.consignee.replace(/\r?\n/g,' '), 96)
      cell(M+99,  y, 120, h1, '13.  Name of Shipping Line / MTO  3126/7', 'PRIYANTHI AGENCY')
      y += h1

      // ── Row 4: Notify | Place of Acceptance ──
      cell(M,    y, 99, h2, '3.  Notify Address  3180/1', 'SAME AS ABOVE')
      cell(M+99, y, 120, h2, '14. (a) Place of Acceptance  3348/9', bn.loading_port)
      y += h2

      // ── Row 5: Voyage/Date | Warehouse | Place of Delivery ──
      cell(M,    y, 55, h2, '4.  Voyage No./Date  8228', `${bn.voyage}  ${bn.voyage_date}`)
      cell(M+55, y, 44, h2, '5.  Warehouse No.  3156  (Terminal)', bn.terminal)
      cell(M+99, y, 120, h2, '14. (b) Place of Delivery  3246/7', bn.discharge_port)
      y += h2

      // ── Row 6: Vessel | Port of Loading ──
      cell(M,    y, 99, h2, '6.  Vessel  8122/3', bn.vessel)
      cell(M+99, y, 60, h2, '7.  Port of Loading  3230/1', bn.loading_port)
      cell(M+159,y, 60, h2, '', '')
      y += h2

      // ── Row 7: Port of Discharge | VSL OPR | CNT OPR | Declaration text ──
      cell(M,     y, 55, h3, '8.  Port of Discharge  3414/5', bn.discharge_port)
      cell(M+55,  y, 22, h3, 'VSL OPR CODE', bn.voc)
      cell(M+77,  y, 22, h3, 'CNT OPR CODE', bn.coc)
      box(M+99, y, 120, h3)
      doc.setFont('helvetica', 'italic').setFontSize(6)
      doc.text('  The Company Preparing this note declares that to the best of their belief the goods', M+100, y+4)
      doc.text('  have been accurately described, their quantities weights and measurements are correct.', M+100, y+8)
      y += h3

      // ── Row 8: Headers for container table ──
      const th = 7
      cell(M,     y, 45, th, '15. Marks & Nos. / Container Nos.  7102', '')
      cell(M+45,  y, 30, th, '16. Number and Kind of Packages  7224/5', '')
      cell(M+75,  y, 50, th, '17. Description of Goods  7002', '')
      cell(M+125, y, 22, th, '18. CCN NO.  7282', '')
      cell(M+147, y, 24, th, '19.(a) Gross Wt (Kg)  6292', '')
      cell(M+171, y, 17, th, '20.(a) Cube m³  6324', '')
      cell(M+188, y, 31, th, 'Lorry / Trailer', '')
      y += th

      // ── Container data row ──
      const dr = 14
      box(M, y, 45, dr); val(M, y, bn.container_no, 42)
      box(M+45, y, 30, dr)
      doc.setFont('helvetica', 'normal').setFontSize(8)
      doc.text(`1 X ${bn.con_type || '40'} FCL`, M+46, y+8)
      box(M+75, y, 50, dr); val(M+75, y, bn.goods, 47)
      box(M+125,y, 22, dr); val(M+125,y, bn.cdn_no, 20)
      box(M+147,y, 24, dr)
      doc.text(bn.gross_mass ? `${bn.gross_mass} KGS` : '', M+148, y+8)
      box(M+171,y, 17, dr); val(M+171,y, bn.volume || '60', 15)
      box(M+188,y, 31, dr); val(M+188,y, `${bn.lorry_no}  ${bn.trailer_no}`, 28)
      y += dr

      // ── Net Wt / Shipped / Seal ──
      const sr = 10
      cell(M,     y, 45, sr, '  Seal No.', bn.seal_no)
      cell(M+45,  y, 30, sr, '  Driver', bn.driver_name.slice(0,18))
      box(M+75,   y, 50, sr)
      box(M+125,  y, 22, sr); label(M+125, y, '19.(e) Shipped (BL)')
      doc.setFont('helvetica','normal').setFontSize(8)
      doc.text(`${bn.pkg_no} BL`, M+126, y+8)
      cell(M+147, y, 24, sr, '19.(b) Net Wt (Kg)', bn.gross_mass ? `${bn.gross_mass} KGS` : '')
      box(M+171,  y, 17, sr)
      box(M+188,  y, 31, sr)
      y += sr

      // ── Status / Freight / SLPA ──
      const fr = 10
      box(M,      y, 55, fr); label(M,     y, '21. For SLPA Use')
      cell(M+55,  y, 44, fr, '25.(a) Status of Container', 'FCL')
      cell(M+99,  y, 60, fr, '25.(b) Freight Payable At', bn.discharge_port)
      cell(M+159, y, 60, fr, '26. No. of Original B/L', '3')
      y += fr

      // ── Company / Declarant / Signature ──
      const cr = 12
      cell(M,     y, 55, cr, '23. Shipping Agent', COMPANY.name)
      cell(M+55,  y, 44, cr, '30. Name of Company Preparing this Note', COMPANY.name)
      cell(M+99,  y, 60, cr, '31. Name of Declarant  3140/1', COMPANY.declarant)
      cell(M+159, y, 60, cr, '32. Tel No.', COMPANY.tel)
      y += cr

      // ── Debit account / Signature line ──
      box(M, y, 219, h3)
      doc.setFont('helvetica','normal').setFontSize(7)
      doc.text(`Please debit our C/A No. ${COMPANY.ca_no} with charges payable`, M+2, y+6)
      box(M+219, y, 58, h3); label(M+219, y, '33. Signature of Declarant                              Date')
      y += h3

      // ── Footer ──
      doc.setFont('helvetica','italic').setFontSize(6.5)
      doc.text(`Generated by Export Management System  ·  CUSDEC ${cusdecNo}  ·  ${new Date().toLocaleDateString('en-GB')}`, M + PW/2, y+5, { align:'center' })
    })

    const dt = new Date().toISOString().slice(0,10)
    doc.save(`BOAT_NOTE_${cusdecNo}_${dt}.pdf`)
    setStatus('✓ PDF downloaded')
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
          body: `Please find the boat notes for CUSDEC ${cusdecNo}.\n\nContainers:\n${boatNotes.map((b,i) => `${i+1}. ${b.container_no} | CDN: ${b.cdn_no} | ${b.goods} | ${b.gross_mass} Kg`).join('\n')}`,
          boatNotes, cusdecNo,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setStatus('✓ Email sent to ' + emailTo)
    } catch (e: any) { setStatus(`✗ Email: ${e.message}`) }
    finally { setSending(false) }
  }

  const cur = cusdecs.find(c => c.id === selCusdec)
  const statusColor = status.startsWith('✓') ? 'text-green-600' : status.startsWith('⚠') ? 'text-amber-600' : 'text-red-600'

  return (
    <AdminLayout>
      <div className="p-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Anchor size={20} className="text-[#3b82f6]"/> Boat Note Generator
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">SHIPPING NOTE / BOAT NOTE – Exp 3a format · Select CUSDEC → CDNs → Generate → Download / Email</p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* Step 1 — CUSDEC */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm">1 · Select CUSDEC</h2>
              <button onClick={loadCusdecs} className="text-gray-400 hover:text-gray-600"><RefreshCw size={13}/></button>
            </div>
            {loading ? (
              <div className="flex justify-center py-6"><Loader size={18} className="animate-spin text-gray-400"/></div>
            ) : cusdecs.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">No CUSDECs — import Excel file first</p>
            ) : (
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {cusdecs.map(c => (
                  <button key={c.id}
                    onClick={() => { setSelCusdec(c.id); setSelCdns([]); setBoatNotes([]) }}
                    className={`w-full text-left p-2.5 rounded-lg border text-xs transition-all ${
                      selCusdec === c.id ? 'bg-blue-50 border-blue-300 shadow-sm' : 'border-gray-100 hover:bg-gray-50'
                    }`}>
                    <p className="font-bold text-gray-800">E {c.number}</p>
                    <p className="text-gray-600 truncate mt-0.5">{c.exporter?.slice(0,40)}</p>
                    <p className="text-gray-400 mt-0.5">{c.vessel} · {c.voyage_no}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Step 2 — CDNs */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm">2 · Select Containers (CDN)</h2>
              {cdns.length > 0 && (
                <div className="flex gap-2 text-xs">
                  <button onClick={() => setSelCdns(cdns.map(c=>c.id))} className="text-blue-600 hover:text-blue-800">All</button>
                  <button onClick={() => setSelCdns([])} className="text-gray-400">None</button>
                </div>
              )}
            </div>
            {!selCusdec ? (
              <p className="text-xs text-gray-400 text-center py-6">Select a CUSDEC first</p>
            ) : cdns.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-xs text-gray-400">No CDNs found for CUSDEC {cur?.number}</p>
                <p className="text-xs text-gray-300 mt-1">Import Excel to populate CDN records</p>
              </div>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto mb-3">
                {cdns.map(cdn => {
                  const on = selCdns.includes(cdn.id)
                  return (
                    <button key={cdn.id} onClick={() => toggleCdn(cdn.id)}
                      className={`w-full flex items-start gap-2 text-left p-2.5 rounded-lg border text-xs transition-all ${
                        on ? 'bg-green-50 border-green-300' : 'border-gray-100 hover:bg-gray-50'
                      }`}>
                      {on
                        ? <CheckSquare size={13} className="text-green-500 flex-shrink-0 mt-0.5"/>
                        : <Square size={13} className="text-gray-300 flex-shrink-0 mt-0.5"/>}
                      <div>
                        <p className="font-bold text-gray-800">{cdn.container_no || '—'}</p>
                        <p className="text-gray-500">CDN: {cdn.cdn_no} · {cdn.goods_description || 'WASTE PAPER'}</p>
                        <p className="text-gray-400">{cdn.gross_mass} Kg · Driver: {cdn.driver_name?.slice(0,18)}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
            <button onClick={generate} disabled={generating || !selCusdec || !selCdns.length}
              className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm text-white font-medium disabled:opacity-40 transition-opacity"
              style={{ background: '#3b82f6' }}>
              {generating ? <Loader size={14} className="animate-spin"/> : <Anchor size={14}/>}
              Generate {selCdns.length > 0 ? `(${selCdns.length})` : ''} Boat Note{selCdns.length !== 1 ? 's' : ''}
            </button>
          </div>

          {/* Step 3 — Output */}
          <div className="card">
            <h2 className="font-semibold text-gray-900 text-sm mb-3">3 · Download / Email</h2>

            {status && <p className={`text-xs mb-3 font-medium ${statusColor}`}>{status}</p>}

            {boatNotes.length > 0 ? (
              <>
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4">
                  <p className="text-xs font-bold text-green-700 mb-1.5">
                    CUSDEC E {cusdecNo} · {boatNotes.length} container{boatNotes.length !== 1 ? 's' : ''}
                  </p>
                  <div className="space-y-0.5">
                    {boatNotes.map((bn, i) => (
                      <p key={i} className="text-xs text-green-700">
                        {i+1}. {bn.container_no} · CDN {bn.cdn_no} · {bn.gross_mass} Kg
                      </p>
                    ))}
                  </div>
                </div>

                <button onClick={downloadPdf}
                  className="w-full flex items-center justify-center gap-2 py-2.5 mb-3 rounded-lg text-sm text-white font-medium"
                  style={{ background: '#1B3A5C' }}>
                  <FileDown size={14}/> Download PDF (Exp 3a format)
                </button>

                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <p className="text-xs font-medium text-gray-600">Send Email</p>
                  <input value={emailTo} onChange={e => setEmailTo(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
                    placeholder="recipient@email.com"/>
                  <button onClick={sendEmail} disabled={sending || !emailTo}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm text-white font-medium disabled:opacity-40"
                    style={{ background: '#22A87A' }}>
                    {sending ? <Loader size={14} className="animate-spin"/> : <Mail size={14}/>}
                    Send Email
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Anchor size={32} className="text-gray-200 mb-3"/>
                <p className="text-sm text-gray-400">Select CUSDEC + containers<br/>then click Generate</p>
              </div>
            )}
          </div>
        </div>

        {/* Format preview note */}
        <div className="mt-4 p-3 bg-blue-50 rounded-xl border border-blue-100 text-xs text-blue-700">
          <span className="font-semibold">PDF Format:</span> SHIPPING NOTE / BOAT NOTE – Exp 3a · Landscape A4 · All fields from Excel b2 sheet (Shipper, Consignee, Voyage, Vessel, Port of Loading/Discharge, Container, CDN No., Gross Weight, Cube, SLPA, Company, Declarant)
        </div>
      </div>
    </AdminLayout>
  )
}
