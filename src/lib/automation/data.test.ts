import assert from 'node:assert/strict'
import { driverId, navisConType, navisGrossMass, cusdecReference, pickVesselOption, pickPortOption, pickByCode, prepareValues, parseVesselOption } from './data'
import { FieldError } from './errors'

// driver id
assert.equal(driverId('K.R.S.P.KUMARA 942143400V'), '942143400V')
assert.equal(driverId('H.P.C.I.PATHIRATHNA 198728601130'), '198728601130')
assert.equal(driverId('H.P.C.M.K.SIRISENA 871232733v'), '871232733V')
assert.equal(driverId('NO ID HERE'), '')
// con type
assert.equal(navisConType('45G1'), '45G1'); assert.equal(navisConType('40G1'), '45G1'); assert.equal(navisConType('20G1'), '22G1'); assert.equal(navisConType('22G1'), '')
// gross mass — the real formats from the CDN rows
assert.equal(navisGrossMass('23.580.00'), '23580'); assert.equal(navisGrossMass('24,550.00'), '24550'); assert.equal(navisGrossMass('22:450.00'), '22450')
assert.equal(navisGrossMass(''), ''); assert.equal(navisGrossMass('999999'), '')      // > 35,000 kg -> refuse, never guess
// cusdec reference
assert.equal(cusdecReference('CBEX1', 'E 61746', '29/09/2026'), 'CBEX1E617462026')
assert.equal(cusdecReference('CBEX1', 'E 56049', '2026-09-07'), 'CBEX1E560492026')
assert.equal(cusdecReference('CBEX1', 'E 1', ''), '')
// vessel option parsing + matching
const opts = ['1XM640EW\u00a0(MARGRETHE\u00a0MAERSK,640E,SLPA)', '1XM641EW (MARGRETHE MAERSK,641E,SLPA)', 'ZPY26073N (ZHONG PENG YOU YI,26073N,SLPA)']
assert.deepEqual(parseVesselOption(opts[0]), { code: '1XM640EW', name: 'MARGRETHE MAERSK', voyage: '640E' })
assert.equal(pickVesselOption(opts, 'MARGRETHE MAERSK', '640E'), 0)
assert.equal(pickVesselOption(opts, 'MARGRETHE', '641E'), 1)            // only the start of the vessel name
assert.equal(pickVesselOption(opts, 'ZHONG PENG YOU YI', '26073N'), 2)
assert.equal(pickVesselOption(opts, '', '640E'), 0)                     // no vessel on the CDN -> voyage only
assert.equal(typeof pickVesselOption(opts, 'MARGRETHE MAERSK', '999X'), 'string')   // voyage not found -> error
assert.equal(typeof pickVesselOption(opts, 'COMPLETELY OTHER SHIP', '640E'), 'string') // voyage ok, vessel unrelated -> error
assert.equal(typeof pickVesselOption(opts, 'MARGRETHE MAERSK', ''), 'string')
// real Navis option with no comma at all in parens — voyage embedded in the code instead,
// with a leg-letter suffix Navis adds that the CDN's own voyage doesn't have
const noCommaOpts = ['ZEY26076NS (ZHONG PENG YOU YI)']
assert.deepEqual(parseVesselOption(noCommaOpts[0]), { code: 'ZEY26076NS', name: 'ZHONG PENG YOU YI', voyage: '' })
assert.equal(pickVesselOption(noCommaOpts, 'ZHONG PENG YOU YI', '26076N'), 0)
// ports
const ports = ['AEJEA\u00a0(Jebel\u00a0Ali)', 'INTUT (Tuticorin)', 'INMUN (Mundra)']
assert.equal(pickPortOption(ports, 'JEBEL ALI'), 0); assert.equal(pickPortOption(ports, 'TUTICORIN'), 1); assert.equal(pickPortOption(ports, 'MUNDRA'), 2)
assert.equal(typeof pickPortOption(ports, 'COLOMBO'), 'string')
// code pickers
const coc = ['AAS\u00a0(Line\u00a0Operator)', 'AAS (Shipper)', 'ONE (Line Operator)']
assert.equal(pickByCode(coc, 'AAS', 'Line Operator'), 0); assert.equal(pickByCode(coc, 'ONE', 'Line Operator'), 2)
assert.equal(typeof pickByCode(coc, 'ZZZ'), 'string')
assert.equal(pickByCode(['PRVT (PRIVATE TRUCKING COMPANY)'], 'PRVT'), 0); assert.equal(pickByCode(['Truck'], 'TRUCK'), 0); assert.equal(pickByCode(['FCL (Full Container)'], 'FCL'), 0)

// whole-job preparation using a real CDN row from cdn_rows.sql
const cdn = { container_no: 'ONEU0068223', con_type: '45G1', gross_mass: '24,550.00', coc: 'ONE', voc: 'BTL', voyage: '26073N', vessel: 'ZHONG PENG YOU YI', discharge_port: 'TUTICORIN',
  driver_name: 'K.R.S.P.KUMARA 942143400V', lorry_no: 'LY-4889', trailer_no: 'LX-2266', seal_no: 'LKAB88118', code: 'CBEX1', cusdec_number: 'E 60147' }
const p = prepareValues(cdn, { code: 'CBEX1', number: 'E 60147', date: '29/09/2026' })
assert.deepEqual(p.navis, { containerNo: 'ONEU0068223', conType: '45G1', grossMass: '24550', coc: 'ONE', voc: 'BTL', vessel: 'ZHONG PENG YOU YI', voyage: '26073N', dischargePort: 'TUTICORIN', cusdecRef: 'CBEX1E601472026' })
assert.deepEqual(p.slpa, { cusdecRef: 'CBEX1E601472026', containerNo: 'ONEU0068223', driverId: '942143400V', truckNo: 'LY-4889', trailerNo: 'LX-2266', sealNo: 'LKAB88118' })
// a bad row is rejected BEFORE any portal is touched, naming the field
for (const [patch, field] of [[{ driver_name: 'NO ID' }, 'Driver ID'], [{ gross_mass: '' }, 'Gross Mass'], [{ con_type: 'XX' }, 'Con Type'], [{ seal_no: '' }, 'Seal No']] as const) {
  try { prepareValues({ ...cdn, ...patch }, { code: 'CBEX1', number: 'E 60147', date: '29/09/2026' }); assert.fail('should have thrown') }
  catch (e) { assert.ok(e instanceof FieldError); assert.equal((e as FieldError).field, field) }
}
// a "fix CUSDEC & retry" override always wins over the computed reference, and never touches it
const withOverride = prepareValues(cdn, { code: 'CBEX1', number: 'E 60147', date: '29/09/2026' }, 'CBEX1E999992026')
assert.equal(withOverride.navis.cusdecRef, 'CBEX1E999992026'); assert.equal(withOverride.slpa.cusdecRef, 'CBEX1E999992026')
console.log('data rules: all tests passed')