import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { randomBytes } from 'node:crypto';
import { db, execute, rows, transaction } from '../db.js';
import { config } from '../config.js';
import { browserDigest, digest, fail, randomToken, safeEqual } from './security.js';
import {
  checkPassword,
  createAdminSession,
  lockAccount,
  requireCurrentSession,
} from './authentication.js';
import { audit } from './events.js';
import type { PasskeySummary } from '../../../../packages/contracts/src/account-security.js';

const rpID = new URL(config.APP_ORIGIN).hostname;
interface Challenge {
  challenge: string;
  user_id: string | null;
  session_digest: Buffer | null;
}
interface Credential {
  id: string;
  user_id: string;
  credential_id: Buffer;
  public_key: Buffer;
  counter: string;
}
const invalid = () => fail('PASSKEY_FAILED', 'Passkey 验证失败，请重试或使用密码登录', 401);

export async function listPasskeys(userId: string): Promise<PasskeySummary[]> {
  const credentials = await rows<{
    id: string;
    name: string;
    created_at: Date;
    last_used_at: Date | null;
  }>(db, 'SELECT id,name,created_at,last_used_at FROM passkeys WHERE user_id=? ORDER BY id DESC', [
    userId,
  ]);
  return credentials.map((credential) => ({
    ...credential,
    id: String(credential.id),
    created_at: credential.created_at.toISOString(),
    last_used_at: credential.last_used_at?.toISOString() ?? null,
  }));
}

async function saveChallenge(
  challenge: string,
  purpose: 'register' | 'login',
  browser: string,
  userId: string | null = null,
  sessionToken: string | null = null,
) {
  const selector = randomToken();
  await execute(
    db,
    'INSERT INTO webauthn_challenges(token_digest,challenge,purpose,browser_digest,user_id,session_digest,expires_at) VALUES (?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE))',
    [
      digest(selector),
      challenge,
      purpose,
      browserDigest(browser),
      userId,
      sessionToken ? digest(sessionToken) : null,
    ],
  );
  return selector;
}

// Commit consumption before cryptographic verification, including failed attempts.
async function consumeChallenge(selector: string, purpose: string, browser: string) {
  return transaction(async (sql) => {
    const [challenge] = await rows<Challenge>(
      sql,
      'SELECT challenge,user_id,session_digest FROM webauthn_challenges WHERE token_digest=? AND purpose=? AND browser_digest=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE',
      [digest(selector), purpose, browserDigest(browser)],
    );
    if (!challenge) return invalid();
    await execute(sql, 'DELETE FROM webauthn_challenges WHERE token_digest=?', [digest(selector)]);
    return challenge;
  });
}

export async function registrationOptions(
  userId: string,
  sessionToken: string,
  browser: string,
  password: string,
) {
  const snapshot = await checkPassword(userId, password);
  const userHandle = await transaction(async (sql) => {
    const user = await lockAccount(sql, userId);
    await requireCurrentSession(sql, userId, sessionToken);
    if (user.password_hash !== snapshot.password_hash) invalid();
    if (user.webauthn_user_handle) return user.webauthn_user_handle;
    const handle = randomBytes(32);
    await execute(sql, 'UPDATE users SET webauthn_user_handle=? WHERE id=?', [handle, userId]);
    return handle;
  });
  const credentials = await rows<Credential>(
    db,
    'SELECT credential_id FROM passkeys WHERE user_id=?',
    [userId],
  );
  const options = await generateRegistrationOptions({
    rpName: 'HereNow',
    rpID,
    userID: new Uint8Array(userHandle),
    userName: snapshot.username,
    attestationType: 'none',
    supportedAlgorithmIDs: [-7, -257],
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: credentials.map((c) => ({ id: c.credential_id.toString('base64url') })),
  });
  const challenge_id = await saveChallenge(
    options.challenge,
    'register',
    browser,
    userId,
    sessionToken,
  );
  return { options, challenge_id };
}

export async function finishRegistration(
  userId: string,
  sessionToken: string,
  browser: string,
  selector: string,
  name: string,
  response: RegistrationResponseJSON,
) {
  const challenge = await consumeChallenge(selector, 'register', browser);
  if (
    String(challenge.user_id) !== userId ||
    !challenge.session_digest?.equals(digest(sessionToken))
  )
    invalid();
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: config.APP_ORIGIN,
    expectedRPID: rpID,
    requireUserVerification: true,
    supportedAlgorithmIDs: [-7, -257],
  }).catch(() => invalid());
  if (!result.verified || !result.registrationInfo) return invalid();
  const credential = result.registrationInfo.credential;
  return transaction(async (sql) => {
    await lockAccount(sql, userId);
    await requireCurrentSession(sql, userId, sessionToken);
    const existing = await rows(sql, 'SELECT id FROM passkeys WHERE user_id=?', [userId]);
    if (existing.length >= 10)
      fail('PASSKEY_LIMIT', '最多添加 10 个 Passkey，请先移除不再使用的凭证');
    const duplicate = await rows(sql, 'SELECT id FROM passkeys WHERE credential_id=?', [
      Buffer.from(credential.id, 'base64url'),
    ]);
    if (duplicate.length) fail('PASSKEY_EXISTS', '此 Passkey 已添加，请使用已有凭证', 409);
    const record = await execute(
      sql,
      'INSERT INTO passkeys(user_id,credential_id,public_key,counter,name) VALUES (?,?,?,?,?)',
      [
        userId,
        Buffer.from(credential.id, 'base64url'),
        Buffer.from(credential.publicKey),
        credential.counter,
        name,
      ],
    );
    await audit(sql, userId, null, 'ADD_PASSKEY');
    return { id: String(record.insertId) };
  });
}

export async function authenticationOptions(browser: string) {
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
  return { options, challenge_id: await saveChallenge(options.challenge, 'login', browser) };
}

export async function passkeyLogin(
  browser: string,
  selector: string,
  response: AuthenticationResponseJSON,
) {
  const challenge = await consumeChallenge(selector, 'login', browser);
  const credentialId = Buffer.from(response.id, 'base64url');
  const [snapshot] = await rows<Credential>(
    db,
    'SELECT user_id FROM passkeys WHERE credential_id=?',
    [credentialId],
  );
  if (!snapshot) return invalid();
  return transaction(async (sql) => {
    const user = await lockAccount(sql, String(snapshot.user_id));
    const [credential] = await rows<Credential>(
      sql,
      'SELECT * FROM passkeys WHERE credential_id=? AND user_id=? FOR UPDATE',
      [credentialId, user.id],
    );
    if (
      !credential ||
      !response.response.userHandle ||
      !user.webauthn_user_handle ||
      !safeEqual(response.response.userHandle, user.webauthn_user_handle.toString('base64url'))
    )
      return invalid();
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.APP_ORIGIN,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: response.id,
        publicKey: new Uint8Array(credential.public_key),
        counter: Number(credential.counter),
      },
    }).catch(() => invalid());
    if (!result.verified) return invalid();
    await execute(sql, 'UPDATE passkeys SET counter=?,last_used_at=UTC_TIMESTAMP(3) WHERE id=?', [
      result.authenticationInfo.newCounter,
      credential.id,
    ]);
    const token = await createAdminSession(sql, String(user.id));
    await audit(sql, String(user.id), null, 'PASSKEY_LOGIN');
    return { token, user };
  });
}

export async function deletePasskey(
  userId: string,
  sessionToken: string,
  id: string,
  password: string,
) {
  const snapshot = await checkPassword(userId, password);
  await transaction(async (sql) => {
    const user = await lockAccount(sql, userId);
    await requireCurrentSession(sql, userId, sessionToken);
    if (user.password_hash !== snapshot.password_hash) invalid();
    const result = await execute(sql, 'DELETE FROM passkeys WHERE id=? AND user_id=?', [
      id,
      userId,
    ]);
    if (!result.affectedRows) fail('NOT_FOUND', 'Passkey 不存在', 404);
    // Also revoke sessions established using the removed credential.
    await execute(sql, 'DELETE FROM admin_sessions WHERE user_id=? AND token_digest<>?', [
      userId,
      digest(sessionToken),
    ]);
    await execute(sql, 'DELETE FROM webauthn_challenges WHERE user_id=?', [userId]);
    await audit(sql, userId, null, 'DELETE_PASSKEY');
  });
}
