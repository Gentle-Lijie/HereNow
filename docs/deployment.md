# 生产部署

日期：2026-10-14。用户指定 EdgeOne Makers 中国站 GitHub 自动部署前端，`ssh b` 运行后端；不使用 Docker。部署与完整产品验收分开记录，真机与生产负载目标仍需实测。

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

当前发布目录 `/srv/herenow/releases/20261014-initial`，稳定入口 `/srv/herenow/current`。`output` 和 `.local` 指向 `/srv/herenow/shared`，升级时保留备份与删除账本。后端以独立 `herenow` 用户运行，代码只读，配置 root 管理，只有共享运维目录可写。

```sh
ssh b 'systemctl status herenow-api --no-pager'
ssh b 'systemctl restart herenow-api'
ssh b 'systemctl start herenow-backup.service'
ssh b 'systemctl start herenow-cleanup.service'
ssh b 'systemctl list-timers herenow-backup.timer herenow-cleanup.timer'
curl --fail https://checkin-api.lijie.space/api/health
```

备份每日北京时间约 03:00，SQL 权限 600，按现有脚本保留 14 天并复制删除账本；清理每小时执行并通过 flock 防止重入。备份与清理是独立 oneshot 服务，失败在 systemd 可见；外部告警渠道及异地备份尚未接入。只允许项目数据库和隔离恢复库，不使用数据库 root 运行 API。

恢复演练使用独立 `herenow_restore_test_*` 数据库，完成后删除。真实恢复业务库后必须先恢复最新删除账本，再重放删除、运行清理，通过检查后才开放入口。

首次创建生产管理员仅调用 `ensureAdmin`，没有运行示例活动 seed。初始登录资料只存本机 `.local/deployment/admin-login.txt`。更新密码按 README 的显式重置流程操作；改变配置不会自动覆盖现有账号密码。

后端发布目前通过 SSH，前端 GitHub 自动部署不自动替换后端。后续后端发布需上传新的源码发布目录、安装锁定依赖、编译 API、先备份再执行版本化迁移、切换 current 并重启。不能通过回退代码自动撤销已执行的数据库迁移。

## 验证状态

2026-10-14 线上转发修复：实际 HTTPS 探针确认原 POST 的字节数保持，但内容被错误复制为全零，导致 JSON 登录请求返回 INVALID_REQUEST 400。EdgeOne reader 的 chunk 支持 ArrayBuffer，与 Node 的 Uint8Array 返回值不同；转发先在运行时规范化 ArrayBuffer / ArrayBufferView，再按原始字节复制，明确使用 ArrayBuffer 与准确 Content-Length 发送。增加真实平台 chunk 形态的回归测试，保留 6 MB 上限和幂等原请求；Git 自动部署后，实际生产前端域名的 context、正确密码登录、退出均返回 200；过长密码返回明确 INVALID_FORM 长度错误。类型、lint、构建、格式检查和 69 项测试通过。诊断只使用无凭证测试内容，临时诊断路由完成后已移除。

- 本地类型检查、lint、格式检查、69 项测试通过；包含固定目标转发、Cookie / CSRF / 幂等传递、IP 伪造头剥离与密钥缺失拒绝，以及超过 1 MB 的名单请求按原始字节转发、超过 6 MB 的上传拒绝。EdgeOne 请求便捷读取方法有 1 MB 限制，转发使用有上限的 ReadableStream 读取。
- 已用锁定 Node 22.14.0 执行实际 Makers 前端构建命令，产物根目录有 index.html，后端 TypeScript 编译通过。
- 后端版本化迁移、生产管理员初始化、systemd API 与定时任务启用完成；HTTPS 健康接口返回 OK，直接访问源站业务 API 与外部 OPTIONS 返回 403。以实际转发代码连接 HTTPS 源站，验证 Cookie 安全标记、生产管理员登录、鉴权请求、Origin 拒绝和退出通过，没有创建演示活动。
- MySQL 8.4.5 的独立 herenow_test 上，65 项测试以业务账号通过；故障注入测试因开启 binlog 而要求管理员创建触发器，单独以测试管理员执行并通过，没有提升生产业务账号的全局权限或改变 MySQL 全局配置。临时测试库和触发器已经清理。新增的两项上传转发测试不依赖数据库。
- 实际备份与清理 oneshot 均成功；备份恢复到隔离随机库，验证 17 张表、1 个管理员后删除临时库。参与入口与静态依赖 JS gzip 约 110 KB，通过 250 KB 构建预算，不能替代手机网络和生产负载实测。
- Makers Git 导入、自定义域名和运行时环境变量已由用户在后台配置。实际项目 makers-wlj9fuksayis；生产地址 https://checkin.lijie.space，Git 自动部署修复已在线生效。通过 HTTP 验证首页、/login、/admin/events/new、/s/deployment-route-probe 返回 SPA；入口 JS / CSS 返回正确内容类型；同源 API 健康、context、登录和退出通过。按用户要求未使用 browser use；线上界面点击、真机扫码、动态码与完整签到浏览器链路仍需实际验收。
- 手机真机扫码 / 定位、生产混合负载、现场围栏、域名下高德授权、外部告警与异地备份仍待验证。
