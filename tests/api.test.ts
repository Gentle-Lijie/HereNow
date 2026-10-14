import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance, HTTPMethods, InjectOptions } from 'fastify';
import { hash } from '@node-rs/argon2';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { PNG } from 'pngjs';
import { buildApp } from '../apps/api/src/app.js';
import { db, execute, rows } from '../apps/api/src/db.js';
import { config } from '../apps/api/src/config.js';
import {
  eventInputSchema,
  fieldSchema,
  type EventRecord,
} from '../packages/contracts/src/index.js';
import { randomToken, digest } from '../apps/api/src/services/security.js';
import { rosterDigest } from '../apps/api/src/services/field-values.js';
import { createTestAdmin } from './fixtures/admin.js';
import { resetAdminPassword } from '../apps/api/src/services/accounts.js';
import { up as migrateBilingualFields } from '../database/migrations/006_bilingual_field_labels.js';
let testAdmin: Awaited<ReturnType<typeof createTestAdmin>> | undefined;
const operators: string[] = [];
let app: FastifyInstance;
let admin: Client;
const created: string[] = [];
class Client {
  cookies = new Map<string, string>();
  csrf = '';
  async call(
    method: HTTPMethods,
    url: string,
    payload?: InjectOptions['payload'],
    extra: Record<string, string> = {},
  ) {
    const response = await app.inject({
      method,
      url,
      payload,
      headers: {
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join(';'),
        origin: config.APP_ORIGIN,
        'x-csrf-token': this.csrf,
        ...extra,
      },
    });
    for (const c of response.cookies) this.cookies.set(c.name, c.value);
    return response;
  }
  async context() {
    const r = await this.call('GET', '/api/context');
    this.csrf = r.json().csrf_token as string;
    return this;
  }
  async scan(e: EventRecord, token: string) {
    const r = await this.call('POST', '/api/public/check-in-sessions', {
      public_id: e.public_id,
      token,
    });
    expect(r.statusCode).toBe(200);
    return r.json().session_id as string;
  }
}
async function create(overrides: Record<string, unknown> = {}) {
  const fields: unknown[] = Array.isArray(overrides.fields)
    ? overrides.fields
    : [{ key: 'name', label: '姓名', type: 'text', required: true }];
  const input = eventInputSchema.parse({
    name: '自动化验收 · 临时活动',
    organizer: '仅测试',
    starts_at: new Date(Date.now() - 60000).toISOString(),
    ends_at: new Date(Date.now() + 3600000).toISOString(),
    ...overrides,
    fields: [
      {
        key: 'entry_code',
        label: '编号',
        label_en: 'Entry code',
        type: 'text',
        required: true,
        allow_duplicates: false,
        roster_match: true,
        max_length: 120,
      },
      ...fields.map((f) => {
        const field = fieldSchema.parse(f);
        return { ...field, label_en: field.label_en || field.key };
      }),
    ],
  });
  const r = await admin.call('POST', '/api/admin/events', input);
  expect(r.statusCode).toBe(200);
  const e = r.json().event as EventRecord;
  created.push(e.id);
  return e;
}
async function publish(e: EventRecord) {
  expect((await admin.call('POST', `/api/admin/events/${e.id}/publish`)).statusCode).toBe(200);
  const display = await admin.call('POST', `/api/admin/events/${e.id}/display-sessions`);
  const token = String(display.json().display_url).split('#d=')[1]!;
  expect(
    (await admin.call('POST', `/api/display/events/${e.id}/connect`, { token })).statusCode,
  ).toBe(200);
  const qr = await admin.call('GET', `/api/display/events/${e.id}/qr`);
  expect(qr.statusCode).toBe(200);
  return qr.json().token as string;
}
const submission = (identity = '000123') => ({
  answers: { entry_code: identity, name: '测试参与者' },
});
const headers = (selector: string, key = randomUUID()) => ({
  'x-session-id': selector,
  'idempotency-key': key,
});
beforeAll(async () => {
  testAdmin = await createTestAdmin();
  app = await buildApp();
  await app.ready();
  admin = await new Client().context();
  expect(
    (
      await admin.call('POST', '/api/admin/login', {
        username: testAdmin.username,
        password: testAdmin.password,
      })
    ).statusCode,
  ).toBe(200);
});
afterAll(async () => {
  for (const id of created) {
    await execute(db, 'DELETE FROM audit_logs WHERE event_id=?', [id]);
    await execute(db, 'DELETE FROM events WHERE id=?', [id]);
  }
  for (const id of operators) {
    await execute(db, 'DELETE FROM admin_sessions WHERE user_id=?', [id]);
    await execute(db, 'DELETE FROM event_members WHERE user_id=?', [id]);
    await execute(db, 'DELETE FROM users WHERE id=?', [id]);
  }
  await testAdmin?.dispose();
  await app.close();
  await db.end();
});
describe('real MySQL check-in transactions', () => {
  it('requires backend authentication and CSRF and protects current QR issuance', async () => {
    const anon = await new Client().context();
    expect((await anon.call('GET', '/api/admin/events')).statusCode).toBe(401);
    expect((await anon.call('POST', '/api/admin/events', {})).statusCode).toBe(401);
    const r = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: 'admin', password: 'x' },
    });
    expect(r.statusCode).toBe(403);
    const e = await create();
    expect((await anon.call('GET', `/api/display/events/${e.id}/qr`)).statusCode).toBe(401);
  });
  it('allows many people to scan the same QR but inserts one identity under 20 concurrent submissions', async () => {
    const e = await create(),
      token = await publish(e);
    const clients = await Promise.all(
      Array.from({ length: 20 }, async () => {
        const c = await new Client().context();
        const selector = await c.scan(e, token);
        return { c, selector };
      }),
    );
    const results = await Promise.all(
      clients.map(({ c, selector }) =>
        c.call('POST', '/api/public/checkins', submission(), headers(selector)),
      ),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.json().code === 'ALREADY_SUBMITTED')).toHaveLength(19);
    const [count] = await rows<{ n: number }>(
      db,
      'SELECT COUNT(*) AS n FROM checkins WHERE event_id=?',
      [e.id],
    );
    expect(Number(count?.n)).toBe(1);
    expect(results.find((r) => r.statusCode !== 200)?.json().receipt_id).toBeUndefined();
  });
  it('retrieves idempotent success after activity close and session expiry; rejects changed content', async () => {
    const e = await create(),
      token = await publish(e),
      c = await new Client().context(),
      selector = await c.scan(e, token),
      h = headers(selector);
    const first = await c.call('POST', '/api/public/checkins', submission(), h);
    expect(first.statusCode).toBe(200);
    await admin.call('POST', `/api/admin/events/${e.id}/state`, { state: 'CLOSED' });
    await execute(
      db,
      'UPDATE checkin_sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE) WHERE selector=?',
      [selector],
    );
    const replay = await c.call('POST', '/api/public/checkins', submission(), h);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().receipt_id).toBe(first.json().receipt_id);
    expect((await c.call('POST', '/api/public/checkins', submission('000999'), h)).statusCode).toBe(
      409,
    );
  });
  it('invalidates pre-pause sessions on resume and rejects tampered or cross-event QR', async () => {
    const e = await create(),
      other = await create(),
      token = await publish(e),
      c = await new Client().context(),
      selector = await c.scan(e, token);
    expect(
      (await c.call('POST', '/api/public/check-in-sessions', { public_id: other.public_id, token }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await c.call('POST', '/api/public/check-in-sessions', {
          public_id: e.public_id,
          token: token + 'x',
        })
      ).statusCode,
    ).toBe(400);
    await admin.call('POST', `/api/admin/events/${e.id}/state`, { state: 'PAUSED' });
    await admin.call('POST', `/api/admin/events/${e.id}/state`, { state: 'PUBLISHED' });
    const r = await c.call('POST', '/api/public/checkins', submission(), headers(selector));
    expect(r.json().code).toBe('RULE_CHANGED');
  });
  it('rolls back failures without consuming session and does not trust body IP or unknown fields', async () => {
    const e = await create(),
      token = await publish(e),
      c = await new Client().context(),
      selector = await c.scan(e, token);
    expect(
      (
        await c.call(
          'POST',
          '/api/public/checkins',
          { ...submission(), ip: '1.2.3.4' },
          headers(selector),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await c.call(
          'POST',
          '/api/public/checkins',
          { ...submission(), answers: { unknown: 'x' } },
          headers(selector),
        )
      ).statusCode,
    ).toBe(400);
    const [s] = await rows<{ consumed: number }>(
      db,
      'SELECT consumed FROM checkin_sessions WHERE selector=?',
      [selector],
    );
    expect(s?.consumed).toBe(0);
    expect(
      (await c.call('POST', '/api/public/checkins', submission(), headers(selector))).statusCode,
    ).toBe(200);
  });
  it('does not allow a stolen selector or receipt in another browser', async () => {
    const e = await create(),
      token = await publish(e),
      c = await new Client().context(),
      selector = await c.scan(e, token);
    const first = await c.call('POST', '/api/public/checkins', submission(), headers(selector));
    const another = await new Client().context();
    expect(
      (
        await another.call('GET', `/api/public/receipts/${first.json().receipt_id}`, undefined, {
          'x-session-id': selector,
        })
      ).statusCode,
    ).toBe(401);
    another.cookies.set(`hn_checkin_${selector}`, c.cookies.get(`hn_checkin_${selector}`)!);
    expect(
      (
        await another.call('GET', `/api/public/receipts/${first.json().receipt_id}`, undefined, {
          'x-session-id': selector,
        })
      ).statusCode,
    ).toBe(403);
  });
  it('preserves one identity row through manual pending, confirmation, revocation, and recovery', async () => {
    const e = await create();
    await publish(e);
    const first = await admin.call('POST', `/api/admin/events/${e.id}/checkins/manual`, {
      submission: submission(),
      reason: '现场核验',
      status: 'PENDING_REVIEW',
    });
    expect(first.statusCode).toBe(200);
    const id = first.json().result.id as string;
    for (const status of ['CHECKED_IN', 'REVOKED', 'CHECKED_IN'])
      expect(
        (
          await admin.call('POST', `/api/admin/checkins/${id}/review`, {
            status,
            reason: '测试状态处理',
          })
        ).statusCode,
      ).toBe(200);
    expect(
      (
        await admin.call('POST', `/api/admin/events/${e.id}/checkins/manual`, {
          submission: submission(),
          reason: '重复',
          status: 'CHECKED_IN',
        })
      ).statusCode,
    ).toBe(409);
    const [count] = await rows<{ n: number }>(
      db,
      'SELECT COUNT(*) AS n FROM checkins WHERE event_id=?',
      [e.id],
    );
    expect(Number(count?.n)).toBe(1);
  });
  it('enforces whitelist qualification and only server roster authority enters snapshots', async () => {
    const e = await create({
      admission: 'roster',
      fields: [
        { key: 'department', label: '部门', type: 'text', source: 'roster', required: true },
      ],
    });
    await execute(
      db,
      'INSERT INTO participants(event_id,identity_digest,identity_value,answers) VALUES (?,?,?,?)',
      [
        e.id,
        rosterDigest(e, { entry_code: '000001' }),
        '000001',
        JSON.stringify({ entry_code: '000001', department: '真实部门' }),
      ],
    );
    const token = await publish(e),
      c = await new Client().context(),
      selector = await c.scan(e, token);
    const bad = await c.call(
      'POST',
      '/api/public/checkins',
      { answers: { entry_code: '999' } },
      headers(selector),
    );
    expect(bad.json().code).toBe('IDENTITY_NOT_ELIGIBLE');
    const good = await c.call(
      'POST',
      '/api/public/checkins',
      { answers: { entry_code: '000001', department: '伪造' } },
      headers(selector),
    );
    expect(good.statusCode).toBe(200);
    expect(good.json().result.answers.department).toBe('真实部门');
  });
  it('does not auto succeed or consume session when forced geofence is denied', async () => {
    const e = await create({
        location_mode: 'required',
        center: {
          latitude: 31.2304,
          longitude: 121.4737,
          coordinate_system: 'WGS84',
          provider: 'manual',
        },
      }),
      token = await publish(e),
      c = await new Client().context(),
      selector = await c.scan(e, token);
    const denied = await c.call('POST', '/api/public/checkins', submission(), headers(selector));
    expect(denied.json().code).toBe('LOCATION_DENIED');
    const outside = await c.call(
      'POST',
      '/api/public/checkins',
      {
        ...submission(),
        location: {
          latitude: 31.24,
          longitude: 121.4737,
          accuracy: 15,
          coordinate_system: 'WGS84',
          source: 'browser_geolocation',
          captured_at: new Date().toISOString(),
        },
      },
      headers(selector),
    );
    expect(outside.json().code).toBe('LOCATION_OUTSIDE');
    expect(outside.json().message).toContain('距离允许签到范围约 868 米');
    const [s] = await rows<{ consumed: number }>(
      db,
      'SELECT consumed FROM checkin_sessions WHERE selector=?',
      [selector],
    );
    expect(s?.consumed).toBe(0);
    const result = await c.call(
      'POST',
      '/api/public/checkins',
      {
        ...submission(),
        location: {
          latitude: 31.2304,
          longitude: 121.4737,
          accuracy: 15,
          coordinate_system: 'WGS84',
          source: 'browser_geolocation',
          captured_at: new Date().toISOString(),
        },
      },
      headers(selector),
    );
    expect(result.statusCode).toBe(200);
  });
  it('exports potentially dangerous text as string cells and retains leading zeros', async () => {
    const e = await create();
    await publish(e);
    await admin.call('POST', `/api/admin/events/${e.id}/checkins/manual`, {
      submission: {
        answers: { entry_code: '000001', name: '=HYPERLINK("https://example.com")' },
      },
      reason: '测试',
      status: 'CHECKED_IN',
    });
    const r = await admin.call('GET', `/api/admin/events/${e.id}/export`);
    expect(r.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.rawPayload as unknown as Parameters<typeof wb.xlsx.load>[0]);
    expect(wb.worksheets[0]!.getCell('A2').text).toBe('000001');
    expect(wb.worksheets[0]!.getCell('B2').type).toBe(ExcelJS.ValueType.String);
  });
  it('restricts operators by event grants and prevents exports', async () => {
    const name = `test_operator_${randomToken()}`;
    const user = await execute(
      db,
      "INSERT INTO users(username,password_hash,role) VALUES (?,?,'operator')",
      [name, await hash('operator-test-password')],
    );
    operators.push(String(user.insertId));
    const c = await new Client().context();
    await c.call('POST', '/api/admin/login', {
      username: name,
      password: 'operator-test-password',
    });
    const e = await create();
    expect((await c.call('GET', `/api/admin/events/${e.id}`)).statusCode).toBe(403);
    expect((await c.call('GET', `/api/display/events/${e.id}/info`)).statusCode).toBe(403);
    await execute(db, 'INSERT INTO event_members(event_id,user_id) VALUES (?,?)', [
      e.id,
      user.insertId,
    ]);
    expect((await c.call('GET', `/api/admin/events/${e.id}`)).statusCode).toBe(200);
    expect((await c.call('GET', `/api/display/events/${e.id}/info`)).statusCode).toBe(200);
    expect((await c.call('GET', `/api/admin/events/${e.id}/export`)).statusCode).toBe(403);
    await execute(db, 'DELETE FROM admin_sessions WHERE user_id=?', [user.insertId]);
    await execute(db, 'DELETE FROM event_members WHERE user_id=?', [user.insertId]);
  });
  it('actual MySQL uniqueness rejects NULL identity digest and uses InnoDB', async () => {
    const e = await create();
    await expect(
      execute(
        db,
        'INSERT INTO participants(event_id,identity_digest,identity_value,answers) VALUES (?,NULL,?,?)',
        [e.id, '000123', '{}'],
      ),
    ).rejects.toThrow();
    const [engine] = await rows<{ ENGINE: string }>(
      db,
      'SELECT ENGINE FROM information_schema.tables WHERE table_schema=? AND table_name=?',
      [config.DB_NAME, 'checkins'],
    );
    expect(engine?.ENGINE).toBe('InnoDB');
    const x = digest('credential');
    expect(x).toHaveLength(32);
  });
  it('rejects erroneous imports and rolls back an entire batch after a preview race', async () => {
    const e = await create({ admission: 'roster' });
    async function preview(csv: string) {
      const boundary = 'herenow-boundary';
      const payload = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\nadd\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="roster.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`,
      );
      return admin.call('POST', `/api/admin/events/${e.id}/imports`, payload, {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      });
    }
    const bad = await preview('entry_code,name\n000001,张三\n000001,李四');
    expect(bad.statusCode).toBe(200);
    expect(bad.json().preview.errors).toHaveLength(1);
    expect(
      (await admin.call('POST', `/api/admin/imports/${bad.json().preview.id}/commit`)).statusCode,
    ).toBe(400);
    const good = await preview('entry_code,name\n000001,张三\n000002,李四');
    expect(good.statusCode).toBe(200);
    await execute(
      db,
      'INSERT INTO participants(event_id,identity_digest,identity_value,answers) VALUES (?,?,?,?)',
      [
        e.id,
        rosterDigest(e, { entry_code: '000002' }),
        '000002',
        '{"entry_code":"000002","name":"已有记录"}',
      ],
    );
    expect(
      (await admin.call('POST', `/api/admin/imports/${good.json().preview.id}/commit`)).statusCode,
    ).toBe(409);
    const roster = await rows<{ identity_value: string }>(
      db,
      'SELECT identity_value FROM participants WHERE event_id=?',
      [e.id],
    );
    expect(roster.map((p) => p.identity_value)).toEqual(['000002']);
  });
  it('rejects a cross-batch collision in a unique roster field after preview without committing partial rows', async () => {
    const e = await create({
      admission: 'roster',
      fields: [
        { key: 'phone', label: '手机号', type: 'phone', required: true, allow_duplicates: false },
      ],
    });
    const boundary = 'roster-field-race';
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\nadd\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="roster.csv"\r\nContent-Type: text/csv\r\n\r\nentry_code,phone\n000001,13800138000\n000002,13800138002\r\n--${boundary}--\r\n`,
    );
    const preview = await admin.call('POST', `/api/admin/events/${e.id}/imports`, payload, {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().preview.errors).toHaveLength(0);
    const existing = { entry_code: '009999', phone: '13800138000' };
    await execute(
      db,
      'INSERT INTO participants(event_id,identity_digest,identity_value,answers) VALUES (?,?,?,?)',
      [e.id, rosterDigest(e, existing), '009999', JSON.stringify(existing)],
    );
    expect(
      (await admin.call('POST', `/api/admin/imports/${preview.json().preview.id}/commit`))
        .statusCode,
    ).toBe(409);
    const roster = await rows<{ identity_value: string }>(
      db,
      'SELECT identity_value FROM participants WHERE event_id=?',
      [e.id],
    );
    expect(roster.map((p) => p.identity_value)).toEqual(['009999']);
  });
  it('rolls back SQL failures without consuming the only submission opportunity', async () => {
    const e = await create(),
      token = await publish(e),
      c = await new Client().context(),
      selector = await c.scan(e, token),
      h = headers(selector);
    const trigger = `reject_test_evidence_${e.id}`;
    await execute(
      db,
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON checkin_evidence FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test-only evidence failure'`,
    );
    try {
      expect((await c.call('POST', '/api/public/checkins', submission(), h)).statusCode).toBe(500);
      const [session] = await rows<{ consumed: number }>(
        db,
        'SELECT consumed FROM checkin_sessions WHERE selector=?',
        [selector],
      );
      expect(session?.consumed).toBe(0);
      const [count] = await rows<{ n: number }>(
        db,
        'SELECT COUNT(*) AS n FROM checkins WHERE event_id=?',
        [e.id],
      );
      expect(Number(count?.n)).toBe(0);
    } finally {
      await execute(db, `DROP TRIGGER ${trigger}`);
    }
    expect((await c.call('POST', '/api/public/checkins', submission(), h)).statusCode).toBe(200);
  });
  it('stores logos per event, exposes them only after a valid scan, and preserves active sessions on presentation edits', async () => {
    const png = new PNG({ width: 2, height: 2 });
    png.data.fill(128);
    const logo = `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
    const e = await create({ checkin_logo: logo }),
      other = await create();
    expect(e.checkin_logo).toMatch(/^data:image\/png;base64,/);
    expect(other.checkin_logo).toBeNull();
    const token = await publish(e),
      client = await new Client().context();
    const scan = await client.call('POST', '/api/public/check-in-sessions', {
      token,
      public_id: e.public_id,
    });
    expect(scan.statusCode).toBe(200);
    expect(scan.json().event.checkin_logo).toBe(e.checkin_logo);
    const configBody = eventInputSchema.parse(
      Object.fromEntries(Object.entries(e).filter(([key]) => key in eventInputSchema.shape)),
    );
    const anonymous = await new Client().context();
    expect(
      (
        await anonymous.call('PATCH', `/api/admin/events/${e.id}`, {
          ...configBody,
          checkin_logo: null,
        })
      ).statusCode,
    ).toBe(401);
    const invalid = await admin.call('PATCH', `/api/admin/events/${e.id}`, {
      ...configBody,
      checkin_logo: 'data:image/png;base64,AAAA',
    });
    expect(invalid.json().code).toBe('INVALID_FORM');
    expect((await admin.call('GET', `/api/admin/events/${e.id}`)).json().event.checkin_logo).toBe(
      e.checkin_logo,
    );
    const reset = await admin.call('PATCH', `/api/admin/events/${e.id}`, {
      ...configBody,
      checkin_logo: null,
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().event.policy_epoch).toBe(e.policy_epoch + 1);
    expect(reset.json().event.checkin_logo).toBeNull();
    expect(
      (
        await client.call(
          'POST',
          '/api/public/checkins',
          submission('logo-session'),
          headers(scan.json().session_id as string),
        )
      ).statusCode,
    ).toBe(200);
  });
  it('shares event branding with authorized displays while keeping paused QR issuance blocked', async () => {
    const png = new PNG({ width: 2, height: 2 });
    png.data.fill(128);
    const e = await create({
      checkin_logo: `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`,
    });
    await publish(e);
    expect((await admin.call('GET', `/api/display/events/${e.id}/info`)).json().checkin_logo).toBe(
      e.checkin_logo,
    );
    expect((await admin.call('GET', `/api/display/events/${e.id}/qr`)).json().checkin_logo).toBe(
      e.checkin_logo,
    );
    const anonymous = await new Client().context();
    expect((await anonymous.call('GET', `/api/display/events/${e.id}/info`)).statusCode).toBe(401);
    await admin.call('POST', `/api/admin/events/${e.id}/state`, { state: 'PAUSED' });
    const paused = await admin.call('GET', `/api/display/events/${e.id}/info`);
    expect(paused.statusCode).toBe(200);
    expect(paused.json().checkin_logo).toBe(e.checkin_logo);
    expect(Object.keys(paused.json()).sort()).toEqual([
      'checkin_logo',
      'code',
      'location_label',
      'name',
    ]);
    expect((await admin.call('GET', `/api/display/events/${e.id}/qr`)).json().code).toBe(
      'ACTIVITY_UNAVAILABLE',
    );
    admin.cookies.delete(`hn_display_${e.id}`);
    expect((await admin.call('GET', `/api/display/events/${e.id}/info`)).json().checkin_logo).toBe(
      e.checkin_logo,
    );
    expect((await admin.call('GET', `/api/display/events/${e.id}/qr`)).statusCode).toBe(401);
  });
  it('requires English labels on edits and publication while keeping legacy active sessions valid', async () => {
    const e = await create(),
      token = await publish(e),
      client = await new Client().context(),
      selector = await client.scan(e, token);
    await execute(
      db,
      "UPDATE events SET config=JSON_REMOVE(config,'$.fields[0].label_en') WHERE id=?",
      [e.id],
    );
    const stored = (await admin.call('GET', `/api/admin/events/${e.id}`)).json()
      .event as EventRecord;
    expect(stored.fields[0]!.label_en).toBe('');
    const connection = await db.getConnection();
    try {
      await migrateBilingualFields(connection);
    } finally {
      connection.release();
    }
    const [migrated] = await rows<{ present: number }>(
      db,
      "SELECT JSON_CONTAINS_PATH(config,'one','$.fields[0].label_en') AS present FROM events WHERE id=?",
      [e.id],
    );
    expect(Number(migrated?.present)).toBe(1);
    const input = Object.fromEntries(
      Object.entries(stored).filter(([key]) => key in eventInputSchema.shape),
    );
    expect((await admin.call('PATCH', `/api/admin/events/${e.id}`, input)).json().code).toBe(
      'INVALID_FORM',
    );
    expect(
      (
        await client.call(
          'POST',
          '/api/public/checkins',
          submission('legacy-bilingual'),
          headers(selector),
        )
      ).statusCode,
    ).toBe(200);
    stored.fields[0]!.label_en = 'Entry code';
    const updated = await admin.call('PATCH', `/api/admin/events/${e.id}`, {
      ...input,
      fields: stored.fields,
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().event.policy_epoch).toBe(stored.policy_epoch);
    const draft = await create();
    await execute(
      db,
      "UPDATE events SET config=JSON_REMOVE(config,'$.fields[0].label_en') WHERE id=?",
      [draft.id],
    );
    expect((await admin.call('POST', `/api/admin/events/${draft.id}/publish`)).json().code).toBe(
      'INVALID_FORM',
    );
  });
  it('supports online and manual early check-in and invalidates old sessions on offset edits', async () => {
    const e = await create({
      starts_at: new Date(Date.now() + 15 * 60000).toISOString(),
      checkin_early_minutes: 30,
    });
    const token = await publish(e),
      c = await new Client().context(),
      selector = await c.scan(e, token);
    const h = headers(selector);
    const first = await c.call('POST', '/api/public/checkins', submission('early-online'), h);
    expect(first.statusCode).toBe(200);
    expect(
      (
        await admin.call('POST', `/api/admin/events/${e.id}/checkins/manual`, {
          submission: submission('early-manual'),
          reason: '提前签到测试',
          status: 'CHECKED_IN',
        })
      ).statusCode,
    ).toBe(200);
    const pending = await new Client().context(),
      pendingSelector = await pending.scan(e, token);
    const configBody = eventInputSchema.parse(
      Object.fromEntries(Object.entries(e).filter(([key]) => key in eventInputSchema.shape)),
    );
    const update = await admin.call('PATCH', `/api/admin/events/${e.id}`, {
      ...configBody,
      checkin_early_minutes: 20,
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().event.policy_epoch).toBe(e.policy_epoch + 2);
    expect(
      (
        await pending.call(
          'POST',
          '/api/public/checkins',
          submission('pending'),
          headers(pendingSelector),
        )
      ).json().code,
    ).toBe('RULE_CHANGED');
    expect(
      (await c.call('POST', '/api/public/checkins', submission('early-online'), h)).json()
        .receipt_id,
    ).toBe(first.json().receipt_id);
  });
  it('rejects QR issuance and manual sign-ins before the configured early opening', async () => {
    const e = await create({
      starts_at: new Date(Date.now() + 60 * 60000).toISOString(),
      ends_at: new Date(Date.now() + 120 * 60000).toISOString(),
      checkin_early_minutes: 30,
    });
    expect((await admin.call('POST', `/api/admin/events/${e.id}/publish`)).statusCode).toBe(200);
    expect(
      (await admin.call('POST', `/api/admin/events/${e.id}/display-sessions`)).json().code,
    ).toBe('ACTIVITY_UNAVAILABLE');
    expect(
      (
        await admin.call('POST', `/api/admin/events/${e.id}/checkins/manual`, {
          submission: submission('too-early'),
          reason: '窗口前测试',
          status: 'CHECKED_IN',
        })
      ).json().code,
    ).toBe('ACTIVITY_UNAVAILABLE');
  });
  it('rejects manual sign-ins for drafts and activities that have not started', async () => {
    const draft = await create();
    const request = { submission: submission(), reason: '提前测试', status: 'CHECKED_IN' };
    expect(
      (await admin.call('POST', `/api/admin/events/${draft.id}/checkins/manual`, request))
        .statusCode,
    ).toBe(400);
    const future = await create({
      starts_at: new Date(Date.now() + 3600000).toISOString(),
      ends_at: new Date(Date.now() + 7200000).toISOString(),
    });
    expect((await admin.call('POST', `/api/admin/events/${future.id}/publish`)).statusCode).toBe(
      200,
    );
    expect(
      (await admin.call('POST', `/api/admin/events/${future.id}/checkins/manual`, request))
        .statusCode,
    ).toBe(400);
  });
  it('explicit password reset changes database authentication and revokes old sessions', async () => {
    const fixture = await createTestAdmin();
    const client = await new Client().context();
    const password = randomToken();
    try {
      expect(
        (
          await client.call('POST', '/api/admin/login', {
            username: fixture.username,
            password: fixture.password,
          })
        ).statusCode,
      ).toBe(200);
      await resetAdminPassword(fixture.username, password);
      expect((await client.call('GET', '/api/admin/events')).statusCode).toBe(401);
      const fresh = await new Client().context();
      expect(
        (
          await fresh.call('POST', '/api/admin/login', {
            username: fixture.username,
            password: fixture.password,
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (await fresh.call('POST', '/api/admin/login', { username: fixture.username, password }))
          .statusCode,
      ).toBe(200);
      const [entry] = await rows<{ action: string; reason: string }>(
        db,
        'SELECT action,reason FROM audit_logs WHERE user_id=? AND action=?',
        [fixture.id, 'RESET_ADMIN_PASSWORD'],
      );
      expect(entry?.action).toBe('RESET_ADMIN_PASSWORD');
      expect(entry?.reason).not.toContain(password);
    } finally {
      await fixture.dispose();
    }
  });
  it('password reset refuses empty passwords, missing admins and operator promotion', async () => {
    await expect(
      resetAdminPassword('missing_admin_' + randomToken(), randomToken()),
    ).rejects.toThrow('指定管理员不存在');
    await expect(resetAdminPassword('admin', '')).rejects.toThrow();
    const username = 'reset_operator_' + randomToken();
    const result = await execute(
      db,
      "INSERT INTO users(username,password_hash,role) VALUES (?,?,'operator')",
      [username, await hash(randomToken())],
    );
    try {
      await expect(resetAdminPassword(username, randomToken())).rejects.toThrow('指定管理员不存在');
      const [user] = await rows<{ role: string }>(db, 'SELECT role FROM users WHERE id=?', [
        result.insertId,
      ]);
      expect(user?.role).toBe('operator');
    } finally {
      await execute(db, 'DELETE FROM users WHERE id=?', [result.insertId]);
    }
  });
});
