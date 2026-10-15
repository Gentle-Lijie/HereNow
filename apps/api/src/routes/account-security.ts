import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  changePasswordSchema,
  passkeyRegistrationSchema,
  passkeyNameSchema,
} from '../../../../packages/contracts/src/account-security.js';
import { config } from '../config.js';
import { fail } from '../services/security.js';
import { changePassword } from '../services/authentication.js';
import {
  authenticationOptions,
  deletePasskey,
  finishRegistration,
  passkeyLogin,
  registrationOptions,
  listPasskeys,
} from '../services/passkeys.js';

const encoded = z
  .string()
  .min(1)
  .max(22000)
  .regex(/^[A-Za-z0-9_-]+$/);
const credentialBase = {
  id: encoded.max(1366),
  rawId: encoded.max(1366),
  type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: z.object({}),
};
const registrationResponse = z.object({
  ...credentialBase,
  response: z.object({ clientDataJSON: encoded, attestationObject: encoded }),
});
const authenticationResponse = z.object({
  ...credentialBase,
  response: z.object({
    clientDataJSON: encoded,
    authenticatorData: encoded,
    signature: encoded,
    userHandle: encoded.max(128),
  }),
});
const selector = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const rateLimit = { config: { rateLimit: { max: 10, timeWindow: 60000 } } };
const cookieOptions = {
  httpOnly: true,
  secure: config.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api',
};

export function accountSecurityRoutes(app: FastifyInstance) {
  app.post('/api/admin/password', rateLimit, async (r, reply) => {
    const user = r.user ?? fail('UNAUTHORIZED', '请先登录后台', 401);
    const input = changePasswordSchema.parse(r.body);
    await changePassword(user.id, r.cookies.hn_admin!, input.current_password, input.new_password);
    reply.clearCookie('hn_admin', cookieOptions);
    return { code: 'OK', message: '操作成功', request_id: r.id };
  });
  app.get('/api/admin/passkeys', async (r) => {
    const user = r.user ?? fail('UNAUTHORIZED', '请先登录后台', 401);
    return {
      code: 'OK',
      message: '操作成功',
      request_id: r.id,
      passkeys: await listPasskeys(user.id),
    };
  });
  app.post('/api/admin/passkeys/register/options', rateLimit, async (r) => {
    const user = r.user ?? fail('UNAUTHORIZED', '请先登录后台', 401);
    const input = passkeyRegistrationSchema.parse(r.body);
    return {
      code: 'OK',
      message: '操作成功',
      request_id: r.id,
      ...(await registrationOptions(
        user.id,
        r.cookies.hn_admin!,
        r.cookies.hn_browser!,
        input.current_password,
      )),
    };
  });
  app.post('/api/admin/passkeys/register/verify', rateLimit, async (r) => {
    const user = r.user ?? fail('UNAUTHORIZED', '请先登录后台', 401);
    const input = z
      .object({ challenge_id: selector, name: passkeyNameSchema, response: registrationResponse })
      .strict()
      .parse(r.body);
    return {
      code: 'OK',
      message: '操作成功',
      request_id: r.id,
      ...(await finishRegistration(
        user.id,
        r.cookies.hn_admin!,
        r.cookies.hn_browser!,
        input.challenge_id,
        input.name,
        input.response,
      )),
    };
  });
  app.delete('/api/admin/passkeys/:id', rateLimit, async (r) => {
    const user = r.user ?? fail('UNAUTHORIZED', '请先登录后台', 401);
    const { id } = z.object({ id: z.string().regex(/^\d+$/) }).parse(r.params);
    const input = passkeyRegistrationSchema.parse(r.body);
    await deletePasskey(user.id, r.cookies.hn_admin!, id, input.current_password);
    return { code: 'OK', message: '操作成功', request_id: r.id };
  });
  app.post('/api/admin/passkeys/login/options', rateLimit, async (r) => ({
    code: 'OK',
    message: '操作成功',
    request_id: r.id,
    ...(await authenticationOptions(r.cookies.hn_browser!)),
  }));
  app.post('/api/admin/passkeys/login/verify', rateLimit, async (r, reply) => {
    const input = z
      .object({ challenge_id: selector, response: authenticationResponse })
      .strict()
      .parse(r.body);
    const { token, user } = await passkeyLogin(
      r.cookies.hn_browser!,
      input.challenge_id,
      input.response,
    );
    reply.setCookie('hn_admin', token, { ...cookieOptions, maxAge: 43200 });
    return {
      code: 'OK',
      message: '操作成功',
      request_id: r.id,
      user: { id: String(user.id), username: user.username, role: user.role },
    };
  });
}
