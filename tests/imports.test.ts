import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { eventInputSchema } from '../packages/contracts/src/index.js';
import { parseImport, workbookBuffer } from '../apps/api/src/services/imports.js';
import { toZonedInput, fromZonedInput } from '../apps/web/src/services/time.js';
const e = eventInputSchema.parse({
  name: '测试',
  organizer: '测试',
  starts_at: '2026-01-01T00:00:00Z',
  ends_at: '2027-01-01T00:00:00Z',
  fields: [
    {
      key: 'entry_code',
      label: '员工编号',
      label_en: 'Employee code',
      type: 'text',
      required: true,
      roster_match: true,
      allow_duplicates: false,
      max_length: 120,
    },
    { key: 'name', label: '姓名', label_en: 'Name', type: 'text', required: true },
  ],
});
describe('safe spreadsheet boundaries', () => {
  it('preserves text identities and detects normalized duplicates', async () => {
    const r = await parseImport(
      Buffer.from('entry_code,name\n000001,张三\n 000001 ,李四\n'),
      'roster.csv',
      e,
    );
    expect(r.rows[0]?.identity_value).toBe('000001');
    expect(r.errors[0]?.row).toBe(3);
  });
  it('supports explicit column mapping', async () => {
    const r = await parseImport(Buffer.from('员工编号,名字\n000001,张三\n'), 'roster.csv', e, {
      entry_code: '员工编号',
      name: '名字',
    });
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0]?.answers.name).toBe('张三');
  });
  it('rejects XLSX formula cells and numeric identities', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('名单');
    ws.addRow(['entry_code', 'name']);
    ws.addRow(['000001', { formula: '1+1', result: 2 }]);
    await expect(
      parseImport(Buffer.from(await wb.xlsx.writeBuffer()), 'roster.xlsx', e),
    ).rejects.toThrow('公式');
    ws.getCell('B2').value = '张三';
    ws.getCell('A2').value = 123;
    const r = await parseImport(Buffer.from(await wb.xlsx.writeBuffer()), 'roster.xlsx', e);
    expect(r.errors[0]?.message).toContain('文本');
  });
  it('writes text including formula-like strings as XLSX string values', async () => {
    const b = await workbookBuffer(['entry_code', 'name'], [['000001', '=1+1']]);
    const r = await parseImport(b, 'roster.xlsx', e);
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0]?.answers.name).toBe('=1+1');
  });
});
describe('event timezone input', () => {
  it('converts event time independently of browser timezone', () => {
    expect(toZonedInput('2026-10-13T16:30:00Z', 'Asia/Shanghai')).toBe('2026-10-14T00:30');
    expect(fromZonedInput('2026-10-14T00:30', 'Asia/Shanghai')).toBe('2026-10-13T16:30:00.000Z');
  });
  it('handles UTC and rejects nonexistent DST local times', () => {
    expect(fromZonedInput('2026-10-14T00:30', 'UTC')).toBe('2026-10-14T00:30:00.000Z');
    expect(() => fromZonedInput('2026-03-08T02:30', 'America/New_York')).toThrow();
  });
});
