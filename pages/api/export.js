import { getAuth } from '@clerk/nextjs/server';

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const OUTPUT_COLS = [
  { key: 'key',              header: 'Key',                                           width: 10 },
  { key: 'name',             header: 'Name',                                          width: 52 },
  { key: 'status',           header: 'Status',                                        width: 10 },
  { key: 'precondition',     header: 'Precondition',                                  width: 32 },
  { key: 'objective',        header: 'Objective',                                     width: 40 },
  { key: 'folder',           header: 'Folder',                                        width: 18 },
  { key: 'priority',         header: 'Priority',                                      width: 10 },
  { key: 'component',        header: 'Component',                                     width: 14 },
  { key: 'labels',           header: 'Labels',                                        width: 14 },
  { key: 'owner',            header: 'Owner',                                         width: 24 },
  { key: 'estimated_time',   header: 'Estimated Time',                                width: 14 },
  { key: 'coverage_issues',  header: 'Coverage (Issues)',                             width: 18 },
  { key: 'coverage_pages',   header: 'Coverage (Pages)',                              width: 18 },
  { key: 'test_type',        header: 'Test type',                                     width: 14 },
  { key: 'test_set',         header: 'Test set',                                      width: 14 },
  { key: 'step',             header: 'Test Script (Step-by-Step) - Step',             width: 46 },
  { key: 'test_data',        header: 'Test Script (Step-by-Step) - Test Data',        width: 36 },
  { key: 'expected_result',  header: 'Test Script (Step-by-Step) - Expected Result',  width: 46 },
  { key: 'plain_text',       header: 'Test Script (Plain Text)',                      width: 20 },
  { key: 'bdd',              header: 'Test Script (BDD)',                             width: 20 },
];

const FIRST_ROW_ONLY = new Set([
  'key','name','status','precondition','objective','folder',
  'priority','component','labels','owner','estimated_time',
  'coverage_issues','coverage_pages','test_type','test_set'
]);

const C_HEADER_BG = 'FF1E1E2E';
const C_HEADER_FG = 'FFCDD6F4';
const C_FIRST_BG  = 'FFF0EDE6';
const C_FIRST_FG  = 'FF1A1A1A';
const C_ROW_A     = 'FFFAFAFA';
const C_ROW_B     = 'FFF5F3EE';
const C_ROW_FG    = 'FF3D3D3D';
const C_BORDER    = 'FFD8D4CC';
const C_BORDER_THICK = 'FFA09888';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Bejelentkezés szükséges.' });

  const { testCases, fixedFields = {} } = req.body;
  if (!testCases || !testCases.length) return res.status(400).json({ error: 'Nincsenek tesztesetek.' });

  try {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Test Cases');

    ws.columns = OUTPUT_COLS.map(c => ({ header: c.header, key: c.key, width: c.width }));

    // Style header row
    const headerRow = ws.getRow(1);
    headerRow.height = 28;
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_HEADER_BG } };
      cell.font = { name: 'Calibri', bold: true, size: 10, color: { argb: C_HEADER_FG } };
      cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: C_BORDER } },
        bottom: { style: 'thin', color: { argb: C_BORDER } },
        left: { style: 'thin', color: { argb: C_BORDER } },
        right: { style: 'thin', color: { argb: C_BORDER } },
      };
    });

    ws.views = [{ state: 'frozen', ySplit: 1 }];

    let alt = false;
    let rowExcel = 2;

    testCases.forEach((tc, tcIdx) => {
      const rawSteps = Array.isArray(tc.steps) ? tc.steps : [{ action: tc.steps || '', expected: '', testData: '' }];
      const steps = rawSteps.map(s => typeof s === 'object' ? s : { action: s, expected: '', testData: '' });
      const nSteps = steps.length;
      alt = !alt;

      steps.forEach((step, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === nSteps - 1;

        const rowData = {};
        OUTPUT_COLS.forEach(col => {
          if (FIRST_ROW_ONLY.has(col.key)) {
            if (!isFirst) { rowData[col.key] = ''; return; }
            switch (col.key) {
              case 'key':            rowData[col.key] = ''; break; // empty - Jira fills this
              case 'name':           rowData[col.key] = tc.name || tc.title || ''; break;
              case 'status':         rowData[col.key] = fixedFields.status || 'Draft'; break;
              case 'precondition':   rowData[col.key] = tc.preconditions || fixedFields.precondition || ''; break;
              case 'objective':      rowData[col.key] = tc.objective || ''; break;
              case 'folder':         rowData[col.key] = fixedFields.folder || ''; break;
              case 'priority':       rowData[col.key] = tc.priority || fixedFields.priority || 'Medium'; break;
              case 'component':      rowData[col.key] = fixedFields.component || ''; break;
              case 'labels':         rowData[col.key] = tc.labels || fixedFields.labels || ''; break;
              case 'owner':          rowData[col.key] = fixedFields.owner || ''; break;
              case 'estimated_time': rowData[col.key] = fixedFields.estimated_time || 'hh:mm'; break;
              case 'coverage_issues':rowData[col.key] = fixedFields.coverage_issues || ''; break;
              case 'coverage_pages': rowData[col.key] = fixedFields.coverage_pages || ''; break;
              case 'test_type':      rowData[col.key] = fixedFields.test_type || 'Functional'; break;
              case 'test_set':       rowData[col.key] = fixedFields.test_set || ''; break;
            }
          } else {
            switch (col.key) {
              case 'step':           rowData[col.key] = step.action || ''; break;
              case 'test_data': {
                const td = (step.testData || '').trim();
                // Skip if empty or just the header with nothing after it
                const isEmptyData = !td || td === 'Important attributes:' || /^Important attributes:\s*$/.test(td);
                rowData[col.key] = isEmptyData ? '' : td;
                break;
              }
              case 'expected_result':rowData[col.key] = step.expected || ''; break;
              case 'plain_text':     rowData[col.key] = ''; break;
              case 'bdd':            rowData[col.key] = ''; break;
            }
          }
        });

        const wsRow = ws.getRow(rowExcel);
        wsRow.height = 15;

        const bgArgb = isFirst ? C_FIRST_BG : (alt ? C_ROW_A : C_ROW_B);
        const fgArgb = isFirst ? C_FIRST_FG : C_ROW_FG;
        const bottomStyle = isLast ? 'medium' : 'thin';
        const bottomColor = isLast ? C_BORDER_THICK : C_BORDER;

        OUTPUT_COLS.forEach((col, colIdx) => {
          const cell = wsRow.getCell(colIdx + 1);
          cell.value = rowData[col.key];
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
          cell.font = {
            name: 'Calibri', size: 10,
            bold: isFirst && col.key === 'name',
            color: { argb: fgArgb }
          };
          cell.alignment = { wrapText: true, vertical: 'top' };
          cell.border = {
            top:    { style: 'thin',      color: { argb: C_BORDER } },
            bottom: { style: bottomStyle, color: { argb: bottomColor } },
            left:   { style: 'thin',      color: { argb: C_BORDER } },
            right:  { style: 'thin',      color: { argb: C_BORDER } },
          };
        });

        rowExcel++;
      });
    });

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="testcases.xlsx"');
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Export hiba: ' + e.message });
  }
}
