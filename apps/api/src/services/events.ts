import type {
  EventInput,
  EventRecord,
  EventState,
  Answers,
  CheckinRecord,
} from '../../../../packages/contracts/src/index.js';
import {
  checkinOpensAt,
  upgradeLegacyEventConfig,
} from '../../../../packages/contracts/src/index.js';
import { db, rows, execute, type Sql } from '../db.js';
import { fail } from './security.js';
export interface EventRow {
  id: string;
  public_id: string;
  state: EventState;
  config: EventInput | string;
  policy_epoch: number;
  form_version: number;
  created_at: Date;
  checkin_count?: number;
  participant_count?: number;
  pending_count?: number;
}
export const decode = <T>(v: T | string): T => (typeof v === 'string' ? (JSON.parse(v) as T) : v);
export const fromEvent = (r: EventRow): EventRecord => ({
  ...upgradeLegacyEventConfig(decode(r.config)),
  id: String(r.id),
  public_id: r.public_id,
  state: r.state,
  policy_epoch: r.policy_epoch,
  form_version: r.form_version,
  created_at: r.created_at.toISOString(),
  checkin_count: Number(r.checkin_count ?? 0),
  participant_count: Number(r.participant_count ?? 0),
  pending_count: Number(r.pending_count ?? 0),
});
export async function getEvent(
  id: string,
  sql: Sql = db,
  lock: 'shared' | 'exclusive' | null = null,
) {
  const r = await rows<EventRow>(
    sql,
    `SELECT * FROM events WHERE id=?${lock === 'shared' ? ' FOR SHARE' : lock === 'exclusive' ? ' FOR UPDATE' : ''}`,
    [id],
  );
  if (!r[0]) return fail('NOT_FOUND', '活动不存在', 404);
  return fromEvent(r[0]);
}
export function available(e: EventRecord, now = Date.now()) {
  if (e.state !== 'PUBLISHED' || now < checkinOpensAt(e) || now >= Date.parse(e.ends_at))
    fail(
      'ACTIVITY_UNAVAILABLE',
      e.state === 'PAUSED' ? '活动已暂停，请联系现场工作人员' : '活动尚未开始或已结束',
    );
}
export async function audit(
  sql: Sql,
  userId: string,
  eventId: string | null,
  action: string,
  reason = '',
) {
  await execute(sql, 'INSERT INTO audit_logs(user_id,event_id,action,reason) VALUES (?,?,?,?)', [
    userId,
    eventId,
    action,
    reason,
  ]);
}
export interface CheckinRow {
  id: string;
  identity_value: string;
  answers: Answers | string;
  status: CheckinRecord['status'];
  source: CheckinRecord['source'];
  checked_in_at: Date;
  receipt_id: string;
  risk_flags: string[] | string | null;
  location_result: string | null;
}
export const fromCheckin = (r: CheckinRow): CheckinRecord => ({
  ...r,
  id: String(r.id),
  answers: decode(r.answers),
  checked_in_at: r.checked_in_at.toISOString(),
  risk_flags: r.risk_flags ? decode(r.risk_flags) : [],
  location_result: r.location_result ?? '未采集',
});
export async function readCheckin(id: string, sql: Sql = db) {
  const r = await rows<CheckinRow>(
    sql,
    'SELECT c.*,e.risk_flags,e.location_result FROM checkins c LEFT JOIN checkin_evidence e ON e.checkin_id=c.id WHERE c.id=?',
    [id],
  );
  if (!r[0]) return fail('NOT_FOUND', '记录不存在', 404);
  return fromCheckin(r[0]);
}

export async function getAdminEvent(id: string) {
  const event = await getEvent(id);
  const [data] = await rows<{ locked: number | string }>(
    db,
    'SELECT EXISTS(SELECT 1 FROM checkins WHERE event_id=?) OR EXISTS(SELECT 1 FROM participants WHERE event_id=?) AS locked',
    [id, id],
  );
  return { ...event, configuration_locked: Number(data?.locked ?? 0) > 0 };
}
