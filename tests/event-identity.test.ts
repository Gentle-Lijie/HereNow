import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, HTTPMethods, InjectOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../apps/api/src/app.js';
import { config } from '../apps/api/src/config.js';
import { db, execute } from '../apps/api/src/db.js';
import { createTestAdmin } from './fixtures/admin.js';
import { eventInputSchema, type EventRecord } from '../packages/contracts/src/index.js';
let app: FastifyInstance;
let account: Awaited<ReturnType<typeof createTestAdmin>>;
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
    const r = await app.inject({
      method,
      url: '/api' + url,
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
async function create() {
  const input = eventInputSchema.parse({
    name: '身份字段编辑回归',
    organizer: '仅测试',
    starts_at: new Date(Date.now() - 60000).toISOString(),
    ends_at: new Date(Date.now() + 3600000).toISOString(),
  });
  const r = await admin.call('POST', '/admin/events', input);
  expect(r.statusCode).toBe(200);
  const event = r.json().event as EventRecord;
  created.push(event.id);
  return { input, event };
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
describe('identity presentation and immutable rules in real MySQL', () => {
  it('protects map configuration and proxy endpoints with backend administrator authentication', async () => {
    const anon = await new Client().context();
    expect((await anon.call('GET', '/admin/map-config')).statusCode).toBe(401);
    expect((await anon.call('GET', '/_AMapService/v3/place/text')).statusCode).toBe(401);
    const status = await admin.call('GET', '/admin/map-config');
    expect(status.statusCode).toBe(200);
    expect(Object.keys(status.json()).sort()).toEqual(['code', 'ready', 'request_id']);
    expect((await admin.call('GET', '/_AMapService/unknown')).statusCode).toBe(404);
  });
  it('allows editing identity type, label and normalization in a draft', async () => {
    const { input, event } = await create();
    const r = await admin.call('PATCH', `/admin/events/${event.id}`, {
      ...input,
      identity_type: 'employee',
      identity_label: '员工编号',
      ignore_case: true,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().event).toMatchObject({
      identity_type: 'employee',
      identity_label: '员工编号',
      ignore_case: true,
    });
  });
  it('renames a published label without invalidating sessions or bypassing identity uniqueness', async () => {
    const { input, event } = await create();
    expect((await admin.call('POST', `/admin/events/${event.id}/publish`)).statusCode).toBe(200);
    const published = (await admin.call('GET', `/admin/events/${event.id}`)).json()
      .event as EventRecord;
    const display = (await admin.call('POST', `/admin/events/${event.id}/display-sessions`)).json()
      .display_url as string;
    await admin.call('POST', `/display/events/${event.id}/connect`, {
      token: display.split('#d=')[1]!,
    });
    const qr = (await admin.call('GET', `/display/events/${event.id}/qr`)).json().token as string;
    const participant = await new Client().context();
    const session = (
      await participant.call('POST', '/public/check-in-sessions', {
        public_id: event.public_id,
        token: qr,
      })
    ).json().session_id as string;
    const renamed = await admin.call('PATCH', `/admin/events/${event.id}`, {
      ...input,
      identity_label: '入场编号',
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().event).toMatchObject({
      identity_label: '入场编号',
      form_version: published.form_version,
      policy_epoch: published.policy_epoch,
    });
    const saved = await participant.call(
      'POST',
      '/public/checkins',
      { identity_value: '000123', answers: {} },
      { 'x-session-id': session, 'idempotency-key': randomUUID() },
    );
    expect(saved.statusCode).toBe(200);
    expect(saved.json().result.identity_value).toBe('000123');
    const again = await new Client().context();
    const next = (
      await again.call('POST', '/public/check-in-sessions', {
        public_id: event.public_id,
        token: qr,
      })
    ).json();
    expect(next.event.identity_label).toBe('入场编号');
    const duplicate = await again.call(
      'POST',
      '/public/checkins',
      { identity_value: '000123', answers: {} },
      { 'x-session-id': next.session_id as string, 'idempotency-key': randomUUID() },
    );
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('ALREADY_SUBMITTED');
  });
  it('keeps published and paused identity rules locked and rejects closed-event edits', async () => {
    const { input, event } = await create();
    expect((await admin.call('POST', `/admin/events/${event.id}/publish`)).statusCode).toBe(200);
    for (const state of ['PUBLISHED', 'PAUSED']) {
      if (state === 'PAUSED')
        expect(
          (await admin.call('POST', `/admin/events/${event.id}/state`, { state })).statusCode,
        ).toBe(200);
      for (const change of [{ identity_type: 'employee' }, { ignore_case: true }]) {
        const rejected = await admin.call('PATCH', `/admin/events/${event.id}`, {
          ...input,
          ...change,
        });
        expect(rejected.statusCode).toBe(400);
        expect(rejected.json().code).toBe('INVALID_FORM');
      }
      expect(
        (
          await admin.call('PATCH', `/admin/events/${event.id}`, {
            ...input,
            identity_label: '入场编号',
          })
        ).statusCode,
      ).toBe(200);
    }
    expect(
      (await admin.call('POST', `/admin/events/${event.id}/state`, { state: 'CLOSED' })).statusCode,
    ).toBe(200);
    expect(
      (
        await admin.call('PATCH', `/admin/events/${event.id}`, {
          ...input,
          identity_label: '报名号',
        })
      ).statusCode,
    ).toBe(400);
  });
});
