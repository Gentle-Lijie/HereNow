import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, HTTPMethods, InjectOptions } from 'fastify';
import { randomUUID, createHmac } from 'node:crypto';
import { buildApp } from '../apps/api/src/app.js';
import { config } from '../apps/api/src/config.js';
import { db, execute, rows } from '../apps/api/src/db.js';
import { createTestAdmin } from './fixtures/admin.js';
import {
  eventInputSchema,
  eventConfigSchema,
  type EventRecord,
  type Answers,
} from '../packages/contracts/src/index.js';
import { randomToken, digest, browserDigest } from '../apps/api/src/services/security.js';
import { up as migrateFields } from '../database/migrations/003_custom_fields.js';
let app: FastifyInstance;
let account: Awaited<ReturnType<typeof createTestAdmin>>;
let admin: Client;
const created: string[] = [];
class Client {
  cookies = new Map<string, string>();
  csrf = '';
  async call(
    method: HTTPMethods,
    path: string,
    payload?: InjectOptions['payload'],
    extra: Record<string, string> = {},
  ) {
    const r = await app.inject({
      method,
      url: '/api' + path,
      payload,
      headers: {
        origin: config.APP_ORIGIN,
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join(';'),
        'x-csrf-token': this.csrf,
        ...extra,
      },
    });
    for (const cookie of r.cookies) this.cookies.set(cookie.name, cookie.value);
    return r;
  }
  async context() {
    this.csrf = (await this.call('GET', '/context')).json().csrf_token as string;
    return this;
  }
}
const code = {
  key: 'entry_code',
  label: '报名号',
  label_en: 'Registration code',
  type: 'text' as const,
  required: true,
  allow_duplicates: false,
};
const phone = {
  key: 'phone',
  label: '手机号',
  label_en: 'Phone number',
  type: 'phone' as const,
  required: true,
  allow_duplicates: false,
};
async function create(overrides: Record<string, unknown> = {}) {
  const candidate = eventConfigSchema.parse({
    name: '字段重复规则回归',
    organizer: '仅测试',
    starts_at: new Date(Date.now() - 60000).toISOString(),
    ends_at: new Date(Date.now() + 3600000).toISOString(),
    ...overrides,
  });
  const input = eventInputSchema.parse({
    ...candidate,
    fields: candidate.fields.map((field) => ({ ...field, label_en: field.label_en || field.key })),
  });
  const response = await admin.call('POST', '/admin/events', input);
  expect(response.statusCode).toBe(200);
  const event = response.json().event as EventRecord;
  created.push(event.id);
  return { input, event };
}
async function qr(event: EventRecord) {
  const display = (await admin.call('POST', `/admin/events/${event.id}/display-sessions`)).json()
    .display_url as string;
  await admin.call('POST', `/display/events/${event.id}/connect`, {
    token: display.split('#d=')[1]!,
  });
  return (await admin.call('GET', `/display/events/${event.id}/qr`)).json().token as string;
}
async function publish(event: EventRecord) {
  expect((await admin.call('POST', `/admin/events/${event.id}/publish`)).statusCode).toBe(200);
  return qr(event);
}
async function scan(event: EventRecord, token: string) {
  const client = await new Client().context();
  const r = await client.call('POST', '/public/check-in-sessions', {
    public_id: event.public_id,
    token,
  });
  expect(r.statusCode).toBe(200);
  return { client, selector: r.json().session_id as string };
}
const headers = (selector: string, key = randomUUID()) => ({
  'x-session-id': selector,
  'idempotency-key': key,
});
async function check(event: EventRecord, token: string, answers: Answers) {
  const { client, selector } = await scan(event, token);
  return client.call('POST', '/public/checkins', { answers }, headers(selector));
}
beforeAll(async () => {
  account = await createTestAdmin();
  app = await buildApp();
  await app.ready();
  admin = await new Client().context();
  expect(
    (
      await admin.call('POST', '/admin/login', {
        username: account.username,
        password: account.password,
      })
    ).statusCode,
  ).toBe(200);
});
afterAll(async () => {
  for (const id of created) {
    await execute(db, 'DELETE FROM audit_logs WHERE event_id=?', [id]);
    await execute(db, 'DELETE FROM attempts WHERE event_id=?', [id]);
    await execute(db, 'DELETE FROM events WHERE id=?', [id]);
  }
  await account.dispose();
  await app.close();
  await db.end();
});
describe('custom field repetition rules in real MySQL', () => {
  it('allows removing unneeded fields before data exists and locks structure after the first record', async () => {
    const { event, input } = await create({ fields: [code] });
    await publish(event);
    expect(
      (await admin.call('GET', `/admin/events/${event.id}`)).json().event.configuration_locked,
    ).toBe(false);
    expect(
      (await admin.call('PATCH', `/admin/events/${event.id}`, { ...input, fields: [] })).statusCode,
    ).toBe(200);
    await check(event, await qr(event), {});
    expect(
      (await admin.call('GET', `/admin/events/${event.id}`)).json().event.configuration_locked,
    ).toBe(true);
    expect(
      (await admin.call('PATCH', `/admin/events/${event.id}`, { ...input, fields: [code] }))
        .statusCode,
    ).toBe(400);
  });
  it('can add an optional independently unique field after previous submissions', async () => {
    const { event, input } = await create({ fields: [code] });
    await publish(event);
    await check(event, await qr(event), { entry_code: '1' });
    const badge = {
      key: 'badge',
      label: '证件号',
      label_en: 'Badge number',
      type: 'text',
      required: false,
      allow_duplicates: false,
    };
    expect(
      (await admin.call('PATCH', `/admin/events/${event.id}`, { ...input, fields: [code, badge] }))
        .statusCode,
    ).toBe(200);
    const token = await qr(event);
    expect((await check(event, token, { entry_code: '2', badge: 'A' })).statusCode).toBe(200);
    expect((await check(event, token, { entry_code: '3', badge: 'A' })).statusCode).toBe(409);
  });
  it('protects map configuration and proxy endpoints with backend authentication', async () => {
    const anon = await new Client().context();
    expect((await anon.call('GET', '/admin/map-config')).statusCode).toBe(401);
    expect((await anon.call('GET', '/_AMapService/v3/place/text')).statusCode).toBe(401);
    const r = await admin.call('GET', '/admin/map-config');
    expect(r.statusCode).toBe(200);
    expect(Object.keys(r.json()).sort()).toEqual(['code', 'ready', 'request_id']);
    expect((await admin.call('GET', '/_AMapService/unknown')).statusCode).toBe(404);
  });
  it('needs no identity field and allows repeated values while retaining idempotency', async () => {
    const { event } = await create({ fields: [{ key: 'name', label: '姓名', type: 'text' }] });
    const token = await publish(event);
    const { client, selector } = await scan(event, token),
      h = headers(selector),
      body = { answers: { name: '同名参与者' } };
    const first = await client.call('POST', '/public/checkins', body, h);
    expect(first.statusCode).toBe(200);
    await execute(
      db,
      'UPDATE checkin_sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE selector=?',
      [selector],
    );
    const retry = await client.call('POST', '/public/checkins', body, h);
    expect(retry.json().result.id).toBe(first.json().result.id);
    const second = await check(event, token, body.answers);
    expect(second.statusCode).toBe(200);
    expect(second.json().result.id).not.toBe(first.json().result.id);
    const empty = await create();
    const q = await publish(empty.event);
    expect((await check(empty.event, q, {})).statusCode).toBe(200);
    expect((await check(empty.event, q, {})).statusCode).toBe(200);
  });
  it('rejects a collision in any independently unique field and rolls back partial claims', async () => {
    const { event } = await create({ fields: [code, phone] });
    const token = await publish(event);
    expect(
      (await check(event, token, { entry_code: '0001', phone: '13800138000' })).statusCode,
    ).toBe(200);
    expect(
      (await check(event, token, { entry_code: '0001', phone: '13800138001' })).statusCode,
    ).toBe(409);
    const { client, selector } = await scan(event, token),
      h = headers(selector);
    expect(
      (
        await client.call(
          'POST',
          '/public/checkins',
          { answers: { entry_code: '0002', phone: '+86 138-0013-8000' } },
          h,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await client.call(
          'POST',
          '/public/checkins',
          { answers: { entry_code: '0002', phone: '13800138002' } },
          h,
        )
      ).statusCode,
    ).toBe(200);
    const [count] = await rows<{ n: number }>(
      db,
      'SELECT COUNT(*) n FROM checkins WHERE event_id=?',
      [event.id],
    );
    expect(Number(count!.n)).toBe(2);
    const claims = await rows(db, 'SELECT * FROM checkin_field_values WHERE event_id=?', [
      event.id,
    ]);
    expect(claims).toHaveLength(4);
    await expect(
      execute(
        db,
        'INSERT INTO checkin_field_values(event_id,field_key,value_digest,checkin_id) VALUES (?,?,NULL,?)',
        [event.id, 'invalid', firstId(claims)],
      ),
    ).rejects.toThrow();
  });
  it('uses a real unique index to reject 19 of 20 concurrent duplicate field submissions', async () => {
    const { event } = await create({ fields: [code] });
    const token = await publish(event);
    const clients = await Promise.all(Array.from({ length: 20 }, () => scan(event, token)));
    const responses = await Promise.all(
      clients.map(({ client, selector }) =>
        client.call(
          'POST',
          '/public/checkins',
          { answers: { entry_code: '000123' } },
          headers(selector),
        ),
      ),
    );
    expect(responses.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.statusCode === 409)).toHaveLength(19);
  });
  it('skips empty optional values and preserves string zeros and case rules', async () => {
    const { event } = await create({ fields: [{ ...code, required: false, ignore_case: true }] });
    const token = await publish(event);
    expect((await check(event, token, {})).statusCode).toBe(200);
    expect((await check(event, token, {})).statusCode).toBe(200);
    expect((await check(event, token, { entry_code: ' 000ABC ' })).statusCode).toBe(200);
    expect((await check(event, token, { entry_code: '000abc' })).statusCode).toBe(409);
    expect((await check(event, token, { entry_code: '1' })).statusCode).toBe(200);
    expect((await check(event, token, { entry_code: '001' })).statusCode).toBe(200);
  });
  it('rejects tightening duplicate rules over existing collisions without changing configuration', async () => {
    const { event, input } = await create({ fields: [{ ...code, allow_duplicates: true }] });
    const token = await publish(event);
    await check(event, token, { entry_code: 'a' });
    await check(event, token, { entry_code: 'a' });
    const r = await admin.call('PATCH', `/admin/events/${event.id}`, { ...input, fields: [code] });
    expect(r.statusCode).toBe(400);
    const current = (await admin.call('GET', `/admin/events/${event.id}`)).json()
      .event as EventRecord;
    expect(current.fields[0]!.allow_duplicates).toBe(true);
    expect(
      await rows(db, 'SELECT 1 FROM checkin_field_values WHERE event_id=?', [event.id]),
    ).toHaveLength(0);
  });
  it('updates repeat rules transactionally, invalidates old sessions, and can permit repetition again', async () => {
    const { event, input } = await create({ fields: [{ ...code, allow_duplicates: true }] });
    const token = await publish(event);
    await check(event, token, { entry_code: 'a' });
    const old = await scan(event, token);
    const patched = await admin.call('PATCH', `/admin/events/${event.id}`, {
      ...input,
      fields: [code],
    });
    expect(patched.statusCode).toBe(200);
    expect(
      (
        await old.client.call(
          'POST',
          '/public/checkins',
          { answers: { entry_code: 'b' } },
          headers(old.selector),
        )
      ).json().code,
    ).toBe('RULE_CHANGED');
    const next = await qr(event);
    expect((await check(event, next, { entry_code: 'a' })).statusCode).toBe(409);
    expect((await admin.call('PATCH', `/admin/events/${event.id}`, input)).statusCode).toBe(200);
    expect((await check(event, await qr(event), { entry_code: 'a' })).statusCode).toBe(200);
  });
  it('uses a selected custom field for roster admission independently of repeat permission', async () => {
    const match = { ...code, roster_match: true, max_length: 120, allow_duplicates: true };
    const { event } = await create({ admission: 'roster', fields: [match] });
    const { rosterDigest } = await import('../apps/api/src/services/field-values.js');
    await execute(
      db,
      'INSERT INTO participants(event_id,identity_digest,identity_value,answers) VALUES (?,?,?,?)',
      [event.id, rosterDigest(event, { entry_code: '0001' }), '0001', '{"entry_code":"0001"}'],
    );
    const token = await publish(event);
    expect((await check(event, token, { entry_code: '0001' })).statusCode).toBe(200);
    expect((await check(event, token, { entry_code: '0001' })).statusCode).toBe(200);
    expect((await check(event, token, { entry_code: '9999' })).json().code).toBe(
      'IDENTITY_NOT_ELIGIBLE',
    );
  });
  it('preserves legacy records, deduplication and completed idempotent results during migration', async () => {
    const input = eventInputSchema.parse({
      name: '旧活动迁移回归',
      organizer: '仅测试',
      starts_at: new Date(Date.now() - 60000).toISOString(),
      ends_at: new Date(Date.now() + 3600000).toISOString(),
      fields: [{ key: 'name', label: '姓名', label_en: 'Name', type: 'text' }],
    });
    const cfg = {
      ...input,
      identity_type: 'registration',
      identity_label: '报名编号',
      ignore_case: false,
    };
    const publicId = randomToken();
    const result = await execute(
      db,
      "INSERT INTO events(public_id,state,config) VALUES (?,'PUBLISHED',?)",
      [publicId, JSON.stringify(cfg)],
    );
    const id = String(result.insertId);
    created.push(id);
    await execute(db, 'INSERT INTO form_versions(event_id,version,fields) VALUES (?,1,?)', [
      id,
      JSON.stringify(input.fields),
    ]);
    const hash = createHmac('sha256', config.IDENTITY_SECRET)
      .update(JSON.stringify([id, 'registration', '000123']))
      .digest();
    const receipt = randomToken();
    const record = await execute(
      db,
      "INSERT INTO checkins(event_id,identity_digest,identity_value,answers,status,source,checked_in_at,receipt_id,form_version,policy_epoch) VALUES (?,?,?,?,'CHECKED_IN','online',UTC_TIMESTAMP(3),?,1,1)",
      [id, hash, '000123', '{"name":"原始姓名"}', receipt],
    );
    const client = await new Client().context(),
      selector = randomToken(),
      token = randomToken();
    client.cookies.set(`hn_checkin_${selector}`, token);
    const session = await execute(
      db,
      'INSERT INTO checkin_sessions(selector,token_digest,event_id,browser_digest,form_version,policy_epoch,expires_at,consumed,result_id) VALUES (?,?,?,?,1,1,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND),TRUE,?)',
      [
        selector,
        digest(token),
        id,
        browserDigest(client.cookies.get('hn_browser')!),
        String(record.insertId),
      ],
    );
    const key = randomUUID(),
      body = { identity_value: '000123', answers: { name: '原始姓名' } };
    await execute(
      db,
      'INSERT INTO idempotency_records(session_id,key_digest,request_digest,result_id,expires_at) VALUES (?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR))',
      [
        String(session.insertId),
        digest(key),
        digest(JSON.stringify(body)),
        String(record.insertId),
      ],
    );
    const connection = await db.getConnection();
    try {
      await migrateFields(connection);
      await migrateFields(connection);
    } finally {
      connection.release();
    }
    const migrated = (await admin.call('GET', `/admin/events/${id}`)).json().event as EventRecord;
    expect(migrated.fields[0]).toMatchObject({ label: '报名编号', allow_duplicates: false });
    expect('identity_type' in migrated).toBe(false);
    const retry = await client.call('POST', '/public/checkins', body, headers(selector, key));
    expect(retry.statusCode).toBe(200);
    expect(retry.json().result.answers).toEqual({ entry_code: '000123', name: '原始姓名' });
    expect(
      await rows(db, 'SELECT 1 FROM checkin_field_values WHERE event_id=?', [id]),
    ).toHaveLength(1);
    expect(
      (await check(migrated, await qr(migrated), { entry_code: '000123', name: '新姓名' }))
        .statusCode,
    ).toBe(409);
  });
});
function firstId(values: unknown[]): string {
  return String((values[0] as { checkin_id: string }).checkin_id);
}
