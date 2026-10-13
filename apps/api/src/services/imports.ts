import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { unzipSync } from 'fflate';
import {
  normalizeIdentity,
  validateAnswers,
  type Answers,
  type EventInput,
  type ImportPreview,
  type Field,
} from '../../../../packages/contracts/src/index.js';
import { fail } from './security.js';
export function convertCell(value: string, field: Field) {
  if (field.type === 'number') {
    if (!value.trim() || !Number.isFinite(Number(value)))
      throw new Error(`${field.label}必须是数字`);
    return Number(value);
  }
  if (field.type === 'boolean') {
    if (!['true', 'false', '是', '否', '1', '0'].includes(value))
      throw new Error(`${field.label}请输入是或否`);
    return ['true', '是', '1'].includes(value);
  }
  if (field.type === 'multiselect')
    return value
      .split('|')
      .map((v) => v.trim())
      .filter(Boolean);
  return value;
}
export async function parseImport(
  buffer: Buffer,
  filename: string,
  event: EventInput,
  mapping: Record<string, string> = {},
  sheet?: string,
): Promise<Omit<ImportPreview, 'id'>> {
  let grid: string[][] = [];
  const numericIdentityRows = new Set<number>();
  if (filename.toLowerCase().endsWith('.csv')) {
    try {
      grid = parse(buffer, {
        bom: true,
        skip_empty_lines: true,
        relax_column_count: false,
        max_record_size: 64000,
      }) as string[][];
    } catch {
      fail('INVALID_IMPORT', 'CSV 格式不正确，请使用 UTF-8 编码');
    }
  } else if (filename.toLowerCase().endsWith('.xlsx')) {
    let total = 0;
    const entries = unzipSync(buffer, {
      filter: (f) => {
        total += f.originalSize;
        if (total > 20 * 1024 * 1024 || f.originalSize > 10 * 1024 * 1024)
          fail('INVALID_IMPORT', 'XLSX 解压大小超限');
        if (/externalLinks|vbaProject/i.test(f.name)) fail('INVALID_IMPORT', '不接受宏或外部链接');
        return true;
      },
    });
    if (Object.keys(entries).length > 300) fail('INVALID_IMPORT', 'XLSX 内容过多');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = sheet ? wb.getWorksheet(sheet) : wb.worksheets[0];
    if (!ws) fail('INVALID_IMPORT', '工作表不存在');
    if (ws!.rowCount > 10001 || ws!.columnCount > 40)
      fail('INVALID_IMPORT', '最多 10,000 行、40 列');
    grid = [];
    const identityHeader = mapping.identity_value ?? 'identity_value';
    let identityIndex = 1;
    ws!.eachRow((row, n) => {
      if (n === 1) {
        row.eachCell((cell, col) => {
          if (
            cell.text === identityHeader ||
            (!mapping.identity_value && cell.text === event.identity_label)
          )
            identityIndex = col;
        });
      }
      const cells: string[] = [];
      for (let col = 1; col <= ws!.columnCount; col++) {
        const cell = row.getCell(col);
        if (cell.type === ExcelJS.ValueType.Formula || cell.type === ExcelJS.ValueType.Hyperlink)
          fail('INVALID_IMPORT', '不接受公式单元格或外部链接');
        cells.push(cell.text);
        if (col === identityIndex && n > 1 && typeof cell.value === 'number')
          numericIdentityRows.add(n);
      }
      grid[n - 1] = cells;
    });
  } else return fail('INVALID_IMPORT', '仅支持 CSV 或 XLSX 文件');
  if (!grid?.length) return fail('INVALID_IMPORT', '文件为空');
  if (grid.length > 10001) fail('INVALID_IMPORT', '最多导入 10,000 行');
  const columns = grid[0]!.map((v) => v.trim());
  if (new Set(columns).size !== columns.length) fail('INVALID_IMPORT', '列标题不能重复');
  const identityHeader =
    mapping.identity_value ??
    (columns.includes('identity_value') ? 'identity_value' : event.identity_label);
  const identityIndex = columns.indexOf(identityHeader);
  if (identityIndex < 0) fail('INVALID_IMPORT', `找不到身份列 ${identityHeader}，请检查列映射`);
  const seen = new Set<string>();
  const result: Omit<ImportPreview, 'id'> = {
    rows: [],
    errors: [],
    total: grid.length - 1,
    columns,
  };
  for (let i = 1; i < grid.length; i++) {
    const row = grid[i];
    if (!row) continue;
    try {
      if (numericIdentityRows.has(i + 1)) throw new Error('身份单元格必须为文本，避免丢失前导零');
      const identity = normalizeIdentity(row[identityIndex] ?? '', event);
      if (seen.has(identity)) throw new Error('规范化后身份重复');
      seen.add(identity);
      const answers: Answers = {};
      for (const f of event.fields) {
        const col = columns.indexOf(mapping[f.key] ?? f.key);
        if (col >= 0 && row[col] !== undefined && row[col] !== '')
          answers[f.key] = convertCell(row[col]!, f);
      }
      const validated = validateAnswers(event.fields, answers, {}, 'import');
      result.rows.push({ row: i + 1, identity_value: identity, answers: validated });
    } catch (e) {
      result.errors.push({ row: i + 1, message: (e as Error).message });
    }
  }
  return result;
}
export async function workbookBuffer(columns: string[], records: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('签到数据');
  ws.addRow(columns);
  for (const record of records) {
    const row = ws.addRow(
      record.map((v) =>
        v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v),
      ),
    );
    row.eachCell((c) => {
      c.numFmt = '@';
    });
  }
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => {
    c.width = 22;
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
