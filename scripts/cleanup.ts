import { mkdir, appendFile } from 'node:fs/promises';
import { db, execute, rows, transaction } from '../apps/api/src/db.js';
import { fromEvent, type EventRow } from '../apps/api/src/services/events.js';
import { join } from 'node:path';
import { projectRoot } from '../apps/api/src/config.js';
export async function cleanup() {
  for (const table of [
    'checkin_evidence',
    'idempotency_records',
    'import_jobs',
    'display_sessions',
    'admin_sessions',
  ])
    await execute(db, `DELETE FROM ${table} WHERE expires_at<UTC_TIMESTAMP(3)`);
  await execute(
    db,
    'DELETE FROM checkin_sessions WHERE expires_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 24 HOUR)',
  );
  await execute(
    db,
    'DELETE FROM attempts WHERE created_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 7 DAY)',
  );
  await execute(
    db,
    'DELETE FROM audit_logs WHERE created_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 180 DAY)',
  );
  const events = (await rows<EventRow>(db, 'SELECT * FROM events')).map(fromEvent);
  const expired = events.filter(
    (e) => Date.parse(e.ends_at) + e.retention_days * 86400000 < Date.now(),
  );
  await mkdir(join(projectRoot, '.local'), { recursive: true, mode: 0o700 });
  for (const event of expired) {
    await appendFile(
      join(projectRoot, '.local/deletions.jsonl'),
      JSON.stringify({ public_id: event.public_id, deleted_at: new Date().toISOString() }) + '\n',
      { mode: 0o600 },
    );
    await transaction(async (c) => {
      await execute(c, 'SELECT id FROM events WHERE id=? FOR UPDATE', [event.id]);
      await execute(c, 'INSERT INTO deletion_logs(event_public_id) VALUES (?)', [event.public_id]);
      await execute(c, 'DELETE FROM events WHERE id=?', [event.id]);
    });
  }
  console.log(`Retention cleanup completed; ${expired.length} expired events removed.`);
}
try {
  await cleanup();
} finally {
  await db.end();
}
