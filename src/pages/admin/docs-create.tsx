import { useEffect, useState, useRef } from "react"
import AdminLayout, { usePermission } from "@/components/admin/AdminLayout"
import { authHeader } from "@/lib/supabase"
import { FileDown, Search, Loader, AlertTriangle, CheckCircle, X, Send } from "lucide-react"
import SendModal, { type SendResultFile } from "@/components/admin/SendModal"

const DOC_TYPES = [
  { value: "boat_note",    label: "Boat Note" },
  { value: "invoice",      label: "Invoice" },
  { value: "packing_list", label: "Packing List" },
  { value: "co",           label: "CO (Certificate of Origin)" },
  { value: "pytho",        label: "Phyto (Phytosanitary)" },
]

const MANUAL_FIELDS = ["Date", "Reference No", "Description", "Quantity", "Weight", "Marks"]

interface CusdecRow { id: string; code: string; number: string; exporter: string; vessel: string }

function DocsCreateContent() {
  const { has } = usePermission()
  const canUse = has("section:docs-create") || has("section:templates.manage")

  const [docType, setDocType] = useState("boat_note")
  const [cusdecQuery, setCusdecQuery] = useState("")
  const [cusdecResults, setCusdecResults] = useState<CusdecRow[]>([])
  const [selectedCusdec, setSelectedCusdec] = useState<CusdecRow | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [manualValues, setManualValues] = useState<Record<string, string>>({})
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState("")
  const [doneModal, setDoneModal] = useState<{ fileName: string; base64: string } | null>(null)
  const [sendModal, setSendModal] = useState(false)
  const [templateExists, setTemplateExists] = useState<boolean | null>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function checkTemplate() {
      setTemplateExists(null)
      const h = await authHeader()
      const res = await fetch("/api/doc-templates", { headers: h })
      if (!res.ok) { setTemplateExists(false); return }
      const d = await res.json()
      setTemplateExists(!!(d.templates || []).find((t: any) => t.document_type === docType))
    }
    checkTemplate()
  }, [docType])

  useEffect(() => {
    clearTimeout(searchTimerRef.current)
    if (!cusdecQuery.trim()) { setCusdecResults([]); setShowDropdown(false); return }
    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const h = await authHeader()
        const res = await fetch("/api/cusdec-search?q=" + encodeURIComponent(cusdecQuery), { headers: h })
        if (res.ok) { const d = await res.json(); setCusdecResults(d.records || []); setShowDropdown(true) }
      } finally { setSearchLoading(false) }
    }, 300)
  }, [cusdecQuery])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  function pickCusdec(row: CusdecRow) {
    setSelectedCusdec(row); setCusdecQuery(row.code + " / " + row.number); setShowDropdown(false)
  }

  async function generate() {
    setError(""); setGenerating(true)
    try {
      const h = await authHeader()
      const res = await fetch("/api/doc-generate", {
        method: "POST", headers: { "Content-Type": "application/json", ...h },
        body: JSON.stringify({ document_type: docType, cusdec_id: selectedCusdec?.id || null, manual_values: manualValues }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "Generate failed")
      setDoneModal({ fileName: d.fileName, base64: d.base64 })
    } catch (e: any) { setError(e.message) }
    finally { setGenerating(false) }
  }

  function downloadPdf() {
    if (!doneModal) return
    const bytes = Uint8Array.from(atob(doneModal.base64), c => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: "application/pdf" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href = url; a.download = doneModal.fileName; a.click()
    URL.revokeObjectURL(url)
  }

  const sendFile: SendResultFile | null = doneModal
    ? { fileName: doneModal.fileName, base64: doneModal.base64, mimeType: "application/pdf" }
    : null

  if (!canUse) return <div className="p-6 text-gray-400 text-sm">Access denied.</div>

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileDown size={20} className="text-blue-500"/>Create Document
        </h1>
        <p className="text-gray-500 text-sm mt-0.5">Generate a PDF from a Google Sheets template</p>
      </div>

      {error && <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3"><AlertTriangle size={16}/>{error}</div>}

      <div className="space-y-4">
        <div className="card">
          <label className="block text-xs font-medium text-gray-600 mb-1">Document Type</label>
          <select value={docType} onChange={e => { setDocType(e.target.value); setDoneModal(null); setError("") }} className="input">
            {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {templateExists === false && (
            <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
              <AlertTriangle size={12}/>No template configured. Go to <a href="/admin/templates" className="underline ml-1">Templates</a> first.
            </p>
          )}
          {templateExists === true && (
            <p className="text-xs text-green-600 mt-1.5 flex items-center gap-1"><CheckCircle size={12}/>Template configured</p>
          )}
        </div>

        <div className="card" ref={dropdownRef}>
          <label className="block text-xs font-medium text-gray-600 mb-1">CUSDEC Record <span className="text-gray-400">(optional)</span></label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
            <input value={cusdecQuery} onChange={e => { setCusdecQuery(e.target.value); setSelectedCusdec(null) }}
              placeholder="Search by code or CUSDEC number..." className="input pl-8"/>
            {searchLoading && <Loader size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-gray-400"/>}
          </div>
          {showDropdown && cusdecResults.length > 0 && (
            <div className="relative">
              <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                {cusdecResults.map(r => (
                  <button key={r.id} onMouseDown={() => pickCusdec(r)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-b border-gray-50 last:border-0">
                    <span className="font-medium text-gray-900">{r.code} / {r.number}</span>
                    <span className="text-gray-400 ml-2">{r.vessel}</span>
                    <span className="text-gray-400 ml-2">{r.exporter}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {showDropdown && cusdecResults.length === 0 && !searchLoading && (
            <p className="text-xs text-gray-400 mt-1">No records found</p>
          )}
          {selectedCusdec && (
            <div className="mt-2 flex items-center gap-2 text-xs text-green-600 bg-green-50 rounded-lg px-2.5 py-1.5 border border-green-100">
              <CheckCircle size={13}/>
              <span>Using: <strong>{selectedCusdec.code} / {selectedCusdec.number}</strong> · {selectedCusdec.exporter}</span>
              <button onClick={() => { setSelectedCusdec(null); setCusdecQuery("") }} className="ml-auto text-gray-400 hover:text-red-500"><X size={12}/></button>
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="text-xs font-semibold text-gray-700 mb-2">Manual Overrides <span className="text-gray-400 font-normal">(leave blank to use DB values)</span></h2>
          <div className="grid grid-cols-2 gap-2">
            {MANUAL_FIELDS.map(f => (
              <div key={f}>
                <label className="block text-[11px] text-gray-500 mb-0.5">{f}</label>
                <input value={manualValues[f] || ""} onChange={e => setManualValues(p => ({ ...p, [f]: e.target.value }))} className="input text-xs"/>
              </div>
            ))}
          </div>
        </div>

        <button onClick={generate} disabled={generating || templateExists === false} className="btn-primary flex items-center gap-2 disabled:opacity-50">
          {generating ? <Loader size={14} className="animate-spin"/> : <FileDown size={14}/>}Generate PDF
        </button>
      </div>

      {doneModal && !sendModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center gap-2 mb-3"><CheckCircle size={20} className="text-green-500"/><h2 className="font-semibold text-gray-900">PDF Generated!</h2></div>
            <p className="text-sm text-gray-500 mb-4">{doneModal.fileName}</p>
            <div className="flex gap-2">
              <button onClick={downloadPdf} className="btn-primary flex items-center gap-2 flex-1 justify-center"><FileDown size={14}/>Download</button>
              <button onClick={() => setSendModal(true)} className="flex items-center gap-2 flex-1 justify-center px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50"><Send size={14}/>Send</button>
            </div>
            <button onClick={() => setDoneModal(null)} className="mt-3 text-xs text-gray-400 hover:text-gray-600 w-full text-center">Close</button>
          </div>
        </div>
      )}

      {sendModal && sendFile && (
        <SendModal files={[sendFile]} onClose={() => { setSendModal(false); setDoneModal(null) }} onSent={() => { setSendModal(false); setDoneModal(null) }}/>
      )}
    </div>
  )
}

export default function DocsCreatePage() { return <DocsCreateContent/> }
DocsCreatePage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>
