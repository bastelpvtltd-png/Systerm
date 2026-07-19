// Builds an ASYCUDA-format export CUSDEC XML matching the structure of a real
// exported declaration (see docs/AM.xml sample) — only the fields that
// actually carry data in a real declaration are exposed as form inputs; every
// other tag in the structure is boilerplate (<null/> or a fixed default) and
// is emitted as-is so the output always matches what ASYCUDA expects.

export interface XmlValues {
  asycudaId: string
  sadFlow: string
  totalItems: string
  totalPackages: string
  officeCode: string
  officeName: string
  regSerial: string
  regNumber: string
  regDate: string
  assessSerial: string
  assessNumber: string
  assessDate: string
  receiptSerial: string
  receiptNumber: string
  receiptDate: string
  exporterCode: string
  exporterName: string
  consigneeName: string
  declarantCode: string
  declarantName: string
  declarantReference: string
  countryFirstDestination: string
  tradingCountry: string
  destinationCountryCode: string
  destinationCountryName: string
  countryOfOriginName: string
  cap: string
  vesselIdentity: string
  borderInfoIdentity: string
  borderMode: string
  containerFlag: string
  deliveryTermsCode: string
  placeOfLoadingCode: string
  placeOfLoadingName: string
  locationOfGoods: string
  bankCode: string
  bankName: string
  bankBranch: string
  bankReference: string
  termsCode: string
  termsDescription: string
  modeOfPayment: string
  globalTaxes: string
  totalTaxes: string
  totalCif: string
  invoiceAmountNational: string
  invoiceAmountForeign: string
  currencyCode: string
  totalInvoice: string
  totalWeight: string
  attachedDocCode: string
  attachedDocName: string
  attachedDocReference: string
  attachedDocDate: string
  numberOfPackages: string
  marks1: string
  marks2: string
  packageKindCode: string
  packageKindName: string
  hsCode: string
  hsPrecision1: string
  preferenceCode: string
  extendedProcedure: string
  nationalProcedure: string
  supplementaryUnitCode: string
  supplementaryUnitName: string
  supplementaryUnitQuantity: string
  itemPrice: string
  countryOfOriginCode: string
  descriptionOfGoods: string
  previousDocSummaryDeclaration: string
  licenceNumber: string
  quantityDeductedFromLicence: string
  itemTaxesAmount: string
  dutyTaxCode1: string
  dutyTaxBase1: string
  dutyTaxRate1: string
  dutyTaxAmount1: string
  dutyTaxCode2: string
  dutyTaxBase2: string
  dutyTaxRate2: string
  dutyTaxAmount2: string
  grossWeightItm: string
  netWeightItm: string
  statisticalValue: string
}

export const emptyXmlValues = (): XmlValues => ({
  asycudaId: '', sadFlow: 'E', totalItems: '1', totalPackages: '',
  officeCode: 'CBEX1', officeName: 'Colombo Exports Office',
  regSerial: 'E', regNumber: '', regDate: '',
  assessSerial: 'A', assessNumber: '', assessDate: '',
  receiptSerial: 'R', receiptNumber: '', receiptDate: '',
  exporterCode: '', exporterName: '', consigneeName: '',
  declarantCode: '', declarantName: '', declarantReference: '',
  countryFirstDestination: '', tradingCountry: '',
  destinationCountryCode: '', destinationCountryName: '', countryOfOriginName: 'Sri Lanka',
  cap: '01', vesselIdentity: '', borderInfoIdentity: '', borderMode: '1', containerFlag: 'true',
  deliveryTermsCode: 'CIF', placeOfLoadingCode: '', placeOfLoadingName: '', locationOfGoods: '',
  bankCode: '', bankName: '', bankBranch: '', bankReference: '',
  termsCode: '10', termsDescription: 'Advanced payment', modeOfPayment: 'CASH',
  globalTaxes: '', totalTaxes: '', totalCif: '',
  invoiceAmountNational: '', invoiceAmountForeign: '', currencyCode: 'USD',
  totalInvoice: '', totalWeight: '',
  attachedDocCode: 'CDA', attachedDocName: 'COCONUT DEVELOPMENT AUTHORITY', attachedDocReference: '', attachedDocDate: '',
  numberOfPackages: '', marks1: '', marks2: '', packageKindCode: 'BL', packageKindName: 'Bale, compressed',
  hsCode: '', hsPrecision1: '00', preferenceCode: 'APTA', extendedProcedure: '1000', nationalProcedure: '000',
  supplementaryUnitCode: 'KGM', supplementaryUnitName: 'Kilogram', supplementaryUnitQuantity: '',
  itemPrice: '', countryOfOriginCode: 'LK', descriptionOfGoods: '',
  previousDocSummaryDeclaration: '', licenceNumber: '', quantityDeductedFromLicence: '',
  itemTaxesAmount: '',
  dutyTaxCode1: 'CC1', dutyTaxBase1: '', dutyTaxRate1: '0.25', dutyTaxAmount1: '',
  dutyTaxCode2: 'CED', dutyTaxBase2: '', dutyTaxRate2: '0', dutyTaxAmount2: '',
  grossWeightItm: '', netWeightItm: '', statisticalValue: '',
})

function esc(v: string) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
// ASYCUDA leaves genuinely-absent leaf values as <Tag>\n<null/>\n</Tag>; a
// present value replaces the null node with the plain value.
function tag(name: string, value: string, indent: string) {
  return value
    ? `${indent}<${name}>${esc(value)}</${name}>`
    : `${indent}<${name}>\n${indent}<null/>\n${indent}</${name}>`
}

// ── Field mapping (Templates tab "ASYCUDA CUSDEC XML" format) ──────────────
// Every key in XmlValues, broken down with a sensible default data source so
// the Templates page can auto-seed a full set of mapping rows instead of the
// user building 85 rows from scratch. "manual" fields repurpose column_name
// (see TemplateMapping) to hold the literal default value itself — the same
// value emptyXmlValues() ships — rather than a picked DB column, since these
// are mostly fixed declaration constants (office code, SAD flow, etc.) that
// only rarely need overriding, exactly like trico_gate_pass repurposes
// target_cell_or_range for its own format-specific meaning.
export interface XmlFieldDef {
  key: keyof XmlValues
  label: string
  group: string
  defaultSource: 'cusdec' | 'cdn' | 'manual'
  defaultColumn?: string
}

const d = emptyXmlValues()

export const XML_FIELD_DEFS: XmlFieldDef[] = [
  // Identification
  { key: 'asycudaId', label: 'ASYCUDA ID (blank = auto)', group: 'Identification', defaultSource: 'manual', defaultColumn: '' },
  { key: 'sadFlow', label: 'SAD Flow', group: 'Identification', defaultSource: 'manual', defaultColumn: d.sadFlow },
  { key: 'totalItems', label: 'Total Items', group: 'Identification', defaultSource: 'manual', defaultColumn: d.totalItems },
  { key: 'totalPackages', label: 'Total Packages', group: 'Identification', defaultSource: 'cusdec', defaultColumn: 'total_packages' },
  { key: 'officeCode', label: 'Customs Office Code', group: 'Identification', defaultSource: 'manual', defaultColumn: d.officeCode },
  { key: 'officeName', label: 'Customs Office Name', group: 'Identification', defaultSource: 'manual', defaultColumn: d.officeName },
  { key: 'regSerial', label: 'Registration Serial', group: 'Identification', defaultSource: 'manual', defaultColumn: d.regSerial },
  { key: 'regNumber', label: 'Registration Number', group: 'Identification', defaultSource: 'cusdec', defaultColumn: 'number' },
  { key: 'regDate', label: 'Registration Date', group: 'Identification', defaultSource: 'cusdec', defaultColumn: 'date' },
  { key: 'assessSerial', label: 'Assessment Serial', group: 'Identification', defaultSource: 'manual', defaultColumn: d.assessSerial },
  { key: 'assessNumber', label: 'Assessment Number', group: 'Identification', defaultSource: 'cusdec', defaultColumn: 'assess_number' },
  { key: 'assessDate', label: 'Assessment Date', group: 'Identification', defaultSource: 'cusdec', defaultColumn: 'assess_date' },
  { key: 'receiptSerial', label: 'Receipt Serial', group: 'Identification', defaultSource: 'manual', defaultColumn: d.receiptSerial },
  { key: 'receiptNumber', label: 'Receipt Number', group: 'Identification', defaultSource: 'cusdec', defaultColumn: 'receipt_number' },
  { key: 'receiptDate', label: 'Receipt Date', group: 'Identification', defaultSource: 'cusdec', defaultColumn: 'receipt_date' },

  // Traders / Declarant
  { key: 'exporterCode', label: 'Exporter Code (TIN/VAT)', group: 'Traders / Declarant', defaultSource: 'cusdec', defaultColumn: 'tin_vat' },
  { key: 'exporterName', label: 'Exporter Name', group: 'Traders / Declarant', defaultSource: 'cusdec', defaultColumn: 'exporter' },
  { key: 'consigneeName', label: 'Consignee Name', group: 'Traders / Declarant', defaultSource: 'cusdec', defaultColumn: 'consignee' },
  { key: 'declarantCode', label: 'Declarant Code', group: 'Traders / Declarant', defaultSource: 'cusdec', defaultColumn: 'declarant_code' },
  { key: 'declarantName', label: 'Declarant Name', group: 'Traders / Declarant', defaultSource: 'cusdec', defaultColumn: 'declarant_name' },
  { key: 'declarantReference', label: 'Declarant Reference', group: 'Traders / Declarant', defaultSource: 'cusdec', defaultColumn: 'reference' },

  // Country / General
  { key: 'countryFirstDestination', label: 'Country of First Destination', group: 'Country / General', defaultSource: 'cusdec', defaultColumn: 'country_first_destination' },
  { key: 'tradingCountry', label: 'Trading Country', group: 'Country / General', defaultSource: 'cusdec', defaultColumn: 'trading_country' },
  { key: 'destinationCountryCode', label: 'Destination Country Code', group: 'Country / General', defaultSource: 'cusdec', defaultColumn: 'destination_country_code' },
  { key: 'destinationCountryName', label: 'Destination Country Name', group: 'Country / General', defaultSource: 'cusdec', defaultColumn: 'destination_country_name' },
  { key: 'countryOfOriginName', label: 'Country of Origin Name', group: 'Country / General', defaultSource: 'manual', defaultColumn: d.countryOfOriginName },
  { key: 'countryOfOriginCode', label: 'Country of Origin Code', group: 'Country / General', defaultSource: 'manual', defaultColumn: d.countryOfOriginCode },
  { key: 'cap', label: 'CAP', group: 'Country / General', defaultSource: 'cusdec', defaultColumn: 'cap' },

  // Transport
  { key: 'vesselIdentity', label: 'Vessel', group: 'Transport', defaultSource: 'cusdec', defaultColumn: 'vessel' },
  { key: 'borderInfoIdentity', label: 'Border Info (Voyage/Date)', group: 'Transport', defaultSource: 'cusdec', defaultColumn: 'border_info_identity' },
  { key: 'borderMode', label: 'Border Mode', group: 'Transport', defaultSource: 'manual', defaultColumn: d.borderMode },
  { key: 'containerFlag', label: 'Container Flag', group: 'Transport', defaultSource: 'manual', defaultColumn: d.containerFlag },
  { key: 'deliveryTermsCode', label: 'Delivery Terms Code', group: 'Transport', defaultSource: 'cusdec', defaultColumn: 'delivery_terms' },
  { key: 'placeOfLoadingCode', label: 'Place of Loading Code', group: 'Transport', defaultSource: 'cusdec', defaultColumn: 'place_of_loading_code' },
  { key: 'placeOfLoadingName', label: 'Place of Loading Name', group: 'Transport', defaultSource: 'cusdec', defaultColumn: 'place_of_loading_name' },
  { key: 'locationOfGoods', label: 'Location of Goods', group: 'Transport', defaultSource: 'cusdec', defaultColumn: 'location_of_goods' },

  // Financial / Bank
  { key: 'bankCode', label: 'Bank Code', group: 'Financial / Bank', defaultSource: 'cusdec', defaultColumn: 'bank_code' },
  { key: 'bankName', label: 'Bank Name', group: 'Financial / Bank', defaultSource: 'cusdec', defaultColumn: 'bank_name' },
  { key: 'bankBranch', label: 'Bank Branch', group: 'Financial / Bank', defaultSource: 'cusdec', defaultColumn: 'bank_branch' },
  { key: 'bankReference', label: 'Bank Reference', group: 'Financial / Bank', defaultSource: 'cusdec', defaultColumn: 'bank_reference' },
  { key: 'termsCode', label: 'Payment Terms Code', group: 'Financial / Bank', defaultSource: 'cusdec', defaultColumn: 'payment_terms_code' },
  { key: 'termsDescription', label: 'Payment Terms Description', group: 'Financial / Bank', defaultSource: 'cusdec', defaultColumn: 'payment_terms_description' },
  { key: 'modeOfPayment', label: 'Mode of Payment', group: 'Financial / Bank', defaultSource: 'cusdec', defaultColumn: 'mode_of_payment' },
  { key: 'globalTaxes', label: 'Global Taxes', group: 'Financial / Bank', defaultSource: 'cusdec', defaultColumn: 'global_taxes' },
  { key: 'totalTaxes', label: 'Total Taxes', group: 'Financial / Bank', defaultSource: 'cusdec', defaultColumn: 'total_taxes' },

  // Valuation
  { key: 'totalCif', label: 'Total CIF', group: 'Valuation', defaultSource: 'cusdec', defaultColumn: 'amount' },
  { key: 'invoiceAmountNational', label: 'Invoice Amount (LKR)', group: 'Valuation', defaultSource: 'cusdec', defaultColumn: 'invoice_amount_lkr' },
  { key: 'invoiceAmountForeign', label: 'Invoice Amount (Foreign)', group: 'Valuation', defaultSource: 'cusdec', defaultColumn: 'invoice_amount_usd' },
  { key: 'currencyCode', label: 'Currency Code', group: 'Valuation', defaultSource: 'manual', defaultColumn: d.currencyCode },
  { key: 'totalInvoice', label: 'Total Invoice', group: 'Valuation', defaultSource: 'cusdec', defaultColumn: 'invoice_amount_usd' },
  { key: 'totalWeight', label: 'Total Weight', group: 'Valuation', defaultSource: 'cusdec', defaultColumn: 'gross_mass' },

  // Attached Documents / Packages
  { key: 'attachedDocCode', label: 'Attached Doc Code', group: 'Attached Documents / Packages', defaultSource: 'manual', defaultColumn: d.attachedDocCode },
  { key: 'attachedDocName', label: 'Attached Doc Name', group: 'Attached Documents / Packages', defaultSource: 'manual', defaultColumn: d.attachedDocName },
  { key: 'attachedDocReference', label: 'Attached Doc Reference', group: 'Attached Documents / Packages', defaultSource: 'cusdec', defaultColumn: 'licence_number' },
  { key: 'attachedDocDate', label: 'Attached Doc Date', group: 'Attached Documents / Packages', defaultSource: 'cusdec', defaultColumn: 'licence_date' },
  { key: 'numberOfPackages', label: 'Number of Packages', group: 'Attached Documents / Packages', defaultSource: 'cusdec', defaultColumn: 'total_packages' },
  { key: 'marks1', label: 'Marks 1', group: 'Attached Documents / Packages', defaultSource: 'cusdec', defaultColumn: 'marks1' },
  { key: 'marks2', label: 'Marks 2', group: 'Attached Documents / Packages', defaultSource: 'cusdec', defaultColumn: 'marks2' },
  { key: 'packageKindCode', label: 'Package Kind Code', group: 'Attached Documents / Packages', defaultSource: 'cusdec', defaultColumn: 'package_kind_code' },
  { key: 'packageKindName', label: 'Package Kind Name', group: 'Attached Documents / Packages', defaultSource: 'cusdec', defaultColumn: 'package_kind_name' },

  // Tarification / HS
  { key: 'hsCode', label: 'HS Code', group: 'Tarification / HS', defaultSource: 'cusdec', defaultColumn: 'hs_code' },
  { key: 'hsPrecision1', label: 'HS Precision', group: 'Tarification / HS', defaultSource: 'manual', defaultColumn: d.hsPrecision1 },
  { key: 'preferenceCode', label: 'Preference Code', group: 'Tarification / HS', defaultSource: 'cusdec', defaultColumn: 'preference_code' },
  { key: 'extendedProcedure', label: 'Extended Procedure', group: 'Tarification / HS', defaultSource: 'cusdec', defaultColumn: 'procedure_code' },
  { key: 'nationalProcedure', label: 'National Procedure', group: 'Tarification / HS', defaultSource: 'manual', defaultColumn: d.nationalProcedure },
  { key: 'supplementaryUnitCode', label: 'Supplementary Unit Code', group: 'Tarification / HS', defaultSource: 'manual', defaultColumn: d.supplementaryUnitCode },
  { key: 'supplementaryUnitName', label: 'Supplementary Unit Name', group: 'Tarification / HS', defaultSource: 'manual', defaultColumn: d.supplementaryUnitName },
  { key: 'supplementaryUnitQuantity', label: 'Supplementary Unit Quantity', group: 'Tarification / HS', defaultSource: 'cusdec', defaultColumn: 'net_mass' },
  { key: 'itemPrice', label: 'Item Price', group: 'Tarification / HS', defaultSource: 'cusdec', defaultColumn: 'invoice_amount_usd' },
  { key: 'descriptionOfGoods', label: 'Description of Goods', group: 'Tarification / HS', defaultSource: 'cusdec', defaultColumn: 'goods' },
  { key: 'previousDocSummaryDeclaration', label: 'Previous Doc (Summary Declaration)', group: 'Tarification / HS', defaultSource: 'cusdec', defaultColumn: 'summary_declaration' },
  { key: 'licenceNumber', label: 'Licence Number', group: 'Tarification / HS', defaultSource: 'cusdec', defaultColumn: 'licence_number' },
  { key: 'quantityDeductedFromLicence', label: 'Quantity Deducted from Licence', group: 'Tarification / HS', defaultSource: 'cusdec', defaultColumn: 'net_mass' },

  // Taxation
  { key: 'itemTaxesAmount', label: 'Item Taxes Amount', group: 'Taxation', defaultSource: 'cusdec', defaultColumn: 'item_taxes_amount' },
  { key: 'dutyTaxCode1', label: 'Duty Tax Code 1', group: 'Taxation', defaultSource: 'manual', defaultColumn: d.dutyTaxCode1 },
  { key: 'dutyTaxBase1', label: 'Duty Tax Base 1', group: 'Taxation', defaultSource: 'cusdec', defaultColumn: 'net_mass' },
  { key: 'dutyTaxRate1', label: 'Duty Tax Rate 1', group: 'Taxation', defaultSource: 'manual', defaultColumn: d.dutyTaxRate1 },
  { key: 'dutyTaxAmount1', label: 'Duty Tax Amount 1', group: 'Taxation', defaultSource: 'cusdec', defaultColumn: 'duty_amount_cc1' },
  { key: 'dutyTaxCode2', label: 'Duty Tax Code 2', group: 'Taxation', defaultSource: 'manual', defaultColumn: d.dutyTaxCode2 },
  { key: 'dutyTaxBase2', label: 'Duty Tax Base 2', group: 'Taxation', defaultSource: 'cusdec', defaultColumn: 'net_mass' },
  { key: 'dutyTaxRate2', label: 'Duty Tax Rate 2', group: 'Taxation', defaultSource: 'manual', defaultColumn: d.dutyTaxRate2 },
  { key: 'dutyTaxAmount2', label: 'Duty Tax Amount 2', group: 'Taxation', defaultSource: 'cusdec', defaultColumn: 'duty_amount_ced' },

  // Item Weight / Value
  { key: 'grossWeightItm', label: 'Gross Weight (Item)', group: 'Item Weight / Value', defaultSource: 'cusdec', defaultColumn: 'gross_mass' },
  { key: 'netWeightItm', label: 'Net Weight (Item)', group: 'Item Weight / Value', defaultSource: 'cusdec', defaultColumn: 'net_mass' },
  { key: 'statisticalValue', label: 'Statistical Value', group: 'Item Weight / Value', defaultSource: 'cusdec', defaultColumn: 'amount' },
]

export interface XmlMappingRow { field_label: string; data_source: 'cusdec' | 'cdn' | 'manual'; column_name: string }

// Every field's suggested mapping, ready to use as-is with zero setup —
// Docs Create falls back to this when no doc_templates row has been saved
// yet for cusdec_xml (or an admin hasn't customized it in Templates), and
// the Templates page seeds a fresh "ASYCUDA CUSDEC XML" template with the
// same rows so what's shown there matches what generation actually uses.
export function defaultXmlMappings(): XmlMappingRow[] {
  return XML_FIELD_DEFS.map(def => ({ field_label: def.key, data_source: def.defaultSource, column_name: def.defaultColumn || '' }))
}

// Resolves a full XmlValues object from configured mappings — "database"
// pulls straight from the matched cusdec/cdn row's column, "manual" uses
// whatever was typed at generation time (falling back to the mapping's own
// configured default constant, see XML_FIELD_DEFS comment above). Any field
// left unmapped, or whose resolved value is blank, keeps its
// emptyXmlValues() default so the output is always structurally complete.
export function resolveXmlValues(
  mappings: XmlMappingRow[],
  cusdecRow: Record<string, any> | null,
  cdnRow: Record<string, any> | null,
  manualValues: Record<string, string> = {}
): XmlValues {
  const values = emptyXmlValues()
  const byKey = new Map(mappings.map(m => [m.field_label, m]))
  for (const def of XML_FIELD_DEFS) {
    const m = byKey.get(def.key)
    if (!m) continue
    let value = ''
    if (m.data_source === 'manual') value = manualValues[def.key] || m.column_name || ''
    else if (m.data_source === 'cusdec') value = cusdecRow ? (cusdecRow[m.column_name] ?? '') : (manualValues[def.key] || '')
    else if (m.data_source === 'cdn') value = cdnRow ? (cdnRow[m.column_name] ?? '') : (manualValues[def.key] || '')
    if (value) (values as any)[def.key] = value
  }
  return values
}

export function buildAsycudaXml(v: XmlValues): string {
  const i2 = '  ', i3 = '   ', i4 = '    '
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<ASYCUDA id="${esc(v.asycudaId || String(Date.now()))}">
<Export_release>
<Date_of_exit/>
<Time_of_exit/>
<Actual_office_of_exit_code>
<null/>
</Actual_office_of_exit_code>
<Actual_office_of_exit_name>
<null/>
</Actual_office_of_exit_name>
<Exit_reference>
<null/>
</Exit_reference>
<Comments>
<null/>
</Comments>
</Export_release>
<Assessment_notice>
${Array(14).fill('<Item_tax_total/>').join('\n')}
</Assessment_notice>
<Global_taxes>
${Array(8).fill('<Global_tax_item/>').join('\n')}
</Global_taxes>
<Property>
<Sad_flow>${esc(v.sadFlow)}</Sad_flow>
<Forms>
<Number_of_the_form>1</Number_of_the_form>
<Total_number_of_forms>1</Total_number_of_forms>
</Forms>
<Nbers>
<Number_of_loading_lists/>
<Total_number_of_items>${esc(v.totalItems)}</Total_number_of_items>
<Total_number_of_packages>${esc(v.totalPackages)}</Total_number_of_packages>
</Nbers>
<Place_of_declaration>
<null/>
</Place_of_declaration>
<Date_of_declaration/>
<Selected_page>1</Selected_page>
</Property>
<Identification>
<Office_segment>
<Customs_clearance_office_code>${esc(v.officeCode)}</Customs_clearance_office_code>
<Customs_Clearance_office_name>${esc(v.officeName)}</Customs_Clearance_office_name>
</Office_segment>
<Type>
<Type_of_declaration>EX</Type_of_declaration>
<Declaration_gen_procedure_code>1</Declaration_gen_procedure_code>
<Type_of_transit_document>
<null/>
</Type_of_transit_document>
</Type>
<Manifest_reference_number>
<null/>
</Manifest_reference_number>
<Registration>
<Serial_number>${esc(v.regSerial)}</Serial_number>
<Number>${esc(v.regNumber)}</Number>
<Date>${esc(v.regDate)}</Date>
</Registration>
<Assessment>
<Serial_number>${esc(v.assessSerial)}</Serial_number>
<Number>${esc(v.assessNumber)}</Number>
<Date>${esc(v.assessDate)}</Date>
</Assessment>
<receipt>
<Serial_number>${esc(v.receiptSerial)}</Serial_number>
<Number>${esc(v.receiptNumber)}</Number>
<Date>${esc(v.receiptDate)}</Date>
</receipt>
</Identification>
<Traders>
<Exporter>
<Exporter_code>${esc(v.exporterCode)}</Exporter_code>
<Exporter_name>${esc(v.exporterName)}</Exporter_name>
</Exporter>
<Consignee>
<Consignee_code>
<null/>
</Consignee_code>
<Consignee_name>${esc(v.consigneeName)}</Consignee_name>
</Consignee>
<Financial>
<Financial_code>
<null/>
</Financial_code>
<Financial_name>
<null/>
</Financial_name>
</Financial>
</Traders>
<Declarant>
<Declarant_code>${esc(v.declarantCode)}</Declarant_code>
<Declarant_name>${esc(v.declarantName)}</Declarant_name>
<Reference>
<Number>${esc(v.declarantReference)}</Number>
</Reference>
</Declarant>
<General_information>
<Country>
<Country_first_destination>${esc(v.countryFirstDestination)}</Country_first_destination>
<Trading_country>${esc(v.tradingCountry)}</Trading_country>
<Export>
<Export_country_code>LK</Export_country_code>
<Export_country_name>Sri Lanka</Export_country_name>
<Export_country_region>
<null/>
</Export_country_region>
</Export>
<Destination>
<Destination_country_code>${esc(v.destinationCountryCode)}</Destination_country_code>
<Destination_country_name>${esc(v.destinationCountryName)}</Destination_country_name>
<Destination_country_region>
<null/>
</Destination_country_region>
</Destination>
<Country_of_origin_name>${esc(v.countryOfOriginName)}</Country_of_origin_name>
</Country>
<Value_details/>
<CAP>${esc(v.cap)}</CAP>
<Additional_information>
<null/>
</Additional_information>
<Comments_free_text>
<null/>
</Comments_free_text>
</General_information>
<Transport>
<Means_of_transport>
<Departure_arrival_information>
<Identity>${esc(v.vesselIdentity)}</Identity>
<Nationality>
<null/>
</Nationality>
</Departure_arrival_information>
<Border_information>
<Identity>${esc(v.borderInfoIdentity)}</Identity>
<Nationality>
<null/>
</Nationality>
<Mode>${esc(v.borderMode)}</Mode>
</Border_information>
<Inland_mode_of_transport>
<null/>
</Inland_mode_of_transport>
</Means_of_transport>
<Container_flag>${esc(v.containerFlag)}</Container_flag>
<Delivery_terms>
<Code>${esc(v.deliveryTermsCode)}</Code>
<Place>
<null/>
</Place>
<Situation>
<null/>
</Situation>
</Delivery_terms>
<Border_office>
<Code>${esc(v.officeCode)}</Code>
<Name>${esc(v.officeName)}</Name>
</Border_office>
<Place_of_loading>
<Code>${esc(v.placeOfLoadingCode)}</Code>
<Name>${esc(v.placeOfLoadingName)}</Name>
<Country>
<null/>
</Country>
</Place_of_loading>
<Location_of_goods>${esc(v.locationOfGoods)}</Location_of_goods>
</Transport>
<Financial>
<Financial_transaction>
<code1>
<null/>
</code1>
<code2>
<null/>
</code2>
</Financial_transaction>
<Bank>
<Code>${esc(v.bankCode)}</Code>
<Name>${esc(v.bankName)}</Name>
<Branch>${esc(v.bankBranch)}</Branch>
<Reference>${esc(v.bankReference)}</Reference>
</Bank>
<Terms>
<Code>${esc(v.termsCode)}</Code>
<Description>${esc(v.termsDescription)}</Description>
</Terms>
<Total_invoice/>
<Deffered_payment_reference>
<null/>
</Deffered_payment_reference>
<Mode_of_payment>${esc(v.modeOfPayment)}</Mode_of_payment>
<Amounts>
<Total_manual_taxes/>
<Global_taxes>${esc(v.globalTaxes)}</Global_taxes>
<Totals_taxes>${esc(v.totalTaxes)}</Totals_taxes>
</Amounts>
<Guarantee>
<Name>
<null/>
</Name>
<Amount>0</Amount>
<Date/>
<Excluded_country>
<Code>
<null/>
</Code>
<Name>
<null/>
</Name>
</Excluded_country>
</Guarantee>
</Financial>
<Warehouse>
<Identification>
<null/>
</Identification>
<Delay/>
</Warehouse>
<Transit>
<Principal>
<Code>
<null/>
</Code>
<Name>
<null/>
</Name>
<Representative>
<null/>
</Representative>
</Principal>
<Signature>
<Place>
<null/>
</Place>
<Date/>
</Signature>
<Destination>
<Office>
<null/>
</Office>
<Country>
<null/>
</Country>
</Destination>
<Seals>
<Number/>
<Identity>
<null/>
</Identity>
</Seals>
<Result_of_control>
<null/>
</Result_of_control>
<Time_limit/>
<Officer_name>
<null/>
</Officer_name>
</Transit>
<Valuation>
<Calculation_working_mode>0</Calculation_working_mode>
<Weight>
<Gross_weight/>
</Weight>
<Total_cost>0</Total_cost>
<Total_CIF>${esc(v.totalCif)}</Total_CIF>
<Gs_Invoice>
<Amount_national_currency>${esc(v.invoiceAmountNational)}</Amount_national_currency>
<Amount_foreign_currency>${esc(v.invoiceAmountForeign)}</Amount_foreign_currency>
<Currency_code>${esc(v.currencyCode)}</Currency_code>
<Currency_name>No foreign currency</Currency_name>
</Gs_Invoice>
<Gs_external_freight>
<Amount_national_currency>0</Amount_national_currency>
<Amount_foreign_currency>0</Amount_foreign_currency>
<Currency_code>
<null/>
</Currency_code>
<Currency_name>No foreign currency</Currency_name>
</Gs_external_freight>
<Gs_internal_freight>
<Amount_national_currency>0</Amount_national_currency>
<Amount_foreign_currency>0</Amount_foreign_currency>
<Currency_code>
<null/>
</Currency_code>
<Currency_name>No foreign currency</Currency_name>
</Gs_internal_freight>
<Gs_insurance>
<Amount_national_currency>0</Amount_national_currency>
<Amount_foreign_currency>0</Amount_foreign_currency>
<Currency_code>
<null/>
</Currency_code>
<Currency_name>No foreign currency</Currency_name>
</Gs_insurance>
<Gs_other_cost>
<Amount_national_currency>0</Amount_national_currency>
<Amount_foreign_currency>0</Amount_foreign_currency>
<Currency_code>
<null/>
</Currency_code>
<Currency_name>No foreign currency</Currency_name>
</Gs_other_cost>
<Gs_deduction>
<Amount_national_currency>0</Amount_national_currency>
<Amount_foreign_currency>0</Amount_foreign_currency>
<Currency_code>
<null/>
</Currency_code>
<Currency_name>No foreign currency</Currency_name>
</Gs_deduction>
<Total>
<Total_invoice>${esc(v.totalInvoice)}</Total_invoice>
<Total_weight>${esc(v.totalWeight)}</Total_weight>
</Total>
</Valuation>
<Item>
<Attached_documents>
<Attached_document_code>${esc(v.attachedDocCode)}</Attached_document_code>
<Attached_document_name>${esc(v.attachedDocName)}</Attached_document_name>
<Attached_document_reference>${esc(v.attachedDocReference)}</Attached_document_reference>
<Attached_document_date>${esc(v.attachedDocDate)}</Attached_document_date>
</Attached_documents>
<Attached_documents>
<Attached_document_code>${esc(v.attachedDocCode)}</Attached_document_code>
<Attached_document_name>${esc(v.attachedDocName)}</Attached_document_name>
<Attached_document_reference>${esc(v.attachedDocReference)}</Attached_document_reference>
<Attached_document_from_rule>1</Attached_document_from_rule>
<Attached_document_date>${esc(v.attachedDocDate)}</Attached_document_date>
</Attached_documents>
<Packages>
<Number_of_packages>${esc(v.numberOfPackages)}</Number_of_packages>
<Marks1_of_packages>${esc(v.marks1)}</Marks1_of_packages>
<Marks2_of_packages>${esc(v.marks2)}</Marks2_of_packages>
<Kind_of_packages_code>${esc(v.packageKindCode)}</Kind_of_packages_code>
<Kind_of_packages_name>${esc(v.packageKindName)}</Kind_of_packages_name>
</Packages>
<IncoTerms>
<Code>${esc(v.deliveryTermsCode)}</Code>
<Place>
<null/>
</Place>
</IncoTerms>
<Tarification>
<Tarification_data>
<null/>
</Tarification_data>
<HScode>
<Commodity_code>${esc(v.hsCode)}</Commodity_code>
<Precision_1>${esc(v.hsPrecision1)}</Precision_1>
<Precision_2>
<null/>
</Precision_2>
<Precision_3>
<null/>
</Precision_3>
<Precision_4>
<null/>
</Precision_4>
</HScode>
<Preference_code>${esc(v.preferenceCode)}</Preference_code>
<Extended_customs_procedure>${esc(v.extendedProcedure)}</Extended_customs_procedure>
<National_customs_procedure>${esc(v.nationalProcedure)}</National_customs_procedure>
<Quota_code>
<null/>
</Quota_code>
<Quota>
<QuotaCode>
<null/>
</QuotaCode>
<QuotaId/>
<QuotaItem>
<ItmNbr/>
</QuotaItem>
</Quota>
<Supplementary_unit>
<Suppplementary_unit_code>${esc(v.supplementaryUnitCode)}</Suppplementary_unit_code>
<Suppplementary_unit_name>${esc(v.supplementaryUnitName)}</Suppplementary_unit_name>
<Suppplementary_unit_quantity>${esc(v.supplementaryUnitQuantity)}</Suppplementary_unit_quantity>
</Supplementary_unit>
<Supplementary_unit>
<Suppplementary_unit_code>
<null/>
</Suppplementary_unit_code>
<Suppplementary_unit_name>
<null/>
</Suppplementary_unit_name>
<Suppplementary_unit_quantity/>
</Supplementary_unit>
<Supplementary_unit>
<Suppplementary_unit_code>
<null/>
</Suppplementary_unit_code>
<Suppplementary_unit_name>
<null/>
</Suppplementary_unit_name>
<Suppplementary_unit_quantity/>
</Supplementary_unit>
<Item_price>${esc(v.itemPrice)}</Item_price>
<Valuation_method_code>
<null/>
</Valuation_method_code>
<Value_item>0-0</Value_item>
<Attached_doc_item>${esc(v.attachedDocCode)} </Attached_doc_item>
<A.I._code>
<null/>
</A.I._code>
</Tarification>
<Goods_description>
<Country_of_origin_code>${esc(v.countryOfOriginCode)}</Country_of_origin_code>
<Country_of_origin_region>
<null/>
</Country_of_origin_region>
<Description_of_goods>${esc(v.descriptionOfGoods)}</Description_of_goods>
<Commercial_Description>
<null/>
</Commercial_Description>
</Goods_description>
<Previous_doc>
<Summary_declaration>${esc(v.previousDocSummaryDeclaration)}</Summary_declaration>
<Summary_declaration_sl>
<null/>
</Summary_declaration_sl>
<Previous_document_reference>
<null/>
</Previous_document_reference>
<Previous_warehouse_code>
<null/>
</Previous_warehouse_code>
</Previous_doc>
<Licence_number>${esc(v.licenceNumber)}</Licence_number>
<Amount_deducted_from_licence/>
<Quantity_deducted_from_licence>${esc(v.quantityDeductedFromLicence)}</Quantity_deducted_from_licence>
<Free_text_1>
<null/>
</Free_text_1>
<Free_text_2>
<null/>
</Free_text_2>
<Taxation>
<Item_taxes_amount>${esc(v.itemTaxesAmount)}</Item_taxes_amount>
<Item_taxes_guaranted_amount/>
<Item_taxes_mode_of_payment>1</Item_taxes_mode_of_payment>
<Counter_of_normal_mode_of_payment/>
<Displayed_item_taxes_amount/>
<Taxation_line>
<Duty_tax_code>${esc(v.dutyTaxCode1)}</Duty_tax_code>
<Duty_tax_Base>${esc(v.dutyTaxBase1)}</Duty_tax_Base>
<Duty_tax_rate>${esc(v.dutyTaxRate1)}</Duty_tax_rate>
<Duty_tax_amount>${esc(v.dutyTaxAmount1)}</Duty_tax_amount>
<Duty_tax_MP>1</Duty_tax_MP>
<Duty_tax_Type_of_calculation>
<null/>
</Duty_tax_Type_of_calculation>
</Taxation_line>
<Taxation_line>
<Duty_tax_code>${esc(v.dutyTaxCode2)}</Duty_tax_code>
<Duty_tax_Base>${esc(v.dutyTaxBase2)}</Duty_tax_Base>
<Duty_tax_rate>${esc(v.dutyTaxRate2)}</Duty_tax_rate>
<Duty_tax_amount>${esc(v.dutyTaxAmount2)}</Duty_tax_amount>
<Duty_tax_MP>1</Duty_tax_MP>
<Duty_tax_Type_of_calculation>
<null/>
</Duty_tax_Type_of_calculation>
</Taxation_line>
${Array(6).fill(0).map(() => `<Taxation_line>
<Duty_tax_code>
<null/>
</Duty_tax_code>
<Duty_tax_Base/>
<Duty_tax_rate/>
<Duty_tax_amount/>
<Duty_tax_MP>
<null/>
</Duty_tax_MP>
<Duty_tax_Type_of_calculation>
<null/>
</Duty_tax_Type_of_calculation>
</Taxation_line>`).join('\n')}
</Taxation>
<Valuation_item>
<Weight_itm>
<Gross_weight_itm>${esc(v.grossWeightItm)}</Gross_weight_itm>
<Net_weight_itm>${esc(v.netWeightItm)}</Net_weight_itm>
</Weight_itm>
<Total_cost_itm>0</Total_cost_itm>
<Total_CIF_itm>${esc(v.totalCif)}</Total_CIF_itm>
<Rate_of_adjustement/>
<Statistical_value>${esc(v.statisticalValue)}</Statistical_value>
<Alpha_coeficient_of_apportionment>1</Alpha_coeficient_of_apportionment>
<Item_Invoice>
<Amount_national_currency>${esc(v.invoiceAmountNational)}</Amount_national_currency>
<Amount_foreign_currency>${esc(v.invoiceAmountForeign)}</Amount_foreign_currency>
<Currency_code>${esc(v.currencyCode)}</Currency_code>
<Currency_name>No foreign currency</Currency_name>
</Item_Invoice>
<item_external_freight>
<Amount_national_currency>0</Amount_national_currency>
<Amount_foreign_currency>0.0</Amount_foreign_currency>
<Currency_code>
<null/>
</Currency_code>
<Currency_name>No foreign currency</Currency_name>
</item_external_freight>
<item_internal_freight>
<Amount_national_currency>0</Amount_national_currency>
<Amount_foreign_currency>0.0</Amount_foreign_currency>
<Currency_code>
<null/>
</Currency_code>
<Currency_name>No foreign currency</Currency_name>
</item_internal_freight>
<item_insurance>
<Amount_national_currency>0</Amount_national_currency>
<Amount_foreign_currency>0.0</Amount_foreign_currency>
<Currency_code>
<null/>
</Currency_code>
<Currency_name>No foreign currency</Currency_name>
</item_insurance>
<item_other_cost>
<Amount_national_currency>0</Amount_national_currency>
<Amount_foreign_currency>0.0</Amount_foreign_currency>
<Currency_code>
<null/>
</Currency_code>
<Currency_name>No foreign currency</Currency_name>
</item_other_cost>
<item_deduction>
<Amount_national_currency>0</Amount_national_currency>
<Amount_foreign_currency>0.0</Amount_foreign_currency>
<Currency_code>
<null/>
</Currency_code>
<Currency_name>No foreign currency</Currency_name>
</item_deduction>
<Market_valuer>
<Rate/>
<Currency_code>
<null/>
</Currency_code>
<Currency_amount/>
<Basis_description>
<null/>
</Basis_description>
<Basis_amount/>
</Market_valuer>
</Valuation_item>
</Item>
</ASYCUDA>
`
}
