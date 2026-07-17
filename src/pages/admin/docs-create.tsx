import { useEffect, useState, useRef } from "react"
import AdminLayout, { usePermission } from "@/components/admin/AdminLayout"
import { authHeader, supabase } from "@/lib/supabase"
import { FileDown, Search, Loader, AlertTriangle, CheckCircle, X, Send, Plus, ChevronDown } from "lucide-react"
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
interface CusdecFull {
  id: string; code: string; number: string; exporter: string; vessel: string
  export_release_passed: boolean; boat_note_url?: string
}
interface TplField { field_label: string; is_repeating: boolean }

function DocsCreateContent() {
  const { has } = usePermission()
  const canUse = has("section:docs-create") || has("section:templates.manage")

  const [docType, setDocType]           = useState("boat_note")
  const [templateExists, setTemplateExists] = useState<boolean | null>(null)
  const [error, setError]               = useState("")
  const [generating, setGenerating]     = useState(false)
  const [doneModal, setDoneModal]       = useState<{ fileName: string; base64: string } | null>(null)
  const [sendModal, setSendModal]       = useState(false)

  // ── Non-boat-note: cusdec search ───────────────────────────────────────────
  const [cusdecQuery, setCusdecQuery]       = useState("")
  const [cusdecResults, setCusdecResults]   = useState<CusdecRow[]>([])
  const [selectedCusdec, setSelectedCusdec] = useState<CusdecRow | null>(null)
  const [showDropdown, setShowDropdown]     = useState(false)
  const [searchLoading, setSearchLoading]   = useState(false)
  const [manualValues, setManualValues]     = useState<Record<string, string>>({})
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const dropdownRef    = useRef<HTMLDivElement>(null)

  // ── Boat Note specific ─────────────────────────────────────────────────────
  const [tplFields, setTplFields]             = useState<TplField[]>([])
  const [formValues, setFormValues]           = useState<Record<string, string[]>>({})
  const [cusdecList, setCusdecList]           = useState<CusdecFull[]>([])
  const [cusdecListLoading, setCusdecListLoading] = useState(false)
  const [cusdecListSearch, setCusdecListSearch]   = useState("")
  const [generatingCusdecId, setGeneratingCusdecId] = useState<string | null>(null)
  const [bnResult, setBnResult] = useState<{
    fileName: string; base64: string; cusdec: CusdecFull | null; hasStatus: boolean
  } | null>(null)
  const [saving, setSaving]           = useState(false)
  const [savedDriveUrl, setSavedDriveUrl] = useState("")
  const [sendModalBn, setSendModalBn] = useState(false)

  // ── Load template + cusdec list when docType changes ──────────────────────
  useEffect(() => {
    async function checkTemplate() {
      setTemplateExists(null)
      const h = await authHeader()
      const res = await fetch("/api/doc-templates", { headers: h })
      if (!res.ok) { setTemplateExists(false); return }
      const d = await res.json()
      const tpl = (d.templates || []).find((t: any) => t.document_type === docType)
      setTemplateExists(!!tpl)
      if (docType === "boat_note" && tpl) {
        const fields: TplField[] = (tpl.template_mappings || []).map((m: any) => ({
          field_label: m.field_label,
          is_repeating: !!m.is_repeating,
        }))
        setTplFields(fields)
        const init: Record<string, string[]> = {}
        fields.forEach(f => { init[f.field_label] = [""] })
        setFormValues(init)
      } else {
        setTplFields([])
        setFormValues({})
      }
    }
    checkTemplate()
    if (docType === "boat_note") loadCusdecList()
  }, [docType]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadCusdecList() {
    setCusdecListLoading(true)
    try {
      const { data } = await supabase
        .from("cusdec")
        .select("id,code,number,exporter,vessel,export_release_passed,boat_note_url")
        .order("created_at", { ascending: false })
        .limit(60)
      setCusdecList((data || []) as CusdecFull[])
    } catch { setCusdecList([]) }
    finally { setCusdecListLoading(false) }
  }

  // ── Non-boat-note cusdec search ───────────────────────────────────────────
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

  // ── Generate (non-boat-note) ───────────────────────────────────────────────
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

  // ── Generate manual boat note ─────────────────────────────────────────────
  async function generateManualBn() {
    setError(""); setGenerating(true)
    try {
      const manual: Record<string, string> = {}
      Object.entries(formValues).forEach(([label, rows]) => { manual[label] = rows.join("\n") })
      const h = await authHeader()
      const res = await fetch("/api/doc-generate", {
        method: "POST", headers: { "Content-Type": "application/json", ...h },
        body: JSON.stringify({ document_type: "boat_note", manual_values: manual }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "Generate failed")
      // manual = download/mail only, no save
      setBnResult({ fileName: d.fileName, base64: d.base64, cusdec: null, hasStatus: true })
      setSavedDriveUrl("")
    } catch (e: any) { setError(e.message) }
    finally { setGenerating(false) }
  }

  // ── Generate from CUSDEC row ──────────────────────────────────────────────
  async function generateFromCusdec(cusdec: CusdecFull) {
    setError(""); setGeneratingCusdecId(cusdec.id); setBnResult(null); setSavedDriveUrl("")
    try {
      const h = await authHeader()
      const res = await fetch("/api/doc-generate", {
        method: "POST", headers: { "Content-Type": "application/json", ...h },
        body: JSON.stringify({ document_type: "boat_note", cusdec_id: cusdec.id }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "Generate failed")
      const hasStatus = !!cusdec.export_release_passed || !!cusdec.boat_note_url
      setBnResult({ fileName: d.fileName, base64: d.base64, cusdec, hasStatus })
    } catch (e: any) { setError(e.message) }
    finally { setGeneratingCusdecId(null) }
  }

  // ── Save boat note to Drive + update cusdec ───────────────────────────────
  async function saveBnToDrive() {
    if (!bnResult?.cusdec) return
    setSaving(true); setError("")
    try {
      const h = await authHeader()
      if (bnResult.cusdec.boat_note_url) {
        const ok = confirm("Mekka already save wela tiyenawa. Replace karannadha?")
        if (!ok) { setSaving(false); return }
      }
      const uploadRes = await fetch("/api/upload-to-drive", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...h },
        body: JSON.stringify({ base64: bnResult.base64, fileName: bnResult.fileName, docType: "boat_note" }),
      })
      const uploadData = await uploadRes.json()
      if (!uploadRes.ok) throw new Error(uploadData.error)
      const driveLink: string = uploadData.driveLink
      const saveRes = await fetch("/api/save-boat-note", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...h },
        body: JSON.stringify({ cusdec_id: bnResult.cusdec.id, drive_url: driveLink, file_name: bnResult.fileName }),
      })
      const saveData = await saveRes.json()
      if (!saveRes.ok) throw new Error(saveData.error)
      setSavedDriveUrl(driveLink)
      loadCusdecList()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  function downloadPdf(base64: string, fileName: string) {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: "application/pdf" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href = url; a.download = fileName; a.click()
    URL.revokeObjectURL(url)
  }

  const filteredCusdecs = cusdecList.filter(c => {
    if (!cusdecListSearch.trim()) return true
    const q = cusdecListSearch.toLowerCase()
    return (c.number || "").toLowerCase().includes(q)
      || (c.code || "").toLowerCase().includes(q)
      || (c.exporter || "").toLowerCase().includes(q)
  })

  const sendFileBn: SendResultFile | null = bnResult
    ? { fileName: bnResult.fileName, base64: bnResult.base64, mimeType: "application/pdf" }
    : null
  const sendFile: SendResultFile | null = doneModal
    ? { fileName: doneModal.fileName, base64: doneModal.base64, mimeType: "application/pdf" }
    : null

  if (!canUse) return <div className="p-6 text-gray-400 text-sm">Access denied.</div>

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileDown size={20} className="text-blue-500"/>Create Document
        </h1>
        <p className="text-gray-500 text-sm mt-0.5">Generate a PDF from a Google Sheets template</p>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          <AlertTriangle size={16}/>{error}
        </div>
      )}

      {/* Doc type */}
      <div className="card mb-4">
        <label className="block text-xs font-medium text-gray-600 mb-1">Document Type</label>
        <select value={docType} onChange={e => { setDocType(e.target.value); setDoneModal(null); setBnResult(null); setError("") }} className="input">
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

      {/* ══════════ BOAT NOTE ══════════ */}
      {docType === "boat_note" ? (
        <div className="space-y-5">

          {/* A: Manual Entry */}
          <div className="card">
            <h2 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2">
              Manual Entry
              <span className="text-xs text-gray-400 font-normal">— fill template fields</span>
            </h2>
            {tplFields.length === 0 ? (
              <p className="text-xs text-gray-400">
                No template fields configured.{" "}
                <a href="/admin/templates" className="underline text-blue-500">Add template mappings</a> first.
              </p>
            ) : (
              <div className="space-y-3">
                {tplFields.map(f => {
                  const rows = formValues[f.field_label] || [""]
                  return (
                    <div key={f.field_label}>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-gray-600">{f.field_label}</label>
                        {f.is_repeating && (
                          <button
                            onClick={() => setFormValues(p => ({ ...p, [f.field_label]: [...(p[f.field_label] || [""]), ""] }))}
                            className="flex items-center gap-1 text-[11px] text-blue-600 hover:underline">
                            <Plus size={11}/>Add Row
                          </button>
                        )}
                      </div>
                      {f.is_repeating ? (
                        <div className="space-y-1.5">
                          {rows.map((val, ri) => (
                            <div key={ri} className="flex gap-1.5">
                              <input
                                value={val}
                                onChange={e => setFormValues(p => {
                                  const arr = [...(p[f.field_label] || [])]
                                  arr[ri] = e.target.value
                                  return { ...p, [f.field_label]: arr }
                                })}
                                className="input text-xs flex-1"
                                placeholder={`Row ${ri + 1}`}/>
                              {rows.length > 1 && (
                                <button
                                  onClick={() => setFormValues(p => {
                                    const arr = (p[f.field_label] || []).filter((_, ii) => ii !== ri)
                                    return { ...p, [f.field_label]: arr }
                                  })}
                                  className="text-gray-300 hover:text-red-500">
                                  <X size={13}/>
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <input
                          value={rows[0] || ""}
                          onChange={e => setFormValues(p => ({ ...p, [f.field_label]: [e.target.value] }))}
                          className="input text-xs w-full"/>
                      )}
                    </div>
                  )
                })}
                <button onClick={generateManualBn} disabled={generating || templateExists === false}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50 mt-1">
                  {generating ? <Loader size={14} className="animate-spin"/> : <FileDown size={14}/>}Generate PDF
                </button>
              </div>
            )}
          </div>

          {/* B: From CUSDEC */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm">From CUSDEC Records</h2>
              <button onClick={loadCusdecList}
                className="text-xs text-gray-400 hover:text-blue-500 flex items-center gap-1">
                {cusdecListLoading ? <Loader size={12} className="animate-spin"/> : null}Refresh
              </button>
            </div>
            <div className="relative mb-3">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
              <input
                value={cusdecListSearch}
                onChange={e => setCusdecListSearch(e.target.value)}
                placeholder="Filter by number, code, exporter..."
                className="input pl-8 text-xs w-full"/>
            </div>
            {cusdecListLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader size={18} className="animate-spin text-gray-300"/>
              </div>
            ) : filteredCusdecs.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No CUSDEC records found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[520px]">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-gray-500">
                      <th className="pb-2 font-medium pr-3">Code</th>
                      <th className="pb-2 font-medium pr-3">Number</th>
                      <th className="pb-2 font-medium pr-3 min-w-[130px]">Exporter</th>
                      <th className="pb-2 font-medium pr-3">Status</th>
                      <th className="pb-2 w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCusdecs.map(c => {
                      const hasStatus = !!c.export_release_passed || !!c.boat_note_url
                      const isGenThis = generatingCusdecId === c.id
                      return (
                        <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2 pr-3 font-mono">{c.code}</td>
                          <td className="py-2 pr-3">{c.number}</td>
                          <td className="py-2 pr-3 truncate max-w-[130px]" title={c.exporter}>{c.exporter}</td>
                          <td className="py-2 pr-3">
                            <div className="flex gap-1 flex-wrap">
                              {c.export_release_passed && (
                                <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded font-medium">Export Released</span>
                              )}
                              {c.boat_note_url && (
                                <span className="text-[10px] bg-green-50 text-green-700 border border-green-200 px-1.5 py-0.5 rounded font-medium">BN Saved</span>
                              )}
                              {!hasStatus && (
                                <span className="text-[10px] text-gray-400">Pending</span>
                              )}
                            </div>
                          </td>
                          <td className="py-2">
                            <button onClick={() => generateFromCusdec(c)} disabled={!!generatingCusdecId}
                              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-white disabled:opacity-40"
                              style={{ background: '#1B3A5C' }}>
                              {isGenThis ? <Loader size={11} className="animate-spin"/> : <FileDown size={11}/>}Generate
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Boat Note result panel */}
          {bnResult && (
            <div className="card border-2 border-blue-100">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                  <CheckCircle size={15} className="text-green-500"/>PDF Generated
                </h2>
                <button onClick={() => setBnResult(null)} className="text-gray-300 hover:text-red-500"><X size={14}/></button>
              </div>
              <p className="text-xs text-gray-500 mb-3 font-mono">{bnResult.fileName}</p>

              {/* Always: Download + Mail */}
              <div className="flex gap-2 mb-4">
                <button onClick={() => downloadPdf(bnResult.base64, bnResult.fileName)}
                  className="btn-primary flex items-center gap-2 flex-1 justify-center">
                  <FileDown size={14}/>Download
                </button>
                <button onClick={() => setSendModalBn(true)}
                  className="flex items-center gap-2 flex-1 justify-center px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50">
                  <Send size={14}/>Send Mail
                </button>
              </div>

              {/* Save to System — only for cusdec rows WITHOUT status */}
              {bnResult.cusdec && !bnResult.hasStatus && (
                <div className="border-t border-gray-100 pt-3">
                  <h3 className="text-xs font-semibold text-gray-700 mb-2">Save to System</h3>
                  {savedDriveUrl ? (
                    <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 rounded-lg px-3 py-2 border border-green-100">
                      <CheckCircle size={13}/>
                      Saved!{" "}
                      <a href={savedDriveUrl} target="_blank" rel="noreferrer" className="underline ml-1">View in Drive</a>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-xs text-gray-600 bg-blue-50 rounded-lg px-3 py-2 border border-blue-100 cursor-not-allowed select-none">
                        <input type="checkbox" checked readOnly className="opacity-60"/>
                        <span className="font-medium">Boat Note Passed</span>
                        <span className="text-gray-400 text-[11px]">(pre-checked)</span>
                      </label>
                      {bnResult.cusdec.boat_note_url && (
                        <p className="text-xs text-amber-600 flex items-center gap-1">
                          <AlertTriangle size={12}/>Already saved before — saving will replace the existing link.
                        </p>
                      )}
                      <button onClick={saveBnToDrive} disabled={saving}
                        className="flex items-center gap-2 w-full justify-center px-3 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                        style={{ background: '#22A87A' }}>
                        {saving ? <Loader size={14} className="animate-spin"/> : <CheckCircle size={14}/>}
                        Upload to Drive &amp; Save
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

      ) : (
        /* ══════════ OTHER DOC TYPES ══════════ */
        <div className="space-y-4">
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
      )}

      {/* Non-boat-note done modal */}
      {doneModal && !sendModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle size={20} className="text-green-500"/><h2 className="font-semibold text-gray-900">PDF Generated!</h2>
            </div>
            <p className="text-sm text-gray-500 mb-4">{doneModal.fileName}</p>
            <div className="flex gap-2">
              <button onClick={() => downloadPdf(doneModal.base64, doneModal.fileName)}
                className="btn-primary flex items-center gap-2 flex-1 justify-center"><FileDown size={14}/>Download</button>
              <button onClick={() => setSendModal(true)}
                className="flex items-center gap-2 flex-1 justify-center px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50">
                <Send size={14}/>Send
              </button>
            </div>
            <button onClick={() => setDoneModal(null)} className="mt-3 text-xs text-gray-400 hover:text-gray-600 w-full text-center">Close</button>
          </div>
        </div>
      )}

      {sendModal && sendFile && (
        <SendModal files={[sendFile]} onClose={() => { setSendModal(false); setDoneModal(null) }} onSent={() => { setSendModal(false); setDoneModal(null) }}/>
      )}

      {sendModalBn && sendFileBn && (
        <SendModal files={[sendFileBn]} onClose={() => setSendModalBn(false)} onSent={() => setSendModalBn(false)}/>
      )}
    </div>
  )
}

export default function DocsCreatePage() { return <DocsCreateContent/> }
DocsCreatePage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>
