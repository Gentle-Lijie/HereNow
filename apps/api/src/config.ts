import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
let root = resolve(process.cwd());
while (dirname(root) !== root) {
  const manifest = join(root, 'package.json');
  if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === 'herenow') break;
  root = dirname(root);
}
export const projectRoot = root;
dotenv.config({ path: join(projectRoot, '.env'), quiet: true });
import { z } from 'zod';
const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(3001),
    APP_ORIGIN: z.url().default('http://localhost:5173'),
    DB_HOST: z.string().default('127.0.0.1'),
    DB_PORT: z.coerce.number().default(3306),
    DB_USER: z.string().default('root'),
    DB_PASSWORD: z.string(),
    TRUSTED_PROXIES: z.string().default(''),
    DB_NAME: z
      .string()
      .regex(/^[a-z0-9_]+$/)
      .default('herenow_dev'),
    TOKEN_SECRET: z.string().min(64),
    IDENTITY_SECRET: z.string().min(64),
    ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/),
    ADMIN_USERNAME: z.string().default('admin'),
    ADMIN_PASSWORD: z.string(),
  })
  .parse(process.env);
if (env.NODE_ENV === 'production' && !env.APP_ORIGIN.startsWith('https://'))
  throw new Error('Production requires HTTPS APP_ORIGIN');
export const config = env;
