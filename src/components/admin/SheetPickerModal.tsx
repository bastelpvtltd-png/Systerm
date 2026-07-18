import { Loader, FileDown, AlertTriangle, X } from 'lucide-react'

// Shown as a popup the instant Sheet Routing can't resolve a Fill/Print
// sheet on its own (no route matches the shipper's TIN VAT, or their routed
// tab was deleted) — see SHEET_SELECTION_REQUIRED in docGenerate.ts. Used by
// every generate() call site that can hit this (Boat Note, Party's Copy,
// CustomDocPanel) instead of each maintaining its own inline picker card.
export default function SheetPickerModal({ message, sheets, fillGid, printGid, onFillChange, onPrintChange, onConfirm, onClose, busy }: {
  message: string
  sheets: { title: string; sheetId: number }[]
  fillGid: string
  printGid: string
  onFillChange: (gid: string) => void
  onPrintChange: (gid: string) => void
  onConfirm: () => void
  onClose: () => void
  busy: boolean
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-bold text-gray-900 text-sm">Pick a Sheet</h2>
          <button onClick={onClose} disabled={busy}><X size={20} className={busy ? 'opacity-30' : ''}/></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-amber-700 flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5"/>{message}
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Fill Sheet</label>
            <select value={fillGid} onChange={e => onFillChange(e.target.value)} className="input text-sm w-full">
              <option value="">— select —</option>
              {sheets.map(s => <option key={s.sheetId} value={s.sheetId}>{s.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Print Sheet</label>
            <select value={printGid} onChange={e => onPrintChange(e.target.value)} className="input text-sm w-full">
              <option value="">— select —</option>
              {sheets.map(s => <option key={s.sheetId} value={s.sheetId}>{s.title}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t">
          <button onClick={onClose} disabled={busy} className="btn-secondary flex-1 disabled:opacity-50">Cancel</button>
          <button onClick={onConfirm} disabled={busy || !fillGid || !printGid} className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-40">
            {busy ? <Loader size={14} className="animate-spin"/> : <FileDown size={14}/>}Generate
          </button>
        </div>
      </div>
    </div>
  )
}
