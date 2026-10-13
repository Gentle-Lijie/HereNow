import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, stat, unlink, copyFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { config, projectRoot } from '../apps/api/src/config.js';
const folder = join(projectRoot, 'output/backups');
await mkdir(folder, { recursive: true, mode: 0o700 });
const filename = join(folder, `herenow-${new Date().toISOString().replaceAll(':', '-')}.sql`);
const stream = createWriteStream(filename, { mode: 0o600 });
try {
  await new Promise<void>((resolve, reject) => {
    let processDone = false,
      streamDone = false;
    const complete = () => {
      if (processDone && streamDone) resolve();
    };
    const proc = spawn(
      'mysqldump',
      [
        '--host',
        config.DB_HOST,
        '--port',
        String(config.DB_PORT),
        '--user',
        config.DB_USER,
        '--single-transaction',
        '--routines',
        '--triggers',
        '--no-tablespaces',
        config.DB_NAME,
      ],
      { env: { ...process.env, MYSQL_PWD: config.DB_PASSWORD }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    proc.stdout.pipe(stream);
    proc.stderr.resume();
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0)
        reject(new Error(`mysqldump failed (${code}); check local client/server compatibility`));
      else {
        processDone = true;
        complete();
      }
    });
    stream.on('finish', () => {
      streamDone = true;
      complete();
    });
    stream.on('error', reject);
  });
  try {
    await copyFile(join(projectRoot, '.local/deletions.jsonl'), join(folder, 'deletions.jsonl'));
    await chmod(join(folder, 'deletions.jsonl'), 0o600);
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
  }
  for (const f of await readdir(folder)) {
    if (!f.endsWith('.sql')) continue;
    const p = join(folder, f);
    if ((await stat(p)).mtimeMs < Date.now() - 14 * 86400000) await unlink(p);
  }
  console.log(`Database snapshot saved: ${filename}`);
} catch (e) {
  stream.destroy();
  await unlink(filename).catch(() => undefined);
  throw e;
}
