import { describe, expect, it } from 'vitest';
import { fieldSchema } from '../packages/contracts/src/index.js';
import { receiptAnswers } from '../apps/web/src/services/receipts.js';
import { formatReceiptTime } from '../apps/web/src/services/time.js';

describe('saved check-in receipt', () => {
  it('formats the event-local year and midnight without locale-dependent punctuation', () => {
    expect(formatReceiptTime('2026-12-31T16:00:00Z')).toBe('2027/01/01 00:00');
    expect(formatReceiptTime('2026-10-14T03:07:00Z', 'UTC')).toBe('2026/10/14 03:07');
    expect(formatReceiptTime('2026-10-14T03:07:00Z', 'Asia/Shanghai')).toBe('2026/10/14 11:07');
  });
  it('shows all first-page fields in order and preserves zero, false, leading zeros and multiline values', () => {
    const fields = [
      { key: 'code', label: '编号', type: 'text' },
      { key: 'count', label: '人数', type: 'number' },
      { key: 'confirm', label: '确认', type: 'boolean' },
      { key: 'note', label: '备注', type: 'textarea' },
      { key: 'empty', label: '可选', type: 'text' },
    ].map((field) => fieldSchema.parse(field));
    expect(
      receiptAnswers(fields, {
        code: '000123',
        count: 0,
        confirm: false,
        note: '第一行\n第二行',
      }).map((row) => row.value),
    ).toEqual(['000123', '0', '否', '第一行\n第二行', '未填写']);
    expect(receiptAnswers(fields, {}).map((row) => row.key)).toEqual(
      fields.map((field) => field.key),
    );
  });
  it('maps option keys to labels without exposing hidden, roster or unknown answer fields', () => {
    const fields = [
      fieldSchema.parse({
        key: 'choice',
        label: '选项',
        type: 'select',
        options: [{ key: 'a', label: '选项甲' }],
      }),
      fieldSchema.parse({
        key: 'multi',
        label: '多选',
        type: 'multiselect',
        options: [
          { key: 'a', label: '甲' },
          { key: 'b', label: '乙' },
        ],
      }),
      fieldSchema.parse({ key: 'private', label: '后台', type: 'text', visibility: 'admin' }),
      fieldSchema.parse({ key: 'roster', label: '名单', type: 'text', source: 'roster' }),
    ];
    expect(
      receiptAnswers(fields, {
        choice: 'a',
        multi: ['b', 'a'],
        private: '不展示',
        roster: '不展示',
        unknown: '不展示',
      }),
    ).toEqual([
      { key: 'choice', label: '选项', value: '选项甲' },
      { key: 'multi', label: '多选', value: '乙、甲' },
    ]);
  });
});
