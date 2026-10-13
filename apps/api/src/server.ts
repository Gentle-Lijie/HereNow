import { buildApp } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
const app = await buildApp();
// Fail before advertising a ready API when the database cannot be reached.
await db.query('SELECT 1');
await app.listen({ host: '127.0.0.1', port: config.PORT });
console.log(`HereNow API http://127.0.0.1:${config.PORT}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app
      .close()
      .then(() => db.end())
      .then(() => process.exit(0));
  });
