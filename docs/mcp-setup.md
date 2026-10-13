# Ant Design MCP 接入与验证

核查日期：2026-10-13。本项目采用 [Ant Design 官方 MCP](https://ant.design/docs/react/mcp/)，通过 npm 包 `@ant-design/cli@6.6.6` 的 `mcp` 命令提供 STDIO 服务。

## 配置

项目级配置在 `.codex/config.toml`，按照 [OpenAI 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) 使用 TOML；不使用 Ant Design 通用客户端示例中的 `.codex/mcp.json` 替代 Codex 的真实配置。

```toml
[mcp_servers.antd]
command = "npx"
args = ["-y", "@ant-design/cli@6.6.6", "mcp", "--version", "6.6.6"]
enabled = true
startup_timeout_sec = 120
tool_timeout_sec = 60
```

前置条件为 Node.js ≥20、npm／npx 可执行及首次下载可访问 npm registry。`@ant-design/cli@6.6.6` 锁定服务软件版本，`--version 6.6.6` 锁定其 React Ant Design 知识版本；两者都不是应用中的 `ant-design-vue` 版本。不需要 API Key，不是业务运行时依赖，不需要向应用 package.json 加入 React。

Codex 仅在受信任项目中加载项目级配置。本机 HereNow 已被标记为 trusted，此次没有修改全局 MCP 或其他项目设置。换机器后，在 Codex 中正常打开并信任该项目即可读取配置。

在项目根目录检查：

```sh
codex mcp get antd --json
codex mcp list
```

这些命令确认配置解析，不足以证明服务能启动。完整检查还需要 MCP `initialize`、`tools/list` 和至少一次 `tools/call`。

## 本次实际验证

| 检查 | 结果 |
| --- | --- |
| npm 软件包来源与版本 | 官方仓库 `ant-design/ant-design-cli`，包版本 6.6.6 |
| CLI 配置解析 | `codex mcp get antd --json` 返回 enabled=true 和正确 STDIO 参数 |
| MCP 握手 | JSON-RPC `initialize` 成功，serverInfo 为 antd 6.6.6 |
| 工具枚举 | 8 个工具全部返回 |
| 提示词枚举 | `antd-expert`、`antd-page-generator` |
| 文档读取 | `antd_doc` 查询 Button 成功，返回 6,914 字符文本 |

本次通过独立 STDIO 客户端完成真实握手与查询，不代表当前聊天的工具列表已经热加载。当前聊天尚未出现 `antd` 工具；启动一个重新读取项目配置的会话后，检查 `/mcp`。桌面设置中的 MCP Restart 也可用于重新连接，若仍未显示则重启客户端后再检查。自动化工具无法操作本机 Codex 应用，因此没有代为点击设置或重启客户端。

## 工具范围与 Vue 使用原则

可用工具：`antd_list`、`antd_info`、`antd_doc`、`antd_demo`、`antd_token`、`antd_design_md`、`antd_semantic`、`antd_changelog`。

本项目使用 Vue 3；官方 MCP 主要面向 React Ant Design。使用设计语言、交互和 Token 值作参考时仍须映射到 Vue 库的实际能力；不把 React Token 配置、属性、DOM 或代码当作 Ant Design Vue API。

- 后台属性、事件、插槽及主题：核对 [Ant Design Vue 官方文档](https://www.antdv.com/)，与项目锁定版本一致。
- 手机表单、弹层、消息和选择器：核对 [Vant 官方文档](https://vant-ui.github.io/vant/)。
- 不复制 JSX／React Hooks，不引入 `antd`／`antd-mobile`；MCP 使用不改变 Vue 技术栈。

## 故障处理

1. 配置不存在：在项目根目录执行检查，确认项目受信任且 `.codex/config.toml` 被读取。
2. 启动失败：检查 `node --version`、`npx --version` 和 npm 网络，执行 `npx -y @ant-design/cli@6.6.6 mcp --help` 验证下载及入口。
3. 已配置但聊天无工具：重新读取会话配置／重启 MCP，使用 `/mcp` 核实连接，不能仅根据文件存在声称挂载成功。
4. 查询结果与 Vue 实现不符：查 Ant Design Vue／Vant 的对应版本文档，不能为适配 MCP 改用 React。
5. 软件或知识版本升级：先验证命令、握手、工具及文档查询，再修改固定版本并记录结果，不自动跟随 latest。
