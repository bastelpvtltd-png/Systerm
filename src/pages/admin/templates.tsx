import { useEffect, useState } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { authHeader } from '@/lib/supabase'
import { FileStack, Upload, Trash2, FileDown, AlertTriangle, Loader } from 'lucide-react'

// Word template upload with {{placeholder}} tags (e.g. {{invoice_number}},
// {{consignee_name}}, {{total_value}}) — upload once, then any time a
// document of that shape is needed, pick the template, fill in the detected
// tags, and get a one-page PDF with those values substituted in place of the
// tags (paragraph layout/order preserved from the original .docx).
interface DocTemplate { id: string; name: string; file_name: string; drive_url: string | null; raw_text: string; placeholders: string[]; created_at: string }

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function TemplatesContent() {
  const { has } = usePermission()
  const canUse = has('section:templates.manage')
  const [templates, setTemplates] = useState<DocTemplate[]>([])
  const [uploading, setUploading] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [selectedId, setSelectedId] = useState<string>('')
  const [values, setValues] = useState<Record<string, string>>({})

  async function loadTemplates() {
    const res = await fetch('/api/list-templates')
    const d = await res.json()
    if (res.ok) setTemplates(d.templates || [])
  }
  useEffect(() => { loadTemplates() }, [])

  const selected = templates.find(t => t.id === selectedId) || null
  useEffect(() => { setValues({}) }, [selectedId])

  async function handleUpload() {
    setError('')
    if (!file) { setError('Choose a .docx file first'); return }
    setUploading(true)
    try {
      const base64 = await fileToBase64(file)
      let driveUrl = ''
      try {
        const dr = await fetch('/api/upload-to-drive', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64, fileName: file.name, mimeType: file.type, docType: 'template' }),
        })
        const dd = await dr.json()
        if (dr.ok && dd.driveLink) driveUrl = dd.driveLink
      } catch {}

      const res = await fetch('/api/upload-template', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ base64, fileName: file.name, name: templateName || file.name, driveUrl }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Upload failed')
      setStatus(`✓ Template saved — ${d.template.placeholders.length} placeholder(s) detected`)
      setFile(null); setTemplateName('')
      await loadTemplates()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this template?')) return
    await fetch(`/api/list-templates?id=${id}`, { method: 'DELETE' })
    if (selectedId === id) setSelectedId('')
    await loadTemplates()
  }

  async function generatePdf() {
    if (!selected) return
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const M = 15
    let y = M
    const filled = selected.raw_text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => values[key] ?? '')

    doc.setFont('helvetica', 'normal').setFontSize(10)
    for (const paragraph of filled.split('\n')) {
      const lines = doc.splitTextToSize(paragraph || ' ', 210 - M * 2)
      for (const line of lines) {
        if (y > 280) { doc.addPage(); y = M }
        doc.text(line, M, y)
        y += 5.5
      }
    }
    doc.save(`${selected.name.replace(/[^\w.-]+/g, '_')}.pdf`)
  }

  if (!canUse) return <div className="p-6 text-gray-400 text-sm">You don't have access to this page.</div>

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FileStack size={20} className="text-[#3b82f6]"/>Templates</h1>
        <p className="text-gray-500 text-sm mt-0.5">Upload a Word template with {'{{placeholder}}'} tags — fill them in and generate a PDF</p>
      </div>

      {error && <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3"><AlertTriangle size={16}/>{error}</div>}
      {status && <p className="text-sm text-green-600 mb-4">{status}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card">
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Upload Template</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Template Name</label>
              <input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="e.g. Certificate of Origin" className="input"/>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">.docx File</label>
              <input type="file" accept=".docx" onChange={e => setFile(e.target.files?.[0] || null)} className="text-sm"/>
            </div>
            <button onClick={handleUpload} disabled={uploading} className="btn-primary flex items-center gap-2">
              {uploading ? <Loader size={14} className="animate-spin"/> : <Upload size={14}/>}Upload Template
            </button>
          </div>

          <h2 className="font-semibold text-gray-900 text-sm mt-6 mb-3">Saved Templates</h2>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {templates.map(t => (
              <div key={t.id} onClick={() => setSelectedId(t.id)}
                className={`flex items-center justify-between p-2.5 rounded-lg border text-xs cursor-pointer ${selectedId === t.id ? 'bg-blue-50 border-blue-300' : 'border-gray-100 hover:bg-gray-50'}`}>
                <div>
                  <p className="font-medium text-gray-800">{t.name}</p>
                  <p className="text-gray-400">{t.placeholders.length} tag{t.placeholders.length === 1 ? '' : 's'}</p>
                </div>
                <button onClick={e => { e.stopPropagation(); handleDelete(t.id) }} className="text-gray-300 hover:text-red-500"><Trash2 size={14}/></button>
              </div>
            ))}
            {templates.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No templates uploaded yet</p>}
          </div>
        </div>

        <div className="card">
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Fill & Generate</h2>
          {!selected ? (
            <p className="text-xs text-gray-400 text-center py-12">Select a template to fill in its tags</p>
          ) : selected.placeholders.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-12">No {'{{tags}}'} were detected in this template</p>
          ) : (
            <>
              <div className="space-y-3 mb-4">
                {selected.placeholders.map(p => (
                  <div key={p}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{'{{' + p + '}}'}</label>
                    <input value={values[p] || ''} onChange={e => setValues(v => ({ ...v, [p]: e.target.value }))} className="input"/>
                  </div>
                ))}
              </div>
              <button onClick={generatePdf} className="btn-primary flex items-center gap-2">
                <FileDown size={14}/>Generate PDF
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function TemplatesPage() {
  return <TemplatesContent/>
}
TemplatesPage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>
