export function renderGatewayWebUi(): string {
  return String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mini Agent Gateway UI</title>
  <style>
    :root {
      --bg: #f4efe6;
      --panel: rgba(255, 251, 245, 0.92);
      --panel-strong: #fffaf2;
      --line: #d9c9b3;
      --text: #2a2118;
      --muted: #756657;
      --accent: #0f766e;
      --accent-2: #b45309;
      --danger: #b42318;
      --shadow: 0 18px 50px rgba(74, 49, 25, 0.12);
      --radius: 18px;
      --mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      --sans: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--sans);
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(15, 118, 110, 0.14), transparent 32%),
        radial-gradient(circle at top right, rgba(180, 83, 9, 0.16), transparent 34%),
        linear-gradient(180deg, #f8f3ea 0%, var(--bg) 100%);
      min-height: 100vh;
    }
    .shell {
      max-width: 1440px;
      margin: 0 auto;
      padding: 24px;
    }
    .hero {
      margin-bottom: 18px;
      padding: 24px;
      border: 1px solid rgba(117, 102, 87, 0.18);
      border-radius: 28px;
      background:
        linear-gradient(135deg, rgba(255,255,255,0.72), rgba(255,248,239,0.92)),
        repeating-linear-gradient(-45deg, rgba(117, 102, 87, 0.02), rgba(117, 102, 87, 0.02) 12px, rgba(255,255,255,0.02) 12px, rgba(255,255,255,0.02) 24px);
      box-shadow: var(--shadow);
      display: grid;
      gap: 12px;
    }
    .hero-top {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: start;
      flex-wrap: wrap;
    }
    .eyebrow {
      font-size: 12px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--accent);
      font-weight: 700;
    }
    h1 {
      margin: 4px 0 0;
      font-size: clamp(28px, 4vw, 52px);
      line-height: 0.95;
      letter-spacing: -0.04em;
    }
    .subtitle {
      color: var(--muted);
      max-width: 70ch;
      margin: 0;
      line-height: 1.5;
    }
    .status-pill {
      border-radius: 999px;
      border: 1px solid var(--line);
      padding: 10px 14px;
      background: rgba(255,255,255,0.74);
      font-size: 13px;
      min-width: 220px;
    }
    .status-pill strong { color: var(--accent); }
    .toolbar {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .field {
      display: grid;
      gap: 6px;
    }
    .field label {
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-weight: 700;
    }
    input, textarea, button { font: inherit; }
    input, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: rgba(255,255,255,0.84);
      padding: 12px 14px;
      color: var(--text);
      outline: none;
      transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
    }
    input:focus, textarea:focus {
      border-color: rgba(15, 118, 110, 0.65);
      box-shadow: 0 0 0 4px rgba(15, 118, 110, 0.09);
    }
    button {
      border: 0;
      border-radius: 14px;
      padding: 12px 16px;
      cursor: pointer;
      font-weight: 700;
      transition: transform 120ms ease, opacity 120ms ease;
    }
    button:hover { transform: translateY(-1px); }
    button:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }
    .primary {
      color: white;
      background: linear-gradient(135deg, var(--accent), #155e75);
    }
    .ghost {
      color: var(--text);
      background: rgba(255,255,255,0.78);
      border: 1px solid var(--line);
    }
    .grid {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 18px;
      align-items: start;
    }
    .stack {
      display: grid;
      gap: 18px;
    }
    .card {
      background: var(--panel);
      border: 1px solid rgba(117, 102, 87, 0.18);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow: hidden;
      backdrop-filter: blur(8px);
    }
    .card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 18px;
      border-bottom: 1px solid rgba(117, 102, 87, 0.14);
      background: linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0.15));
    }
    .card-head h2 {
      margin: 0;
      font-size: 16px;
      letter-spacing: -0.02em;
    }
    .card-head span {
      color: var(--muted);
      font-size: 12px;
    }
    .card-body { padding: 18px; }
    .composer {
      display: grid;
      gap: 12px;
    }
    textarea {
      min-height: 110px;
      resize: vertical;
      line-height: 1.5;
    }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .stream {
      min-height: 180px;
      white-space: pre-wrap;
      line-height: 1.65;
      font-size: 15px;
    }
    .placeholder {
      color: var(--muted);
      font-style: italic;
    }
    .tool-list, .event-list {
      display: grid;
      gap: 10px;
      max-height: 640px;
      overflow: auto;
      padding-right: 4px;
    }
    .tool-item, .event-item {
      border: 1px solid rgba(117, 102, 87, 0.15);
      border-radius: 14px;
      background: var(--panel-strong);
      padding: 12px;
    }
    .tool-top, .event-top {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      margin-bottom: 8px;
    }
    .tool-name, .event-type {
      font-weight: 700;
      font-size: 13px;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .tool-meta, .event-time {
      font-size: 12px;
      color: var(--muted);
      white-space: nowrap;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: var(--mono);
      font-size: 12px;
      line-height: 1.55;
      color: #362d23;
    }
    .event-item pre {
      max-height: 180px;
      overflow: auto;
    }
    .stats {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .stat {
      min-width: 120px;
      padding: 12px 14px;
      background: rgba(255,255,255,0.72);
      border: 1px solid rgba(117, 102, 87, 0.16);
      border-radius: 14px;
    }
    .stat strong {
      display: block;
      font-size: 22px;
      letter-spacing: -0.03em;
      margin-bottom: 3px;
    }
    .stat span {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }
    .ok { color: var(--accent); }
    .warn { color: var(--accent-2); }
    .err { color: var(--danger); }
    @media (max-width: 1080px) {
      .toolbar { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 720px) {
      .shell { padding: 14px; }
      .hero { padding: 18px; }
      .toolbar { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <div class="hero-top">
        <div>
          <div class="eyebrow">Gateway Monitor</div>
          <h1>Mini Agent UI</h1>
          <p class="subtitle">观察 EventStream、流式回复和工具调用。这个面板直接连 Gateway WebSocket，不额外引入前端构建链，适合调试和演示。</p>
        </div>
        <div class="status-pill" id="connectionStatus">状态: <strong>未连接</strong></div>
      </div>

      <div class="toolbar">
        <div class="field">
          <label for="wsUrl">WebSocket URL</label>
          <input id="wsUrl" value="" placeholder="ws://localhost:18789" />
        </div>
        <div class="field">
          <label for="token">Token</label>
          <input id="token" value="" placeholder="可留空" />
        </div>
        <div class="field">
          <label for="sessionKey">Session</label>
          <input id="sessionKey" value="main" />
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <div class="actions">
            <button class="primary" id="connectBtn">连接</button>
            <button class="ghost" id="disconnectBtn">断开</button>
          </div>
        </div>
      </div>

      <div class="stats">
        <div class="stat"><strong id="turnCount">0</strong><span>Turns</span></div>
        <div class="stat"><strong id="toolCount">0</strong><span>Tool Calls</span></div>
        <div class="stat"><strong id="eventCount">0</strong><span>Events</span></div>
        <div class="stat"><strong id="runState">idle</strong><span>Run State</span></div>
      </div>
    </section>

    <section class="grid">
      <div class="stack">
        <article class="card">
          <div class="card-head">
            <h2>Chat</h2>
            <span>发送消息并观察流式输出</span>
          </div>
          <div class="card-body composer">
            <textarea id="messageInput" placeholder="输入一条消息，例如：请列出当前目录并解释 agent-loop 的结构"></textarea>
            <div class="actions">
              <button class="primary" id="sendBtn">发送</button>
              <button class="ghost" id="clearOutputBtn">清空输出</button>
              <button class="ghost" id="historyBtn">读取历史</button>
            </div>
          </div>
        </article>

        <article class="card">
          <div class="card-head">
            <h2>Assistant Stream</h2>
            <span id="streamMeta">等待运行</span>
          </div>
          <div class="card-body">
            <div class="stream" id="streamOutput"><span class="placeholder">这里会显示流式回复。</span></div>
          </div>
        </article>

        <article class="card">
          <div class="card-head">
            <h2>Raw Event Stream</h2>
            <span>最近 120 条</span>
          </div>
          <div class="card-body">
            <div class="event-list" id="eventList"></div>
          </div>
        </article>
      </div>

      <div class="stack">
        <article class="card">
          <div class="card-head">
            <h2>Tool Timeline</h2>
            <span>工具开始、结束、跳过、审批</span>
          </div>
          <div class="card-body">
            <div class="tool-list" id="toolList"></div>
          </div>
        </article>

        <article class="card">
          <div class="card-head">
            <h2>Session History</h2>
            <span>按需加载</span>
          </div>
          <div class="card-body">
            <pre id="historyOutput">暂无历史</pre>
          </div>
        </article>
      </div>
    </section>
  </div>

  <script>
    const state = {
      socket: null,
      pending: new Map(),
      currentText: "",
      turns: 0,
      tools: 0,
      events: 0
    };

    const els = {
      wsUrl: document.getElementById("wsUrl"),
      token: document.getElementById("token"),
      sessionKey: document.getElementById("sessionKey"),
      connectBtn: document.getElementById("connectBtn"),
      disconnectBtn: document.getElementById("disconnectBtn"),
      sendBtn: document.getElementById("sendBtn"),
      historyBtn: document.getElementById("historyBtn"),
      clearOutputBtn: document.getElementById("clearOutputBtn"),
      messageInput: document.getElementById("messageInput"),
      streamOutput: document.getElementById("streamOutput"),
      streamMeta: document.getElementById("streamMeta"),
      eventList: document.getElementById("eventList"),
      toolList: document.getElementById("toolList"),
      historyOutput: document.getElementById("historyOutput"),
      connectionStatus: document.getElementById("connectionStatus"),
      turnCount: document.getElementById("turnCount"),
      toolCount: document.getElementById("toolCount"),
      eventCount: document.getElementById("eventCount"),
      runState: document.getElementById("runState")
    };

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function bootDefaults() {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const defaultWs = proto + "//" + window.location.host;
      els.wsUrl.value = localStorage.getItem("ocm_ws_url") || defaultWs;
      els.token.value = localStorage.getItem("ocm_token") || "";
      els.sessionKey.value = localStorage.getItem("ocm_session") || "main";
    }

    function persistSettings() {
      localStorage.setItem("ocm_ws_url", els.wsUrl.value.trim());
      localStorage.setItem("ocm_token", els.token.value);
      localStorage.setItem("ocm_session", els.sessionKey.value.trim());
    }

    function setStatus(text, tone) {
      const cls = tone === "err" ? "err" : tone === "warn" ? "warn" : "ok";
      els.connectionStatus.innerHTML = "状态: <strong class=\"" + cls + "\">" + escapeHtml(text) + "</strong>";
    }

    function updateStats() {
      els.turnCount.textContent = String(state.turns);
      els.toolCount.textContent = String(state.tools);
      els.eventCount.textContent = String(state.events);
    }

    function setRunState(value) {
      els.runState.textContent = value;
    }

    function safeJson(value) {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }

    function clock() {
      return new Date().toLocaleTimeString("zh-CN", { hour12: false });
    }

    function prepend(container, node, limit) {
      container.prepend(node);
      while (container.children.length > limit) {
        container.removeChild(container.lastElementChild);
      }
    }

    function addEventItem(label, payload) {
      state.events += 1;
      updateStats();
      const item = document.createElement("div");
      item.className = "event-item";
      item.innerHTML =
        "<div class=\"event-top\"><div class=\"event-type\">" + escapeHtml(label) + "</div><div class=\"event-time\">" + clock() + "</div></div>" +
        "<pre>" + escapeHtml(safeJson(payload)) + "</pre>";
      prepend(els.eventList, item, 120);
    }

    function addToolItem(title, meta, body) {
      const item = document.createElement("div");
      item.className = "tool-item";
      item.innerHTML =
        "<div class=\"tool-top\"><div class=\"tool-name\">" + escapeHtml(title) + "</div><div class=\"tool-meta\">" + escapeHtml(meta) + "</div></div>" +
        "<pre>" + escapeHtml(body) + "</pre>";
      prepend(els.toolList, item, 80);
    }

    function setStreamText(text) {
      if (!text) {
        els.streamOutput.innerHTML = "<span class=\"placeholder\">这里会显示流式回复。</span>";
      } else {
        els.streamOutput.textContent = text;
      }
    }

    function resetRunView() {
      state.currentText = "";
      state.turns = 0;
      state.tools = 0;
      setStreamText("");
      els.streamMeta.textContent = "等待运行";
      updateStats();
      setRunState("idle");
    }

    function sendFrame(frame) {
      if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
        throw new Error("not connected");
      }
      state.socket.send(JSON.stringify(frame));
    }

    function request(method, params) {
      const id = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "req_" + Date.now() + "_" + Math.random().toString(16).slice(2);
      sendFrame({ type: "req", id, method, params });
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          state.pending.delete(id);
          reject(new Error("request timeout: " + method));
        }, 60000);
        state.pending.set(id, { resolve, reject, timer });
      });
    }

    function handleResponse(res) {
      const entry = state.pending.get(res.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      state.pending.delete(res.id);
      if (res.ok) entry.resolve(res.payload);
      else entry.reject(new Error((res.error && res.error.message) || "request failed"));
    }

    async function handleEvent(frame) {
      if (frame.event === "connect.challenge") {
        try {
          const payload = frame.payload || {};
          const hello = await request("connect", {
            token: els.token.value || undefined,
            nonce: payload.nonce
          });
          setStatus("已连接", "ok");
          addEventItem("connect.ok", hello);
        } catch (error) {
          setStatus("连接失败", "err");
          addEventItem("connect.error", { message: String(error) });
        }
        return;
      }

      if (frame.event === "chat") {
        addEventItem("chat", frame.payload);
        const payload = frame.payload || {};
        if (payload.state === "delta") {
          state.currentText += payload.text || "";
          setStreamText(state.currentText);
          els.streamMeta.textContent = "run " + (payload.runId || "-") + " streaming";
          setRunState("streaming");
        } else if (payload.state === "final") {
          state.currentText = payload.text || state.currentText;
          setStreamText(state.currentText);
          els.streamMeta.textContent = "run " + (payload.runId || "-") + " completed";
          setRunState("completed");
        } else if (payload.state === "error") {
          els.streamMeta.textContent = "run error";
          setRunState("error");
          addToolItem("run_error", clock(), payload.error || "unknown error");
        }
        return;
      }

      if (frame.event === "agent") {
        const payload = frame.payload || {};
        addEventItem(payload.type || "agent", payload);

        if (payload.type === "agent_start") {
          resetRunView();
          els.streamMeta.textContent = "run " + (payload.runId || "-") + " started";
          setRunState("running");
        } else if (payload.type === "turn_start") {
          state.turns = Math.max(state.turns, Number(payload.turn) || 0);
          updateStats();
        } else if (payload.type === "tool_execution_start") {
          state.tools += 1;
          updateStats();
          addToolItem(payload.toolName || "tool", "start " + clock(), safeJson(payload.args || {}));
        } else if (payload.type === "tool_execution_end") {
          addToolItem(payload.toolName || "tool", "end " + clock(), String(payload.result || ""));
        } else if (payload.type === "tool_skipped") {
          addToolItem(payload.toolName || "tool", "skipped " + clock(), "Skipped due to steering or queued input.");
        } else if (payload.type === "tool_approval_request" || payload.type === "tool_approval_resolved") {
          addToolItem(payload.toolName || "approval", payload.type + " " + clock(), safeJson(payload));
        } else if (payload.type === "retry" || payload.type === "context_overflow_compact" || payload.type === "agent_error") {
          addToolItem(payload.type, clock(), safeJson(payload));
        } else if (payload.type === "agent_end") {
          setRunState("idle");
        }
        return;
      }

      if (frame.event === "tick") {
        return;
      }

      addEventItem(frame.event, frame.payload);
    }

    function disconnect() {
      for (const [id, pending] of state.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error("socket closed"));
        state.pending.delete(id);
      }
      if (state.socket) {
        try {
          state.socket.close(1000, "manual disconnect");
        } catch {}
      }
      state.socket = null;
    }

    function connect() {
      persistSettings();
      disconnect();
      resetRunView();
      els.eventList.innerHTML = "";
      els.toolList.innerHTML = "";
      setStatus("连接中", "warn");

      const ws = new WebSocket(els.wsUrl.value.trim());
      state.socket = ws;

      ws.addEventListener("open", () => {
        setStatus("等待握手", "warn");
      });

      ws.addEventListener("message", async (event) => {
        let frame;
        try {
          frame = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (frame.type === "res") handleResponse(frame);
        if (frame.type === "event") await handleEvent(frame);
      });

      ws.addEventListener("close", (event) => {
        setStatus("已断开", event.code === 1000 ? "warn" : "err");
        addEventItem("socket.close", { code: event.code, reason: event.reason });
        state.socket = null;
      });

      ws.addEventListener("error", () => {
        setStatus("连接异常", "err");
      });
    }

    async function sendMessage() {
      const message = els.messageInput.value.trim();
      if (!message) return;
      try {
        persistSettings();
        if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
          throw new Error("not connected");
        }
        await request("chat.send", {
          sessionKey: els.sessionKey.value.trim() || "main",
          message
        });
        els.messageInput.value = "";
        addEventItem("chat.send", { sessionKey: els.sessionKey.value.trim() || "main", message });
      } catch (error) {
        addEventItem("chat.send.error", { message: String(error) });
      }
    }

    async function loadHistory() {
      try {
        const payload = await request("chat.history", {
          sessionKey: els.sessionKey.value.trim() || "main"
        });
        els.historyOutput.textContent = safeJson(payload);
      } catch (error) {
        els.historyOutput.textContent = String(error);
      }
    }

    els.connectBtn.addEventListener("click", connect);
    els.disconnectBtn.addEventListener("click", disconnect);
    els.sendBtn.addEventListener("click", sendMessage);
    els.historyBtn.addEventListener("click", loadHistory);
    els.clearOutputBtn.addEventListener("click", resetRunView);
    els.messageInput.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        sendMessage();
      }
    });

    bootDefaults();
    resetRunView();
  </script>
</body>
</html>`;
}
