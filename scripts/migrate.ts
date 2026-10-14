import { readFile, readdir } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { config } from '../apps/api/src/config.js';
const c = await mysql.createConnection({
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  timezone: 'Z',
  multipleStatements: true,
});
try {
  await c.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await c.query(`USE \`${config.DB_NAME}\``);
  await c.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(120) PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB',
  );
  const [done] = await c.query<mysql.RowDataPacket[]>('SELECT name FROM schema_migrations');
  for (const file of (await readdir('database/migrations'))
    .filter((f) => f.endsWith('.sql') || f.endsWith('.ts'))
    .sort()) {
    if (done.some((r) => r.name === file)) continue;
    if (file.endsWith('.sql')) await c.query(await readFile(`database/migrations/${file}`, 'utf8'));
    else {
      const migration = (await import(
        pathToFileURL(resolve('database/migrations', file)).href
      )) as { up: (connection: mysql.Connection) => Promise<void> };
      await migration.up(c);
    }
    await c.query('INSERT INTO schema_migrations(name) VALUES (?)', [file]);
    console.log(`Applied ${file}`);
  }
  const [v] = await c.query<mysql.RowDataPacket[]>('SELECT VERSION() AS version');
  console.log(`Database ready: ${config.DB_NAME}, MySQL ${String(v[0]?.version)}`);
} finally {
  await c.end();
}
