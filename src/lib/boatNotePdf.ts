import type { BoatNote } from '@/lib/useBoatNoteCreator'

// Exact same Exp 3a PDF layout as Docs Create's Boat Note tab
// (src/pages/admin/boat-note.tsx's downloadPdf) — shared so the Automation
// tab's Boat Note Create option produces an identical document instead of a
// second, drifting copy of the box layout.
const COMPANY = {
  name: 'PRIYANTHI AGENCY',
  declarant: 'H A B P KUMRA',
  ca_no: '706266609',
  tel: '',
}

export async function downloadBoatNotePdf(boatNotes: BoatNote[], cusdecNo: string) {
  if (!boatNotes.length) return
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  const PW = 277
  const M = 10

  boatNotes.forEach((bn, pi) => {
    if (pi > 0) doc.addPage()
    let y = M

    doc.setFontSize(10).setFont('helvetica', 'bold')
    doc.text('SHIPPING NOTE / BOAT NOTE  -  Exp 3a', M + PW / 2, y + 4, { align: 'center' })
    y += 8

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

    const h1 = 18, h2 = 12, h3 = 10

    cell(M, y, 99, h1, '1.  Shipper (Name and Address)  3336/7', bn.shipper.replace(/\r?\n/g, ' '), 96)
    cell(M + 99, y, 60, h1, '9.  Custom Entry No.', bn.entry_no)
    cell(M + 159, y, 60, h1, '10.  SN(B/L) No.', bn.bl_no)
    y += h1

    box(M, y, 99, h2); label(M, y, '')
    cell(M + 99, y, 60, h2, '11.  Exporter\'s Registration No.', '')
    cell(M + 159, y, 60, h2, '12.  SLPA No.', bn.slpa_no)
    y += h2

    cell(M, y, 99, h1, '2.  Consignee (Name and Address)  3132/3', bn.consignee.replace(/\r?\n/g, ' '), 96)
    cell(M + 99, y, 120, h1, '13.  Name of Shipping Line / MTO  3126/7', 'PRIYANTHI AGENCY')
    y += h1

    cell(M, y, 99, h2, '3.  Notify Address  3180/1', 'SAME AS ABOVE')
    cell(M + 99, y, 120, h2, '14. (a) Place of Acceptance  3348/9', bn.loading_port)
    y += h2

    cell(M, y, 55, h2, '4.  Voyage No./Date  8228', `${bn.voyage}  ${bn.voyage_date}`)
    cell(M + 55, y, 44, h2, '5.  Warehouse No.  3156  (Terminal)', bn.terminal)
    cell(M + 99, y, 120, h2, '14. (b) Place of Delivery  3246/7', bn.discharge_port)
    y += h2

    cell(M, y, 99, h2, '6.  Vessel  8122/3', bn.vessel)
    cell(M + 99, y, 60, h2, '7.  Port of Loading  3230/1', bn.loading_port)
    cell(M + 159, y, 60, h2, '', '')
    y += h2

    cell(M, y, 55, h3, '8.  Port of Discharge  3414/5', bn.discharge_port)
    cell(M + 55, y, 22, h3, 'VSL OPR CODE', bn.voc)
    cell(M + 77, y, 22, h3, 'CNT OPR CODE', bn.coc)
    box(M + 99, y, 120, h3)
    doc.setFont('helvetica', 'italic').setFontSize(6)
    doc.text('  The Company Preparing this note declares that to the best of their belief the goods', M + 100, y + 4)
    doc.text('  have been accurately described, their quantities weights and measurements are correct.', M + 100, y + 8)
    y += h3

    const th = 7
    cell(M, y, 45, th, '15. Marks & Nos. / Container Nos.  7102', '')
    cell(M + 45, y, 30, th, '16. Number and Kind of Packages  7224/5', '')
    cell(M + 75, y, 50, th, '17. Description of Goods  7002', '')
    cell(M + 125, y, 22, th, '18. CCN NO.  7282', '')
    cell(M + 147, y, 24, th, '19.(a) Gross Wt (Kg)  6292', '')
    cell(M + 171, y, 17, th, '20.(a) Cube m³  6324', '')
    cell(M + 188, y, 31, th, 'Lorry / Trailer', '')
    y += th

    const dr = 14
    box(M, y, 45, dr); val(M, y, bn.container_no, 42)
    box(M + 45, y, 30, dr)
    doc.setFont('helvetica', 'normal').setFontSize(8)
    doc.text(`1 X ${bn.con_type || '40'} FCL`, M + 46, y + 8)
    box(M + 75, y, 50, dr); val(M + 75, y, bn.goods, 47)
    box(M + 125, y, 22, dr); val(M + 125, y, bn.cdn_no, 20)
    box(M + 147, y, 24, dr)
    doc.text(bn.gross_mass ? `${bn.gross_mass} KGS` : '', M + 148, y + 8)
    box(M + 171, y, 17, dr); val(M + 171, y, bn.volume || '60', 15)
    box(M + 188, y, 31, dr); val(M + 188, y, `${bn.lorry_no}  ${bn.trailer_no}`, 28)
    y += dr

    const sr = 10
    cell(M, y, 45, sr, '  Seal No.', bn.seal_no)
    cell(M + 45, y, 30, sr, '  Driver', bn.driver_name.slice(0, 18))
    box(M + 75, y, 50, sr)
    box(M + 125, y, 22, sr); label(M + 125, y, '19.(e) Shipped (BL)')
    doc.setFont('helvetica', 'normal').setFontSize(8)
    doc.text(`${bn.pkg_no} BL`, M + 126, y + 8)
    cell(M + 147, y, 24, sr, '19.(b) Net Wt (Kg)', bn.gross_mass ? `${bn.gross_mass} KGS` : '')
    box(M + 171, y, 17, sr)
    box(M + 188, y, 31, sr)
    y += sr

    const fr = 10
    box(M, y, 55, fr); label(M, y, '21. For SLPA Use')
    cell(M + 55, y, 44, fr, '25.(a) Status of Container', 'FCL')
    cell(M + 99, y, 60, fr, '25.(b) Freight Payable At', bn.discharge_port)
    cell(M + 159, y, 60, fr, '26. No. of Original B/L', '3')
    y += fr

    const cr = 12
    cell(M, y, 55, cr, '23. Shipping Agent', COMPANY.name)
    cell(M + 55, y, 44, cr, '30. Name of Company Preparing this Note', COMPANY.name)
    cell(M + 99, y, 60, cr, '31. Name of Declarant  3140/1', COMPANY.declarant)
    cell(M + 159, y, 60, cr, '32. Tel No.', COMPANY.tel)
    y += cr

    box(M, y, 219, h3)
    doc.setFont('helvetica', 'normal').setFontSize(7)
    doc.text(`Please debit our C/A No. ${COMPANY.ca_no} with charges payable`, M + 2, y + 6)
    box(M + 219, y, 58, h3); label(M + 219, y, '33. Signature of Declarant                              Date')
    y += h3

    doc.setFont('helvetica', 'italic').setFontSize(6.5)
    doc.text(`Generated by Export Management System  ·  CUSDEC ${cusdecNo}  ·  ${new Date().toLocaleDateString('en-GB')}`, M + PW / 2, y + 5, { align: 'center' })
  })

  const dt = new Date().toISOString().slice(0, 10)
  doc.save(`BOAT_NOTE_${cusdecNo}_${dt}.pdf`)
}
