import ExcelJS from 'exceljs'

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile('C:\\Users\\USER\\Desktop\\boat-template-test.xlsx')

const b2 = wb.getWorksheet('b2')
if (!b2) { console.log('No b2 sheet!'); process.exit(1) }

console.log('=== b2 sheet cells (non-empty) ===')
b2.eachRow({ includeEmpty: false }, (row, rowNum) => {
  row.eachCell({ includeEmpty: false }, (cell, colNum) => {
    const addr = cell.address
    const type = cell.type
    const formula = cell.formula
    const value = cell.value
    const result = cell.result
    if (formula) {
      console.log(`  ${addr}: FORMULA="${formula}" cached="${result}"`)
    } else if (value !== null && value !== undefined && value !== '') {
      console.log(`  ${addr}: VALUE="${value}"`)
    }
  })
})

const b1 = wb.getWorksheet('b1')
console.log('\n=== b1 sheet cells (non-empty) ===')
b1.eachRow({ includeEmpty: false }, (row, rowNum) => {
  row.eachCell({ includeEmpty: false }, (cell) => {
    const formula = cell.formula
    const value = cell.value
    if (formula) {
      console.log(`  ${cell.address}: FORMULA="${formula}"`)
    } else if (value !== null && value !== undefined && value !== '') {
      console.log(`  ${cell.address}: VALUE="${value}"`)
    }
  })
})
