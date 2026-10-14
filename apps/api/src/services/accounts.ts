import { hash } from '@node-rs/argon2';
import { z } from 'zod';
import { rows, execute, transaction } from '../db.js';
import { audit } from './events.js';
import { fail } from './security.js';

/** Explicit deployment action: changing bootstrap configuration alone never overwrites accounts. */
export async function resetAdminPassword(username: string, password: string) {
  const input = z
    .object({ username: z.string().min(1).max(80), password: z.string().min(1).max(200) })
    .parse({ username, password });
  // Keep the expensive hash operation outside the database transaction.
  const passwordHash = await hash(input.password, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  return transaction(async (sql) => {
    const [user] = await rows<{ id: string; role: string }>(
      sql,
      'SELECT id,role FROM users WHERE username=? FOR UPDATE',
      [input.username],
    );
    if (!user || user.role !== 'admin') {
      return fail('ADMIN_NOT_FOUND', '指定管理员不存在，请核对 ADMIN_USERNAME', 404);
    }
    await execute(sql, 'UPDATE users SET password_hash=? WHERE id=?', [passwordHash, user.id]);
    await execute(sql, 'DELETE FROM admin_sessions WHERE user_id=?', [user.id]);
    await audit(sql, String(user.id), null, 'RESET_ADMIN_PASSWORD', '部署方通过本机重置命令更新');
    return { username: input.username };
  });
}
