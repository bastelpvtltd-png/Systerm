import { useState, useRef } from 'react'
import AdminLayout from '@/components/admin/AdminLayout'
import { supabase } from '@/lib/supabase'
import { Upload, FileText, Package, ScanLine, Ship, Copy, CheckCircle, Loader, Save, Eye } from 'lucide-react'

type DocType = 'cusdec' | 'cdn' | 'barcode' | 'boat_note' | 'party_copy'
type PdfField = { grid: string; label: string; value: string }

const DOC_TYPES: { key: DocType; label: string; icon: any; color: string; canExtract: boolean }[] = [
  { key: 'cusdec',     label: 'CUSDEC',       icon: FileText, color: '#1B3A5C', canExtract: true  },
  { key: 'cdn',        label: 'CDN',           icon: Package,  color: '#22A87A', canExtract: true  },
  { key: 'barcode',    label: 'Barcode',       icon: ScanLine, color: '#f59e0b', canExtract: false },
  { key: 'boat_note',  label: 'Boat Note',     icon: Ship,     color: '#3b82f6', canExtract: false },
  { key: 'party_copy', label: "Party's Copy",  icon: Copy,     color: '#8b5cf6', canExtract: false },
]

interface UploadedDoc {
  docType: DocType
  fileName: string
  fileUrl: string
  fields: PdfField[]
  saved: boolean
}

export default function DocumentsPage() {
  const [active, setActive]         = useState<DocType>('cusdec')
  const [uploading, setUploading]   = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [docs, setDocs]             = useState<Record<DocType, UploadedDoc | null>>({
    cusdec: null, cdn: null, barcode: null, boat_note: null, party_copy: null,
  })
  const [editFields, setEditFields] = useState<PdfField[]>([])
  const [saving, setSaving]         = useState(false)
  const [showRaw, setShowRaw]       = useState(false)
  const [rawText, setRawText]       = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const activeDef = DOC_TYPES.find(d => d.key === active)!
  const activeDoc = docs[active]

  async function handleFile(file: File) {
    setUploading(true)
    setExtracting(false)
    setEditFields([])
    setRawText('')

    try {
      // 1. Upload to Supabase Storage
      const ext = file.name.split('.').pop()
      const path = `documents/${active}/${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage
        .from('export-docs')
        .upload(path, file, { upsert: true })

      let fileUrl = ''
      if (!upErr) {
        const { data } = supabase.storage.from('export-docs').getPublicUrl(path)
        fileUrl = data.publicUrl
      }

      // 2. Extract if CUSDEC or CDN
      let fields: PdfField[] = []
      if (activeDef.canExtract) {
        setExtracting(true)
        const base64 = await fileToBase64(file)
        const res = await fetch('/api/extract-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64, docType: active }),
        })
        const json = await res.json()
        fields = json.fields || []
        setRawText(json.rawText || '')
        setEditFields(fields)
        setExtracting(false)
      }

      const doc: UploadedDoc = { docType: active, fileName: file.name, fileUrl, fields, saved: false }
      setDocs(prev => ({ ...prev, [active]: doc }))
    } finally {
      setUploading(false)
      setExtracting(false)
    }
  }

  async function handleSaveToSupabase() {
    if (!activeDoc) return
    setSaving(true)
    try {
      const data: Record<string, any> = {}
      editFields.forEach(f => { data[`grid_${f.grid.replace(/\s/g,'_')}`] = f.value })

      if (active === 'cusdec') {
        const cusdecNo = editFields.find(f => f.grid === '1' || f.label.includes('Declaration'))?.value || ''
        await supabase.from('cusdec').insert({
          cusdec_no: cusdecNo,
          pdf_url: activeDoc.fileUrl,
          xml_data: JSON.stringify(data),
          status: 'pending',
        })
      } else if (active === 'cdn') {
        const cdnNo = editFields.find(f => f.grid === 'CDN')?.value || ''
        await supabase.from('cdn').insert({
          cdn_no: cdnNo,
          details: data,
          status: 'pending',
        })
      }

      // Save to uploaded_documents log
      await supabase.from('uploaded_documents').insert({
        doc_type: active,
        file_name: activeDoc.fileName,
        file_url: activeDoc.fileUrl,
        extracted_data: editFields.length ? data : null,
      })

      setDocs(prev => ({ ...prev, [active]: { ...prev[active]!, saved: true } }))
    } finally {
      setSaving(false)
    }
  }

  function updateField(idx: number, val: string) {
    setEditFields(prev => prev.map((f, i) => i === idx ? { ...f, value: val } : f))
  }

  return (
    <AdminLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
          <p className="text-gray-500 text-sm mt-1">Upload & extract data from export documents</p>
        </div>

        {/* Doc Type Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {DOC_TYPES.map(d => {
            const Icon = d.icon
            const uploaded = !!docs[d.key]
            return (
              <button key={d.key} onClick={() => { setActive(d.key); setEditFields(docs[d.key]?.fields || []) }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${
                  active === d.key
                    ? 'text-white border-transparent shadow-md'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
                style={active === d.key ? { background: d.color, borderColor: d.color } : {}}>
                <Icon size={16}/>
                {d.label}
                {uploaded && <CheckCircle size={14} className="text-green-400"/>}
              </button>
            )
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Upload Panel */}
          <div className="card">
            <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <activeDef.icon size={18} style={{ color: activeDef.color }}/>
              Upload {activeDef.label}
            </h2>

            {/* Drop Zone */}
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-green-300 hover:bg-green-50 transition-colors">
              {uploading || extracting ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader size={32} className="animate-spin text-green-500"/>
                  <p className="text-sm text-gray-500">
                    {uploading && !extracting ? 'Uploading...' : 'Extracting PDF data...'}
                  </p>
                </div>
              ) : activeDoc ? (
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle size={32} className="text-green-500"/>
                  <p className="text-sm font-medium text-gray-700">{activeDoc.fileName}</p>
                  <p className="text-xs text-gray-400">Click to replace</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Upload size={32} className="text-gray-300"/>
                  <p className="text-sm font-medium text-gray-600">Click to upload {activeDef.label} PDF</p>
                  <p className="text-xs text-gray-400">PDF files only</p>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".pdf" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}/>

            {/* Status */}
            {activeDoc && (
              <div className="mt-4 space-y-2">
                {activeDoc.fileUrl && (
                  <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 px-3 py-2 rounded-lg">
                    <CheckCircle size={12}/>
                    Saved to Supabase Storage
                  </div>
                )}
                {activeDoc.saved && (
                  <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 px-3 py-2 rounded-lg">
                    <CheckCircle size={12}/>
                    Data saved to database
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Extracted Data Panel */}
          {activeDef.canExtract && (
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">Extracted Fields</h2>
                <div className="flex gap-2">
                  {rawText && (
                    <button onClick={() => setShowRaw(!showRaw)}
                      className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
                      <Eye size={12}/> {showRaw ? 'Table' : 'Raw Text'}
                    </button>
                  )}
                  {editFields.length > 0 && !activeDoc?.saved && (
                    <button onClick={handleSaveToSupabase} disabled={saving}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg text-white font-medium"
                      style={{ background: saving ? '#94a3b8' : '#22A87A' }}>
                      {saving ? <Loader size={12} className="animate-spin"/> : <Save size={12}/>}
                      Save to DB
                    </button>
                  )}
                </div>
              </div>

              {showRaw ? (
                <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-96 text-gray-700 whitespace-pre-wrap">
                  {rawText}
                </pre>
              ) : editFields.length > 0 ? (
                <div className="overflow-auto max-h-96">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="text-left px-2 py-2 text-gray-500 font-medium w-12">Grid</th>
                        <th className="text-left px-2 py-2 text-gray-500 font-medium w-36">Field</th>
                        <th className="text-left px-2 py-2 text-gray-500 font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editFields.map((f, i) => (
                        <tr key={i} className="border-t border-gray-50 hover:bg-gray-50">
                          <td className="px-2 py-1.5">
                            <span className="inline-block bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-mono text-xs">
                              {f.grid}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-gray-600 font-medium">{f.label}</td>
                          <td className="px-2 py-1.5">
                            <input
                              value={f.value}
                              onChange={e => updateField(i, e.target.value)}
                              className="w-full bg-transparent border-b border-transparent hover:border-gray-200 focus:border-green-400 focus:outline-none py-0.5 text-gray-800"
                              placeholder="—"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <FileText size={32} className="text-gray-200 mb-3"/>
                  <p className="text-sm text-gray-400">Upload a {activeDef.label} PDF to extract fields</p>
                </div>
              )}
            </div>
          )}

          {/* Non-extractable doc info */}
          {!activeDef.canExtract && (
            <div className="card flex flex-col items-center justify-center py-12 text-center">
              <activeDef.icon size={32} className="text-gray-200 mb-3"/>
              <p className="text-sm text-gray-500 font-medium">{activeDef.label}</p>
              <p className="text-xs text-gray-400 mt-1">File saved to storage on upload</p>
            </div>
          )}
        </div>

        {/* All Uploaded Summary */}
        <div className="card mt-6">
          <h2 className="font-semibold text-gray-900 mb-4">This Session Uploads</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {DOC_TYPES.map(d => {
              const doc = docs[d.key]
              const Icon = d.icon
              return (
                <div key={d.key} onClick={() => { setActive(d.key); setEditFields(docs[d.key]?.fields || []) }}
                  className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                    doc ? 'border-green-200 bg-green-50' : 'border-gray-100 bg-gray-50'
                  }`}>
                  <Icon size={20} style={{ color: doc ? '#22A87A' : '#d1d5db' }}/>
                  <span className="text-xs font-medium text-gray-600">{d.label}</span>
                  {doc ? (
                    <span className="text-xs text-green-600 font-medium">✓ Uploaded</span>
                  ) : (
                    <span className="text-xs text-gray-400">Pending</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload = () => res((reader.result as string).split(',')[1])
    reader.onerror = rej
    reader.readAsDataURL(file)
  })
}
