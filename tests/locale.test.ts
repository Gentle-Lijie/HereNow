import { afterEach, describe, expect, it } from 'vitest';
import {
  fieldSchema,
  eventInputSchema,
  eventConfigSchema,
} from '../packages/contracts/src/index.js';
import { locale, t, fieldLabel, publicErrorMessage } from '../apps/web/src/services/locale.js';
import { receiptAnswers } from '../apps/web/src/services/receipts.js';
afterEach(() => {
  locale.value = 'zh';
});
describe('participant inline localization', () => {
  it('switches inline text and field labels while retaining legacy label fallbacks', () => {
    const field = fieldSchema.parse({
      key: 'name',
      label: '姓名',
      label_en: 'Full name',
      type: 'text',
    });
    locale.value = 'en';
    expect(t('签到', 'Check in')).toBe('Check in');
    expect(fieldLabel(field)).toBe('Full name');
    expect(fieldLabel({ ...field, label_en: '' })).toBe('姓名');
    locale.value = 'zh';
    expect(fieldLabel(field)).toBe('姓名');
  });
  it('requires both names at event input boundaries but can read old stored configurations', () => {
    const event = {
      name: '测试',
      organizer: '测试',
      starts_at: '2026-01-01T00:00:00Z',
      ends_at: '2026-01-02T00:00:00Z',
      fields: [{ key: 'name', label: '姓名', type: 'text' }],
    };
    expect(eventInputSchema.safeParse(event).success).toBe(false);
    expect(eventConfigSchema.parse(event).fields[0]!.label_en).toBe('');
    expect(
      eventInputSchema.safeParse({
        ...event,
        fields: [{ ...event.fields[0], label_en: 'Full name' }],
      }).success,
    ).toBe(true);
    expect(
      eventInputSchema.safeParse({
        ...event,
        fields: [{ ...event.fields[0], label: ' ', label_en: 'Full name' }],
      }).success,
    ).toBe(false);
  });
  it('translates server geofence distances without exposing or changing coordinates', () => {
    locale.value = 'en';
    expect(
      publicErrorMessage(
        Object.assign(
          new Error('当前位置在签到范围外，距离允许签到范围约 134 米，请靠近后重新定位'),
          { code: 'LOCATION_OUTSIDE' },
        ),
      ),
    ).toContain('134 m');
    expect(
      publicErrorMessage(
        Object.assign(new Error('活动尚未开始'), { code: 'ACTIVITY_UNAVAILABLE' }),
      ),
    ).toContain('Check-in is not open');
  });
  it('localizes receipt labels, booleans and empty answers while preserving saved values', () => {
    const field = fieldSchema.parse({
      key: 'confirm',
      label: '确认',
      label_en: 'Confirmation',
      type: 'boolean',
    });
    expect(receiptAnswers([field], { confirm: false }, 'en')[0]).toEqual({
      key: 'confirm',
      label: 'Confirmation',
      value: 'No',
    });
    expect(receiptAnswers([field], {}, 'en')[0]!.value).toBe('Not provided');
  });
});
