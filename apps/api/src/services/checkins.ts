import type {
  EventRecord,
  CheckinInput,
  Answers,
  Participant,
} from '../../../../packages/contracts/src/index.js';
import { rosterValue, validateAnswers } from '../../../../packages/contracts/src/index.js';
import { db, rows, execute, transaction, type Sql } from '../db.js';
import { available, getEvent, readCheckin, decode } from './events.js';
import { browserDigest, digest, encrypt, randomToken, fail } from './security.js';
import { rosterDigest, claimFieldValues } from './field-values.js';
import { locationDecision } from './location.js';
interface Session {
  id: string;
  event_id: string;
  browser_digest: Buffer;
  form_version: number;
  policy_epoch: number;
  expires_at: Date;
  consumed: number;
  result_id: string | null;
}
export async function resolveSession(selector: string, token: string) {
  const r = await rows<Session>(
    db,
    'SELECT * FROM checkin_sessions WHERE selector=? AND token_digest=?',
    [selector, digest(token)],
  );
  if (!r[0]) return fail('SESSION_EXPIRED', '请重新扫描现场二维码', 401);
  return r[0];
}
async function prepare(e: EventRecord, input: CheckinInput, sql: Sql) {
  if (input.identity_value !== undefined) fail('INVALID_FORM', '请重新扫码并填写活动的自定义字段');
  let participant: Participant | undefined;
  if (e.admission === 'roster') {
    let hash: Buffer;
    try {
      hash = rosterDigest(e, input.answers);
    } catch (err) {
      return fail('INVALID_FORM', (err as Error).message);
    }
    const r = await rows<Participant>(
      sql,
      'SELECT * FROM participants WHERE event_id=? AND identity_digest=? FOR UPDATE',
      [e.id, hash],
    );
    participant = r[0];
    if (!participant?.active) fail('IDENTITY_NOT_ELIGIBLE', '资料未通过名单校验，请现场核验');
  }
  let answers: Answers;
  try {
    answers = validateAnswers(
      e.fields,
      input.answers,
      participant ? decode(participant.answers) : {},
    );
  } catch (err) {
    return fail('INVALID_FORM', (err as Error).message);
  }
  const identity = e.admission === 'roster' ? rosterValue(e, answers) : '';
  const hash = digest(randomToken());
  return { identity, hash, participant, answers };
}
export async function submit(
  session: Session,
  input: CheckinInput,
  idempotencyKey: string,
  browser: string,
  ip: string,
  ua: string,
) {
  const keyHash = digest(idempotencyKey);
  const requestHash = digest(JSON.stringify(input));
  const snapshot = await getEvent(session.event_id);
  let location: ReturnType<typeof locationDecision> | undefined;
  let locationError: unknown;
  try {
    location = locationDecision(snapshot, input.location);
  } catch (err) {
    locationError = err;
  }
  try {
    return await transaction(async (c) => {
      const event = await getEvent(session.event_id, c, 'shared');
      const [s] = await rows<Session>(c, 'SELECT * FROM checkin_sessions WHERE id=? FOR UPDATE', [
        session.id,
      ]);
      if (!s || !s.browser_digest.equals(browserDigest(browser)))
        return fail('SESSION_EXPIRED', '签到会话与浏览器不匹配', 401);
      const [old] = await rows<{ request_digest: Buffer; result_id: string }>(
        c,
        'SELECT request_digest,result_id FROM idempotency_records WHERE session_id=? AND key_digest=? AND expires_at>UTC_TIMESTAMP(3)',
        [s.id, keyHash],
      );
      if (old) {
        if (!old.request_digest.equals(requestHash))
          fail('IDEMPOTENCY_CONFLICT', '同一请求标识不能提交不同内容', 409);
        return readCheckin(old.result_id, c);
      }
      available(event);
      if (s.expires_at.getTime() <= Date.now() || s.consumed)
        fail('SESSION_EXPIRED', '签到会话已结束，请重新扫码');
      if (s.policy_epoch !== event.policy_epoch)
        fail('RULE_CHANGED', '活动规则已更新，请重新扫描二维码');
      if (snapshot.policy_epoch !== event.policy_epoch)
        fail('RULE_CHANGED', '活动规则已更新，请重试');
      if (locationError) throw locationError;
      const [form] = await rows<{ fields: EventRecord['fields'] | string }>(
        c,
        'SELECT fields FROM form_versions WHERE event_id=? AND version=?',
        [event.id, s.form_version],
      );
      if (!form) fail('INVALID_FORM', '表单版本不存在');
      event.fields = decode(form!.fields);
      const prepared = await prepare(event, input, c);
      const result = await execute(
        c,
        "INSERT INTO checkins(event_id,identity_digest,participant_id,identity_value,answers,status,source,checked_in_at,receipt_id,form_version,policy_epoch) VALUES (?,?,?,?,?,'CHECKED_IN','online',UTC_TIMESTAMP(3),?,?,?)",
        [
          event.id,
          prepared.hash,
          prepared.participant?.id ?? null,
          prepared.identity,
          JSON.stringify(prepared.answers),
          randomToken(),
          s.form_version,
          event.policy_epoch,
        ],
      );
      const id = String(result.insertId);
      await claimFieldValues(c, event, prepared.answers, id);
      const [shared] = await rows<{ count: number }>(
        c,
        'SELECT COUNT(*) AS count FROM checkin_evidence x JOIN checkins y ON x.checkin_id=y.id WHERE y.event_id=? AND x.browser_digest=?',
        [event.id, browserDigest(browser)],
      );
      const risks = Number(shared?.count ?? 0) > 0 ? ['同浏览器多次提交'] : [];
      await execute(
        c,
        'INSERT INTO checkin_evidence(checkin_id,encrypted_data,browser_digest,risk_flags,location_result,expires_at) VALUES (?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 7 DAY))',
        [
          id,
          encrypt({
            location: input.location ?? null,
            center: event.center,
            distance: location!.distance,
            conversion_version: 'gcoord@1.0.7',
            conversion_error_budget: event.conversion_error_budget,
            ip,
            ua: ua.slice(0, 300),
          }),
          browserDigest(browser),
          JSON.stringify(risks),
          location!.result,
        ],
      );
      await execute(c, 'UPDATE checkin_sessions SET consumed=TRUE,result_id=? WHERE id=?', [
        id,
        s.id,
      ]);
      await execute(
        c,
        'INSERT INTO idempotency_records(session_id,key_digest,request_digest,result_id,expires_at) VALUES (?,?,?,?,DATE_ADD(?,INTERVAL 24 HOUR))',
        [s.id, keyHash, requestHash, id, s.expires_at],
      );
      return readCheckin(id, c);
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY')
      fail('ALREADY_SUBMITTED', '不允许重复的字段值已有签到记录，请现场核验', 409);
    throw e;
  }
}
export async function manual(
  event: EventRecord,
  input: CheckinInput,
  status: 'CHECKED_IN' | 'PENDING_REVIEW',
  sql: Sql,
) {
  if (event.state === 'DRAFT' || Date.now() < Date.parse(event.starts_at))
    fail('ACTIVITY_UNAVAILABLE', '活动未发布或尚未开始，不能进行人工补签');
  const p = await prepare(event, input, sql);
  const result = await execute(
    sql,
    "INSERT INTO checkins(event_id,identity_digest,participant_id,identity_value,answers,status,source,checked_in_at,receipt_id,form_version,policy_epoch) VALUES (?,?,?,?,?,?,'manual',UTC_TIMESTAMP(3),?,?,?)",
    [
      event.id,
      p.hash,
      p.participant?.id ?? null,
      p.identity,
      JSON.stringify(p.answers),
      status,
      randomToken(),
      event.form_version,
      event.policy_epoch,
    ],
  );
  await claimFieldValues(sql, event, p.answers, String(result.insertId));
  return readCheckin(String(result.insertId), sql);
}
