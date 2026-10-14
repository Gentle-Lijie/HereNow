import { hash } from '@node-rs/argon2';
import { config } from '../../apps/api/src/config.js';
import { db, execute } from '../../apps/api/src/db.js';
import { randomToken } from '../../apps/api/src/services/security.js';

export async function createTestAdmin() {
  if (config.DB_NAME !== 'herenow_test') throw new Error('Test accounts require herenow_test');
  const username = `test_admin_${randomToken()}`;
  const password = randomToken();
  const result = await execute(
    db,
    "INSERT INTO users(username,password_hash,role) VALUES (?,?,'admin')",
    [username, await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 })],
  );
  const id = String(result.insertId);
  return {
    id,
    username,
    password,
    async dispose() {
      await execute(db, 'DELETE FROM admin_sessions WHERE user_id=?', [id]);
      await execute(db, 'DELETE FROM event_members WHERE user_id=?', [id]);
      await execute(db, 'DELETE FROM audit_logs WHERE user_id=?', [id]);
      await execute(db, 'DELETE FROM users WHERE id=?', [id]);
    },
  };
}
