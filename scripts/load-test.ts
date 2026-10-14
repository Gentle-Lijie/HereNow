import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { buildApp } from '../apps/api/src/app.js';
import { db, execute, rows } from '../apps/api/src/db.js';
import { createTestAdmin } from '../tests/fixtures/admin.js';
import { config } from '../apps/api/src/config.js';
import { eventInputSchema, type EventRecord } from '../packages/contracts/src/index.js';
if (config.DB_NAME !== 'herenow_test') throw new Error('Load test requires DB_NAME=herenow_test');
const testAdmin = await createTestAdmin();
const app = await buildApp();
await app.listen({ host: '127.0.0.1', port: 0 });
const origin = app.listeningOrigin;
class Client {
  cookies = new Map<string, string>();
  csrf = '';
  async call(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
    const r = await fetch(`${origin}/api${path}`, {
      method,
      headers: {
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join(';'),
        origin: config.APP_ORIGIN,
        'x-csrf-token': this.csrf,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of r.headers.getSetCookie()) {
      const pair = c.split(';')[0]!,
        index = pair.indexOf('=');
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const data = (await r.json()) as Record<string, unknown>;
    if (!r.ok) throw new Error(`Request failed: ${r.status} ${String(data.code)}`);
    return data;
  }
  async context() {
    this.csrf = String((await this.call('/context')).csrf_token);
    return this;
  }
}
let eventId = '';
try {
  const admin = await new Client().context();
  await admin.call('/admin/login', 'POST', {
    username: testAdmin.username,
    password: testAdmin.password,
  });
  const input = eventInputSchema.parse({
    name: '压测临时活动',
    fields: [
      { key: 'entry_code', label: '编号', type: 'text', required: true, allow_duplicates: false },
    ],
    organizer: '仅自动化测试',
    starts_at: new Date(Date.now() - 60000).toISOString(),
    ends_at: new Date(Date.now() + 3600000).toISOString(),
  });
  const event = (await admin.call('/admin/events', 'POST', input)).event as EventRecord;
  eventId = event.id;
  await admin.call(`/admin/events/${event.id}/publish`, 'POST');
  const display = await admin.call(`/admin/events/${event.id}/display-sessions`, 'POST');
  const token = String(display.display_url).split('#d=')[1]!;
  await admin.call(`/display/events/${event.id}/connect`, 'POST', { token });
  const qr = await admin.call(`/display/events/${event.id}/qr`);
  const clients = [];
  for (let i = 0; i < 100; i++) {
    const c = await new Client().context();
    const s = await c.call('/public/check-in-sessions', 'POST', {
      token: qr.token,
      public_id: event.public_id,
    });
    clients.push({ client: c, selector: String(s.session_id) });
  }
  const latency: number[] = [];
  const start = performance.now();
  await Promise.all(
    clients.map(async ({ client, selector }, i) => {
      await new Promise((r) => setTimeout(r, Math.max(0, start + i * 10 - performance.now())));
      const began = performance.now();
      const r = await client.call(
        '/public/checkins',
        'POST',
        { answers: { entry_code: `LOAD-${String(i).padStart(5, '0')}` } },
        { 'x-session-id': selector, 'Idempotency-Key': randomUUID() },
      );
      if (r.code !== 'CHECKED_IN') throw new Error('Missing success receipt');
      latency.push(performance.now() - began);
    }),
  );
  latency.sort((a, b) => a - b);
  const [count] = await rows<{ n: number }>(
    db,
    'SELECT COUNT(*) AS n FROM checkins WHERE event_id=?',
    [event.id],
  );
  if (Number(count?.n) !== 100) throw new Error('Missing or duplicated result');
  console.log(
    JSON.stringify(
      {
        environment: 'Local loopback HTTP / Node 24 / MySQL 9.3',
        target_rps: 100,
        requests: 100,
        successes: latency.length,
        p95_ms: Math.round(latency[94]!),
        max_ms: Math.round(latency[99]!),
        elapsed_ms: Math.round(performance.now() - start),
        unique_records: Number(count?.n),
        unexpected_5xx: 0,
      },
      null,
      2,
    ),
  );
} finally {
  if (eventId) {
    await execute(db, 'DELETE FROM audit_logs WHERE event_id=?', [eventId]);
    await execute(db, 'DELETE FROM events WHERE id=?', [eventId]);
  }
  await testAdmin.dispose();
  await app.close();
  await db.end();
}
