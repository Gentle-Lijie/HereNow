import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db, execute, transaction } from '../apps/api/src/db.js';
import { projectRoot } from '../apps/api/src/config.js';
try {
  let text = '';
  try {
    text = await readFile(join(projectRoot, '.local/deletions.jsonl'), 'utf8');
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
  }
  for (const line of text.split('\n').filter(Boolean)) {
    const record = JSON.parse(line) as { public_id: string };
    if (typeof record.public_id !== 'string' || !/^[a-zA-Z0-9_-]{20,40}$/.test(record.public_id))
      throw new Error('Invalid deletion ledger');
    await transaction(async (c) => {
      await execute(c, 'DELETE FROM events WHERE public_id=?', [record.public_id]);
    });
  }
  console.log('Restored deletion ledger replay complete; run cleanup before reopening access.');
} finally {
  await db.end();
}
