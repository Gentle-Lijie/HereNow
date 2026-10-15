import { hash, verify } from '@node-rs/argon2';
import type { PoolConnection } from 'mysql2/promise';
import { db, execute, rows, transaction } from '../db.js';
import { digest, fail, randomToken } from './security.js';
import { audit } from './events.js';

export interface Account {
  id: string;
  username: string;
  role: 'admin' | 'operator';
  password_hash: string;
  webauthn_user_handle: Buffer | null;
}
export const hashPassword = (password: string) =>
  hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

export async function createAdminSession(sql: PoolConnection, userId: string) {
  const token = randomToken();
  await execute(
    sql,
    'INSERT INTO admin_sessions(token_digest,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 12 HOUR))',
    [digest(token), userId],
  );
  return token;
}

export async function checkPassword(userId: string, password: string) {
  const [user] = await rows<Account>(db, 'SELECT * FROM users WHERE id=?', [userId]);
  if (!user || !(await verify(user.password_hash, password)))
    return fail('PASSWORD_INCORRECT', '当前密码不正确', 401);
  return user;
}

// Lock the account before credentials, challenges or sessions in all credential mutations.
export async function lockAccount(sql: PoolConnection, userId: string) {
  const [user] = await rows<Account>(sql, 'SELECT * FROM users WHERE id=? FOR UPDATE', [userId]);
  return user ?? fail('UNAUTHORIZED', '请重新登录后台', 401);
}

export async function requireCurrentSession(sql: PoolConnection, userId: string, token: string) {
  const [session] = await rows(
    sql,
    'SELECT 1 FROM admin_sessions WHERE user_id=? AND token_digest=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE',
    [userId, digest(token)],
  );
  if (!session) fail('UNAUTHORIZED', '请重新登录后台', 401);
}

export async function passwordLogin(username: string, password: string) {
  const [snapshot] = await rows<Account>(db, 'SELECT * FROM users WHERE username=?', [username]);
  if (!snapshot || !(await verify(snapshot.password_hash, password)))
    return fail('LOGIN_FAILED', '账号或密码不正确', 401);
  return transaction(async (sql) => {
    const user = await lockAccount(sql, String(snapshot.id));
    if (user.password_hash !== snapshot.password_hash)
      return fail('LOGIN_FAILED', '账号或密码不正确', 401);
    return { token: await createAdminSession(sql, String(user.id)), user };
  });
}

export async function changePassword(
  userId: string,
  sessionToken: string,
  currentPassword: string,
  newPassword: string,
) {
  const snapshot = await checkPassword(userId, currentPassword);
  if (currentPassword === newPassword) fail('PASSWORD_UNCHANGED', '新密码不能与当前密码相同');
  const passwordHash = await hashPassword(newPassword);
  await transaction(async (sql) => {
    const user = await lockAccount(sql, userId);
    await requireCurrentSession(sql, userId, sessionToken);
    if (user.password_hash !== snapshot.password_hash)
      fail('UNAUTHORIZED', '密码已变更，请重新登录', 401);
    await execute(sql, 'UPDATE users SET password_hash=? WHERE id=?', [passwordHash, userId]);
    await execute(sql, 'DELETE FROM admin_sessions WHERE user_id=?', [userId]);
    await execute(sql, 'DELETE FROM webauthn_challenges WHERE user_id=?', [userId]);
    await audit(sql, userId, null, 'CHANGE_PASSWORD');
  });
}
