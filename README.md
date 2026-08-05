# ccm-token-spend —— Codex 桌面版 Token 消耗统计面板

[English](README.en.md) | [简体中文](README.md)

在 Codex / ChatGPT **桌面版**界面右下角显示「每个对话 / 每轮对话」的 token 消耗量：本轮消耗、会话累计、请求次数、上下文窗口（已用/总量）、输入缓存命中拆分、最近轮次列表，数据约 **1 秒**实时刷新。

![面板展开](panel-preview.png)

![收起为小按钮](mini-preview.png)

## 支持环境

- **操作系统：仅 Windows**（开发与测试基于 Windows 10 22H2；macOS / Linux 未支持，开机自启守护为 Windows 专属）。
- **客户端：Codex / ChatGPT 桌面版**（不支持 codex CLI）。
- **必须安装 Codex++**（负责注入面板脚本并开放调试端口 9229）。
- **Node.js ≥ 18**（使用 node-version），或**无需 Node**（使用 exe-version）。

## ⚠️ 使用前提（请先按顺序确认）

1. **仅支持 Codex / ChatGPT 桌面版，不支持 codex CLI。**
2. **必须安装 Codex++**（负责把面板脚本注入页面，并通过调试端口 9229 推送数据）。没装 Codex++ 的话，本工具不适用。
3. **监控程序二选一：**
   - 电脑上**已安装 Node.js（≥ 18）** → 使用 `node-version`（脚本方式，体积小）；
   - 电脑上**没有 Node.js** → 使用 `exe-version`（免安装、免环境，体积约 55MB）。

```
判断流程：
Codex 桌面版？ ──否──> 不支持（CLI 用户请勿继续）
   │是
已装 Codex++？ ──否──> 先安装 Codex++，否则不支持
   │是
已装 Node.js？ ──是──> 用 node-version
   │否
用 exe-version
```

## 文件说明

- `codex-token-spend-panel.js` — 面板脚本（两个版本通用，复制到 Codex++ 用户脚本目录）
- `node-version\token-stats.mjs` — Node 版监控程序
- `exe-version\ccm-token-spend.exe` — 免安装 exe 版监控程序
- `guardian.ps1` / `install-autostart.ps1` / `uninstall-autostart.ps1` — 开机自启守护脚本（Windows 专属）

## 安装（两个版本通用，只需做一次）

1. 把 `codex-token-spend-panel.js` 复制到 Codex++ 的用户脚本目录：

   ```powershell
   Copy-Item .\codex-token-spend-panel.js "$env:APPDATA\Codex++\user_scripts\" -Force
   ```

2. **完全退出并重启 Codex 桌面版**，让脚本注入页面（右下角应出现面板）。

## 运行监控（每次想用时执行）

- **Node 版：**
  ```powershell
  cd node-version
  node token-stats.mjs --watch --cdp
  ```
- **exe 版：**
  ```powershell
  cd exe-version
  ccm-token-spend.exe --watch --cdp
  ```
- 也可以直接**双击**对应文件夹里的 `start-watch.cmd`。

保持这个窗口运行即可。

## 面板说明

- 顶部汇总区（标题、本轮、会话累计、请求次数、上下文窗口）与底部「更新于」栏**常驻显示**，只有中间的「轮次明细」区域滚动。
- 面板高度按内容自适应：汇总区换行变高时自动增高，且始终不超出 Codex 窗口；拖拽缩放松手后自动恢复到内容所需高度。
- 标题栏可拖动，四个角均可拖拽调整大小；面板与小按钮的位置、大小分别记忆。
- 面板右上角 `×` 可收起为小按钮，点小按钮恢复。
- 会话历史标题列会随面板宽度自动拉伸。

## 开机自启（可选）：Codex 启动时自动运行监控

如果不想每次手动启动监控，可以安装守护进程：登录 Windows 后自动常驻，检测到 Codex 运行时自动启动监控，Codex 退出后自动停止，监控进程崩溃也会自动重启。

1. 在 PowerShell 中进入本工具目录，运行：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1
   ```

2. 安装后立即生效（无需重启 Codex）。卸载时运行：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\uninstall-autostart.ps1
   ```

> 提示：如果之前有手动打开的监控窗口，先关闭它再安装，避免双实例。

## 数据说明

- 只读取 Codex 自己的本地会话日志（`%USERPROFILE%\.codex\sessions\...\rollout-*.jsonl`），**不涉及任何密钥**，面板只显示数字摘要。
- 「会话累计」= 该对话所有请求的 billed token 之和（含每轮重复发送的上下文）。
- 「上下文窗口（已用/总量）」= 已用为当前对话最新一次请求的上下文占用，总量为模型上下文窗口大小。
- 「每轮」= 一次用户消息到下一次用户消息之间发生的所有请求。
- 输入缓存拆分：`输入 X（缓存命中 Y，未命中 Z）`，其中未命中 = 输入 − 缓存命中；旧日志没有缓存字段时自动显示为 `输入 X + 输出 W`。
- 新对话（尚无数据）显示 0，而不是「暂无数据」；切到空白新对话时不会显示上一个对话的数据。
- Codex 刚启动、界面尚未加载完成时显示 0，加载完成后自动显示当前对话的数据（不回退显示上一个对话）。

## 开发者：命令行直接查看（无需面板）

```powershell
node token-stats.mjs                  # 最近一个对话
node token-stats.mjs --thread <id>    # 指定对话
node token-stats.mjs --detail         # 附带每次请求明细
node token-stats.mjs --all            # 所有对话的累计消耗
```

## 开发者：重新打包 exe（可选）

```powershell
cd build
npm install          # 首次需要：安装 @yao-pkg/pkg
.\node_modules\.bin\pkg ..\token-stats.mjs --target node22-win-x64 --output ..\release\exe-version\ccm-token-spend.exe
```

## 测试环境

- Windows 10 22H2（build 19045）
- Codex 桌面版 26.727.6591.0
- Codex++ 1.2.44
- Node.js v24.14.1
- 目前接入的是**第三方 API**，测试时固定单一模型；**未测试切换模型**（同一对话中更换模型）的效果。
- 已实测：命令行统计输出、面板渲染（轮次全量、会话累计缓存拆分、上下文窗口已用/总量）、四角缩放、面板与小按钮位置记忆、顶部汇总区与底部「更新于」栏常驻（窄宽度自动增高且不超出窗口）、会话历史标题列随宽度拉伸、空白新对话显示 0、守护进程（Codex 启动自动拉起监控、退出自动停止、监控崩溃自动重启）。
- macOS / Linux 未测试。
## 致谢

内置的「当前对话 ID」检测逻辑参考了开源项目 [codex-context-used-meter](https://github.com/Minghou-Lei/codex-context-used-meter)（MIT License），已完全自研集成，不依赖任何外部脚本、无需额外安装。
