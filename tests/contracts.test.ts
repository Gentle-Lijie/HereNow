import { describe, it, expect } from 'vitest';
import {
  eventInputSchema,
  fieldSchema,
  normalizeFieldValue,
  canonicalFieldValue,
  upgradeLegacyEventConfig,
  validateAnswers,
  locationSchema,
} from '../packages/contracts/src/index.js';
import { haversine, normalizeCenter, locationDecision } from '../apps/api/src/services/location.js';
const event = eventInputSchema.parse({
  name: '测试活动',
  organizer: '测试',
  starts_at: '2026-01-01T00:00:00Z',
  ends_at: '2027-01-01T00:00:00Z',
});
describe('identity and field boundaries', () => {
  it('keeps entered text and stable choice keys while comparing canonical values', () => {
    const field = fieldSchema.parse({
      key: 'code',
      label: '编号',
      type: 'text',
      allow_duplicates: false,
      ignore_case: true,
    });
    expect(validateAnswers([field], { code: ' AbC ' }).code).toBe(' AbC ');
    expect(canonicalFieldValue(field, ' AbC ')).toBe(canonicalFieldValue(field, 'abc'));
    const select = fieldSchema.parse({
      key: 'choice',
      label: '选择',
      type: 'select',
      options: [{ key: 'Ａ', label: '全角键' }],
    });
    expect(validateAnswers([select], { choice: 'Ａ' }).choice).toBe('Ａ');
    const migrated = upgradeLegacyEventConfig({
      ...event,
      fields: [{ key: 'entry_code', label: '已有字段', type: 'text' }],
      identity_type: 'registration',
      identity_label: '报名号',
      ignore_case: false,
    });
    expect(migrated.fields.map((f) => f.key)).toEqual(['entry_code_1', 'entry_code']);
  });
  it('defaults to duplicate values being allowed without a required identity field', () => {
    expect(event.fields).toHaveLength(0);
    expect(fieldSchema.parse({ key: 'name', label: '姓名', type: 'text' }).allow_duplicates).toBe(
      true,
    );
    expect(eventInputSchema.safeParse({ ...event, identity_type: 'registration' }).success).toBe(
      false,
    );
  });
  it('canonicalizes multi-select order and migrates legacy identifiers into visible fields', () => {
    expect(canonicalFieldValue({ type: 'multiselect', ignore_case: false }, ['b', 'a'])).toBe(
      canonicalFieldValue({ type: 'multiselect', ignore_case: false }, ['a', 'b']),
    );
    const migrated = upgradeLegacyEventConfig({
      ...event,
      identity_type: 'registration',
      identity_label: '报名号',
      ignore_case: true,
    });
    expect(migrated.fields[0]).toMatchObject({
      key: 'entry_code',
      label: '报名号',
      required: true,
      allow_duplicates: false,
      ignore_case: true,
    });
    expect('identity_type' in migrated).toBe(false);
  });
  it('preserves leading zeros and only folds case when configured', () => {
    expect(normalizeFieldValue({ type: 'text', ignore_case: false }, ' 000ABC ')).toBe('000ABC');
    expect(normalizeFieldValue({ type: 'text', ignore_case: true }, '000ABC')).toBe('000abc');
  });
  it('normalizes mainland phone numbers but rejects invalid identities', () => {
    expect(normalizeFieldValue({ type: 'phone', ignore_case: false }, '+86 138-0013-8000')).toBe(
      '13800138000',
    );
    expect(() => normalizeFieldValue({ type: 'phone', ignore_case: false }, '张三')).toThrow();
  });
  it('rejects unknown fields and validates types and enum keys', () => {
    const f = fieldSchema.parse({
      key: 'team',
      label: '团队',
      type: 'select',
      required: true,
      options: [{ key: 'dev', label: '研发' }],
    });
    expect(() => validateAnswers([f], {})).toThrow();
    expect(() => validateAnswers([f], { team: 'design' })).toThrow();
    expect(() => validateAnswers([f], { team: 'dev', secret: 'x' })).toThrow();
    expect(validateAnswers([f], { team: 'dev' })).toEqual({ team: 'dev' });
  });
  it('server roster values override client-supplied authority', () => {
    const f = fieldSchema.parse({
      key: 'department',
      label: '部门',
      type: 'text',
      source: 'roster',
      required: true,
    });
    expect(validateAnswers([f], { department: '伪造值' }, { department: '真实值' })).toEqual({
      department: '真实值',
    });
  });
  it('rejects forbidden field names, duplicate options, and invalid dates', () => {
    expect(fieldSchema.safeParse({ key: 'constructor', label: 'x', type: 'text' }).success).toBe(
      false,
    );
    expect(
      fieldSchema.safeParse({
        key: 'team',
        label: 'x',
        type: 'select',
        options: [
          { key: 'x', label: 'a' },
          { key: 'x', label: 'b' },
        ],
      }).success,
    ).toBe(false);
    expect(eventInputSchema.safeParse({ ...event, ends_at: event.starts_at }).success).toBe(false);
  });
});
describe('location rules', () => {
  const required = {
    ...event,
    location_mode: 'required' as const,
    center: {
      latitude: 31.2304,
      longitude: 121.4737,
      coordinate_system: 'WGS84' as const,
      provider: 'manual' as const,
    },
  };
  const location = {
    latitude: 31.2304,
    longitude: 121.4737,
    accuracy: 20,
    coordinate_system: 'WGS84' as const,
    source: 'browser_geolocation' as const,
    captured_at: new Date().toISOString(),
  };
  it('distinguishes within, outside, accuracy, and uncertainty', () => {
    expect(locationDecision(required, location).result).toBe('范围内');
    expect(() => locationDecision(required, { ...location, latitude: 31.24 })).toThrow('范围外');
    expect(() => locationDecision(required, { ...location, accuracy: 150 })).toThrow('精度不足');
    expect(() =>
      locationDecision({ ...required, radius: 50 }, { ...location, accuracy: 45 }),
    ).toThrow('边界');
    expect(() => locationDecision(required)).toThrow();
  });
  it('does not accept location in off mode or infer unknown sources', () => {
    expect(locationDecision(event).result).toBe('未采集');
    expect(() => locationDecision(event, location)).toThrow();
    expect(
      locationSchema.safeParse({ ...location, source: 'ip', coordinate_system: 'GCJ-02' }).success,
    ).toBe(false);
  });
  it('uses same-frame distance and explicitly converts map centers once', () => {
    expect(haversine(location, location)).toBe(0);
    const point = normalizeCenter({
      ...required,
      center: {
        latitude: 31.22845773757727,
        longitude: 121.47822305927693,
        coordinate_system: 'GCJ-02',
        provider: 'amap',
      },
    });
    expect(haversine(point!, location)).toBeLessThan(5);
    expect(() =>
      normalizeCenter({
        ...required,
        center: { latitude: 60, longitude: 160, coordinate_system: 'GCJ-02', provider: 'amap' },
      }),
    ).toThrow();
  });
});
