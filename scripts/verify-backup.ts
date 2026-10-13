import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { join } from 'node:path';
import { config, projectRoot } from '../apps/api/src/config.js';
const files = (await readdir(join(projectRoot, 'output/backups')))
  .filter((f) => f.endsWith('.sql'))
  .sort();
if (!files.length) throw new Error('No backup found');
const name = `herenow_restore_test_${randomBytes(4).toString('hex')}`;
const c = await mysql.createConnection({
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
});
let created = false;
try {
  await c.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4`);
  created = true;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'mysql',
      ['--host', config.DB_HOST, '--port', String(config.DB_PORT), '--user', config.DB_USER, name],
      { env: { ...process.env, MYSQL_PWD: config.DB_PASSWORD }, stdio: ['pipe', 'ignore', 'pipe'] },
    );
    createReadStream(join(projectRoot, 'output/backups', files.at(-1)!)).pipe(child.stdin);
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Restore failed (${code})`)),
    );
  });
  const [tables] = await c.query<mysql.RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=?',
    [name],
  );
  const [users] = await c.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM \`${name}\`.users`,
  );
  if (Number(tables[0]?.n) < 15 || Number(users[0]?.n) < 1)
    throw new Error('Incomplete restored database');
  console.log(
    JSON.stringify({
      restore: 'passed',
      tables: Number(tables[0]?.n),
      users: Number(users[0]?.n),
      isolated_database: name,
    }),
  );
} finally {
  if (created) await c.query(`DROP DATABASE \`${name}\``);
  await c.end();
}
