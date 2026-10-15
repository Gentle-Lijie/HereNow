# 生产部署

日期：2026-10-15。用户指定 EdgeOne Makers 中国站 GitHub 自动部署前端，`ssh b` 运行后端；不使用 Docker。部署与完整产品验收分开记录，真机与生产负载目标仍需实测。

## 架构与域名

- 前端：`https://checkin.lijie.space`，Vue 3 + Vite，GitHub 私有仓库 `Gentle-Lijie/HereNow`，生产分支 `main`。
- 后端：`https://checkin-api.lijie.space`，服务器 `106.12.60.181`，Node 22.14.0 + Fastify，仅监听 `127.0.0.1:3018`。
- 数据库：服务器现有 MySQL 8.4.5，新建 `herenow` 库及仅允许 loopback 连接的独立账号，业务数据不与现有应用共用库。
- 浏览器请求同源 `/api/*`，Edge Function 转发到固定 HTTPS 后端，保持 Cookie、Origin、CSRF 与原始幂等请求。高德 SDK 继续使用同源 `/api/_AMapService`；没有跨源 Cookie 或 CORS 通配授权。
- 转发仅保留必要请求头；服务端 `API_PROXY_SECRET` 认证转发，客户端不能伪造密钥或 `request.eo.clientIp`。Nginx 验证密钥后覆盖 `X-Forwarded-For`；除健康检查外拒绝直接访问源站 API。后端只信任 loopback 代理。密钥缺失时转发返回 503，绝不降级放行。

## Makers 控制台填写

使用 [中国站控制台](https://console.cloud.tencent.com/edgeone/pages)，从 GitHub 导入已有仓库，仅授权 `Gentle-Lijie/HereNow`，不要选择直接上传项目。

| 项目           | 填写                                                               |
| -------------- | ------------------------------------------------------------------ |
| 项目名称       | `herenow`（名称被占用时使用控制台允许的名称）                      |
| 生产分支       | `main`                                                             |
| Git 自动部署   | 开启，生产部署由 main 的提交触发                                   |
| 框架           | Vue / Vite；若预设改动根目录，选择 Other 并使用以下自定义值        |
| 根目录         | 默认仓库根目录（留空），不能填 `apps/web` 或 `apps/web/dist`       |
| 安装命令       | `npm ci --no-audit --no-fund`                                      |
| 构建命令       | `npx --yes --package=node@22.14.0 --call "npm run build:frontend"` |
| 输出目录       | `apps/web/dist`                                                    |
| 默认构建 Node  | `22.11.0`；实际构建命令显式使用 `22.14.0`                          |
| 生产自定义域名 | `checkin.lijie.space`，开启 HTTPS                                  |

`edgeone.json` 已声明以上构建值及精确 `/*` → `/index.html` SPA fallback；Makers 优先匹配静态资源和 Functions。生产部署需要包含仓库根目录 `edge-functions`，它只执行转发。前端代码保留 `/api`，不需要配置跨域 `VITE_API_BASE_URL`。

环境变量只在生产环境填写：

| 名称               | 用途                                                      | 值的来源                                                                                     |
| ------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `API_PROXY_SECRET` | Edge Function 的服务端运行时变量，必须支持 Functions 读取 | 本机被 Git 忽略的 `.local/deployment/edgeone-runtime.env`；与服务器一致，禁止添加 VITE_ 前缀 |
| `VITE_AMAP_KEY`    | 构建时公开的高德 JS Key                                   | `.local/deployment/edgeone-build.env`                                                        |

数据库密码、签名密钥、身份摘要密钥、加密密钥、管理员密码、高德安全密钥只保存在服务器 `/etc/herenow/backend.env`，不填入 Makers。高德应用的域名白名单需要包含 `checkin.lijie.space`。预览域名未授权业务写请求：后端生产 Origin 仅允许 `https://checkin.lijie.space`，不能把预览站当作已通过生产验证的入口。

加速区域按实际备案和平台要求选择；中国站账号不等于已经配置中国大陆加速，不能声称域名已备案。

## DNS

| 主机记录      | 类型  | 记录值                                                        | TTL |
| ------------- | ----- | ------------------------------------------------------------- | --- |
| `checkin-api` | A     | `106.12.60.181`                                               | 600 |
| `checkin`     | CNAME | `checkin.lijie.space.pages.dnsoe6.com`（已通过公网 DNS 核对） | 600 |

记录使用 DNS-only，不套其他代理。添加前端域名时如控制台返回 TXT / 其他验证记录，按实际完整名称与值创建。后端使用服务器现有 `*.lijie.space` 通配证书，证书由现有管理流程续期；本项目不覆盖证书或修改其他站点。

## 服务与运维

后端源码直接克隆到 `ssh b` 的家目录 `/root/HereNow`，在仓库根目录通过 `ecosystem.config.cjs` 由现有 root PM2 管理 `herenow-api`。API 的 cwd 为 `/root/HereNow`，单进程监听 `127.0.0.1:3018`；PM2 通过已启用的 `pm2-root.service` 开机恢复。旧 `herenow-api.service` 停止并禁用，避免重复监听。旧 `/srv/herenow/releases` 保留供回滚，不再作为当前 API 的工作目录。

`.env` 链接到 `/etc/herenow/backend.env`，生产秘密不进入 Git、PM2 ecosystem 或命令行。`output` 和 `.local` 分别链接到 `/srv/herenow/shared/output`、`/srv/herenow/shared/local`，继续使用既有备份和删除账本。API 和运维任务沿用 root PM2 的运行账号；不再具有原独立 herenow 用户 API 的 systemd 沙箱隔离。备份／清理仍由已有 systemd timers 触发，服务模板改为 root 账号和新仓库 cwd，`ProtectHome=read-only` 允许读取代码，写入仍限定共享目录。

首次安装（生产配置、MySQL、Nginx、共享目录已准备）：

```sh
ssh b
cd ~
git clone git@github.com:Gentle-Lijie/HereNow.git
cd ~/HereNow
ln -s /etc/herenow/backend.env .env
ln -s /srv/herenow/shared/output output
ln -s /srv/herenow/shared/local .local
npm ci --no-audit --no-fund
npm run build -w @herenow/api
# 切换前备份；仅在有新迁移时执行 db:migrate。
PATH=/www/server/mysql/bin:$PATH npm run backup
systemctl disable --now herenow-api.service
umask 077
pm2 start ecosystem.config.cjs --only herenow-api
pm2 save
# 新机器需用 pm2 startup 按输出配置开机恢复；本服务器已启用 pm2-root。
install -m 644 deploy/herenow-backup.service deploy/herenow-cleanup.service /etc/systemd/system/
systemctl daemon-reload
```

日常查看与重启：

```sh
ssh b 'cd ~/HereNow && pm2 status herenow-api'
ssh b 'cd ~/HereNow && pm2 restart ecosystem.config.cjs --only herenow-api'
ssh b 'systemctl start herenow-backup.service'
ssh b 'systemctl start herenow-cleanup.service'
ssh b 'systemctl list-timers herenow-backup.timer herenow-cleanup.timer'
curl --fail https://checkin-api.lijie.space/api/health
```

备份每日北京时间约 03:00，SQL 权限 600，按现有脚本保留 14 天并复制删除账本；清理每小时执行并通过 flock 防止重入。备份与清理是独立 oneshot 服务，失败在 systemd 可见；外部告警渠道及异地备份尚未接入。只允许项目数据库和隔离恢复库，不使用数据库 root 运行 API。

恢复演练使用独立 `herenow_restore_test_*` 数据库，完成后删除。真实恢复业务库后必须先恢复最新删除账本，再重放删除、运行清理，通过检查后才开放入口。

首次创建生产管理员仅调用 `ensureAdmin`，没有运行示例活动 seed。初始登录资料只存本机 `.local/deployment/admin-login.txt`。更新密码按 README 的显式重置流程操作；改变配置不会自动覆盖现有账号密码。

后端发布通过 SSH，前端 GitHub 自动部署不自动替换后端。在 `/root/HereNow` 执行 `git pull --ff-only`、`npm ci --no-audit --no-fund`、`npm run build -w @herenow/api`，先备份，再按需要执行版本化迁移，然后 `pm2 restart ecosystem.config.cjs --only herenow-api` 并检查健康状态、`pm2 save`。本次原因选填不涉及数据库变更，不执行迁移。不能通过回退代码自动撤销已执行的数据库迁移。

切换失败时先 `pm2 stop herenow-api`，再 `systemctl enable --now herenow-api.service` 恢复旧 API；必要时恢复预先保存的备份／清理 unit 并 daemon-reload。确认旧 API 健康后更新 PM2 保存列表，避免重启时双启动。

## 验证状态

2026-10-14 线上转发修复：实际 HTTPS 探针确认原 POST 的字节数保持，但内容被错误复制为全零，导致 JSON 登录请求返回 INVALID_REQUEST 400。EdgeOne reader 的 chunk 支持 ArrayBuffer，与 Node 的 Uint8Array 返回值不同；转发先在运行时规范化 ArrayBuffer / ArrayBufferView，再按原始字节复制，明确使用 ArrayBuffer 与准确 Content-Length 发送。增加真实平台 chunk 形态的回归测试，保留 6 MB 上限和幂等原请求；Git 自动部署后，实际生产前端域名的 context、正确密码登录、退出均返回 200；过长密码返回明确 INVALID_FORM 长度错误。类型、lint、构建、格式检查和 69 项测试通过。诊断只使用无凭证测试内容，临时诊断路由完成后已移除。

- 本地类型检查、lint、格式检查、69 项测试通过；包含固定目标转发、Cookie / CSRF / 幂等传递、IP 伪造头剥离与密钥缺失拒绝，以及超过 1 MB 的名单请求按原始字节转发、超过 6 MB 的上传拒绝。EdgeOne 请求便捷读取方法有 1 MB 限制，转发使用有上限的 ReadableStream 读取。
- 已用锁定 Node 22.14.0 执行实际 Makers 前端构建命令，产物根目录有 index.html，后端 TypeScript 编译通过。
- 后端版本化迁移、生产管理员初始化、systemd API 与定时任务启用完成；HTTPS 健康接口返回 OK，直接访问源站业务 API 与外部 OPTIONS 返回 403。以实际转发代码连接 HTTPS 源站，验证 Cookie 安全标记、生产管理员登录、鉴权请求、Origin 拒绝和退出通过，没有创建演示活动。
- MySQL 8.4.5 的独立 herenow_test 上，65 项测试以业务账号通过；故障注入测试因开启 binlog 而要求管理员创建触发器，单独以测试管理员执行并通过，没有提升生产业务账号的全局权限或改变 MySQL 全局配置。临时测试库和触发器已经清理。新增的两项上传转发测试不依赖数据库。
- 实际备份与清理 oneshot 均成功；备份恢复到隔离随机库，验证 17 张表、1 个管理员后删除临时库。参与入口与静态依赖 JS gzip 约 110 KB，通过 250 KB 构建预算，不能替代手机网络和生产负载实测。
- Makers Git 导入、自定义域名和运行时环境变量已由用户在后台配置。实际项目 makers-wlj9fuksayis；生产地址 https://checkin.lijie.space，Git 自动部署修复已在线生效。通过 HTTP 验证首页、/login、/admin/events/new、/s/deployment-route-probe 返回 SPA；入口 JS / CSS 返回正确内容类型；同源 API 健康、context、登录和退出通过。按用户要求未使用 browser use；线上界面点击、真机扫码、动态码与完整签到浏览器链路仍需实际验收。
- 手机真机扫码 / 定位、生产混合负载、现场围栏、域名下高德授权、外部告警与异地备份仍待验证。
