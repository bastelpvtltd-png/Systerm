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
