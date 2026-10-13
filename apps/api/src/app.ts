import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';
import {
  eventInputSchema,
  checkinInputSchema,
  type EventInput,
  type ImportPreview,
  type Participant,
} from '../../../packages/contracts/src/index.js';
import { db, rows, execute, transaction } from './db.js';
import { config, projectRoot } from './config.js';
import {
  AppError,
  fail,
  randomToken,
  digest,
  browserDigest,
  csrf,
  safeEqual,
  signQr,
  verifyQr,
  identityDigest,
} from './services/security.js';
import {
  fromEvent,
  getEvent,
  available,
  audit,
  readCheckin,
  fromCheckin,
  decode,
  type EventRow,
  type CheckinRow,
} from './services/events.js';
import { resolveSession, submit, manual } from './services/checkins.js';
import { normalizeCenter } from './services/location.js';
import { parseImport, workbookBuffer } from './services/imports.js';
interface User {
  id: string;
  username: string;
  role: 'admin' | 'operator';
  password_hash?: string;
}
declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}
const idParams = z.object({ id: z.string().regex(/^\d+$/) });
const getId = (r: FastifyRequest) => idParams.parse(r.params).id;
const requiredUser = (r: FastifyRequest) => r.user ?? fail('UNAUTHORIZED', '请先登录后台', 401);
const admin = (r: FastifyRequest) => {
  const user = requiredUser(r);
  if (user.role !== 'admin') fail('FORBIDDEN', '仅管理员可以执行此操作', 403);
  return user;
};
async function authorize(r: FastifyRequest, eventId: string) {
  const user = requiredUser(r);
  if (user.role === 'operator') {
    const allowed = await rows(db, 'SELECT 1 FROM event_members WHERE event_id=? AND user_id=?', [
      eventId,
      user.id,
    ]);
    if (!allowed.length) fail('FORBIDDEN', '没有该活动的操作权限', 403);
  }
  return user;
}
const body = <T>(schema: z.ZodType<T>, r: FastifyRequest) => schema.parse(r.body);
const cookieOptions = {
  httpOnly: true,
  secure: config.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api',
};
export async function buildApp() {
  const app = Fastify({
    bodyLimit: 65536,
    trustProxy: config.TRUSTED_PROXIES
      ? config.TRUSTED_PROXIES.split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : false,
    logger:
      config.NODE_ENV === 'production'
        ? { level: 'warn', redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body'] }
        : false,
  });
  app.decorateRequest('user', null);
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4 } });
  await app.register(helmet, {
    contentSecurityPolicy:
      config.NODE_ENV === 'production'
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", 'https://webapi.amap.com', 'https://*.amap.com'],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'blob:', 'https://*.amap.com', 'https://*.autonavi.com'],
              connectSrc: ["'self'", 'https://*.amap.com', 'https://*.autonavi.com'],
              workerSrc: ["'self'", 'blob:'],
            },
          }
        : false,
    referrerPolicy: { policy: 'no-referrer' },
  });
  await app.register(rateLimit, { global: false });
  app.addHook('onRequest', async (r, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!r.url.startsWith('/api/')) return;
    const browser = r.cookies.hn_browser;
    if (r.method !== 'GET' && r.method !== 'HEAD') {
      const token = r.headers['x-csrf-token'];
      if (
        r.headers.origin !== config.APP_ORIGIN ||
        !browser ||
        typeof token !== 'string' ||
        !safeEqual(token, csrf(browser))
      )
        fail('CSRF_INVALID', '页面验证已失效，请刷新重试', 403);
    }
    if (r.cookies.hn_admin) {
      const [u] = await rows<User>(
        db,
        'SELECT u.id,u.username,u.role FROM admin_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_digest=? AND s.expires_at>UTC_TIMESTAMP(3)',
        [digest(r.cookies.hn_admin)],
      );
      r.user = u ? { ...u, id: String(u.id) } : null;
    }
  });
  app.setErrorHandler(async (err, r, reply) => {
    const e = err as Error & { code?: string; statusCode?: number };
    let code = 'INTERNAL_ERROR',
      message = '服务暂时不可用，请重试',
      status = 500;
    if (e instanceof AppError) {
      code = e.code;
      message = e.message;
      status = e.status;
    } else if (e instanceof z.ZodError) {
      code = 'INVALID_FORM';
      message = e.issues[0]?.message ?? '输入格式错误';
      status = 400;
    } else if (e.code === 'ER_DUP_ENTRY') {
      code = 'ALREADY_SUBMITTED';
      message = '该身份已有记录，请现场核验';
      status = 409;
    } else if (e.statusCode && e.statusCode < 500) {
      status = e.statusCode;
      code = status === 429 ? 'RATE_LIMITED' : 'INVALID_REQUEST';
      message = status === 429 ? '操作过于频繁，请稍后重试' : '请求格式或文件不正确';
    }
    if (status >= 500) r.log.error({ code: (e as { code?: string }).code }, 'Request failed');
    if (r.url.startsWith('/api/public/') && status < 500)
      await execute(db, 'INSERT INTO attempts(reason_code) VALUES (?)', [code]).catch(
        () => undefined,
      );
    return reply.status(status).send({ code, message, request_id: r.id });
  });
  app.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { code: 'OK', message: 'healthy' };
  });
  app.get('/api/context', async (r, reply) => {
    const browser = r.cookies.hn_browser ?? randomToken();
    if (!r.cookies.hn_browser)
      reply.setCookie('hn_browser', browser, { ...cookieOptions, maxAge: 7 * 86400 });
    return {
      code: 'OK',
      csrf_token: csrf(browser),
      user: r.user,
      server_time: new Date().toISOString(),
    };
  });
  app.post(
    '/api/admin/login',
    { config: { rateLimit: { max: 10, timeWindow: 60000 } } },
    async (r, reply) => {
      const input = body(
        z.object({ username: z.string().max(80), password: z.string().max(200) }).strict(),
        r,
      );
      const [u] = await rows<User>(db, 'SELECT * FROM users WHERE username=?', [input.username]);
      if (!u?.password_hash || !(await verify(u.password_hash, input.password)))
        fail('LOGIN_FAILED', '账号或密码不正确', 401);
      const token = randomToken();
      await execute(
        db,
        'INSERT INTO admin_sessions(token_digest,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 12 HOUR))',
        [digest(token), u!.id],
      );
      reply.setCookie('hn_admin', token, { ...cookieOptions, maxAge: 43200 });
      return { code: 'OK', user: { id: String(u!.id), username: u!.username, role: u!.role } };
    },
  );
  app.post('/api/admin/logout', async (r, reply) => {
    if (r.cookies.hn_admin)
      await execute(db, 'DELETE FROM admin_sessions WHERE token_digest=?', [
        digest(r.cookies.hn_admin),
      ]);
    reply.clearCookie('hn_admin', cookieOptions);
    return { code: 'OK' };
  });
  app.get('/api/admin/events', async (r) => {
    const u = requiredUser(r);
    const list = await rows<EventRow>(
      db,
      `SELECT e.*,(SELECT COUNT(*) FROM checkins c WHERE c.event_id=e.id AND c.status='CHECKED_IN') AS checkin_count,(SELECT COUNT(*) FROM checkins c WHERE c.event_id=e.id AND c.status='PENDING_REVIEW') AS pending_count,(SELECT COUNT(*) FROM participants p WHERE p.event_id=e.id AND p.active=TRUE) AS participant_count FROM events e ${u.role === 'operator' ? 'JOIN event_members m ON m.event_id=e.id AND m.user_id=?' : ''} ORDER BY e.created_at DESC`,
      u.role === 'operator' ? [u.id] : [],
    );
    return { code: 'OK', events: list.map(fromEvent) };
  });
  app.get('/api/admin/events/:id', async (r) => {
    const id = getId(r);
    await authorize(r, id);
    return { code: 'OK', event: await getEvent(id) };
  });
  app.post('/api/admin/events', async (r) => {
    const user = admin(r);
    const input = body(eventInputSchema, r);
    const id = await transaction(async (c) => {
      const created = await execute(c, 'INSERT INTO events(public_id,config) VALUES (?,?)', [
        randomToken(),
        JSON.stringify(input),
      ]);
      const id = String(created.insertId);
      await execute(c, 'INSERT INTO form_versions(event_id,version,fields) VALUES (?,1,?)', [
        id,
        JSON.stringify(input.fields),
      ]);
      await audit(c, user.id, id, 'CREATE_EVENT');
      return id;
    });
    return { code: 'OK', event: await getEvent(id) };
  });
  app.patch('/api/admin/events/:id', async (r) => {
    const user = admin(r),
      id = getId(r),
      input = body(eventInputSchema, r);
    await transaction(async (c) => {
      const old = await getEvent(id, c, 'exclusive');
      if (old.state === 'CLOSED') fail('ACTIVITY_UNAVAILABLE', '已结束活动不能编辑');
      if (old.state !== 'DRAFT') {
        for (const key of ['identity_type', 'ignore_case', 'identity_label'] as const)
          if (old[key] !== input[key]) fail('INVALID_FORM', '发布后不能修改身份规则');
        for (const f of old.fields) {
          const updated = input.fields.find((x) => x.key === f.key);
          if (
            !updated ||
            updated.type !== f.type ||
            updated.required !== f.required ||
            updated.source !== f.source ||
            updated.visibility !== f.visibility ||
            updated.max_length !== f.max_length ||
            JSON.stringify(updated.options.map((o) => o.key)) !==
              JSON.stringify(f.options.map((o) => o.key))
          )
            fail('INVALID_FORM', '发布后只能调整字段文案或新增非必填字段');
        }
        if (input.fields.some((f) => !old.fields.some((x) => x.key === f.key) && f.required))
          fail('INVALID_FORM', '发布后不能新增必填字段');
      }
      if (input.location_mode === 'required' && !input.center && old.state !== 'DRAFT')
        fail('INVALID_FORM', '强制围栏需要活动中心');
      normalizeCenter(input);
      const formChanged = JSON.stringify(old.fields) !== JSON.stringify(input.fields);
      const policyChanged = [
        'starts_at',
        'ends_at',
        'admission',
        'location_mode',
        'center',
        'radius',
        'max_accuracy',
        'conversion_error_budget',
      ].some(
        (k) =>
          JSON.stringify(old[k as keyof EventInput]) !==
          JSON.stringify(input[k as keyof EventInput]),
      );
      await execute(
        c,
        'UPDATE events SET config=?,form_version=form_version+?,policy_epoch=policy_epoch+? WHERE id=?',
        [JSON.stringify(input), formChanged ? 1 : 0, policyChanged ? 1 : 0, id],
      );
      if (formChanged)
        await execute(c, 'INSERT INTO form_versions(event_id,version,fields) VALUES (?,?,?)', [
          id,
          old.form_version + 1,
          JSON.stringify(input.fields),
        ]);
      await audit(c, user.id, id, 'UPDATE_EVENT');
    });
    return { code: 'OK', event: await getEvent(id) };
  });
  app.post('/api/admin/events/:id/publish', async (r) => {
    const user = admin(r),
      id = getId(r);
    await transaction(async (c) => {
      const e = await getEvent(id, c, 'exclusive');
      if (e.state !== 'DRAFT') fail('INVALID_STATE', '只有草稿可以发布');
      if (e.location_mode === 'required' && !e.center) fail('INVALID_FORM', '请先设置活动中心');
      normalizeCenter(e);
      if (e.admission === 'roster') {
        const [count] = await rows<{ n: number }>(
          c,
          'SELECT COUNT(*) AS n FROM participants WHERE event_id=? AND active=TRUE',
          [id],
        );
        if (!count?.n) fail('INVALID_FORM', '名单签到需先导入可用名单');
      }
      await execute(
        c,
        "UPDATE events SET state='PUBLISHED',policy_epoch=policy_epoch+1 WHERE id=?",
        [id],
      );
      await audit(c, user.id, id, 'PUBLISH_EVENT');
    });
    return { code: 'OK' };
  });
  app.post('/api/admin/events/:id/state', async (r) => {
    const user = admin(r),
      id = getId(r),
      input = body(z.object({ state: z.enum(['PAUSED', 'PUBLISHED', 'CLOSED']) }).strict(), r);
    await transaction(async (c) => {
      const e = await getEvent(id, c, 'exclusive');
      if (
        e.state === 'DRAFT' ||
        e.state === 'CLOSED' ||
        e.state === input.state ||
        (input.state === 'PUBLISHED' && e.state !== 'PAUSED')
      )
        fail('INVALID_STATE', '此状态不能执行该操作');
      await execute(c, 'UPDATE events SET state=?,policy_epoch=policy_epoch+1 WHERE id=?', [
        input.state,
        id,
      ]);
      await audit(c, user.id, id, `STATE_${input.state}`);
    });
    return { code: 'OK' };
  });
  app.post('/api/admin/events/:id/display-sessions', async (r) => {
    const id = getId(r);
    await authorize(r, id);
    const e = await getEvent(id);
    available(e);
    const token = randomToken();
    const expiry = new Date(Math.min(Date.now() + 43200000, Date.parse(e.ends_at)));
    await execute(
      db,
      'INSERT INTO display_sessions(token_digest,event_id,expires_at) VALUES (?,?,?)',
      [digest(token), id, expiry],
    );
    return {
      code: 'OK',
      display_url: `/display/${id}#d=${token}`,
      expires_at: expiry.toISOString(),
    };
  });
  app.post('/api/display/events/:id/connect', async (r, reply) => {
    const id = getId(r),
      input = body(z.object({ token: z.string().max(100) }).strict(), r);
    const [s] = await rows(
      db,
      'SELECT 1 FROM display_sessions WHERE token_digest=? AND event_id=? AND expires_at>UTC_TIMESTAMP(3) AND revoked=FALSE',
      [digest(input.token), id],
    );
    if (!s) fail('UNAUTHORIZED', '展示会话已失效', 401);
    reply.setCookie(`hn_display_${id}`, input.token, { ...cookieOptions, maxAge: 43200 });
    return { code: 'OK' };
  });
  app.get('/api/display/events/:id/qr', async (r) => {
    const id = getId(r);
    const token = r.cookies[`hn_display_${id}`];
    if (!token) fail('UNAUTHORIZED', '请从后台打开电子码展示页', 401);
    const [s] = await rows(
      db,
      'SELECT 1 FROM display_sessions WHERE token_digest=? AND event_id=? AND expires_at>UTC_TIMESTAMP(3) AND revoked=FALSE',
      [digest(token!), id],
    );
    if (!s) fail('UNAUTHORIZED', '展示会话已过期', 401);
    const e = await getEvent(id);
    available(e);
    return {
      code: 'OK',
      name: e.name,
      location_label: e.location_label,
      token: await signQr(e),
      public_id: e.public_id,
      expires_at: new Date((Math.floor(Date.now() / 1000) + 45) * 1000).toISOString(),
      server_time: new Date().toISOString(),
    };
  });
  app.post(
    '/api/public/check-in-sessions',
    { config: { rateLimit: { max: 2000, timeWindow: 60000 } } },
    async (r, reply) => {
      const input = body(
        z.object({ token: z.string().max(2048), public_id: z.string().max(40) }).strict(),
        r,
      );
      let payload;
      try {
        payload = await verifyQr(input.token);
      } catch {
        return fail('QR_EXPIRED', '二维码已过期或无效，请扫描现场最新二维码');
      }
      if (payload.public_id !== input.public_id) fail('QR_EXPIRED', '二维码与活动不匹配');
      const selector = randomToken(),
        token = randomToken(),
        expires = new Date(Date.now() + 120000);
      const e = await transaction(async (c) => {
        const e = await getEvent(payload.event_id, c, 'shared');
        available(e);
        if (e.policy_epoch !== payload.policy_epoch)
          fail('RULE_CHANGED', '活动规则已更新，请重新扫码');
        await execute(
          c,
          'INSERT INTO checkin_sessions(selector,token_digest,event_id,browser_digest,form_version,policy_epoch,expires_at) VALUES (?,?,?,?,?,?,?)',
          [
            selector,
            digest(token),
            e.id,
            browserDigest(r.cookies.hn_browser!),
            e.form_version,
            e.policy_epoch,
            expires,
          ],
        );
        return e;
      });
      reply.setCookie(`hn_checkin_${selector}`, token, { ...cookieOptions, maxAge: 86520 });
      const { ignore_case, center, conversion_error_budget, ...publicEvent } = e;
      void ignore_case;
      void center;
      void conversion_error_budget;
      publicEvent.fields = publicEvent.fields.filter(
        (f) => f.visibility === 'public' && f.source === 'user',
      );
      return {
        code: 'OK',
        event: publicEvent,
        session_id: selector,
        expires_at: expires.toISOString(),
        server_time: new Date().toISOString(),
      };
    },
  );
  app.post(
    '/api/public/checkins',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: 60000,
          keyGenerator: (r) => String(r.headers['x-session-id'] ?? r.ip),
        },
      },
    },
    async (r) => {
      const selector = z.string().max(40).parse(r.headers['x-session-id']),
        key = z.string().uuid().parse(r.headers['idempotency-key']);
      const s = await resolveSession(selector, r.cookies[`hn_checkin_${selector}`] ?? '');
      const input = body(checkinInputSchema, r);
      const result = await submit(
        s,
        input,
        key,
        r.cookies.hn_browser!,
        r.ip,
        String(r.headers['user-agent'] ?? ''),
      );
      return {
        code: result.status,
        message: result.status === 'CHECKED_IN' ? '签到成功' : '当前签到状态已更新',
        request_id: r.id,
        receipt_id: result.receipt_id,
        result,
      };
    },
  );
  app.get('/api/public/receipts/:opaque_id', async (r) => {
    const receipt = z.object({ opaque_id: z.string().max(50) }).parse(r.params).opaque_id;
    const selector = z.string().max(40).parse(r.headers['x-session-id']);
    const s = await resolveSession(selector, r.cookies[`hn_checkin_${selector}`] ?? '');
    if (!s.result_id || !s.browser_digest.equals(browserDigest(r.cookies.hn_browser ?? '')))
      fail('FORBIDDEN', '无法查看该回执', 403);
    const result = await readCheckin(s.result_id!);
    if (result.receipt_id !== receipt) fail('FORBIDDEN', '无法查看该回执', 403);
    return { code: 'OK', result };
  });
  app.get('/api/admin/events/:id/checkins', async (r) => {
    const id = getId(r);
    await authorize(r, id);
    const q = z
      .object({
        page: z.coerce.number().int().min(1).max(10000).default(1),
        search: z.string().max(120).default(''),
        status: z.enum(['CHECKED_IN', 'PENDING_REVIEW', 'REVOKED', '']).default(''),
      })
      .parse(r.query);
    const where =
      'c.event_id=?' +
      (q.search ? ' AND c.identity_value LIKE ?' : '') +
      (q.status ? ' AND c.status=?' : '');
    const values: unknown[] = [id];
    if (q.search) values.push(`%${q.search}%`);
    if (q.status) values.push(q.status);
    const records = await rows<CheckinRow>(
      db,
      `SELECT c.*,e.risk_flags,e.location_result FROM checkins c LEFT JOIN checkin_evidence e ON e.checkin_id=c.id WHERE ${where} ORDER BY c.checked_in_at DESC,c.id DESC LIMIT 50 OFFSET ?`,
      [...values, (q.page - 1) * 50],
    );
    const [count] = await rows<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM checkins c WHERE ${where}`,
      values,
    );
    return { code: 'OK', records: records.map(fromCheckin), total: Number(count?.n ?? 0) };
  });
  app.post('/api/admin/events/:id/checkins/manual', async (r) => {
    const id = getId(r),
      user = await authorize(r, id);
    const input = body(
      z
        .object({
          submission: checkinInputSchema,
          reason: z.string().trim().min(1).max(500),
          status: z.enum(['CHECKED_IN', 'PENDING_REVIEW']),
        })
        .strict(),
      r,
    );
    const result = await transaction(async (c) => {
      const e = await getEvent(id, c, 'exclusive');
      const result = await manual(e, input.submission, input.status, c);
      await audit(c, user.id, id, 'MANUAL_CHECKIN', input.reason);
      return result;
    });
    return { code: 'OK', result };
  });
  app.post('/api/admin/checkins/:id/review', async (r) => {
    const id = getId(r),
      input = body(
        z
          .object({
            status: z.enum(['CHECKED_IN', 'REVOKED']),
            reason: z.string().trim().min(1).max(500),
          })
          .strict(),
        r,
      );
    const [record] = await rows<{ event_id: string }>(
      db,
      'SELECT event_id FROM checkins WHERE id=?',
      [id],
    );
    if (!record) fail('NOT_FOUND', '记录不存在', 404);
    const user = await authorize(r, record!.event_id);
    await transaction(async (c) => {
      await getEvent(record!.event_id, c, 'exclusive');
      await execute(c, 'UPDATE checkins SET status=? WHERE id=?', [input.status, id]);
      await audit(c, user.id, record!.event_id, `REVIEW_${input.status}`, input.reason);
    });
    return { code: 'OK' };
  });
  app.get('/api/admin/events/:id/participants', async (r) => {
    const id = getId(r);
    admin(r);
    await authorize(r, id);
    const participants = await rows<Participant>(
      db,
      'SELECT id,identity_value,answers,active FROM participants WHERE event_id=? ORDER BY id LIMIT 10000',
      [id],
    );
    return {
      code: 'OK',
      participants: participants.map((p) => ({
        ...p,
        id: String(p.id),
        answers: decode(p.answers),
        active: Boolean(p.active),
      })),
    };
  });
  app.patch('/api/admin/events/:id/participants/:participant', async (r) => {
    const id = getId(r),
      user = admin(r);
    const p = z.object({ participant: z.string().regex(/^\d+$/) }).parse(r.params).participant;
    const input = body(z.object({ active: z.boolean() }).strict(), r);
    await transaction(async (c) => {
      await getEvent(id, c, 'exclusive');
      const result = await execute(
        c,
        'UPDATE participants SET active=? WHERE id=? AND event_id=?',
        [input.active, p, id],
      );
      if (!result.affectedRows) fail('NOT_FOUND', '名单记录不存在', 404);
      await audit(c, user.id, id, input.active ? 'ENABLE_PARTICIPANT' : 'DISABLE_PARTICIPANT');
    });
    return { code: 'OK' };
  });
  app.post('/api/admin/events/:id/imports', async (r) => {
    const id = getId(r),
      user = admin(r),
      e = await getEvent(id);
    const file = await r.file();
    if (!file) fail('INVALID_IMPORT', '请选择文件');
    const buffer = await file!.toBuffer();
    const fields = file!.fields;
    const mappingRaw = fields.mapping;
    const sheetRaw = fields.sheet;
    const modeRaw = fields.mode;
    const mapping =
      mappingRaw && 'value' in mappingRaw
        ? z.record(z.string(), z.string().max(80)).parse(JSON.parse(String(mappingRaw.value)))
        : {};
    const mode =
      modeRaw && 'value' in modeRaw ? z.enum(['add', 'update']).parse(modeRaw.value) : 'add';
    let preview: Omit<ImportPreview, 'id'>;
    try {
      preview = await parseImport(
        buffer,
        file!.filename,
        e,
        mapping,
        sheetRaw && 'value' in sheetRaw ? String(sheetRaw.value) : undefined,
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      return fail('INVALID_IMPORT', '文件无法解析，请检查 CSV / XLSX 格式');
    }
    if (mode === 'add') {
      for (const row of preview.rows) {
        const found = await rows(
          db,
          'SELECT 1 FROM participants WHERE event_id=? AND identity_digest=?',
          [id, identityDigest(e, row.identity_value)],
        );
        if (found.length)
          preview.errors.push({ row: row.row, message: '此身份已存在，可选择按主键更新' });
      }
    }
    const result = await execute(
      db,
      'INSERT INTO import_jobs(event_id,user_id,data,expires_at) VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR))',
      [
        id,
        user.id,
        JSON.stringify({
          ...preview,
          mode,
          policy_epoch: e.policy_epoch,
          form_version: e.form_version,
        }),
      ],
    );
    return { code: 'OK', preview: { ...preview, id: String(result.insertId) } };
  });
  app.post('/api/admin/imports/:id/commit', async (r) => {
    const user = admin(r),
      id = getId(r);
    const [job] = await rows<{ event_id: string }>(
      db,
      'SELECT event_id FROM import_jobs WHERE id=? AND user_id=?',
      [id, user.id],
    );
    if (!job) fail('NOT_FOUND', '导入任务不存在', 404);
    await transaction(async (c) => {
      const e = await getEvent(job!.event_id, c, 'exclusive');
      const [locked] = await rows<{ data: string; committed: boolean }>(
        c,
        'SELECT data,committed FROM import_jobs WHERE id=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE',
        [id],
      );
      if (!locked || locked.committed) fail('INVALID_IMPORT', '导入任务过期或已提交');
      const data = decode<
        ImportPreview & { mode: 'add' | 'update'; policy_epoch: number; form_version: number }
      >(locked!.data);
      if (data.errors.length) fail('INVALID_IMPORT', '请修正全部错误后重新上传');
      if (data.policy_epoch !== e.policy_epoch || data.form_version !== e.form_version)
        fail('RULE_CHANGED', '活动配置已变，请重新预览');
      for (const p of data.rows) {
        const hash = identityDigest(e, p.identity_value);
        if (data.mode === 'update')
          await execute(
            c,
            'INSERT INTO participants(event_id,identity_digest,identity_value,answers) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE answers=VALUES(answers)',
            [e.id, hash, p.identity_value, JSON.stringify(p.answers)],
          );
        else
          await execute(
            c,
            'INSERT INTO participants(event_id,identity_digest,identity_value,answers) VALUES (?,?,?,?)',
            [e.id, hash, p.identity_value, JSON.stringify(p.answers)],
          );
      }
      await execute(
        c,
        "UPDATE import_jobs SET committed=TRUE,data=JSON_OBJECT('committed',true) WHERE id=?",
        [id],
      );
      await audit(c, user.id, e.id, 'IMPORT_COMMIT', `${data.rows.length} 条`);
    });
    return { code: 'OK' };
  });
  app.get('/api/admin/events/:id/template', async (r, reply) => {
    admin(r);
    const e = await getEvent(getId(r));
    const columns = ['identity_value', ...e.fields.map((f) => f.key)];
    return reply
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="roster-template.xlsx"')
      .send(await workbookBuffer(columns, []));
  });
  app.get('/api/admin/events/:id/export', async (r, reply) => {
    const user = admin(r),
      id = getId(r),
      e = await getEvent(id);
    const list = await rows<CheckinRow>(
      db,
      'SELECT c.* FROM checkins c WHERE event_id=? ORDER BY checked_in_at',
      [id],
    );
    const buffer = await workbookBuffer(
      [e.identity_label, '状态', '签到时间', '来源', ...e.fields.map((f) => f.label)],
      list.map((c) => [
        c.identity_value,
        c.status,
        c.checked_in_at.toISOString(),
        c.source,
        ...e.fields.map((f) => decode(c.answers)[f.key] ?? ''),
      ]),
    );
    await audit(db, user.id, id, 'EXPORT_CHECKINS');
    return reply
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="checkins.xlsx"')
      .send(buffer);
  });
  app.get('/api/admin/events/:id/audit', async (r) => {
    admin(r);
    const id = getId(r);
    return {
      code: 'OK',
      logs: await rows(
        db,
        'SELECT a.action,a.reason,a.created_at,u.username FROM audit_logs a JOIN users u ON u.id=a.user_id WHERE event_id=? ORDER BY a.id DESC LIMIT 100',
        [id],
      ),
    };
  });
  const webRoot = resolve(projectRoot, 'apps/web/dist');
  if (existsSync(webRoot)) {
    await app.register(staticFiles, { root: webRoot });
    app.setNotFoundHandler((r, reply) => {
      if (r.url.startsWith('/api/'))
        return reply
          .status(404)
          .send({ code: 'NOT_FOUND', message: '接口不存在', request_id: r.id });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
export async function ensureAdmin() {
  const [exists] = await rows(db, 'SELECT 1 FROM users WHERE username=?', [config.ADMIN_USERNAME]);
  if (!exists)
    await execute(db, "INSERT INTO users(username,password_hash,role) VALUES (?,?,'admin')", [
      config.ADMIN_USERNAME,
      await hash(config.ADMIN_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
    ]);
}
