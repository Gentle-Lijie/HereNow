export function toZonedInput(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
export function formatReceiptTime(iso: string, timezone = 'Asia/Shanghai') {
  return toZonedInput(iso, timezone).replace('T', ' ').replaceAll('-', '/');
}
export function fromZonedInput(value: string, timezone: string) {
  const naive = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(naive)) throw new Error('请输入有效的活动时间');
  let candidate = naive;
  for (let i = 0; i < 3; i++) {
    const rendered = Date.parse(`${toZonedInput(new Date(candidate).toISOString(), timezone)}:00Z`);
    candidate += naive - rendered;
  }
  if (toZonedInput(new Date(candidate).toISOString(), timezone) !== value)
    throw new Error('此时间在所选时区中不存在，请检查夏令时');
  return new Date(candidate).toISOString();
}
