import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
if (!existsSync('.env')) {
  let env = readFileSync('.env.example', 'utf8');
  for (const key of ['TOKEN_SECRET', 'IDENTITY_SECRET', 'ENCRYPTION_KEY'])
    env = env.replace(`${key}=\n`, `${key}=${randomBytes(32).toString('hex')}\n`);
  env = env.replace(
    'ADMIN_PASSWORD=\n',
    `ADMIN_PASSWORD=${randomBytes(18).toString('base64url')}\n`,
  );
  writeFileSync('.env', env, { mode: 0o600 });
  console.log('Created .env. Set your MySQL credentials, then run npm run setup again.');
} else {
  for (const task of ['db:migrate', 'db:seed']) {
    const p = spawnSync('npm', ['run', task], { stdio: 'inherit' });
    if (p.status !== 0) process.exit(p.status ?? 1);
  }
}
