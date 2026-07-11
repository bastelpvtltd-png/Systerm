import { XMLParser } from 'fast-xml-parser'

// Reads a real ASYCUDA CUSDEC XML export (the same tag shape asycudaXml.ts
// builds — see docs/AM.xml sample) back into the flat field names
// generate-boat-note.ts already expects on a `cusdec` row, so an uploaded
// XML can feed the Boat Note builder without that CUSDEC having been
// scanned/typed into the database first.
export interface ParsedCusdec {
  number: string
  exporter: string
  consignee: string
  vessel: string
  bl_no: string
  gross_mass: string
  goods_description: string
}

function textOf(node: any): string {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node === 'object' && 'null' in node) return ''
  return ''
}

export function parseCusdecXml(xml: string): ParsedCusdec {
  const parser = new XMLParser({ ignoreAttributes: false })
  const doc = parser.parse(xml)
  const root = doc?.ASYCUDA
  if (!root) throw new Error('Not a recognized ASYCUDA CUSDEC XML (missing <ASYCUDA> root)')

  const identification = root.Identification || {}
  const traders = identification.Traders || root.Traders || {}
  const transport = root.Transport || identification.Transport || {}
  const item = Array.isArray(root.Item) ? root.Item[0] : root.Item || {}

  return {
    number: textOf(identification.Registration?.Number),
    exporter: textOf(traders.Exporter?.Exporter_name),
    consignee: textOf(traders.Consignee?.Consignee_name),
    vessel: textOf(transport.Means_of_transport?.Departure_arrival_information?.Identity),
    bl_no: textOf(identification.Manifest_reference_number),
    gross_mass: textOf(root.Valuation?.Weight?.Gross_weight),
    goods_description: textOf(item.Goods_description?.Description_of_goods),
  }
}
