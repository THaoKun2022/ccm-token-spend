(() => {
  "use strict";
  // Guard: only the first injected copy runs (Codex++ may re-inject).
  if (window.__ccmTokenSpendPanelInstalled) return;
  window.__ccmTokenSpendPanelInstalled = true;
  // codex-token-spend-panel.js
  // Renders a small floating panel in the Codex page with per-turn / per-conversation
  // token consumption, fed by token-stats.mjs (which reads Codex session logs and
  // pushes a sanitized summary through the Codex++ CDP channel).
  //
  // Data arrives via:
  //   window.__ccmTokenSpend = { threadId, modelContextWindow, contextUsed,
  //                              requestCount, sessionTotal, sessionInput,
  //                              sessionCached, sessionOutput,
  //                              turns: [{startLabel, snippet, requests,
  //                              input, output, total}], updatedAt }
  //   window.dispatchEvent(new Event("ccm-token-spend"))

  const ROOT_ID = "ccm-token-spend-panel";
  const STYLE_ID = "ccm-token-spend-style";
  const MINI_ID = "ccm-token-spend-mini";
  const STORAGE_KEY = "__ccmTokenSpendPanelClosed";
  const POS_STORAGE_KEY = "__ccmTokenSpendPanelPos";
  const MINI_POS_STORAGE_KEY = "__ccmTokenSpendMiniPos";
  const SIZE_STORAGE_KEY = "__ccmTokenSpendPanelSize";
  const MIN_W = 220;
  const MIN_H = 190;

  const state = {
    data: null,
    root: null,
    mini: null,
    skeletonBuilt: false,
    lastTurnsKey: null,
    manipulating: false,
  };

  function fmtShort(n) {
    if (n == null || !Number.isFinite(n)) return "--";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return String(Math.round(n));
  }

  function fmtInt(n) {
    if (n == null || !Number.isFinite(n)) return "--";
    return n.toLocaleString("en-US");
  }

  function clock(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((v) => String(v).padStart(2, "0")).join(":");
  }

  function loadPos(key) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
    } catch {}
    return null;
  }

  function savePos(key, x, y) {
    try {
      window.localStorage.setItem(key, JSON.stringify({ x, y }));
    } catch {}
  }

  // Height of the app's top bar, so the panel never hides underneath it.
  function minTop() {
    try {
      const el = document.elementFromPoint(Math.floor(window.innerWidth / 2), 2);
      const b = el && el.getBoundingClientRect ? el.getBoundingClientRect().bottom : 0;
      if (b >= 20 && b <= 100) return Math.ceil(b) + 4;
    } catch {}
    return 40;
  }

  // Keep the element fully inside the window so it can never be lost off-screen.
  function clampPos(el, x, y) {
    const w = el.offsetWidth || 200;
    const h = el.offsetHeight || 60;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxX = Math.max(0, vw - w);
    const maxY = Math.max(0, vh - h);
    const top = minTop();
    return { x: Math.max(0, Math.min(x, maxX)), y: Math.max(top, Math.min(y, maxY)) };
  }

  function applyPos(el, key) {
    const p = loadPos(key);
    if (!p) return;
    const c = clampPos(el, p.x, p.y);
    el.style.left = c.x + "px";
    el.style.top = c.y + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
  }

  function loadSize() {
    try {
      const raw = window.localStorage.getItem(SIZE_STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (s && Number.isFinite(s.w) && Number.isFinite(s.h)) return { w: s.w, h: s.h };
    } catch {}
    return null;
  }

  function saveSize(w, h) {
    try {
      window.localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify({ w, h }));
    } catch {}
  }

  // Clamp a candidate size so the panel stays fully inside the window,
  // shifting top/left when growth would push beyond an edge.
  function clampSize(w, h, left, top, corner) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const topMin = minTop();
    const maxRight = vw - 4;
    const maxBottom = vh - 4;
    const movesLeft = corner === "nw" || corner === "sw";
    const movesTop = corner === "nw" || corner === "ne";
    const rightEdge = left + w;
    const bottomEdge = top + h;
    let L = left;
    let T = top;
    if (w < MIN_W) {
      w = MIN_W;
      if (movesLeft) L = rightEdge - MIN_W;
    }
    if (h < MIN_H) {
      h = MIN_H;
      if (movesTop) T = bottomEdge - MIN_H;
    }
    if (L + w > maxRight) L = maxRight - w;
    if (T + h > maxBottom) T = maxBottom - h;
    if (L < 0) {
      L = 0;
      w = Math.min(w, maxRight);
    }
    if (T < topMin) {
      T = topMin;
      h = Math.min(h, maxBottom - topMin);
    }
    return { w: Math.round(w), h: Math.round(h), left: Math.round(L), top: Math.round(T) };
  }

  function applySize(el) {
    const s = loadSize();
    if (!s) return;
    const rect = el.getBoundingClientRect();
    const c = clampSize(s.w, s.h, rect.left, rect.top);
    el.style.width = c.w + "px";
    el.style.height = c.h + "px";
    el.style.maxHeight = "none";
    if (Math.abs(c.left - rect.left) > 1 || Math.abs(c.top - rect.top) > 1) {
      el.style.left = c.left + "px";
      el.style.top = c.top + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
      // 位置持久化交给 applyPos / 拖拽 / 缩放收尾，避免展开时覆盖面板已存位置。
    }
  }

  function wasJustDragged(el) {
    const ds = el && el.dataset;
    if (!ds || !ds.ccmDragEndedAt) return false;
    if (Number(ds.ccmDragEndedAt) > Date.now() - 500) {
      delete ds.ccmDragEndedAt;
      return true;
    }
    delete ds.ccmDragEndedAt;
    return false;
  }

  function makeDraggable(el, handle, posKey) {
    let startX = 0;
    let startY = 0;
    let baseX = 0;
    let baseY = 0;
    let dragging = false;
    let moved = false;

    const onMove = (ev) => {
      if (!dragging) return;
      ev.stopPropagation();
      const c = clampPos(el, baseX + (ev.clientX - startX), baseY + (ev.clientY - startY));
      if (Math.abs(c.x - baseX) > 2 || Math.abs(c.y - baseY) > 2) moved = true;
      el.style.left = c.x + "px";
      el.style.top = c.y + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
    };

    const finish = (ev) => {
      if (!dragging) return;
      ev.stopPropagation();
      dragging = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", finish);
      el.style.cursor = "";
      if (moved) {
        try {
          el.dataset.ccmDragEndedAt = String(Date.now());
        } catch {}
      }
      // Snap fully back into the window and remember the position.
      const rect = el.getBoundingClientRect();
      const c = clampPos(el, rect.left, rect.top);
      el.style.left = c.x + "px";
      el.style.top = c.y + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
      savePos(posKey, c.x, c.y);
      state.manipulating = false;
    };

    const onDown = (ev) => {
      if (dragging) return;
      if (ev.button !== 0) return;
      if (ev.target.closest && ev.target.closest(".ccm-ts-close")) return;
      ev.stopPropagation();
      state.manipulating = true;
      const p = loadPos(posKey);
      const rect = el.getBoundingClientRect();
      baseX = p ? p.x : rect.left;
      baseY = p ? p.y : rect.top;
      startX = ev.clientX;
      startY = ev.clientY;
      dragging = true;
      moved = false;
      el.style.cursor = "grabbing";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", finish);
    };

    handle.addEventListener("pointerdown", onDown);
    handle.addEventListener("mousedown", onDown);
  }

  function makeResizable(el, handle, corner) {
    corner = corner || "se";
    let startX = 0;
    let startY = 0;
    let baseW = 0;
    let baseH = 0;
    let baseLeft = 0;
    let baseTop = 0;
    let resizing = false;

    const onMove = (ev) => {
      if (!resizing) return;
      ev.stopPropagation();
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let w = baseW;
      let h = baseH;
      let L = baseLeft;
      let T = baseTop;
      if (corner === "nw") {
        w = baseW - dx;
        h = baseH - dy;
        L = baseLeft + dx;
        T = baseTop + dy;
      } else if (corner === "ne") {
        w = baseW + dx;
        h = baseH - dy;
        T = baseTop + dy;
      } else if (corner === "sw") {
        w = baseW - dx;
        h = baseH + dy;
        L = baseLeft + dx;
      } else {
        w = baseW + dx;
        h = baseH + dy;
      }
      const c = clampSize(w, h, L, T, corner);
      el.style.width = c.w + "px";
      el.style.height = c.h + "px";
      el.style.left = c.left + "px";
      el.style.top = c.top + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
    };

    const finish = (ev) => {
      if (!resizing) return;
      ev.stopPropagation();
      resizing = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", finish);
      state.manipulating = false;
      fitPanelHeight(el);
      const rect = el.getBoundingClientRect();
      saveSize(Math.round(rect.width), Math.round(rect.height));
      savePos(POS_STORAGE_KEY, Math.round(rect.left), Math.round(rect.top));
    };

    const onDown = (ev) => {
      if (resizing) return;
      if (ev.button !== 0) return;
      ev.stopPropagation();
      ev.preventDefault();
      state.manipulating = true;
      const rect = el.getBoundingClientRect();
      baseLeft = rect.left;
      baseTop = rect.top;
      baseW = rect.width;
      baseH = rect.height;
      startX = ev.clientX;
      startY = ev.clientY;
      resizing = true;
      el.style.maxHeight = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", finish);
    };

    handle.addEventListener("pointerdown", onDown);
    handle.addEventListener("mousedown", onDown);
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
#${ROOT_ID} {
  position: fixed;
  -webkit-app-region: no-drag;
  right: 14px;
  bottom: 14px;
  z-index: 2147483646;
  width: 260px;
  max-height: 300px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #e6e6e6;
  background: rgba(18, 18, 22, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px;
  padding: 10px 12px 28px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
  user-select: none;
}
#${ROOT_ID} * { box-sizing: border-box; }
#${ROOT_ID} .ccm-ts-top { flex-shrink: 0; }
#${ROOT_ID} .ccm-ts-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
  margin-bottom: 6px;
  cursor: grab;
  touch-action: none;
}
#${ROOT_ID} .ccm-ts-header:active { cursor: grabbing; }
#${ROOT_ID} .ccm-ts-close {
  position: relative;
  z-index: 4;
  border: none;
  background: transparent;
  color: #9a9aa3;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
}
#${ROOT_ID} .ccm-ts-close:hover { color: #fff; background: rgba(255,255,255,0.08); }
#${ROOT_ID} .ccm-ts-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
#${ROOT_ID} .ccm-ts-label { color: #9a9aa3; white-space: nowrap; }
#${ROOT_ID} .ccm-ts-val { font-weight: 600; white-space: nowrap; }
#${ROOT_ID} .ccm-ts-last { color: #ffd479; }
#${ROOT_ID} .ccm-ts-sub { color: #9a9aa3; font-size: 11px; }
#${ROOT_ID} .ccm-ts-body, #${ROOT_ID} .ccm-ts-turns, #${ROOT_ID} .ccm-ts-foot, #${ROOT_ID} .ccm-ts-wait { user-select: text; -webkit-user-select: text; }
#${ROOT_ID} .ccm-ts-turns { flex: 1 1 auto; min-height: 0; overflow-y: auto; margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px; }
#${ROOT_ID} .ccm-ts-turn {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
#${ROOT_ID} .ccm-ts-turn .ccm-ts-snip {
  flex: 1 1 auto;
  min-width: 0;
  color: #9a9aa3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#${ROOT_ID} .ccm-ts-turn > span:first-child { white-space: nowrap; flex-shrink: 0; }
#${ROOT_ID} .ccm-ts-wait { flex: 1 1 auto; color: #9a9aa3; font-size: 11px; }
#${ROOT_ID} .ccm-ts-foot { position: absolute; left: 12px; right: 12px; bottom: 10px; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #6f6f78; font-size: 10.5px; background: rgba(18, 18, 22, 0.92); z-index: 2; }
#${ROOT_ID} .ccm-ts-resize {
  position: absolute;
  width: 14px;
  height: 14px;
  touch-action: none;
  z-index: 3;
}
#${ROOT_ID} .ccm-ts-resize-se { right: 0; bottom: 0; cursor: nwse-resize; }
#${ROOT_ID} .ccm-ts-resize-se::after {
  content: "";
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 5px;
  height: 5px;
  border-right: 2px solid rgba(255, 255, 255, 0.35);
  border-bottom: 2px solid rgba(255, 255, 255, 0.35);
}
#${ROOT_ID} .ccm-ts-resize-nw { left: 0; top: 0; cursor: nwse-resize; }
#${ROOT_ID} .ccm-ts-resize-nw::after {
  content: "";
  position: absolute;
  left: 3px;
  top: 3px;
  width: 5px;
  height: 5px;
  border-left: 2px solid rgba(255, 255, 255, 0.35);
  border-top: 2px solid rgba(255, 255, 255, 0.35);
}
#${ROOT_ID} .ccm-ts-resize-ne { right: 0; top: 0; cursor: nesw-resize; }
#${ROOT_ID} .ccm-ts-resize-ne::after {
  content: "";
  position: absolute;
  right: 3px;
  top: 3px;
  width: 5px;
  height: 5px;
  border-right: 2px solid rgba(255, 255, 255, 0.35);
  border-top: 2px solid rgba(255, 255, 255, 0.35);
}
#${ROOT_ID} .ccm-ts-resize-sw { left: 0; bottom: 0; cursor: nesw-resize; }
#${ROOT_ID} .ccm-ts-resize-sw::after {
  content: "";
  position: absolute;
  left: 3px;
  bottom: 3px;
  width: 5px;
  height: 5px;
  border-left: 2px solid rgba(255, 255, 255, 0.35);
  border-bottom: 2px solid rgba(255, 255, 255, 0.35);
}
#${MINI_ID} {
  position: fixed;
  -webkit-app-region: no-drag;
  right: 14px;
  bottom: 14px;
  z-index: 2147483646;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  color: #e6e6e6;
  background: rgba(18, 18, 22, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  padding: 5px 10px;
  cursor: grab;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  user-select: none;
  touch-action: none;
}
#${MINI_ID}:active { cursor: grabbing; }
`;
    document.head.appendChild(style);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function removePanel() {
    if (state.root) {
      state.root.remove();
      state.root = null;
      state.skeletonBuilt = false;
      state.lastTurnsKey = null;
    }
  }

  function removeMini() {
    if (state.mini) {
      state.mini.remove();
      state.mini = null;
    }
  }

  function isClosed() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function setClosed(v) {
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {}
  }

  function buildSkeleton(root) {
    root.innerHTML = `
      <div class="ccm-ts-top">
        <div class="ccm-ts-header"><span>Token 消耗</span><button class="ccm-ts-close" title="关闭">×</button></div>
        <div class="ccm-ts-wait">等待数据…<br>请运行<br><b>node token-stats.mjs --watch --cdp</b></div>
        <div class="ccm-ts-body">
          <div class="ccm-ts-row"><span class="ccm-ts-label">本轮</span><span class="ccm-ts-val ccm-ts-last">--</span></div>
          <div class="ccm-ts-sub ccm-ts-io" style="text-align:right"></div>
          <div class="ccm-ts-row"><span class="ccm-ts-label">会话累计</span><span class="ccm-ts-val ccm-ts-session">--</span></div>
          <div class="ccm-ts-sub ccm-ts-session-io" style="text-align:right"></div>
          <div class="ccm-ts-row"><span class="ccm-ts-label">请求次数</span><span class="ccm-ts-val ccm-ts-reqs">--</span></div>
          <div class="ccm-ts-row ccm-ts-ctx-row"><span class="ccm-ts-label">上下文窗口</span><span class="ccm-ts-val ccm-ts-ctx">--</span></div>
        </div>
      </div>
      <div class="ccm-ts-turns"></div>
      <div class="ccm-ts-foot"></div>
      <div class="ccm-ts-resize ccm-ts-resize-se" title="拖动调整大小"></div>
      <div class="ccm-ts-resize ccm-ts-resize-nw" title="拖动调整大小"></div>
      <div class="ccm-ts-resize ccm-ts-resize-ne" title="拖动调整大小"></div>
      <div class="ccm-ts-resize ccm-ts-resize-sw" title="拖动调整大小"></div>`;
    const header = root.querySelector(".ccm-ts-header");
    if (header) makeDraggable(root, header, POS_STORAGE_KEY);
    const closeBtn = root.querySelector(".ccm-ts-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (wasJustDragged(root)) return;
        setClosed(true);
        render();
      });
    }
    for (const corner of ["se", "nw", "ne", "sw"]) {
      const resize = root.querySelector(".ccm-ts-resize-" + corner);
      if (resize) makeResizable(root, resize, corner);
    }
  }

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  // Grow-only height fit: top summary + bottom footer must always stay fully
  // visible, so when the summary wraps taller at narrow widths the panel grows
  // instead of clipping them. Never runs mid-drag/resize.
  function fitPanelHeight(root) {
    if (state.manipulating) return;
    const top = root.querySelector(".ccm-ts-top");
    if (!top) return;
    const needed = top.offsetHeight + 56;
    if (needed <= root.offsetHeight) return;
    const h = Math.min(needed, Math.max(120, window.innerHeight - minTop() - 8));
    if (h > 300) root.style.maxHeight = "none";
    root.style.height = h + "px";
    // Growing may push the panel past the window edge (e.g. bottom-left docked):
    // reuse the boundary clamp so it always stays inside the Codex window.
    const rect = root.getBoundingClientRect();
    const c = clampPos(root, rect.left, rect.top);
    root.style.left = c.x + "px";
    root.style.top = c.y + "px";
    root.style.right = "auto";
    root.style.bottom = "auto";
  }

  function refresh(root) {
    const d = state.data;
    const wait = root.querySelector(".ccm-ts-wait");
    const body = root.querySelector(".ccm-ts-body");
    const turns = root.querySelector(".ccm-ts-turns");
    const foot = root.querySelector(".ccm-ts-foot");
    const last = d && d.turns && d.turns.length ? d.turns[d.turns.length - 1] : null;
    if (!d) {
      if (wait) wait.style.display = "";
      if (body) body.style.display = "none";
      if (turns) turns.style.display = "none";
      setText(foot, "");
      fitPanelHeight(root);
      return;
    }
    if (wait) wait.style.display = "none";
    if (body) body.style.display = "";
    if (turns) turns.style.display = "";
    if (foot) foot.style.display = "";
    setText(root.querySelector(".ccm-ts-last"), last ? fmtShort(last.total) + " tokens" : "0 tokens");
    const io = root.querySelector(".ccm-ts-io");
    if (io) {
      if (last) {
        io.style.display = "";
        const cached = last.cached != null ? last.cached : null;
        io.textContent =
          "输入 " + fmtShort(last.input) +
          (cached != null ? "（缓存命中 " + fmtShort(cached) + "，未命中 " + fmtShort(Math.max(0, (last.input || 0) - cached)) + "）" : "") +
          " + 输出 " + fmtShort(last.output);
      } else {
        io.style.display = "none";
      }
    }
    setText(root.querySelector(".ccm-ts-session"), fmtShort(d.sessionTotal) + " tokens");
    const sio = root.querySelector(".ccm-ts-session-io");
    if (sio) {
      if (d.sessionInput != null) {
        sio.style.display = "";
        const cached = d.sessionCached != null ? d.sessionCached : null;
        sio.textContent =
          "输入 " + fmtShort(d.sessionInput) +
          (cached != null ? "（缓存命中 " + fmtShort(cached) + "，未命中 " + fmtShort(Math.max(0, (d.sessionInput || 0) - cached)) + "）" : "") +
          " + 输出 " + fmtShort(d.sessionOutput);
      } else {
        sio.style.display = "none";
      }
    }
    setText(root.querySelector(".ccm-ts-reqs"), fmtInt(d.requestCount));
    const ctxRow = root.querySelector(".ccm-ts-ctx-row");
    if (ctxRow) {
      if (d.modelContextWindow) {
        ctxRow.style.display = "";
        setText(root.querySelector(".ccm-ts-ctx"), fmtShort(d.contextUsed) + " / " + fmtShort(d.modelContextWindow));
      } else {
        ctxRow.style.display = "none";
      }
    }
    const recent = d.turns ? [...d.turns].reverse() : [];
    const key = (d.turns ? d.turns.length : 0) + "|" + recent.map((t) => t.startLabel + "|" + t.total + "|" + t.input + "|" + t.output + "|" + (t.cached || 0)).join("~");
    if (key !== state.lastTurnsKey) {
      state.lastTurnsKey = key;
      const scrollTop = turns ? turns.scrollTop : 0;
      if (turns) {
        turns.innerHTML = recent
          .map(
            (t, i) => `
          <div class="ccm-ts-turn">
            <span>${i === 0 ? "本轮" : "T" + (d.turns.length - i)}</span>
            <span class="ccm-ts-snip" title="${escapeHtml(t.snippet || "")}">${escapeHtml(t.snippet || "")}</span>
            <span class="ccm-ts-val">${fmtShort(t.total)}</span>
          </div>`,
          )
          .join("") || '<span class="ccm-ts-sub">暂无轮次数据</span>';
        turns.scrollTop = scrollTop;
      }
    }
    setText(foot, "更新于" + clock(d.updatedAt) + " · 数据来自本地会话记录");
    fitPanelHeight(root);
  }

  function render() {
    installStyle();
    if (isClosed()) {
      removePanel();
      ensureMini();
      return;
    }
    removeMini();
    let root = state.root;
    if (!root) {
      root = document.getElementById(ROOT_ID);
      if (!root) {
        root = document.createElement("div");
        root.id = ROOT_ID;
        document.body.appendChild(root);
      }
      state.root = root;
    }
    if (!state.skeletonBuilt) {
      buildSkeleton(root);
      state.skeletonBuilt = true;
      // Geometry is applied once here (panel creation / expand), and again on
      // window resize and at drag/resize release. It is deliberately NOT
      // applied on every data push so an in-progress drag/resize never jumps
      // back to the stored size/position.
      applySize(root);
      applyPos(root, POS_STORAGE_KEY);
    }
    refresh(root);
  }
  function ensureMini() {
    if (!isClosed()) return;
    let mini = state.mini || document.getElementById(MINI_ID);
    if (!mini) {
      mini = document.createElement("div");
      mini.id = MINI_ID;
      mini.title = "显示 Token 消耗面板（拖动可移动位置）";
      mini.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (wasJustDragged(mini)) return;
        setClosed(false);
        render();
      });
      makeDraggable(mini, mini, MINI_POS_STORAGE_KEY);
      document.body.appendChild(mini);
      applyPos(mini, MINI_POS_STORAGE_KEY);
    }
    state.mini = mini;
    // Keep the collapsed button's total in sync with every data push.
    const d = state.data;
    mini.textContent = "Token " + (d ? fmtShort(d.sessionTotal) : "");
  }

  window.addEventListener("ccm-token-spend", () => {
    state.data = window.__ccmTokenSpend || null;
    render();
  });

  if (window.__ccmTokenSpend) {
    state.data = window.__ccmTokenSpend;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }

  setInterval(() => {
    if (window.__ccmTokenSpend && (!state.data || state.data.updatedAt !== window.__ccmTokenSpend.updatedAt)) {
      state.data = window.__ccmTokenSpend;
      render();
    }
  }, 3000);

  window.addEventListener("resize", () => {
    if (state.root) {
      applySize(state.root);
      applyPos(state.root, POS_STORAGE_KEY);
    }
    if (state.mini) applyPos(state.mini, MINI_POS_STORAGE_KEY);
  });
})();
