import { createHmac } from 'node:crypto';
import {
  canonicalFieldValue,
  rosterField,
  rosterValue,
  type EventRecord,
  type Field,
  type Answers,
} from '../../../../packages/contracts/src/index.js';
import { fail } from './security.js';
import { config } from '../config.js';
import { execute, rows, type Sql } from '../db.js';
export const fieldValueDigest = (eventId: string, field: Field, value: Answers[string]) =>
  createHmac('sha256', config.IDENTITY_SECRET)
    .update(JSON.stringify([eventId, field.key, field.type, canonicalFieldValue(field, value)]))
    .digest();
export function rosterDigest(event: Pick<EventRecord, 'id' | 'fields'>, answers: Answers) {
  const field = rosterField(event);
  if (!field) throw new Error('请先设置名单匹配字段');
  return fieldValueDigest(event.id, field, rosterValue(event, answers));
}
export async function claimFieldValues(
  sql: Sql,
  event: Pick<EventRecord, 'id' | 'fields'>,
  answers: Answers,
  checkinId: string,
) {
  // All callers hold the activity lock; the unique index remains the concurrency backstop.
  for (const field of [...event.fields].sort((a, b) => a.key.localeCompare(b.key))) {
    const value = answers[field.key];
    if (
      field.allow_duplicates ||
      value === undefined ||
      (typeof value === 'string' && value.trim() === '') ||
      (Array.isArray(value) && !value.length)
    )
      continue;
    try {
      await execute(
        sql,
        'INSERT INTO checkin_field_values(event_id,field_key,value_digest,checkin_id) VALUES (?,?,?,?)',
        [event.id, field.key, fieldValueDigest(event.id, field, value), checkinId],
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY')
        fail('ALREADY_SUBMITTED', `${field.label}不允许重复，请修改或现场核验`, 409);
      throw error;
    }
  }
}
export async function rebuildFieldValues(sql: Sql, event: Pick<EventRecord, 'id' | 'fields'>) {
  await execute(sql, 'DELETE FROM checkin_field_values WHERE event_id=?', [event.id]);
  const records = await rows<{ id: string; answers: Answers | string }>(
    sql,
    'SELECT id,answers FROM checkins WHERE event_id=? ORDER BY id',
    [event.id],
  );
  for (const record of records)
    await claimFieldValues(
      sql,
      event,
      typeof record.answers === 'string' ? (JSON.parse(record.answers) as Answers) : record.answers,
      String(record.id),
    );
}
export async function rebuildRosterValues(sql: Sql, event: Pick<EventRecord, 'id' | 'fields'>) {
  const participants = await rows<{ id: string; answers: Answers | string }>(
    sql,
    'SELECT id,answers FROM participants WHERE event_id=?',
    [event.id],
  );
  if (!participants.length) return;
  for (const participant of participants) {
    const answers =
      typeof participant.answers === 'string'
        ? (JSON.parse(participant.answers) as Answers)
        : participant.answers;
    await execute(sql, 'UPDATE participants SET identity_digest=?,identity_value=? WHERE id=?', [
      rosterDigest(event, answers),
      rosterValue(event, answers),
      participant.id,
    ]);
  }
}
export function rosterImportConflicts(
  event: Pick<EventRecord, 'fields'>,
  existing: Answers[],
  incoming: Array<{ row: number; answers: Answers }>,
  mode: 'add' | 'update',
) {
  const merged = new Map<string, { row: number; answers: Answers }>();
  for (const answers of existing) merged.set(rosterValue(event, answers), { row: 0, answers });
  const errors: Array<{ row: number; message: string }> = [];
  for (const item of incoming) {
    const match = rosterValue(event, item.answers);
    if (mode === 'add' && merged.has(match))
      errors.push({ row: item.row, message: '名单匹配值已存在，可选择按匹配字段更新' });
    merged.set(match, item);
  }
  const seen = new Map<string, number>();
  for (const item of merged.values())
    for (const field of event.fields.filter((f) => !f.allow_duplicates)) {
      const value = item.answers[field.key];
      if (
        value === undefined ||
        (typeof value === 'string' && !value.trim()) ||
        (Array.isArray(value) && !value.length)
      )
        continue;
      const key = JSON.stringify([field.key, canonicalFieldValue(field, value)]);
      if (seen.has(key))
        errors.push({
          row: item.row || seen.get(key) || 1,
          message: `${field.label}不允许重复，名单中已存在相同值`,
        });
      else seen.set(key, item.row);
    }
  return errors;
}
