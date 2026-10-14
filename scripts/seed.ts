import { ensureAdmin } from '../apps/api/src/app.js';
import { db, rows, execute } from '../apps/api/src/db.js';
import { eventInputSchema } from '../packages/contracts/src/index.js';
import { randomToken } from '../apps/api/src/services/security.js';
try {
  await ensureAdmin();
  const [existing] = await rows(db, 'SELECT 1 FROM events LIMIT 1');
  if (!existing) {
    const event = eventInputSchema.parse({
      name: '秋日分享会 · 示例活动',
      organizer: 'HereNow 本地演示',
      description: '一起分享最近的发现，让每一次相聚都有迹可循。此活动仅供本地开发体验。',
      starts_at: new Date(Date.now() - 3600000).toISOString(),
      ends_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      location_label: '上海 · 创意空间',
      identity_label: '报名编号',
      fields: [
        { key: 'name', label: '姓名', type: 'text', required: true },
        { key: 'department', label: '团队 / 部门', type: 'text', required: false },
      ],
    });
    const result = await execute(
      db,
      "INSERT INTO events(public_id,state,config) VALUES (?,'PUBLISHED',?)",
      [randomToken(), JSON.stringify(event)],
    );
    await execute(db, 'INSERT INTO form_versions(event_id,version,fields) VALUES (?,1,?)', [
      result.insertId,
      JSON.stringify(event.fields),
    ]);
    console.log('Created explicitly labeled local example event (no fabricated check-ins).');
  }
  console.log(
    '管理员初始化完成；已有账号密码不会被覆盖。修改密码请运行 npm run admin:reset-password。',
  );
} finally {
  await db.end();
}
