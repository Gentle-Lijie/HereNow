import type { Field, Answer } from '../../../../packages/contracts/src/index';
export function formatAnswer(field: Field | undefined, value: Answer | undefined): string {
  if (value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value))
    return value.map((v) => field?.options.find((o) => o.key === v)?.label ?? v).join('、');
  if (field?.type === 'select')
    return field.options.find((o) => o.key === value)?.label ?? String(value);
  return String(value);
}
