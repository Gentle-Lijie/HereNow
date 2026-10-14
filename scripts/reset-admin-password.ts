import { config } from '../apps/api/src/config.js';
import { db } from '../apps/api/src/db.js';
import { resetAdminPassword } from '../apps/api/src/services/accounts.js';

try {
  const result = await resetAdminPassword(config.ADMIN_USERNAME, config.ADMIN_PASSWORD);
  console.log(`管理员 ${result.username} 的密码已按 .env 更新，旧登录会话已撤销。`);
} finally {
  await db.end();
}
