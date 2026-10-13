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
  .refine(
    (v) => !['identity_value', 'constructor', 'prototype', '__proto__'].includes(v),
    '字段键为保留名称',
  );
export const fieldSchema = z
  .object({
    key: safeKey,
    label: z.string().trim().min(1).max(80),
    type: z.enum(fieldTypes),
    required: z.boolean().default(false),
    options: z
      .array(z.object({ key: z.string().min(1).max(80), label: z.string().min(1).max(100) }))
      .max(100)
      .default([]),
    help_text: z.string().max(300).default(''),
    visibility: z.enum(['public', 'admin']).default('public'),
    source: z.enum(['user', 'roster']).default('user'),
    max_length: z.number().int().min(1).max(2000).default(2000),
  })
  .strict()
  .superRefine((f, c) => {
    if (
      ['select', 'multiselect'].includes(f.type) &&
      (!f.options.length || new Set(f.options.map((o) => o.key)).size !== f.options.length)
    )
      c.addIssue({ code: 'custom', message: '选择字段需要不重复的选项键' });
  });
export const eventInputSchema = z
  .object({
    name: z.string().trim().min(1, '请输入活动名称').max(120),
    description: z.string().max(2000).default(''),
    organizer: z.string().trim().min(1).max(120),
    contact: z.string().max(200).default(''),
    category: z.enum(['internal', 'external']).default('internal'),
    starts_at: z.iso.datetime(),
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
    identity_label: z.string().min(1).max(60).default('报名编号'),
    identity_type: z.enum(['registration', 'employee', 'student', 'phone']).default('registration'),
    ignore_case: z.boolean().default(false),
    fields: z.array(fieldSchema).max(30).default([]),
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
    if (e.admission === 'open' && e.fields.some((f) => f.source === 'roster'))
      c.addIssue({ code: 'custom', message: '名单权威字段仅用于名单模式' });
  });
export type Field = z.infer<typeof fieldSchema>;
export type EventInput = z.infer<typeof eventInputSchema>;
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
    identity_value: z.string().min(1).max(120),
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
  event: Omit<EventInput, 'ignore_case' | 'center' | 'conversion_error_budget'>;
  session_id: string;
  expires_at: string;
  server_time: string;
}
export const normalizeIdentity = (
  value: string,
  event: Pick<EventInput, 'identity_type' | 'ignore_case'>,
) => {
  let v = value.trim().normalize('NFKC');
  if (event.identity_type === 'phone') {
    v = v.replace(/[\s()-]/g, '').replace(/^\+86/, '');
    if (!/^1[3-9]\d{9}$/.test(v)) throw new Error('请输入有效的中国大陆手机号');
  }
  if (!v || v.length > 120) throw new Error('身份标识格式不正确');
  return event.ignore_case ? v.toLocaleLowerCase('en-US') : v;
};
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
    const value =
      mode === 'public' && field.source === 'roster' ? roster[field.key] : answers[field.key];
    const empty =
      value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
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
