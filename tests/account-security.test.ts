import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { buildApp } from '../apps/api/src/app.js';
import { config } from '../apps/api/src/config.js';
import { db, execute } from '../apps/api/src/db.js';
import { digest } from '../apps/api/src/services/security.js';
import { createTestAdmin } from './fixtures/admin.js';

let app: FastifyInstance;
let clientSequence = 1;
const fixtures: Awaited<ReturnType<typeof createTestAdmin>>[] = [];
class Client {
  cookies = new Map<string, string>();
  csrf = '';
  ip = `127.1.0.${clientSequence++}`;
  async call(
    method: HTTPMethods,
    url: string,
    payload?: object,
    headers: Record<string, string> = {},
  ) {
    const response = await app.inject({
      method,
      url,
      payload,
      remoteAddress: this.ip,
      headers: {
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join(';'),
        origin: config.APP_ORIGIN,
        'x-csrf-token': this.csrf,
        ...headers,
      },
    });
    for (const cookie of response.cookies) this.cookies.set(cookie.name, cookie.value);
    return response;
  }
  async context() {
    this.csrf = (await this.call('GET', '/api/context')).json().csrf_token as string;
    return this;
  }
  async login(username: string, password: string) {
    return this.call('POST', '/api/admin/login', { username, password });
  }
}
async function account() {
  const user = await createTestAdmin();
  fixtures.push(user);
  const client = await new Client().context();
  expect((await client.login(user.username, user.password)).statusCode).toBe(200);
  return { user, client };
}
function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const key = new Map<number, number | Uint8Array>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, Buffer.from(jwk.x!, 'base64url')],
    [-3, Buffer.from(jwk.y!, 'base64url')],
  ]);
  return {
    id: randomBytes(32).toString('base64url'),
    privateKey,
    cose: Buffer.from(isoCBOR.encode(key)),
  };
}
function authData(flags: number, counter: number, rpID = new URL(config.APP_ORIGIN).hostname) {
  const count = Buffer.alloc(4);
  count.writeUInt32BE(counter);
  return Buffer.concat([digest(rpID), Buffer.from([flags]), count]);
}
function registration(
  options: PublicKeyCredentialCreationOptionsJSON,
  key: ReturnType<typeof authenticator>,
  overrides: { origin?: string; challenge?: string; flags?: number; rpID?: string } = {},
): RegistrationResponseJSON {
  const credentialId = Buffer.from(key.id, 'base64url');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(credentialId.length);
  const data = Buffer.concat([
    authData(overrides.flags ?? 0x45, 0, overrides.rpID),
    Buffer.alloc(16),
    length,
    credentialId,
    key.cose,
  ]);
  const attestation = isoCBOR.encode(
    new Map<string, string | Uint8Array | Map<string, string>>([
      ['fmt', 'none'],
      ['authData', data],
      ['attStmt', new Map()],
    ]),
  );
  return {
    id: key.id,
    rawId: key.id,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: Buffer.from(
        JSON.stringify({
          type: 'webauthn.create',
          challenge: overrides.challenge ?? options.challenge,
          origin: overrides.origin ?? config.APP_ORIGIN,
          crossOrigin: false,
        }),
      ).toString('base64url'),
      attestationObject: Buffer.from(attestation).toString('base64url'),
    },
  };
}
function assertion(
  options: PublicKeyCredentialRequestOptionsJSON,
  key: { id: string; privateKey: KeyObject },
  handle: string,
  overrides: {
    origin?: string;
    challenge?: string;
    flags?: number;
    counter?: number;
    rpID?: string;
  } = {},
): AuthenticationResponseJSON {
  const clientData = Buffer.from(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: overrides.challenge ?? options.challenge,
      origin: overrides.origin ?? config.APP_ORIGIN,
      crossOrigin: false,
    }),
  );
  const data = authData(overrides.flags ?? 0x05, overrides.counter ?? 1, overrides.rpID);
  return {
    id: key.id,
    rawId: key.id,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientData.toString('base64url'),
      authenticatorData: data.toString('base64url'),
      signature: sign(
        'sha256',
        Buffer.concat([data, digest(clientData.toString('utf8'))]),
        key.privateKey,
      ).toString('base64url'),
      userHandle: handle,
    },
  };
}
async function register(client: Client, password: string) {
  const response = await client.call('POST', '/api/admin/passkeys/register/options', {
    current_password: password,
  });
  expect(response.statusCode).toBe(200);
  const { options, challenge_id } = response.json() as {
    options: PublicKeyCredentialCreationOptionsJSON;
    challenge_id: string;
  };
  const key = authenticator();
  const payload = { challenge_id, name: '我的安全密钥', response: registration(options, key) };
  const result = await client.call('POST', '/api/admin/passkeys/register/verify', payload);
  expect(result.statusCode, result.body).toBe(200);
  return { ...key, handle: options.user.id, idInDatabase: result.json().id as string, payload };
}
async function loginOptions(client: Client) {
  const result = await client.call('POST', '/api/admin/passkeys/login/options', {});
  expect(result.statusCode).toBe(200);
  return result.json() as { options: PublicKeyCredentialRequestOptionsJSON; challenge_id: string };
}
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await execute(db, 'DELETE FROM webauthn_challenges WHERE user_id IS NULL');
  for (const fixture of fixtures) await fixture.dispose();
  await app.close();
  await db.end();
});

describe('account security with real MySQL and WebAuthn signatures', () => {
  it('changes only the current account password, revokes every session, and rejects old passwords', async () => {
    const { user, client } = await account();
    const otherSession = await new Client().context();
    await otherSession.login(user.username, user.password);
    const otherAccount = await account();
    expect(
      (
        await client.call('POST', '/api/admin/password', {
          current_password: 'wrong',
          new_password: 'a-new-password-123',
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await client.call('POST', '/api/admin/password', {
          current_password: user.password,
          new_password: 'short',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await client.call('POST', '/api/admin/password', {
          current_password: user.password,
          new_password: user.password,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await client.call('POST', '/api/admin/password', {
          current_password: user.password,
          new_password: 'a-new-password-123',
          user_id: otherAccount.user.id,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await client.call('POST', '/api/admin/password', {
          current_password: user.password,
          new_password: 'a-new-password-123',
        })
      ).statusCode,
    ).toBe(200);
    expect((await client.call('GET', '/api/context')).json().user).toBeNull();
    expect((await otherSession.call('GET', '/api/context')).json().user).toBeNull();
    expect((await client.login(user.username, user.password)).statusCode).toBe(401);
    expect((await client.login(user.username, 'a-new-password-123')).statusCode).toBe(200);
    expect((await otherAccount.client.call('GET', '/api/context')).json().user.id).toBe(
      otherAccount.user.id,
    );
  });
  it('serializes competing password changes and rejects stale session mutations', async () => {
    const { user, client } = await account();
    const results = await Promise.all(
      ['new-password-alpha', 'new-password-bravo'].map((new_password) =>
        client.call('POST', '/api/admin/password', {
          current_password: user.password,
          new_password,
        }),
      ),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 401)).toHaveLength(1);
    expect(
      (
        await client.call('POST', '/api/admin/passkeys/register/options', {
          current_password: user.password,
        })
      ).statusCode,
    ).toBe(401);
  });
  it('registers a credential, logs in without username/password, and consumes concurrent replays once', async () => {
    const { user, client } = await account();
    const key = await register(client, user.password);
    expect(
      (await client.call('POST', '/api/admin/passkeys/register/verify', key.payload)).statusCode,
    ).toBe(401);
    const list = (await client.call('GET', '/api/admin/passkeys')).json().passkeys;
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('我的安全密钥');
    expect(list[0].credential_id).toBeUndefined();
    expect(list[0].public_key).toBeUndefined();
    const anonymous = await new Client().context();
    const { options, challenge_id } = await loginOptions(anonymous);
    expect(options.allowCredentials ?? []).toHaveLength(0);
    const payload = { challenge_id, response: assertion(options, key, key.handle) };
    const results = await Promise.all([
      anonymous.call('POST', '/api/admin/passkeys/login/verify', payload),
      anonymous.call('POST', '/api/admin/passkeys/login/verify', payload),
    ]);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 401)).toHaveLength(1);
    expect(results.find((r) => r.statusCode === 200)?.json().user.password_hash).toBeUndefined();
    expect((await anonymous.call('GET', '/api/context')).json().user.id).toBe(user.id);
    expect(
      (await client.call('GET', '/api/admin/passkeys')).json().passkeys[0].last_used_at,
    ).toBeTruthy();
  });
  it.each(['origin', 'challenge', 'uv', 'rp', 'signature', 'handle'] as const)(
    'rejects invalid authentication %s and consumes failed challenges',
    async (invalid) => {
      const { user, client } = await account();
      const key = await register(client, user.password);
      const anonymous = await new Client().context();
      const { options, challenge_id } = await loginOptions(anonymous);
      const response = assertion(options, key, key.handle, {
        ...(invalid === 'origin' ? { origin: 'https://evil.example' } : {}),
        ...(invalid === 'challenge' ? { challenge: 'wrong' } : {}),
        ...(invalid === 'uv' ? { flags: 1 } : {}),
        ...(invalid === 'rp' ? { rpID: 'evil.example' } : {}),
      });
      if (invalid === 'signature')
        response.response.signature = randomBytes(64).toString('base64url');
      if (invalid === 'handle')
        response.response.userHandle = randomBytes(32).toString('base64url');
      expect(
        (
          await anonymous.call('POST', '/api/admin/passkeys/login/verify', {
            challenge_id,
            response,
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await anonymous.call('POST', '/api/admin/passkeys/login/verify', {
            challenge_id,
            response: assertion(options, key, key.handle),
          })
        ).statusCode,
      ).toBe(401);
      expect((await anonymous.call('GET', '/api/context')).json().user).toBeNull();
    },
  );
  it('rejects cross-browser, expired and wrong-purpose challenges', async () => {
    const { user, client } = await account();
    const key = await register(client, user.password);
    const a = await new Client().context(),
      b = await new Client().context();
    const first = await loginOptions(a);
    expect(
      (
        await b.call('POST', '/api/admin/passkeys/login/verify', {
          challenge_id: first.challenge_id,
          response: assertion(first.options, key, key.handle),
        })
      ).statusCode,
    ).toBe(401);
    await execute(
      db,
      'UPDATE webauthn_challenges SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE token_digest=?',
      [digest(first.challenge_id)],
    );
    expect(
      (
        await a.call('POST', '/api/admin/passkeys/login/verify', {
          challenge_id: first.challenge_id,
          response: assertion(first.options, key, key.handle),
        })
      ).statusCode,
    ).toBe(401);
    const reg = (
      await client.call('POST', '/api/admin/passkeys/register/options', {
        current_password: user.password,
      })
    ).json();
    const login = await loginOptions(client);
    expect(
      (
        await client.call('POST', '/api/admin/passkeys/login/verify', {
          challenge_id: reg.challenge_id,
          response: assertion(login.options, key, key.handle),
        })
      ).statusCode,
    ).toBe(401);
  });
  it.each(['origin', 'uv', 'rp'] as const)('rejects invalid registration %s', async (invalid) => {
    const { user, client } = await account();
    const { options, challenge_id } = (
      await client.call('POST', '/api/admin/passkeys/register/options', {
        current_password: user.password,
      })
    ).json() as { options: PublicKeyCredentialCreationOptionsJSON; challenge_id: string };
    const response = registration(options, authenticator(), {
      ...(invalid === 'origin' ? { origin: 'https://evil.example' } : {}),
      ...(invalid === 'uv' ? { flags: 0x41 } : {}),
      ...(invalid === 'rp' ? { rpID: 'evil.example' } : {}),
    });
    expect(
      (
        await client.call('POST', '/api/admin/passkeys/register/verify', {
          challenge_id,
          name: 'test',
          response,
        })
      ).statusCode,
    ).toBe(401);
    expect((await client.call('GET', '/api/admin/passkeys')).json().passkeys).toHaveLength(0);
  });
  it('requires current password and ownership for deletion, and revokes other sessions', async () => {
    const { user, client } = await account();
    const key = await register(client, user.password);
    const other = await account();
    expect(
      (
        await client.call('POST', '/api/admin/passkeys/register/options', {
          current_password: 'wrong',
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await other.client.call('DELETE', `/api/admin/passkeys/${key.idInDatabase}`, {
          current_password: other.user.password,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await client.call('DELETE', `/api/admin/passkeys/${key.idInDatabase}`, {
          current_password: 'wrong',
        })
      ).statusCode,
    ).toBe(401);
    const loginClient = await new Client().context();
    const login = await loginOptions(loginClient);
    expect(
      (
        await loginClient.call('POST', '/api/admin/passkeys/login/verify', {
          challenge_id: login.challenge_id,
          response: assertion(login.options, key, key.handle),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await client.call('DELETE', `/api/admin/passkeys/${key.idInDatabase}`, {
          current_password: user.password,
        })
      ).statusCode,
    ).toBe(200);
    expect((await loginClient.call('GET', '/api/context')).json().user).toBeNull();
    const retry = await loginOptions(loginClient);
    expect(
      (
        await loginClient.call('POST', '/api/admin/passkeys/login/verify', {
          challenge_id: retry.challenge_id,
          response: assertion(retry.options, key, key.handle, { counter: 2 }),
        })
      ).statusCode,
    ).toBe(401);
    expect((await client.call('GET', '/api/context')).json().user.id).toBe(user.id);
  });
  it('retains Passkey access after password changes and rejects previously issued registration challenges', async () => {
    const { user, client } = await account();
    const key = await register(client, user.password);
    const pending = (
      await client.call('POST', '/api/admin/passkeys/register/options', {
        current_password: user.password,
      })
    ).json() as { options: PublicKeyCredentialCreationOptionsJSON; challenge_id: string };
    await client.call('POST', '/api/admin/password', {
      current_password: user.password,
      new_password: 'the-new-password-123',
    });
    await client.login(user.username, 'the-new-password-123');
    expect(
      (
        await client.call('POST', '/api/admin/passkeys/register/verify', {
          challenge_id: pending.challenge_id,
          name: 'expired',
          response: registration(pending.options, authenticator()),
        })
      ).statusCode,
    ).toBe(401);
    const anon = await new Client().context();
    const login = await loginOptions(anon);
    expect(
      (
        await anon.call('POST', '/api/admin/passkeys/login/verify', {
          challenge_id: login.challenge_id,
          response: assertion(login.options, key, key.handle),
        })
      ).statusCode,
    ).toBe(200);
  });
  it('requires authentication/CSRF and rate limits unauthenticated challenges without account enumeration', async () => {
    const anon = await new Client().context();
    expect((await anon.call('GET', '/api/admin/passkeys')).statusCode).toBe(401);
    expect(
      (
        await anon.call('POST', '/api/admin/password', {
          current_password: 'x',
          new_password: 'new-password-123',
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await anon.call(
          'POST',
          '/api/admin/passkeys/login/options',
          {},
          { origin: 'https://evil.example' },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await anon.call('POST', '/api/admin/passkeys/register/options', { current_password: 'x' }))
        .statusCode,
    ).toBe(401);
    for (let i = 0; i < 10; i++)
      expect((await anon.call('POST', '/api/admin/passkeys/login/options', {})).statusCode).toBe(
        200,
      );
    expect((await anon.call('POST', '/api/admin/passkeys/login/options', {})).statusCode).toBe(429);
  });
  it('binds registration to the original account and session even in the same browser', async () => {
    const { user, client } = await account();
    const pending = (
      await client.call('POST', '/api/admin/passkeys/register/options', {
        current_password: user.password,
      })
    ).json() as { options: PublicKeyCredentialCreationOptionsJSON; challenge_id: string };
    // Password login rotates the admin session while preserving the browser cookie.
    expect((await client.login(user.username, user.password)).statusCode).toBe(200);
    expect(
      (
        await client.call('POST', '/api/admin/passkeys/register/verify', {
          challenge_id: pending.challenge_id,
          name: 'stale session',
          response: registration(pending.options, authenticator()),
        })
      ).statusCode,
    ).toBe(401);
    const second = (
      await client.call('POST', '/api/admin/passkeys/register/options', {
        current_password: user.password,
      })
    ).json() as typeof pending;
    const other = await account();
    await client.login(other.user.username, other.user.password);
    expect(
      (
        await client.call('POST', '/api/admin/passkeys/register/verify', {
          challenge_id: second.challenge_id,
          name: 'wrong account',
          response: registration(second.options, authenticator()),
        })
      ).statusCode,
    ).toBe(401);
    expect((await client.call('GET', '/api/admin/passkeys')).json().passkeys).toHaveLength(0);
  });
  it('rejects a non-increasing signature counter while allowing synced credentials with zero counters', async () => {
    const { user, client } = await account();
    const key = await register(client, user.password);
    const anon = await new Client().context();
    for (const [counter, expected] of [
      [0, 200],
      [0, 200],
      [1, 200],
      [1, 401],
      [0, 401],
    ] as const) {
      const login = await loginOptions(anon);
      expect(
        (
          await anon.call('POST', '/api/admin/passkeys/login/verify', {
            challenge_id: login.challenge_id,
            response: assertion(login.options, key, key.handle, { counter }),
          })
        ).statusCode,
      ).toBe(expected);
    }
  });
  it('enforces credential uniqueness and the per-account limit in the database transaction', async () => {
    const { user, client } = await account();
    const key = await register(client, user.password);
    const pending = (
      await client.call('POST', '/api/admin/passkeys/register/options', {
        current_password: user.password,
      })
    ).json() as { options: PublicKeyCredentialCreationOptionsJSON; challenge_id: string };
    expect(
      (
        await client.call('POST', '/api/admin/passkeys/register/verify', {
          challenge_id: pending.challenge_id,
          name: 'duplicate',
          response: registration(pending.options, key),
        })
      ).json().code,
    ).toBe('PASSKEY_EXISTS');
    for (let i = 0; i < 9; i++)
      await execute(
        db,
        'INSERT INTO passkeys(user_id,credential_id,public_key,name) VALUES (?,?,?,?)',
        [user.id, randomBytes(32), key.cose, `limit-${i}`],
      );
    const last = (
      await client.call('POST', '/api/admin/passkeys/register/options', {
        current_password: user.password,
      })
    ).json() as typeof pending;
    expect(
      (
        await client.call('POST', '/api/admin/passkeys/register/verify', {
          challenge_id: last.challenge_id,
          name: 'eleventh',
          response: registration(last.options, authenticator()),
        })
      ).json().code,
    ).toBe('PASSKEY_LIMIT');
    expect((await client.call('GET', '/api/admin/passkeys')).json().passkeys).toHaveLength(10);
  });
});
