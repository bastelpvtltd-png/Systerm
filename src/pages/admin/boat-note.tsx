import { useState, useEffect } from 'react'
import AdminLayout from '@/components/admin/AdminLayout'
import { Ship, Loader, Download, RefreshCw, CheckSquare, Square, FileDown, Mail } from 'lucide-react'

interface CusdecRecord { id: string; number: string; exporter: string; consignee: string; vessel: string; created_at: string }
interface CdnRecord { id: string; cdn_no: string; container_no: string; driver_name: string; cusdec_number: string; goods_description: string; gross_mass: string; vessel: string }
interface BoatNote { shipper: string; consignee: string; entry_no: string; bl_no: string; slpa_no: string; voyage: string; voyage_date: string; vessel: string; terminal: string; lorry_no: string; trailer_no: string; driver_name: string; container_no: string; con_type: string; seal_no: string; goods: string; gross_mass: string; cdn_no: string; pkg_no: string; pkg_type: string; voc: string; coc: string; loading_port: string; discharge_port: string }

export default function BoatNotePage() {
  const [cusdecs, setCusdecs] = useState<CusdecRecord[]>([])
  const [cdns, setCdns]       = useState<CdnRecord[]>([])
  const [selectedCusdec, setSelectedCusdec] = useState<string>('')
  const [selectedCdns, setSelectedCdns]     = useState<string[]>([])
  const [boatNotes, setBoatNotes]           = useState<BoatNote[]>([])
  const [cusdecNo, setCusdecNo]             = useState('')
  const [loading, setLoading]   = useState(false)
  const [generating, setGenerating] = useState(false)
  const [emailAddr, setEmailAddr]   = useState('bathiyapradeep7788@gmail.com')
  const [sending, setSending]       = useState(false)
  const [status, setStatus]         = useState('')

  useEffect(() => { loadCusdecs() }, [])
  useEffect(() => { if (selectedCusdec) loadCdns(selectedCusdec) }, [selectedCusdec])

  async function loadCusdecs() {
    setLoading(true)
    try {
      const res = await fetch('/api/list-records?table=cusdec&limit=100')
      if (res.ok) { const d = await res.json(); setCusdecs(d.records || []) }
    } finally { setLoading(false) }
  }

  async function loadCdns(cusdecId: string) {
    const cur = cusdecs.find(c => c.id === cusdecId)
    if (!cur) return
    try {
      const res = await fetch(`/api/list-records?table=cdn&filter=cusdec_number&value=${cur.number}`)
      if (res.ok) { const d = await res.json(); setCdns(d.records || []) }
    } catch {}
  }

  function toggleCdn(id: string) {
    setSelectedCdns(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function selectAll() { setSelectedCdns(cdns.map(c => c.id)) }
  function clearAll()  { setSelectedCdns([]) }

  async function generate() {
    if (!selectedCusdec || !selectedCdns.length) {
      setStatus('⚠ Select a CUSDEC and at least one CDN'); return
    }
    setGenerating(true); setBoatNotes([])
    try {
      const res = await fetch('/api/generate-boat-note', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cusdec_id: selectedCusdec, cdn_ids: selectedCdns }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setBoatNotes(d.boat_notes || [])
      setCusdecNo(d.cusdec_no || '')
      setStatus(`✓ ${d.boat_notes.length} boat note(s) generated`)
    } catch (e: any) {
      setStatus(`✗ ${e.message}`)
    } finally { setGenerating(false) }
  }

  async function downloadPdf() {
    if (!boatNotes.length) return
    // Dynamic import jsPDF (client only)
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

    boatNotes.forEach((bn, pageIdx) => {
      if (pageIdx > 0) doc.addPage()

      const margin = 12
      let y = margin

      // Title
      doc.setFontSize(11).setFont('helvetica', 'bold')
      doc.text('SHIPPING NOTE / BOAT NOTE - Exp 3a', 105, y, { align: 'center' })
      y += 7

      doc.setFontSize(8).setFont('helvetica', 'normal')

      // Draw table cell helper
      const cell = (x: number, yw: number, w: number, h: number, label: string, value: string, bold = false) => {
        doc.rect(x, yw, w, h)
        doc.setFont('helvetica', 'bold').setFontSize(7)
        doc.text(label, x + 1, yw + 3.5)
        doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(8)
        if (value) doc.text(value.slice(0, 40), x + 1, yw + 8)
      }

      const pageW = 186  // 210 - 2*12
      const rowH = 16
      const rowH2 = 12

      // Row 1: Shipper | Entry No | B/L No
      cell(margin, y, 80, rowH, '1.  Shipper (Name and Address)', bn.shipper.replace(/\r?\n/g, ' '))
      cell(margin + 80, y, 53, rowH, '9.  Custom Entry No.', bn.entry_no)
      cell(margin + 133, y, 53, rowH, '10. SN(B/L) No.', bn.bl_no)
      y += rowH

      // Row 2: [Shipper cont] | Exporter Reg | SLPA No
      cell(margin, y, 80, rowH2, '2.  Consignee', bn.consignee.slice(0, 50))
      cell(margin + 80, y, 53, rowH2, '11. Exporter\'s Reg. No.', '')
      cell(margin + 133, y, 53, rowH2, '12. SLPA No.', bn.slpa_no)
      y += rowH2

      // Row 3: Voyage | Terminal | Loading | Discharge
      cell(margin, y, 50, rowH2, '3.  Voyage No./Date', `${bn.voyage}  ${bn.voyage_date}`)
      cell(margin + 50, y, 40, rowH2, 'TERMINAL', bn.terminal)
      cell(margin + 90, y, 48, rowH2, '5.  Port of Loading', bn.loading_port)
      cell(margin + 138, y, 48, rowH2, '6.  Port of Discharge', bn.discharge_port)
      y += rowH2

      // Row 4: Vessel | VOC | COC
      cell(margin, y, 60, rowH2, '4.  Vessel', bn.vessel)
      cell(margin + 60, y, 63, rowH2, 'VOC', bn.voc)
      cell(margin + 123, y, 63, rowH2, 'COC', bn.coc)
      y += rowH2

      // Row 5: Lorry | Trailer | Driver
      cell(margin, y, 50, rowH2, '7.  Lorry No.', bn.lorry_no)
      cell(margin + 50, y, 50, rowH2, '    Trailer No.', bn.trailer_no)
      cell(margin + 100, y, 86, rowH2, '12. Driver Name', bn.driver_name)
      y += rowH2

      // Row 6: Container | Con Type | Seal
      cell(margin, y, 60, rowH2, '18. Container No.', bn.container_no, true)
      cell(margin + 60, y, 36, rowH2, '    Type', bn.con_type)
      cell(margin + 96, y, 44, rowH2, '    Seal No.', bn.seal_no)
      cell(margin + 140, y, 46, rowH2, 'CDN No.', bn.cdn_no, true)
      y += rowH2

      // Row 7: Goods | Pkg | Gross
      cell(margin, y, 80, rowH, '20. Description of Goods', bn.goods)
      cell(margin + 80, y, 30, rowH, '19. Pkg No.', bn.pkg_no)
      cell(margin + 110, y, 30, rowH, '    Type', bn.pkg_type)
      cell(margin + 140, y, 46, rowH, '21. Gross Mass (Kg)', bn.gross_mass, true)
      y += rowH

      // Footer note
      doc.setFontSize(7).setFont('helvetica', 'italic')
      doc.text(`Generated by Export System · CUSDEC ${cusdecNo}`, margin, y + 4)
    })

    const today = new Date().toISOString().slice(0, 10)
    doc.save(`BOAT_NOTE_${cusdecNo}_${today}.pdf`)
    setStatus('✓ PDF downloaded')
  }

  async function sendEmail() {
    if (!boatNotes.length || !emailAddr) return
    setSending(true)
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: emailAddr,
          subject: `BOAT NOTES - CUSDEC ${cusdecNo} - ${new Date().toLocaleDateString('en-GB')}`,
          body: `Please find the boat notes for CUSDEC ${cusdecNo} attached.\n\nContainers:\n${boatNotes.map(b => `- ${b.container_no} | CDN ${b.cdn_no} | ${b.goods}`).join('\n')}`,
          boatNotes,
          cusdecNo,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setStatus('✓ Email sent to ' + emailAddr)
    } catch (e: any) {
      setStatus(`✗ Email failed: ${e.message}`)
    } finally { setSending(false) }
  }

  const selectedCusdecObj = cusdecs.find(c => c.id === selectedCusdec)

  return (
    <AdminLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Ship size={22} className="text-[#3b82f6]"/> Boat Note Generator
          </h1>
          <p className="text-gray-500 text-sm mt-1">Select CUSDEC + CDN containers → Generate → Download or Email</p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* Step 1 — Select CUSDEC */}
          <div className="card">
            <h2 className="font-semibold text-gray-900 mb-3 text-sm">Step 1 — Select CUSDEC</h2>
            {loading ? (
              <div className="flex justify-center py-6"><Loader size={18} className="animate-spin text-gray-400"/></div>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {cusdecs.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-4">No CUSDECs — import Excel first</p>
                )}
                {cusdecs.map(c => (
                  <button key={c.id} onClick={() => { setSelectedCusdec(c.id); setSelectedCdns([]); setBoatNotes([]) }}
                    className={`w-full text-left p-2.5 rounded-lg border text-xs transition-colors ${
                      selectedCusdec === c.id ? 'bg-blue-50 border-blue-300' : 'border-gray-100 hover:bg-gray-50'
                    }`}>
                    <p className="font-semibold text-gray-800">E {c.number}</p>
                    <p className="text-gray-500 truncate">{c.exporter?.slice(0, 35)}</p>
                    <p className="text-gray-400">{c.vessel} · {new Date(c.created_at).toLocaleDateString('en-GB')}</p>
                  </button>
                ))}
              </div>
            )}
            <button onClick={loadCusdecs} className="mt-2 w-full text-xs text-gray-400 flex items-center justify-center gap-1 hover:text-gray-600">
              <RefreshCw size={11}/> Refresh
            </button>
          </div>

          {/* Step 2 — Select CDN containers */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm">Step 2 — Select Containers</h2>
              {cdns.length > 0 && (
                <div className="flex gap-2">
                  <button onClick={selectAll} className="text-xs text-blue-600 hover:text-blue-800">All</button>
                  <button onClick={clearAll}  className="text-xs text-gray-400 hover:text-gray-600">None</button>
                </div>
              )}
            </div>
            {!selectedCusdec ? (
              <p className="text-xs text-gray-400 text-center py-6">Select a CUSDEC first</p>
            ) : cdns.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">No CDNs found for this CUSDEC</p>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {cdns.map(cdn => {
                  const checked = selectedCdns.includes(cdn.id)
                  return (
                    <button key={cdn.id} onClick={() => toggleCdn(cdn.id)}
                      className={`w-full flex items-center gap-2 text-left p-2.5 rounded-lg border text-xs transition-colors ${
                        checked ? 'bg-green-50 border-green-300' : 'border-gray-100 hover:bg-gray-50'
                      }`}>
                      {checked ? <CheckSquare size={14} className="text-green-500 flex-shrink-0"/> : <Square size={14} className="text-gray-300 flex-shrink-0"/>}
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-800">{cdn.container_no || cdn.cdn_no}</p>
                        <p className="text-gray-500">CDN: {cdn.cdn_no} · {cdn.driver_name?.slice(0, 20)}</p>
                        <p className="text-gray-400">{cdn.gross_mass} Kg</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
            <button onClick={generate} disabled={generating || !selectedCusdec || !selectedCdns.length}
              className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm text-white font-medium disabled:opacity-40"
              style={{ background: '#3b82f6' }}>
              {generating ? <Loader size={14} className="animate-spin"/> : <Ship size={14}/>}
              Generate Boat Notes ({selectedCdns.length})
            </button>
          </div>

          {/* Step 3 — Download / Email */}
          <div className="card">
            <h2 className="font-semibold text-gray-900 mb-3 text-sm">Step 3 — Download / Email</h2>

            {status && (
              <p className={`text-xs mb-3 font-medium ${status.startsWith('✓') ? 'text-green-600' : status.startsWith('⚠') ? 'text-amber-600' : 'text-red-600'}`}>
                {status}
              </p>
            )}

            {boatNotes.length > 0 ? (
              <>
                <div className="mb-4 p-3 bg-green-50 rounded-lg border border-green-200">
                  <p className="text-xs font-semibold text-green-700 mb-2">Generated: {boatNotes.length} boat note(s)</p>
                  <div className="space-y-1">
                    {boatNotes.map((bn, i) => (
                      <div key={i} className="text-xs text-green-600">
                        {i+1}. {bn.container_no} · CDN {bn.cdn_no}
                      </div>
                    ))}
                  </div>
                </div>

                <button onClick={downloadPdf}
                  className="w-full flex items-center justify-center gap-2 py-2.5 mb-3 rounded-lg text-sm text-white font-medium"
                  style={{ background: '#1B3A5C' }}>
                  <FileDown size={14}/> Download PDF
                </button>

                <div className="border-t border-gray-100 pt-3">
                  <p className="text-xs text-gray-500 mb-2 font-medium">Send via Email</p>
                  <input value={emailAddr} onChange={e => setEmailAddr(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 mb-2 focus:outline-none focus:border-blue-400"
                    placeholder="recipient@email.com"/>
                  <button onClick={sendEmail} disabled={sending || !emailAddr}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm text-white font-medium disabled:opacity-40"
                    style={{ background: '#22A87A' }}>
                    {sending ? <Loader size={14} className="animate-spin"/> : <Mail size={14}/>}
                    Send Email
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Ship size={32} className="text-gray-200 mb-3"/>
                <p className="text-sm text-gray-400">Generate boat notes to download or email</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}
