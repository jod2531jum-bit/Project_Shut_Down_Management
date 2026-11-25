import ExcelJS from 'exceljs';
const t=Date.now();
const wb=new ExcelJS.Workbook();
await wb.xlsx.readFile("../../../Major Shutdown Schedule Oct'26 (15 days) Rev.I.xlsx");
console.log('load ms',Date.now()-t, wb.worksheets.map(w=>[w.name,w.state,w.rowCount]));
const ws=wb.getWorksheet('OCT2026')!;
for (const r of [13,14,76,107,138,276,293]) {
  const row=ws.getRow(r);
  console.log(r,'outline',row.outlineLevel,[1,2,3,4,5,8].map(c=>{const v=row.getCell(c).value as any;return v&&typeof v==='object'&&!(v instanceof Date)?JSON.stringify(v):String(v)}).join(' | ').slice(0,260));
}
console.log('comment G125', JSON.stringify(ws.getCell('G125').note));
console.log('bold C14', ws.getCell('C14').font?.bold, 'C15', ws.getCell('C15').font?.bold, 'indent', ws.getCell('C15').alignment?.indent);
