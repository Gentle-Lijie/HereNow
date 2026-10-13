import { hash } from '@node-rs/argon2';
import { db, execute, transaction } from '../apps/api/src/db.js';
import { z } from 'zod';
const username = z.string().min(1).max(80).parse(process.env.NEW_USER_NAME),
  password = z.string().min(12).parse(process.env.NEW_USER_PASSWORD),
  role = z.enum(['admin', 'operator']).parse(process.env.NEW_USER_ROLE ?? 'operator');
const eventIds = (process.env.NEW_USER_EVENTS ?? '')
  .split(',')
  .filter(Boolean)
  .map((v) => z.string().regex(/^\d+$/).parse(v));
try {
  await transaction(async (c) => {
    const result = await execute(
      c,
      'INSERT INTO users(username,password_hash,role) VALUES (?,?,?)',
      [username, await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }), role],
    );
    for (const eventId of eventIds)
      await execute(c, 'INSERT INTO event_members(event_id,user_id) VALUES (?,?)', [
        eventId,
        result.insertId,
      ]);
  });
  console.log('Account created with explicit event grants.');
} finally {
  await db.end();
}
