#!/usr/bin/env node
// ccm-token-spend / token-stats.mjs
//
// Reads Codex session rollout files (~/.codex/sessions/**/rollout-*.jsonl) and
// reports per-request / per-turn / per-conversation token consumption.
//
// Usage:
//   node token-stats.mjs                    stats for the most recent conversation
//   node token-stats.mjs --thread <id>      stats for a specific conversation
//   node token-stats.mjs --all              per-conversation totals across all sessions
//   node token-stats.mjs --detail           include per-request rows in the printed table
//   node token-stats.mjs --watch [--cdp]    watch the active conversation (push to page with --cdp)
//   node token-stats.mjs --cdp              one-shot push of a sanitized summary into the Codex page
//   node token-stats.mjs --port <port>      CDP port override (default 9229)
//
// The tool only reads Codex's own session logs and never prints secrets.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SESSIONS_DIR = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions");
const ROLLOUT_RE = /^rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-(.+)\.jsonl$/;

function findRolloutFiles() {
  const out = [];
  if (!fs.existsSync(SESSIONS_DIR)) return out;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) out.push(full);
    }
  };
  walk(SESSIONS_DIR);
  return out;
}

function threadIdOf(file) {
  const m = path.basename(file).match(ROLLOUT_RE);
  return m ? m[2] : null;
}

function fileDate(file) {
  const m = path.basename(file).match(ROLLOUT_RE);
  return m ? m[1] : null;
}

function parseFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const counts = [];
  const userMessages = [];
  let modelContextWindow = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type !== "event_msg" || !o.payload) continue;
    const p = o.payload;
    if (p.type === "token_count" && p.info) {
      const info = p.info;
      const last = info.last_token_usage || {};
      counts.push({
        ts: o.timestamp || "",
        total: info.total_token_usage && Number.isFinite(info.total_token_usage.total_tokens)
          ? info.total_token_usage.total_tokens
          : null,
        input: Number.isFinite(last.input_tokens) ? last.input_tokens : null,
        output: Number.isFinite(last.output_tokens) ? last.output_tokens : null,
        cached: Number.isFinite(last.cached_input_tokens) ? last.cached_input_tokens : 0,
        lastTotal: Number.isFinite(last.total_tokens) ? last.total_tokens : null,
        totalInfo: {
          input: info.total_token_usage && Number.isFinite(info.total_token_usage.input_tokens) ? info.total_token_usage.input_tokens : null,
          cached: info.total_token_usage && Number.isFinite(info.total_token_usage.cached_input_tokens) ? info.total_token_usage.cached_input_tokens : 0,
          output: info.total_token_usage && Number.isFinite(info.total_token_usage.output_tokens) ? info.total_token_usage.output_tokens : null,
        },
      });
      if (Number.isFinite(info.model_context_window)) modelContextWindow = info.model_context_window;
    } else if (p.type === "user_message") {
      let snippet = "";
      try {
        const raw = p.message && (p.message.text ?? p.message);
        snippet = (Array.isArray(raw) ? raw.join(" ") : typeof raw === "string" ? raw : "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60);
      } catch {}
      userMessages.push({ ts: o.timestamp || "", snippet });
    }
  }
  if (!counts.length && !userMessages.length) return null;
  return { file, threadId: threadIdOf(file), date: fileDate(file), counts, userMessages, modelContextWindow };
}

function buildStats(parsed) {
  const counts = [...parsed.counts].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const starts = [...parsed.userMessages].sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const turns = [];
  const turnIndexFor = (ts) => {
    let idx = -1;
    for (let i = 0; i < starts.length; i += 1) {
      if (starts[i].ts <= ts) idx = i;
      else break;
    }
    return Math.max(idx, 0);
  };
  for (const c of counts) {
    const idx = turnIndexFor(c.ts);
    while (turns.length <= idx) {
      const s = starts[turns.length] || { ts: "", snippet: "" };
      turns.push({ start: s.ts, startLabel: labelOf(s.ts), snippet: s.snippet, requests: [], input: 0, output: 0, cached: 0, total: 0 });
    }
    const t = turns[idx];
    t.requests.push(c);
    if (c.input != null) t.input += c.input;
    if (c.output != null) t.output += c.output;
    if (c.cached != null) t.cached += c.cached;
    if (c.lastTotal != null) t.total += c.lastTotal;
  }
  const lastCount = counts[counts.length - 1];
  const lastTotalInfo = lastCount && lastCount.totalInfo;
  return {
    threadId: parsed.threadId,
    file: parsed.file,
    date: parsed.date,
    modelContextWindow: parsed.modelContextWindow,
    requestCount: counts.length,
    sessionTotal: lastCount && lastCount.total != null ? lastCount.total : null,
    sessionInput: lastTotalInfo && lastTotalInfo.input != null ? lastTotalInfo.input : null,
    sessionCached: lastTotalInfo && lastTotalInfo.cached != null ? lastTotalInfo.cached : null,
    sessionOutput: lastTotalInfo && lastTotalInfo.output != null ? lastTotalInfo.output : null,
    contextUsed:
      lastCount && lastCount.lastTotal != null
        ? parsed.modelContextWindow != null
          ? Math.min(lastCount.lastTotal, parsed.modelContextWindow)
          : lastCount.lastTotal
        : null,
    turns: turns.map((t) => ({
      start: t.start,
      startLabel: t.startLabel,
      snippet: t.snippet,
      requests: t.requests,
      input: t.input,
      output: t.output,
      cached: t.cached,
      total: t.total,
    })),
  };
}

function labelOf(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(11, 16);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function fmtInt(n) {
  if (n == null || !Number.isFinite(n)) return "--";
  return n.toLocaleString("en-US");
}

function fmtShort(n) {
  if (n == null || !Number.isFinite(n)) return "--";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(Math.round(n));
}

function printStats(stats, { detail = false } = {}) {
  console.log("会话: " + (stats.threadId || "?"));
  console.log("文件: " + stats.file);
  if (stats.modelContextWindow) console.log("上下文窗口: " + fmtInt(stats.modelContextWindow) + " tokens");
  console.log("请求次数: " + fmtInt(stats.requestCount));
  const sCached = stats.sessionCached != null ? stats.sessionCached : null;
  console.log(
    "会话累计消耗: " + fmtInt(stats.sessionTotal) + " tokens (" + fmtShort(stats.sessionTotal) + ")" +
      (stats.sessionInput != null
        ? "  输入 " + fmtShort(stats.sessionInput) +
          (sCached != null ? "（缓存命中 " + fmtShort(sCached) + "，未命中 " + fmtShort(Math.max(0, stats.sessionInput - sCached)) + "）" : "") +
          " + 输出 " + fmtShort(stats.sessionOutput)
        : ""),
  );
  console.log("");
  console.log("每轮对话消耗:");
  let i = 1;
  for (const t of stats.turns) {
    console.log(
      `  T${i}  ${t.startLabel || "??:??"}  ${fmtShort(t.total)} tokens (输入 ${fmtShort(t.input)} + 输出 ${fmtShort(t.output)}), ${t.requests.length} 次请求${t.snippet ? "  「" + t.snippet + "」" : ""}`,
    );
    if (detail) {
      t.requests.forEach((r, j) => {
        console.log(`      #${j + 1} ${(r.ts || "").slice(11, 19)}  in ${fmtShort(r.input)}  out ${fmtShort(r.output)}  total ${fmtShort(r.lastTotal)}`);
      });
    }
    i += 1;
  }
}

function payloadFor(stats) {
  return {
    threadId: stats.threadId,
    file: stats.file,
    modelContextWindow: stats.modelContextWindow,
    requestCount: stats.requestCount,
    sessionTotal: stats.sessionTotal,
    sessionInput: stats.sessionInput,
    sessionCached: stats.sessionCached,
    sessionOutput: stats.sessionOutput,
    contextUsed: stats.contextUsed,
    turns: stats.turns.map((t) => ({
      startLabel: t.startLabel,
      snippet: t.snippet,
      requests: t.requests.length,
      input: t.input,
      output: t.output,
      cached: t.cached,
      total: t.total,
    })),
    updatedAt: new Date().toISOString(),
  };
}

async function cdpEval(port, expression) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = targets.find((t) => t.url === "app://-/index.html" && !t.url.includes("avatar-overlay"));
  if (!page) throw new Error("Codex page target not found on CDP port " + port);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error("CDP timeout on port " + port));
    }, 8000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        if (msg.result && msg.result.exceptionDetails) reject(new Error("page error: " + JSON.stringify(msg.result.exceptionDetails).slice(0, 200)));
        else resolve(msg.result && msg.result.result ? msg.result.result.value : undefined);
      }
    };
    ws.onerror = (e) => {
      clearTimeout(timer);
      reject(new Error("WebSocket error: " + (e && e.message ? e.message : "unknown")));
    };
  });
}

// A2: 内置会话 ID 检测，完全自研，不依赖任何外部脚本。
// 从页面 DOM / React fiber 读取当前会话 ID；侧边栏收起时沿用最后确认的 ID。
// 逻辑参考开源实现（MIT）的 readActiveConversationId。
// Sentinel returned when the user is on a brand-new blank conversation that has
// no messages yet: the panel should show zeros instead of the previous data.
const NEW_THREAD = "__new_blank__";

async function activeThreadId(port) {
  try {
    const id = await cdpEval(
      port,
      `(function () {
        function norm(v) {
          if (v == null) return null;
          if (typeof v !== "string" && typeof v !== "number") return null;
          var text = String(v).trim();
          if (!text) return null;
          var cn = /client-new-thread:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(text);
          if (cn) return "client-new-thread:" + cn[1].toLowerCase();
          var m = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(text);
          if (m) return m[0].toLowerCase();
          return text.replace(/^[a-z]+:/i, "").toLowerCase();
        }
        function elConv(el) {
          if (!el || el.nodeType !== 1) return null;
          for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
            var v = n.getAttribute("data-app-action-sidebar-thread-id") || n.getAttribute("data-thread-id") || n.getAttribute("data-conversation-id");
            var c = norm(v);
            if (c) return c;
          }
          return null;
        }
        function hasConversationSurface() {
          return !!(document.querySelector('[data-thread-find-target="conversation"]') ||
                    document.querySelector('[data-thread-find-composer="true"]') ||
                    document.querySelector('[data-codex-composer="true"]') ||
                    document.querySelector('[data-app-shell-main-content-layout*="thread"]'));
        }
        function confirm(id) {
          window.__ccmTokenSpendActiveId = { id: id, at: Date.now() };
          return id;
        }
        var activeSels = [
          '[aria-current="page"][data-app-action-sidebar-thread-id]',
          '[data-app-action-sidebar-thread-active="true"][data-app-action-sidebar-thread-id]',
          '[aria-selected="true"][data-app-action-sidebar-thread-id]',
          '[aria-current="page"]',
          '[data-app-action-sidebar-thread-active="true"]',
          '[aria-selected="true"]'
        ];
        // Brand-new blank conversation (no messages yet): no active sidebar
        // thread and the main conversation area is gone. Return the NEW_THREAD
        // sentinel so the watcher shows zeros instead of the previous data.
        // Note: only a sidebar *thread* with active state counts — other
        // elements (e.g. folders) may also carry aria-current="page".
        try {
          var activeThreadNow = document.querySelector(
            '[aria-current="page"][data-app-action-sidebar-thread-id],' +
            '[data-app-action-sidebar-thread-active="true"][data-app-action-sidebar-thread-id],' +
            '[aria-selected="true"][data-app-action-sidebar-thread-id]'
          );
          if (!activeThreadNow && !document.querySelector('main [data-thread-find-target="conversation"]') && hasConversationSurface()) {
            return "${NEW_THREAD}";
          }
        } catch (e) {}
        try {
          var sels = activeSels;
          for (var i = 0; i < sels.length; i++) {
            var c = elConv(document.querySelector(sels[i]));
            if (c) return confirm(c);
          }
        } catch (e) {}
        try {
          // React fiber 兜底扫描较慢，最多每 2 秒做一次。
          var now = Date.now();
          var cache = window.__ccmTokenSpendActiveIdCache;
          if (cache && cache.id && now - cache.at < 2000) {
            // The main conversation area must still be present, otherwise the
            // cached id is stale (user moved to a new blank conversation).
            if (document.querySelector('main [data-thread-find-target="conversation"]')) return cache.id;
          }
          var seen = new WeakSet();
          function scan(value, depth) {
            if (!value || typeof value !== "object" || depth < 0) return null;
            if (seen.has(value)) return null;
            seen.add(value);
            var idKeys = ["conversationId", "localConversationId", "threadId", "id", "key"];
            for (var k = 0; k < idKeys.length; k++) {
              try {
                var cand = value[idKeys[k]];
                var nm = norm(cand);
                if (nm && /[0-9a-f]{8}-/.test(nm)) return nm;
              } catch (e) {}
            }
            if (value.nodeType === 1) {
              var ec = elConv(value);
              if (ec) return ec;
            }
            if (Array.isArray(value)) {
              var lim = Math.min(value.length, 40);
              for (var i2 = 0; i2 < lim; i2++) {
                var r2 = scan(value[i2], depth - 1);
                if (r2) return r2;
              }
              return null;
            }
            if (value instanceof Map) {
              var i3 = 0;
              for (var pair of value) {
                if (i3 >= 40) break;
                var r3 = scan(pair[1], depth - 1);
                if (r3) return r3;
                i3 += 1;
              }
              return null;
            }
            var keyRe = /^(?:props|children|memoizedProps|pendingProps|memoizedState|stateNode|child|sibling|return|alternate|value|current|context|node|chain|conversationId|localConversationId|threadId|id|key|params|thread|conversation)$/;
            for (var key in value) {
              if (!keyRe.test(key)) continue;
              try {
                var child = value[key];
                if (child === value) continue;
                var r4 = scan(child, depth - 1);
                if (r4) return r4;
              } catch (e) {}
            }
            return null;
          }
          var anchors = [
            document.querySelector("main"),
            document.querySelector('[data-thread-find-target="conversation"]'),
            document.querySelector('[data-thread-find-composer="true"]'),
            document.querySelector('[data-codex-composer="true"]'),
            document.getElementById("root")
          ];
          for (var a = 0; a < anchors.length; a++) {
            var anchor = anchors[a];
            if (!anchor) continue;
            var direct = elConv(anchor);
            if (direct) { window.__ccmTokenSpendActiveIdCache = { id: direct, at: now }; return confirm(direct); }
            for (var pk in anchor) {
              if (!/^__react(?:Props|Fiber|Container)\$/.test(pk)) continue;
              try {
                var r5 = scan(anchor[pk], 14);
                if (r5) { window.__ccmTokenSpendActiveIdCache = { id: r5, at: now }; return confirm(r5); }
              } catch (e) {}
            }
          }
          window.__ccmTokenSpendActiveIdCache = { id: null, at: now };
        } catch (e) {}
        // 侧边栏收起时 active/current 节点会消失；主会话区仍在时沿用最后确认的 ID。
        try {
          var last = window.__ccmTokenSpendActiveId;
          if (last && last.id && document.querySelector('main [data-thread-find-target="conversation"]') && hasConversationSurface()) return last.id;
        } catch (e) {}
        return null;
      })()`,
    );
    if (id) return id;
  } catch {}
  return null;
}

async function cdpPush(port, payload) {
  const expr = `window.__ccmTokenSpend = ${JSON.stringify(payload)}; window.dispatchEvent(new Event("ccm-token-spend")); "ok"`;
  return cdpEval(port, expr);
}

function resolveFile(threadId) {
  const files = findRolloutFiles().sort((a, b) => {
    const am = fs.statSync(a).mtimeMs;
    const bm = fs.statSync(b).mtimeMs;
    return bm - am;
  });
  if (threadId) return files.find((f) => threadIdOf(f) === threadId) || null;
  return files[0] || null;
}

// Newest session file that actually contains data (skips empty/broken files).
function resolveAnyFile() {
  const files = findRolloutFiles().sort((a, b) => {
    const am = fs.statSync(a).mtimeMs;
    const bm = fs.statSync(b).mtimeMs;
    return bm - am;
  });
  for (const f of files) {
    if (parseFile(f)) return f;
  }
  return null;
}

// Stats for a conversation that exists but has no data yet (shows zeros).
function emptyStats(threadId, file) {
  return {
    threadId: threadId || "",
    file: file || "",
    date: file ? fileDate(file) : "",
    modelContextWindow: null,
    requestCount: 0,
    sessionTotal: 0,
    sessionInput: 0,
    sessionCached: 0,
    sessionOutput: 0,
    contextUsed: 0,
    turns: [],
  };
}

// ---- client-new-thread 占位 ID 映射 ----
// 新建对话在侧边栏里是 local:client-new-thread:<uuid> 占位 ID，而会话文件用的是真实 ID。
// 遇到占位 ID 时，把「占位 ID 首次出现之后新建的会话文件」学习为该对话的真实 ID，
// 并持久化到本地，避免监控进程重启后丢失映射。
const CLIENT_MAP_DIR = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const CLIENT_MAP_FILE = path.join(CLIENT_MAP_DIR, "ccm-token-spend", "client-thread-map.json");

let clientState = { clientMap: {}, activatedAt: {} };
try {
  const raw = fs.readFileSync(CLIENT_MAP_FILE, "utf8");
  const o = JSON.parse(raw);
  clientState = {
    clientMap: o && typeof o.clientMap === "object" ? o.clientMap : {},
    activatedAt: o && typeof o.activatedAt === "object" ? o.activatedAt : {},
  };
} catch {}

function saveClientState() {
  try {
    fs.mkdirSync(path.dirname(CLIENT_MAP_FILE), { recursive: true });
    fs.writeFileSync(CLIENT_MAP_FILE, JSON.stringify(clientState));
  } catch {}
}

function isClientNewThread(id) {
  return typeof id === "string" && id.indexOf("client-new-thread:") === 0;
}

function clientThreadUuid(id) {
  const m = /^client-new-thread:([0-9a-f-]+)$/i.exec(id);
  return m ? m[1] : id;
}

// 占位对话首次出现之后新建（首次提交）的会话文件，用来学习 占位ID -> 真实ID。
function findNewestClientFileSince(ts, excludeThreadId) {
  const files = findRolloutFiles();
  let best = null;
  let bestTime = -1;
  const slack = 1000;
  for (const f of files) {
    if (excludeThreadId && threadIdOf(f) === excludeThreadId) continue;
    try {
      const st = fs.statSync(f);
      const created = st.birthtimeMs && st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs;
      if (created >= ts - slack && st.mtimeMs > bestTime) {
        bestTime = st.mtimeMs;
        best = f;
      }
    } catch {}
  }
  return best ? threadIdOf(best) : null;
}

// 兜底：修复前已存在、已有内容的占位对话，其文件创建时间早于激活时间。
// 这时学习「最新且未被其他占位对话认领」的会话文件。
function findNewestUnclaimedFile(excludeThreadId, claimedSet) {
  const files = findRolloutFiles();
  let best = null;
  let bestTime = -1;
  for (const f of files) {
    const tid = threadIdOf(f);
    if (!tid) continue;
    if (excludeThreadId && tid === excludeThreadId) continue;
    if (claimedSet && claimedSet.has(tid)) continue;
    try {
      const st = fs.statSync(f);
      if (st.mtimeMs > bestTime) {
        bestTime = st.mtimeMs;
        best = f;
      }
    } catch {}
  }
  return best ? threadIdOf(best) : null;
}

// 页面里是否有真实会话内容（空白新对话没有 conversation surface）。
async function hasConversationContent(port) {
  try {
    const v = await cdpEval(port, `!!document.querySelector('main [data-thread-find-target="conversation"]')`);
    return v === true || v === "true";
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const args = { thread: null, all: false, detail: false, watch: false, cdp: false, port: 9229 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--thread") args.thread = argv[i + 1];
    else if (a === "--all") args.all = true;
    else if (a === "--detail") args.detail = true;
    else if (a === "--watch") args.watch = true;
    else if (a === "--cdp") args.cdp = true;
    else if (a === "--port") args.port = Number(argv[i + 1]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.all) {
    const files = findRolloutFiles().sort((a, b) => b.localeCompare(a));
    if (!files.length) {
      console.log("未找到任何会话记录: " + SESSIONS_DIR);
      return;
    }
    console.log("=== 每个对话的 token 消耗量 ===");
    for (const f of files) {
      const parsed = parseFile(f);
      if (!parsed) continue;
      const stats = buildStats(parsed);
      const last = stats.turns[stats.turns.length - 1];
      console.log(
        `${stats.date || ""}  ${(stats.threadId || "?").slice(0, 8)}…  ${fmtShort(stats.sessionTotal)} tokens (${stats.requestCount} 次请求, ${stats.turns.length} 轮)` +
          (last && last.snippet ? `  「${last.snippet}」` : ""),
      );
    }
    return;
  }

  if (args.watch) {
    let lastKey = "";
    let lastPushAt = 0;
    let lastRealThreadId = "";
    console.log("监控中… 每 1 秒刷新" + (args.cdp ? "，并通过调试端口写入 Codex 页面" : "") + " (Ctrl+C 退出)");
    for (;;) {
      try {
        const rawThread = args.thread || (await activeThreadId(args.port));
        let thread = rawThread;
        let threadIsClientNew = false;
        if (isClientNewThread(rawThread)) {
          threadIsClientNew = true;
          const ph = clientThreadUuid(rawThread);
          if (!(ph in clientState.activatedAt)) {
            clientState.activatedAt[ph] = Date.now();
            saveClientState();
          }
          const learned = clientState.clientMap[ph];
          if (learned) {
            thread = learned;
          } else {
            // 排除上一个真实对话的文件，避免刚离开旧对话的瞬间误关联。
            const cand = findNewestClientFileSince(clientState.activatedAt[ph], lastRealThreadId);
            if (cand) {
              clientState.clientMap[ph] = cand;
              saveClientState();
              thread = cand;
            } else if (await hasConversationContent(port)) {
              // 修复前已存在、已有内容的占位对话：文件创建时间早于激活时间，
              // 用「最新且未被认领的会话文件」兜底学习。
              const claimed = new Set(Object.values(clientState.clientMap));
              const fb = findNewestUnclaimedFile(lastRealThreadId, claimed);
              if (fb) {
                clientState.clientMap[ph] = fb;
                saveClientState();
                thread = fb;
              } else {
                thread = null;
              }
            } else {
              thread = null; // 仍是空白新对话 -> 显示 0
            }
          }
        }
        let file = null;
        let parsed = null;
        let stats = null;
        if (thread && thread !== NEW_THREAD) {
          file = resolveFile(thread);
          parsed = file ? parseFile(file) : null;
          if (parsed) {
            stats = buildStats(parsed);
          } else {
            // Active conversation exists but has no data yet -> show zeros.
            stats = emptyStats(thread, file);
          }
        } else if (thread === NEW_THREAD) {
          // Brand-new blank conversation, nothing sent yet -> show zeros.
          stats = emptyStats(null, null);
        } else if (threadIsClientNew) {
          // 占位对话还没有对应文件（仍是空白）-> 显示 0，不回退到上一个对话。
          stats = emptyStats(null, null);
        } else {
          // 启动加载期（页面还没加载完、读不到对话 ID）：显示 0，
          // 等加载完成识别出当前对话后再显示真实数据，不回退到上一个对话。
          stats = emptyStats(null, null);
        }
        if (stats) {
          if (thread && thread !== NEW_THREAD && stats.threadId) lastRealThreadId = stats.threadId;
          const key = `${stats.threadId}|${stats.requestCount}|${stats.sessionTotal}`;
          const changed = key !== lastKey;
          const heartbeat = args.cdp && Date.now() - lastPushAt > 1000;
          if (changed || heartbeat) {
            if (changed) lastKey = key;
            if (args.cdp) {
              await cdpPush(args.port, payloadFor(stats));
              lastPushAt = Date.now();
              if (changed) {
                console.log(`[${new Date().toLocaleTimeString()}] 已推送: ${stats.threadId?.slice(0, 8)}… 累计 ${fmtShort(stats.sessionTotal)} tokens`);
              }
            } else if (changed) {
              console.log(`[${new Date().toLocaleTimeString()}] 会话 ${stats.threadId?.slice(0, 8)}… 累计 ${fmtShort(stats.sessionTotal)} tokens / ${stats.requestCount} 次请求`);
            }
          }
        }
      } catch (e) {
        if (args.cdp) console.log("推送失败: " + (e && e.message ? e.message : e));
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const file = resolveFile(args.thread);
  if (!file) {
    console.log("未找到会话记录: " + SESSIONS_DIR);
    process.exit(1);
  }
  const parsed = parseFile(file);
  if (!parsed) {
    console.log("会话文件为空或格式无法解析: " + file);
    process.exit(1);
  }
  const stats = buildStats(parsed);
  printStats(stats, { detail: args.detail });

  if (args.cdp) {
    await cdpPush(args.port, payloadFor(stats));
    console.log("");
    console.log("已写入 Codex 页面 (port " + args.port + ")");
  }
}

if (!process.env.CCM_TOKENS_AS_MODULE) {
  main().catch((e) => {
    console.error("错误: " + (e && e.message ? e.message : e));
    process.exit(1);
  });
}

export {
  SESSIONS_DIR,
  CLIENT_MAP_FILE,
  clientState,
  saveClientState,
  isClientNewThread,
  clientThreadUuid,
  findNewestClientFileSince,
  findNewestUnclaimedFile,
  hasConversationContent,
  findRolloutFiles,
  threadIdOf,
  resolveFile,
  resolveAnyFile,
  emptyStats,
  parseFile,
  buildStats,
};