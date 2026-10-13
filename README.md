# HereNow · 在场

Vue 3 活动签到工具。后台采用 Ant Design Vue，手机签到采用 Vant，API 使用 Fastify 与本机 MySQL。当前是可运行的核心开发版本；上线条件与尚未实测项见 [实施与验收记录](docs/implementation-status.md)。

## 本地启动

需要 Node.js 22+ 与可登录的本机 MySQL（目标基线 8.4；本机实际验证为 9.3.0）。

```sh
npm ci
npm run setup
npm run dev
```

首次没有 `.env` 时，setup 从 `.env.example` 生成密钥与管理员密码。填写本机数据库连接后再次运行 setup；它创建独立数据库、应用迁移和后台账号。当前机器已初始化 `herenow_dev`，用户名 `admin`，管理员密码见本地 `.env` 的 `ADMIN_PASSWORD`。数据库密码与管理员密码分别配置。

默认预览：[http://localhost:5173](http://localhost:5173)。默认 API：[http://127.0.0.1:3001/api/health](http://127.0.0.1:3001/api/health)。`npm run dev` 同时启动两端，但 Vite 会等待 API 健康检查（含数据库）通过后才开始监听，避免初次打开页面时代理连接被拒绝。最多等待 60 秒，失败时显示 API / MySQL 排查提示。

前端监听地址和端口取自 `APP_ORIGIN`，API 端口取自 `PORT`，代理自动跟随；例如 `APP_ORIGIN=http://localhost:5174`、`PORT=3002`。前端端口被占用时会明确退出，不自动换到与 Origin 校验不一致的端口。单独运行 web workspace 也需先启动 API。数据库、后台会话、名单和签到均真实落库；没有内存模拟模式。

`.env`、临时文件、截图与数据库备份已被 Git 忽略。示例活动明确标注为本地演示，默认不伪造签到记录。不要把开发环境的演示数据当作实际活动。

## 使用流程

1. 创建活动，填写时间、主办方、身份标识和必要字段。
2. 名单模式先保存草稿；下载模板、上传 CSV / XLSX、检查预览并确认导入。
3. 按需要设置定位规则。配置检查通过后发布活动。
4. 在工作台或记录页打开电子码展示页；参与者扫描动态活动码。
5. 参与者填写表单、按活动规则获取位置并提交；后台查看记录、补签、核验、撤销或恢复。
6. 管理员按需导出 XLSX。精确坐标和原始 IP 不进入常规导出。

手机号身份目前按中国大陆规则校验，编号身份保留前导零。自填身份和白名单均不构成实名认证。页面以服务器确认的结果为准；待核验和已撤销不计成功。

## 地图配置

设置 `.env` 的 `VITE_AMAP_KEY` 为已授权的高德 JS API Key，配置合法域名，重新启动前端。地图仅在后台选点打开时加载；参与端默认使用标准浏览器定位。当前未提供 Key，因此已验证的是加载失败提示和坐标备用路径，实际 POI 搜索、点击、拖动、围栏预览仍需凭有效授权实测。

地图账号若要求额外的安全代理配置，应按高德官方方案接入部署方代理；不要把敏感 Web Service Key 或安全密钥写入 `VITE_*`。当前没有实现该代理，不能把 JS Key 配置视为所有账号都可直接运行的保证。WGS84 / GCJ-02 转换采用固定版本 gcoord，包含工程误差预算；已知点与手机现场精度仍需实际验证。

手机真机定位需要 HTTPS 或浏览器认可的安全上下文。localhost 仅供本机预览；手机直接访问电脑 IP 的普通 HTTP，不能用于宣称定位验收通过。

## 验证命令

```sh
npm run typecheck
npm run lint
npm run format:check
DB_NAME=herenow_test npm run db:migrate
npm test
npm run build
npm run test:load
```

集成测试只使用独立 `herenow_test`，创建明确标记的临时活动并清理；包含真实唯一索引、事务回滚、并发、幂等和权限检查。压测走本机 HTTP 与 MySQL，不能替代线上资源配置或手机网络测量。

## 本机构建运行与运维

```sh
npm run build
npm start
npm run backup
npm run backup:verify
npm run cleanup
```

构建后 Fastify 同源提供 `apps/web/dist` 和 API。服务默认只监听 `127.0.0.1`，生产由可信 TLS 入口代理；生产设置 `NODE_ENV=production`、HTTPS `APP_ORIGIN`、独立密钥和数据库账号。

IP 默认取 socket，不信任任意 `X-Forwarded-For`。只有实际经过可信代理时，设置 `TRUSTED_PROXIES`（逗号分隔的受信地址 / CIDR），并让入口覆盖客户端转发头。例如本机 Nginx 可配置可信 loopback，使用 `proxy_set_header X-Forwarded-For $remote_addr`。不得任意信任全网代理。

备份使用本机 `mysqldump`，写入权限受限的 `output/backups` 并按 14 天轮转。`backup:verify` 创建随机命名的独立临时库，恢复最近备份、检查表与账号，再清理该临时库；不会覆盖业务库。发布前另需在实际生产资源上演练。

清理脚本清理过期证据、尝试、会话与导入任务，并按活动结束时间及保留天数清理活动资料。删除前写入 `.local/deletions.jsonl`；必须将该账本与备份一起保存。恢复业务备份后先恢复最新删除账本，再运行 `npm run restore:deletions` 与 `npm run cleanup`，确认删除重放完成后才开放访问。当前提供手动运行命令，正式部署仍需安排每日备份与周期清理、告警及任务互斥。

## 账号与活动授权

管理员账号由部署方创建，无公开注册。创建操作员使用部署环境变量 `NEW_USER_NAME`、`NEW_USER_PASSWORD`、`NEW_USER_ROLE=operator`、`NEW_USER_EVENTS=活动ID,活动ID` 后运行 `npm run user:create`。密码至少 12 字符；输入秘密应使用本地环境配置，避免写入 shell 历史或 Git。操作员只访问被授予的活动，默认无法导出或查看完整名单。

## 文档

- [产品与技术 Spec](spec.md)
- [开发规范](docs/development-standards.md)
- [AI 开发约定](AGENTS.md)
- [Ant Design MCP](docs/mcp-setup.md)
- [实施与验收记录](docs/implementation-status.md)
