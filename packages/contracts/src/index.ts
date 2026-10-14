import { z } from 'zod';
export const fieldTypes = [
  'text',
  'textarea',
  'phone',
  'email',
  'number',
  'date',
  'select',
  'multiselect',
  'boolean',
] as const;
const safeKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/)
  .refine((v) => !['constructor', 'prototype', '__proto__'].includes(v), '字段键为保留名称');
export const fieldSchema = z
  .object({
    key: safeKey,
    label: z.string().trim().min(1).max(80),
    label_en: z.string().trim().max(80).default(''),
    type: z.enum(fieldTypes),
    required: z.boolean().default(false),
    options: z
      .array(z.object({ key: z.string().min(1).max(80), label: z.string().min(1).max(100) }))
      .max(100)
      .default([]),
    help_text: z.string().max(300).default(''),
    visibility: z.enum(['public', 'admin']).default('public'),
    source: z.enum(['user', 'roster']).default('user'),
    allow_duplicates: z.boolean().default(true),
    ignore_case: z.boolean().default(false),
    roster_match: z.boolean().default(false),
    max_length: z.number().int().min(1).max(2000).default(2000),
  })
  .strict()
  .superRefine((f, c) => {
    if (
      f.roster_match &&
      (!['text', 'phone', 'email'].includes(f.type) ||
        !f.required ||
        f.visibility !== 'public' ||
        f.source !== 'user' ||
        f.max_length > 120)
    )
      c.addIssue({
        code: 'custom',
        message: '名单匹配字段须为必填的公开文本、手机号或邮箱，用户填写且长度不超过 120。',
      });
    if (f.ignore_case && !['text', 'textarea', 'email'].includes(f.type))
      c.addIssue({ code: 'custom', message: '只有文本与邮箱字段支持忽略大小写。' });
    if (
      ['select', 'multiselect'].includes(f.type) &&
      (!f.options.length || new Set(f.options.map((o) => o.key)).size !== f.options.length)
    )
      c.addIssue({ code: 'custom', message: '选择字段需要不重复的选项键' });
  });
export const eventConfigSchema = z
  .object({
    name: z.string().trim().min(1, '请输入活动名称').max(120),
    description: z.string().max(2000).default(''),
    organizer: z.string().trim().min(1).max(120),
    contact: z.string().max(200).default(''),
    checkin_logo: z
      .string()
      .max(32790)
      .regex(
        /^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
        'Logo 必须是处理后的 PNG 图片',
      )
      .nullable()
      .default(null),
    category: z.enum(['internal', 'external']).default('internal'),
    starts_at: z.iso.datetime(),
    checkin_early_minutes: z.number().int().min(0).max(1440).default(0),
    ends_at: z.iso.datetime(),
    timezone: z
      .string()
      .default('Asia/Shanghai')
      .refine((v) => {
        try {
          new Intl.DateTimeFormat('zh-CN', { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, '无效时区'),
    location_label: z.string().max(200).default(''),
    admission: z.enum(['open', 'roster']).default('open'),
    fields: z.array(fieldSchema).max(31).default([]),
    location_mode: z.enum(['off', 'record', 'required']).default('off'),
    center: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        coordinate_system: z.enum(['WGS84', 'GCJ-02']),
        provider: z.enum(['manual', 'amap']),
      })
      .strict()
      .nullable()
      .default(null),
    radius: z.number().min(50).max(10000).default(200),
    max_accuracy: z.number().min(1).max(1000).default(100),
    conversion_error_budget: z.number().min(5).max(100).default(10),
    retention_days: z.number().int().min(1).max(365).default(90),
  })
  .strict()
  .superRefine((e, c) => {
    if (new Date(e.starts_at) >= new Date(e.ends_at))
      c.addIssue({ code: 'custom', path: ['ends_at'], message: '结束时间必须晚于开始时间' });
    if (new Set(e.fields.map((f) => f.key)).size !== e.fields.length)
      c.addIssue({ code: 'custom', path: ['fields'], message: '字段键不能重复' });
    if (e.fields.filter((f) => f.roster_match).length > 1)
      c.addIssue({ code: 'custom', message: '只能选择一个名单匹配字段。' });
    if (e.admission === 'open' && e.fields.some((f) => f.source === 'roster'))
      c.addIssue({ code: 'custom', message: '名单权威字段仅用于名单模式' });
  });
export const eventInputSchema = eventConfigSchema.superRefine((event, context) => {
  event.fields.forEach((field, index) => {
    if (!field.label_en.trim())
      context.addIssue({
        code: 'custom',
        path: ['fields', index, 'label_en'],
        message: '所有字段名称必须填写中文和英文',
      });
  });
});
export type Field = z.infer<typeof fieldSchema>;
export type EventInput = z.infer<typeof eventInputSchema>;
export function checkinOpensAt(event: Pick<EventInput, 'starts_at' | 'checkin_early_minutes'>) {
  return Date.parse(event.starts_at) - (event.checkin_early_minutes ?? 0) * 60000;
}
export type EventState = 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'CLOSED';
export type CheckinState = 'CHECKED_IN' | 'PENDING_REVIEW' | 'REVOKED';
export type Answer = string | number | boolean | string[];
export type Answers = Record<string, Answer>;
export interface EventRecord extends EventInput {
  id: string;
  public_id: string;
  state: EventState;
  policy_epoch: number;
  form_version: number;
  created_at: string;
  checkin_count: number;
  participant_count: number;
  configuration_locked?: boolean;
  pending_count: number;
}
export interface CheckinRecord {
  id: string;
  identity_value: string;
  answers: Answers;
  status: CheckinState;
  source: 'online' | 'manual';
  checked_in_at: string;
  receipt_id: string;
  risk_flags: string[];
  location_result: string;
}
export interface Participant {
  id: string;
  identity_value: string;
  answers: Answers;
  active: boolean;
}
export interface ImportPreview {
  id: string;
  rows: Array<{ row: number; identity_value: string; answers: Answers }>;
  errors: Array<{ row: number; message: string }>;
  total: number;
  columns: string[];
}
export const locationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().positive().max(100000),
    coordinate_system: z.literal('WGS84'),
    source: z.literal('browser_geolocation'),
    captured_at: z.iso.datetime(),
  })
  .strict();
export type LocationInput = z.infer<typeof locationSchema>;
export const checkinInputSchema = z
  .object({
    // Legacy bodies remain parseable so a completed idempotent request can be recovered.
    identity_value: z.string().min(1).max(120).optional(),
    answers: z.record(
      z.string(),
      z.union([
        z.string().max(2000),
        z.number().finite(),
        z.boolean(),
        z.array(z.string().max(100)).max(100),
      ]),
    ),
    location: locationSchema.optional(),
  })
  .strict();
export type CheckinInput = z.infer<typeof checkinInputSchema>;
export interface PublicSession {
  event: Omit<EventInput, 'center' | 'conversion_error_budget'>;
  session_id: string;
  expires_at: string;
  server_time: string;
}
export function normalizeFieldValue(
  field: Pick<Field, 'type' | 'ignore_case'>,
  value: Answer,
): Answer {
  if (typeof value !== 'string') return Array.isArray(value) ? [...new Set(value)].sort() : value;
  if (!['text', 'textarea', 'phone', 'email'].includes(field.type)) return value;
  let text = value.trim().normalize('NFKC');
  if (field.type === 'phone') {
    text = text.replace(/[\s()-]/g, '').replace(/^\+86/, '');
    if (!/^1[3-9]\d{9}$/.test(text)) throw new Error('请输入有效的中国大陆手机号');
  }
  return field.ignore_case ? text.toLocaleLowerCase('en-US') : text;
}
export function canonicalFieldValue(
  field: Pick<Field, 'type' | 'ignore_case'>,
  value: Answer,
): string {
  return JSON.stringify(normalizeFieldValue(field, value));
}
export const rosterField = (event: Pick<EventInput, 'fields'>) =>
  event.fields.find((field) => field.roster_match);
export function rosterValue(event: Pick<EventInput, 'fields'>, answers: Answers): string {
  const field = rosterField(event);
  if (!field) throw new Error('请先设置名单匹配字段');
  const value = answers[field.key];
  if (typeof value !== 'string') throw new Error(`请填写${field.label}`);
  const normalized = normalizeFieldValue(field, value);
  if (typeof normalized !== 'string' || !normalized || normalized.length > 120)
    throw new Error(`${field.label}格式或长度不正确`);
  return normalized;
}
// Read old persisted configurations without creating a hidden system field in new activities.
export function upgradeLegacyEventConfig(config: unknown): EventInput {
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error('活动配置无效');
  const data = config as Record<string, unknown>;
  if (typeof data.identity_type !== 'string') return eventConfigSchema.parse(config);
  const { identity_type, identity_label, ignore_case, ...rest } = data;
  const fields = z.array(fieldSchema).parse(data.fields ?? []);
  let key = 'entry_code';
  for (let i = 1; fields.some((field) => field.key === key); i++) key = `entry_code_${i}`;
  const field = fieldSchema.parse({
    key,
    label: identity_label ?? '编号',
    type: identity_type === 'phone' ? 'phone' : 'text',
    required: true,
    allow_duplicates: false,
    ignore_case: Boolean(ignore_case) && identity_type !== 'phone',
    roster_match: true,
    max_length: 120,
  });
  return eventConfigSchema.parse({ ...rest, fields: [field, ...fields] });
}
export function validateAnswers(
  fields: Field[],
  answers: Answers,
  roster: Answers = {},
  mode: 'public' | 'import' = 'public',
): Answers {
  const result: Answers = {};
  const known = new Set(fields.map((f) => f.key));
  for (const key of Object.keys(answers)) {
    if (!known.has(key)) throw new Error(`未知字段：${key}`);
  }
  for (const field of fields) {
    if (mode === 'public' && field.visibility === 'admin') continue;
    let value =
      mode === 'public' && field.source === 'roster' ? roster[field.key] : answers[field.key];
    if (typeof value === 'string' && value.trim() !== '' && field.type === 'phone')
      value = normalizeFieldValue({ ...field, ignore_case: false }, value);
    const empty =
      value === undefined ||
      (typeof value === 'string' && value.trim() === '') ||
      (Array.isArray(value) && value.length === 0);
    if (empty) {
      if (field.required) throw new Error(`请填写${field.label}`);
      continue;
    }
    if (field.type === 'boolean') {
      if (typeof value !== 'boolean' || (field.required && !value))
        throw new Error(`请确认${field.label}`);
    } else if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value))
        throw new Error(`${field.label}必须是数字`);
    } else if (field.type === 'multiselect') {
      if (!Array.isArray(value) || value.some((v) => !field.options.some((o) => o.key === v)))
        throw new Error(`${field.label}包含无效选项`);
    } else {
      if (typeof value !== 'string' || value.length > field.max_length)
        throw new Error(`${field.label}格式或长度不正确`);
      if (field.type === 'email' && !z.email().safeParse(value).success)
        throw new Error(`${field.label}邮箱格式不正确`);
      if (field.type === 'phone' && !/^1[3-9]\d{9}$/.test(value))
        throw new Error(`${field.label}手机号格式不正确`);
      if (field.type === 'date' && !z.iso.date().safeParse(value).success)
        throw new Error(`${field.label}日期格式不正确`);
      if (field.type === 'select' && !field.options.some((o) => o.key === value))
        throw new Error(`${field.label}选项无效`);
    }
    result[field.key] = value as Answer;
  }
  return result;
}
export const stateLabels: Record<EventState, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  PAUSED: '已暂停',
  CLOSED: '已结束',
};
export const checkinLabels: Record<CheckinState, string> = {
  CHECKED_IN: '签到成功',
  PENDING_REVIEW: '待核验',
  REVOKED: '已撤销',
};
