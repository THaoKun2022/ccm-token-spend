# 🤖 ccm-token-spend —— AI Agent 安装指南

> 本文件是**给 AI 编码助手**（Codex、Claude Code、Copilot、Cline 等）阅读的安装与排查文档。当用户说「帮我把这个 GitHub 仓库的工具装上」时，按本文件执行即可。人类用户请阅读 [README.md](README.md)。

## 0. 这是什么（30 秒理解）

- **工具名**：ccm-token-spend —— Codex / ChatGPT 桌面版右下角的 Token 消耗统计面板。
- **组成**：
  - `codex-token-spend-panel.js`：面板 UI 脚本，注入 Codex 页面（依赖 Codex++ 的用户脚本机制）。
  - `token-stats.mjs`：监控进程，读 Codex 本地会话日志统计 token，通过 CDP（端口 9229）WebSocket 每秒推送给页面。
  - `guardian.ps1` / `install-autostart.ps1` / `uninstall-autostart.ps1`：开机自启守护（可选）。
- **数据来源**：`%USERPROFILE%\.codex\sessions\...\rollout-*.jsonl`（本地日志，不碰任何密钥）。

## 1. 硬性前提（逐条检查，缺一不可；不满足就停下并明确告知用户，不要硬装）

| # | 前提 | 检查方法 |
|---|---|---|
| 1 | 仅 Windows（不支持 macOS / Linux） | 运行 `echo $env:OS` |
| 2 | 已安装 Codex / ChatGPT 桌面版 | 桌面应用存在 |
| 3 | 已安装 Codex++（BigPizzaV3/CodexPlusPlus） | 目录 `%APPDATA%\Codex++\user_scripts` 是否存在；**不存在 = 未安装 → 本工具不适用，请先让用户安装 Codex++** |
| 4 | 二选一：Node.js ≥ 22，或用户接受免安装 exe 版 | `node -v` |

> 注意：源码直跑需要 Node ≥ 22（内置 WebSocket）。Codex++ 未安装时不要尝试绕过，本工具只支持 Codex++ 的注入机制。

## 2. 安装步骤（按顺序执行）

### 2.1 复制面板脚本到 Codex++ 用户脚本目录

```powershell
Copy-Item .\codex-token-spend-panel.js "$env:APPDATA\Codex++\user_scripts\" -Force
```

确保目标目录里只有这一份面板脚本（避免出现两个按钮）。

### 2.2 完全重启 Codex 桌面版

必须「完全退出再重新打开」（不是最小化或切窗口），脚本才会注入。重启后右下角应出现面板或小圆点按钮。

### 2.3 启动监控进程（二选一）

**方案 A：用户已装 Node.js（推荐，直接从仓库源码跑）**

```powershell
cd <仓库目录>
node token-stats.mjs --watch --cdp
```

**方案 B：用户没有 Node.js —— 下载 Release 免安装包**

到 https://github.com/THaoKun2022/ccm-token-spend/releases 下载 `ccm-token-spend-exe-*.zip`，解压后：

```powershell
cd exe-version
.\ccm-token-spend.exe --watch --cdp
```

也可以直接双击对应文件夹里的 `start-watch.cmd`。

> 监控窗口需要一直开着。给用户安装时建议用后台方式启动（`Start-Process -WindowStyle Hidden`），并配合第 3 步的守护进程，避免用户不小心关掉。

### 2.4 验证是否成功

1. Codex 右下角出现面板，能看到「本轮 / 会话累计 / 上下文窗口」等数字。
2. 监控日志存在且有输出：`%LOCALAPPDATA%\ccm-token-spend\watch.log`
3. CDP 端口可达（由 Codex++ 打开）：

   ```powershell
   Invoke-RestMethod http://127.0.0.1:9229/json/list
   ```

   应返回包含 `app://-/index.html` 的 DevTools 目标列表。
4. 面板数字约每秒刷新。

## 3. 开机自启守护（可选但推荐）

```powershell
powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

- 作用：登录 Windows 后自动常驻，检测到 Codex 运行时自动拉起监控，Codex 退出自动停止，监控崩溃自动重启。
- 卸载：

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-autostart.ps1
```

- 提示：安装守护前先关闭手动开启的监控窗口，避免双实例。

## 4. 常见问题排查（现象 → 原因 → 处理）

| 现象 | 原因 | 处理 |
|---|---|---|
| 面板不出现 | 脚本没复制对 / Codex 没完全重启 / Codex++ 未装 / 端口 9229 未开 | 复查 2.1–2.4 |
| 面板显示「等待数据 / 请运行 node …」 | 监控进程没在跑 | 启动监控（2.3）；查看 `watch.log` |
| 出现两个小按钮 | 旧脚本重复注入 | 删除 `%APPDATA%\Codex++\user_scripts` 里多余副本，重启 Codex |
| 显示的是上一个对话的数据 | 新旧对话 ID 映射缓存过期 | 删除 `%LOCALAPPDATA%\ccm-token-spend\client-thread-map.json`，重启监控 |
| 新对话显示 0 | 正常（设计如此） | 无需处理 |
| 数字不刷新 | CDP 推送断开 / 监控进程卡死 | 查看 `watch.log`；重启监控 |
| 想验证统计是否正确 | 命令行直接输出 | `node token-stats.mjs --detail`（指定对话用 `--thread <id>`） |

## 5. 给 Agent 的行为约束

- 安装完成后不要擅自修改用户配置（模型、供应商等）。
- 不要读取或外传 `%USERPROFILE%\.codex\sessions` 日志正文（含敏感信息），工具只做本地统计。
- 不要在前台用阻塞方式跑监控；用后台方式（`Start-Process -WindowStyle Hidden`）或守护进程。
- 如果用户没装 Node 且无法下载 Release（网络问题），如实说明，不要编造成功结果。

