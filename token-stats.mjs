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
  return {
    threadId: parsed.threadId,
    file: parsed.file,
    date: parsed.date,
    modelContextWindow: parsed.modelContextWindow,
    requestCount: counts.length,
    sessionTotal: lastCount && lastCount.total != null ? lastCount.total : null,
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
  console.log("会话累计消耗: " + fmtInt(stats.sessionTotal) + " tokens (" + fmtShort(stats.sessionTotal) + ")");
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

async function activeThreadId(port) {
  try {
    const id = await cdpEval(
      port,
      `(function(){ try { var s = window.__codexContextMeter && window.__codexContextMeter.getState ? window.__codexContextMeter.getState() : null; return (s && s.activeConversationId) || null; } catch(e) { return null; } })()`,
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
    threadId,
    file: file || "",
    date: file ? fileDate(file) : "",
    modelContextWindow: null,
    requestCount: 0,
    sessionTotal: 0,
    turns: [],
  };
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
    console.log("监控中… 每 1 秒刷新" + (args.cdp ? "，并通过调试端口写入 Codex 页面" : "") + " (Ctrl+C 退出)");
    for (;;) {
      try {
        const thread = args.thread || (await activeThreadId(args.port));
        let file = resolveFile(thread);
        let parsed = file ? parseFile(file) : null;
        let stats = null;
        if (parsed) {
          stats = buildStats(parsed);
        } else if (thread) {
          // Active conversation exists but has no data yet -> show zeros.
          stats = emptyStats(thread, file);
        } else {
          const fallback = resolveAnyFile();
          if (fallback) {
            file = fallback;
            stats = buildStats(parseFile(fallback));
          }
        }
        if (stats) {
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

main().catch((e) => {
  console.error("错误: " + (e && e.message ? e.message : e));
  process.exit(1);
});