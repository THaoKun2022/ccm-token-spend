# AGENTS.md

## 项目定位

- 工具：Codex / ChatGPT 桌面版 Token 消耗统计面板（项目名 ccm-token-spend）。
- 仅针对 Codex / ChatGPT 桌面版，不针对 codex cli。
- 依赖 Codex++：面板脚本必须放到 `%APPDATA%\Codex++\user_scripts` 才会生效；未安装 Codex++ 时工具不支持。
- 已内置「当前对话 ID」检测逻辑（从页面 DOM / React fiber 读取当前对话），完全自研，无需任何外部脚本。

## 目录结构

- `codex-token-spend-panel.js`：面板 UI 脚本，注入 Codex 页面（基于 Codex++ 用户脚本机制）。
- `token-stats.mjs`：核心监控，读 Codex 会话日志统计 token，通过 CDP（127.0.0.1:9229）WebSocket 向页面推送数据。
- `guardian.ps1`：守护进程，负责拉起/重启监控进程。
- `install-autostart.ps1` / `uninstall-autostart.ps1`：开机自启安装/卸载。
- `README.md`：说明文档（含测试环境与支持环境说明）。
- `release\`：发布目录，含 `exe-version`（打包 exe）、`node-version`（node 运行）、面板脚本、预览图、README。
- `build\`：打包构建目录（内含 node_modules 与 pkg）。

## 工作原理

- 监控进程读 Codex 本地会话日志，统计当前对话的 token 消耗（输入含缓存命中/未命中、输出、请求数、会话累计、每轮明细等）。
- 通过 CDP WebSocket 每秒向页面推送数据：`window.__ccmTokenSpend` = { threadId, modelContextWindow, contextUsed, requestCount, sessionTotal, sessionInput, sessionCached, sessionOutput, turns[], updatedAt }，并触发事件 `ccm-token-spend`。
- 面板收到数据只做数字原地更新（不整体重渲染）；尺寸/位置恢复只由「展开、窗口变化、松手」等事件管理，避免重置滚动位置。
- 新对话的占位 ID（`local:client-new-thread:<uuid>`）到真实 UUID 的映射会持久化到 `%LOCALAPPDATA%\ccm-token-spend\client-thread-map.json`。
- 监控日志：`%LOCALAPPDATA%\ccm-token-spend\watch.log`。Codex 重启后若面板卡「等待数据」，先查该日志与进程是否存活。

## 修改约定（重要）

- 编辑 JS / 含中文文件时，必须使用 Node `fs.writeFileSync`（UTF-8）写入，不要用 PowerShell 直写，否则中文编码会坏。
- 修改后保持源码与 `release\` 目录、以及 `%APPDATA%\Codex++\user_scripts` 下的生效脚本同步。
- 写 `%APPDATA%\Codex++\user_scripts`、重启监控进程等操作需要提升权限。
- 用户偏好：
  - 全程使用中文沟通。
  - 改完不主动重新打包 exe；用户说需要打包时才打包。
  - 重大改动先记录下来再动手改。
  - 不主动 git commit / push，除非用户明确要求。
- 提交/发布前检查是否包含隐私或本机敏感信息（真实用户目录、Token、密钥、邮箱、私网地址、带凭据的 URL 等）。

## 面板既有设计（改动前先确认是否要保留）

- 上下文窗口展示为「上下文窗口 xxx/yyy」，xxx 为已用、yyy 为总大小。
- 汇总区、底部「更新于…」栏常驻显示；只有轮次明细区域滚动。
- 「本轮」列避免换行（nowrap + flex-shrink:0）。
- 按钮位置记忆（收起回到原位置，展开记住窗口上次位置）；面板四角均可拖动调整大小；窗口不超出 Codex 窗口边界（拖动与展开都要检测）。
- 启动加载期读不到对话 ID 时显示 0（不回退到上一条对话的数据）。
- 会话累计也按「本轮」方式分输入（缓存命中/未命中）展示；总量对不上属已知，在 README 说明即可。

## 运行 / 测试 / 打包

- 环境：Node v24.x；脚本用 `.mjs` 结尾避免 require/await 冲突。
- `token-stats.mjs` 支持 `CCM_TOKENS_AS_MODULE=1` 导入做单元测试，导出 `clientState`、`findNewestClientFileSince`、`findNewestUnclaimedFile` 等。
- CDP 目标：`http://127.0.0.1:9229/json/list`。
- 打包 exe（在 `build\` 下执行）：
  `.`node_modules\.bin\pkg ..	oken-stats.mjs --target node22-win-x64 --output ..eleaseexe-versionccm-token-spend.exe`
- 测试环境说明（已写入 README）：接入第三方 API、固定单模型下测试；未测试切换模型的效果。
