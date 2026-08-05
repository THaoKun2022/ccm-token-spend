# ccm-token-spend —— Codex 桌面版 Token 消耗统计面板

在 Codex / ChatGPT **桌面版**界面右下角显示「每个对话 / 每轮对话」的 token 消耗量：本轮消耗、会话累计、请求次数、上下文窗口、输入缓存命中拆分、最近轮次列表，数据约 **1 秒**实时刷新。

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

保持这个窗口运行即可。面板右上角 `×` 可收起为小按钮，点小按钮恢复；标题栏可拖动，右下角可拖拽调整大小。

## 数据说明

- 只读取 Codex 自己的本地会话日志（`%USERPROFILE%\.codex\sessions\...\rollout-*.jsonl`），**不涉及任何密钥**，面板只显示数字摘要。
- 「会话累计」= 该对话所有请求的 billed token 之和（含每轮重复发送的上下文）。
- 「每轮」= 一次用户消息到下一次用户消息之间发生的所有请求。
- 输入缓存拆分：`输入 X（缓存命中 Y，未命中 Z）`，其中未命中 = 输入 − 缓存命中；旧日志没有缓存字段时自动显示为 `输入 X + 输出 W`。
- 新对话（尚无数据）显示 0，而不是「暂无数据」。

## 开发者：命令行直接查看（无需面板）

```powershell
node token-stats.mjs                  # 最近一个对话
node token-stats.mjs --thread <id>    # 指定对话
node token-stats.mjs --detail         # 附带每次请求明细
node token-stats.mjs --all            # 所有对话的累计消耗
```

## 致谢

面板的「当前对话 ID」来自开源项目 [codex-context-used-meter](https://github.com/Minghou-Lei/codex-context-used-meter)（MIT License）注入的 `__codexContextMeter`。未安装该脚本时自动降级为按最新会话文件判断。