import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
});


import { LLMRouter } from './router.js';
import { ProviderConfig, ModelTier, ChatMessage, ToolCall } from './types.js';
import { ConversationLogger } from './conversation-logger.js';
import { ProviderStateManager } from './state.js';
import { ErrorClassifier } from './error-classifier.js';
import crypto from 'crypto';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

export function createApp(
  configs: ProviderConfig[],
  state: ProviderStateManager,
  classifier: ErrorClassifier,
  logger?: ConversationLogger,
) {
  const router = new LLMRouter(configs, state, classifier);
  const app = express();
// Assign a unique request ID to each incoming request
app.use((req, res, next) => {
  const requestId = crypto.randomUUID();
  (req as any).requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
});
app.use(cors());
app.use(limiter);
// expose rate limit info in headers
app.use((req, res, next) => {
  const headers = res.getHeaders();
  // express-rate-limit stores remaining limit in res.locals
  const remaining = (res as any).getHeader('RateLimit-Remaining') ?? (res as any).locals?.rateLimit?.remaining;
  if (remaining !== undefined) {
    res.setHeader('X-RateLimit-Remaining', String(remaining));
  }
  next();
});
  app.use(morgan('combined'));
app.use((req, res, next) => { console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`); next(); });


  app.use(express.json());

  app.get('/v1/models', (_req, res) => {
    res.json({
      object: 'list',
      data: ['default'].map(id => ({
        id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'free-llm-router',
      })),
    });
  });

  app.post('/v1/chat/completions', async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }
    // const body = req.body as Record<string, unknown>;
    const startMs = Date.now();
    const tools = body.tools as Array<unknown> | undefined;
    const toolChoice = body.tool_choice;
    const hasTools = tools && tools.length > 0;
    console.log(`[request] id=${(req as any).requestId} model=${body.model} stream=${body.stream} messages=${(body.messages as any[])?.length || 0} tools=${hasTools ? tools!.length : 0} tool_choice=${toolChoice ?? 'none'} temperature=${body.temperature ?? 'default'}`);

    if (body.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const modelId = (body.model as string) || 'default';
      const responseId = `chatcmpl-${crypto.randomUUID().slice(0, 12)}`;
      const created = Math.floor(Date.now() / 1000);

      try {
        let lastProvider: string | undefined;
        let accContent = '';
        const accToolCalls: ToolCall[] = [];

        for await (const { chunk, providerUsed } of router.streamChat(body as any)) {
          lastProvider = providerUsed;

          let delta: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(chunk);
            if (parsed.content !== undefined) {
              if (parsed.content !== null) {
                accContent += parsed.content;
                delta.content = parsed.content;
              }
            }
            if (parsed.tool_calls) {
              delta.tool_calls = parsed.tool_calls;
              for (const tc of parsed.tool_calls as ToolCall[]) {
                const idx = (tc as any).index ?? accToolCalls.length;
                if (accToolCalls[idx]) {
                  accToolCalls[idx].function.arguments += tc.function?.arguments || '';
                } else {
                  accToolCalls[idx] = tc;
                }
              }
            }
            if (parsed.role) {
              delta.role = parsed.role;
            }
          } catch {
            delta.content = chunk;
          }
          if (Object.keys(delta).length === 0) continue;
          res.write(`data: ${JSON.stringify({
            id: responseId, object: 'chat.completion.chunk', created, model: modelId,
            choices: [{ index: 0, delta, finish_reason: null }],
          })}\n\n`);
        }
        console.log(`[response] id=${(req as any).requestId} stream OK provider=${lastProvider ?? '(unknown)'} latency=${Date.now() - startMs}ms`);

        if (logger) {
          const assistantMsg: ChatMessage = { role: 'assistant', content: accContent || null };
          if (accToolCalls.length) assistantMsg.tool_calls = accToolCalls;
          logger.record([...(body.messages as ChatMessage[]), assistantMsg]);
        }
      } catch (e) {
        console.error(`[response] stream FAIL: ${(e as Error).message.slice(0, 200)}`);
        res.write(`data: ${JSON.stringify({
          id: responseId, object: 'chat.completion.chunk', created, model: modelId,
          choices: [{ index: 0, delta: { content: (e as Error).message }, finish_reason: 'stop' }],
        })}\n\n`);
      }

      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    try {
      const { response, providerUsed } = await router.chat(body as any);
      const latency = Date.now() - startMs;
      const finish = response.choices?.[0]?.finish_reason || '?';
      const tokens = response.usage?.total_tokens || 0;
      const contentLen = (response.choices?.[0]?.message?.content || '').length;
      console.log(`[response] OK provider=${providerUsed} model=${response.model} latency=${latency}ms tokens=${tokens} finish=${finish} content=${contentLen}chars`);
      if (logger) {
        logger.record([...(body.messages as ChatMessage[]), response.choices[0].message]);
      }
      res.setHeader('X-Provider', providerUsed);
      res.json(response);
    } catch (e) {
      const latency = Date.now() - startMs;
      console.log(`[response] FAIL latency=${latency}ms: ${(e as Error).message.slice(0, 300)}`);
      res.status(502).json({
        error: {
          message: (e as Error).message,
          type: 'provider_error',
        },
      });
    }
  });

  app.get('/debug/route', async (req, res) => {
    const model = (req.query.model as string) || 'default';
    const provider = req.query.provider as string | undefined;

    const result = await router.debugRoute({ model, provider });
    res.json(result);
  });

  app.post('/debug/test-model', async (req, res) => {
    const { provider, model } = req.body as { provider?: string; model?: string };
    if (!provider || !model) {
      res.status(400).json({ error: 'provider and model are required' });
      return;
    }
    const result = await router.debugTestModel(provider, model);
    res.json(result);
  });

  if (logger) {
    app.get('/admin/conversations', (req, res) => {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const since = req.query.since ? parseInt(req.query.since as string, 10) : undefined;
      const entries = logger.query({ limit, since });
      res.json({
        count: entries.length,
        total: logger.size,
        entries,
      });
    });
  }

  // Health endpoint returns status and config
app.get('/providers', (_req, res) => {res.json({providers: configs.map(c => c.key)});});

// Root endpoint - status page
app.get('/', (_req, res) => {
  const allStates = state.getAllStates();
  const allModels = configs.flatMap(c => c.models);
  const totalTokens = allModels.reduce((s, m) => s + m.contextWindow, 0);
  const scores = router.getProviderScores();
  const scoreMap = new Map(scores.map(s => [s.key, s.score]));
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Free LLM Router</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; justify-content: center; padding: 3rem 1rem; }
    .container { max-width: 800px; width: 100%; }
    h1 { font-size: 2rem; margin-bottom: 0.25rem; }
    .subtitle { color: #94a3b8; margin-bottom: 2rem; }
    .card { background: #1e293b; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; }
    .card h2 { font-size: 1.125rem; margin-bottom: 1rem; color: #38bdf8; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; }
    .stat { background: #334155; border-radius: 6px; padding: 0.75rem; text-align: center; }
    .stat .value { font-size: 1.5rem; font-weight: 700; }
    .stat .label { font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.25rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td { text-align: left; padding: 0.5rem 0.5rem 0.5rem 0; border-bottom: 1px solid #334155; }
    th { color: #94a3b8; font-weight: 600; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; }
    .badge { display: inline-block; padding: 0.125rem 0.5rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
    .badge.healthy { background: #065f46; color: #6ee7b7; }
    .badge.degraded { background: #78350f; color: #fcd34d; }
    .badge.error { background: #7f1d1d; color: #fca5a5; }
    .badge.down { background: #7f1d1d; color: #fca5a5; }
    .badge.unauthenticated { background: #422006; color: #fbbf24; border: 1px solid #92400e; }
    .badge.unknown { background: #1e293b; color: #94a3b8; border: 1px solid #334155; }
    .endpoint { background: #0f172a; border-radius: 4px; padding: 0.5rem 0.75rem; font-family: monospace; font-size: 0.8125rem; color: #a5f3fc; margin-top: 1rem; overflow-x: auto; white-space: nowrap; }
    .btn { display: inline-flex; align-items: center; gap: 0.5rem; background: #38bdf8; color: #0f172a; border: none; padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.875rem; font-weight: 600; cursor: pointer; }
    .btn:hover { background: #7dd3fc; }
    .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 100; justify-content: center; align-items: center; padding: 1rem; }
    .modal-overlay.open { display: flex; }
    .modal { background: #1e293b; border-radius: 12px; width: 100%; max-width: 640px; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid #334155; }
    .modal-header h2 { font-size: 1.125rem; color: #e2e8f0; margin: 0; }
    .modal-close { background: none; border: none; color: #94a3b8; font-size: 1.25rem; cursor: pointer; padding: 0.25rem; line-height: 1; }
    .modal-close:hover { color: #e2e8f0; }
    .modal-body { padding: 1.25rem; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 0.75rem; }
    .modal-body label { font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
    .modal-body select, .modal-body textarea { background: #0f172a; color: #e2e8f0; border: 1px solid #334155; border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 0.875rem; font-family: inherit; width: 100%; }
    .modal-body textarea { min-height: 100px; resize: vertical; }
    .modal-body select:focus, .modal-body textarea:focus { outline: none; border-color: #38bdf8; }
    .chat-response { background: #0f172a; border-radius: 6px; padding: 0.75rem; font-size: 0.875rem; line-height: 1.5; white-space: pre-wrap; word-break: break-word; min-height: 60px; max-height: 300px; overflow-y: auto; color: #e2e8f0; font-family: inherit; }
    .chat-response .placeholder { color: #475569; }
    .chat-response .streaming { color: #a5f3fc; }
    .chat-response .done { color: #6ee7b7; }
    .chat-response .error { color: #fca5a5; }
    .modal-footer { padding: 1rem 1.25rem; border-top: 1px solid #334155; display: flex; justify-content: flex-end; gap: 0.5rem; }
    .modal-footer .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: #334155; color: #e2e8f0; }
    .btn-secondary:hover { background: #475569; }
    .footer { margin-top: 2rem; text-align: center; font-size: 0.75rem; color: #475569; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Free LLM Router</h1>
    <p class="subtitle">OpenAI-compatible proxy with automatic provider fallback</p>

    <div class="card">
      <h2>Overview</h2>
      <div class="stat-grid">
        <div class="stat"><div class="value">${configs.length}</div><div class="label">Providers</div></div>
        <div class="stat"><div class="value">${allModels.length}</div><div class="label">Models</div></div>
        <div class="stat"><div class="value">${formatUptime(process.uptime())}</div><div class="label">Uptime</div></div>
        <div class="stat"><div class="value">v${version}</div><div class="label">Version</div></div>
      </div>
    </div>

    <div class="card">
      <h2>Providers</h2>
      <table>
        <thead><tr><th>Provider</th><th>Status</th><th>Models</th><th>Avg Latency</th><th>Score</th></tr></thead>
        <tbody>
          ${allStates.map(({ key, state }) => {
            const config = configs.find(c => c.key === key);
            const modelCount = config?.models.length ?? 0;
            const avgLat = state.latencyMs.length > 0 ? Math.round(state.latencyMs.reduce((a, b) => a + b, 0) / state.latencyMs.length) + 'ms' : '—';
            const s = scoreMap.get(key) ?? 0;
            const displayHealth = state.latencyMs.length > 0 && (state.latencyMs.reduce((a, b) => a + b, 0) / state.latencyMs.length) > 2000 ? 'degraded' : state.health;
            return `<tr><td>${key}</td><td><span class="badge ${displayHealth}">${displayHealth}</span></td><td>${modelCount}</td><td>${avgLat}</td><td>${s}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>API Endpoint</h2>
      <div class="endpoint">POST /v1/chat/completions</div>
      <div class="endpoint" style="margin-top:0.5rem;">GET /v1/models</div>
      <button class="btn" style="margin-top:1rem;" onclick="openChatModal()">Test Chat</button>
    </div>

    <div class="modal-overlay" id="chatModal">
      <div class="modal">
        <div class="modal-header">
          <h2>Test Chat</h2>
          <button class="modal-close" onclick="closeChatModal()">&times;</button>
        </div>
        <div class="modal-body">
          <label for="model-select">Model</label>
          <select id="model-select">
            <option value="default">default</option>
          </select>
          <label for="message-input">Message</label>
          <textarea id="message-input" placeholder="Type your message here...">Hello! What can you do?</textarea>
          <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
            <input type="checkbox" id="streamToggle" checked> Use streaming
          </label>
          <label>Response</label>
          <div class="chat-response" id="chatResponse"><span class="placeholder">Response will appear here...</span></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeChatModal()">Close</button>
          <button class="btn" id="sendBtn" onclick="sendTestMessage()">Send</button>
        </div>
      </div>
    </div>

    <div class="footer">Free LLM Router v${version}</div>
    <script>
    let abortController = null;

    function openChatModal() {
      document.getElementById('chatModal').classList.add('open');
      document.getElementById('message-input').focus();
    }

    function closeChatModal() {
      if (abortController) { abortController.abort(); abortController = null; }
      document.getElementById('chatModal').classList.remove('open');
    }

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeChatModal();
    });

    async function sendTestMessage() {
      const model = document.getElementById('model-select').value;
      const message = document.getElementById('message-input').value.trim();
      if (!message) return;

      const responseEl = document.getElementById('chatResponse');
      const sendBtn = document.getElementById('sendBtn');
      const useStream = document.getElementById('streamToggle').checked;

      responseEl.innerHTML = '<span class="streaming">Thinking...</span>';
      sendBtn.disabled = true;
      abortController = new AbortController();

      try {
        if (useStream) {
          await doStream(model, message);
        } else {
          await doNonStream(model, message);
        }
      } catch (e) {
        if (e.name === 'AbortError') {
          responseEl.innerHTML = '<span class="placeholder">Cancelled.</span>';
          return;
        }
        if (useStream && e.message && e.message.includes('All providers failed')) {
          responseEl.innerHTML = '<span class="streaming">Streaming failed, trying non-streaming...</span>';
          try {
            await doNonStream(model, message);
          } catch (e2) {
            responseEl.innerHTML = '<span class="error">' + escapeHtml(e2.message) + '</span>';
          }
        } else {
          responseEl.innerHTML = '<span class="error">' + escapeHtml(e.message) + '</span>';
        }
      } finally {
        abortController = null;
        sendBtn.disabled = false;
      }
    }

    async function doStream(model, message) {
      const responseEl = document.getElementById('chatResponse');
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: message }], stream: true }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        let msg = body;
        try { const j = JSON.parse(body); msg = j.error?.message || j.error || body; } catch {}
        throw new Error(msg);
      }

      if (!res.body) throw new Error('Response has no body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let content = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) content += delta;
            responseEl.innerHTML = '<span class="streaming">' + escapeHtml(content) + '</span>';
            responseEl.scrollTop = responseEl.scrollHeight;
          } catch {}
        }
      }

      responseEl.innerHTML = '<span class="done">' + escapeHtml(content) + '</span>';
    }

    async function doNonStream(model, message) {
      const responseEl = document.getElementById('chatResponse');
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: message }], stream: false }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        let msg = body;
        try { const j = JSON.parse(body); msg = j.error?.message || j.error || body; } catch {}
        throw new Error(msg);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      const finish = data.choices?.[0]?.finish_reason || '';
      const usage = data.usage ? \`(\${data.usage.prompt_tokens} in / \${data.usage.completion_tokens} out)\` : '';
      responseEl.innerHTML = '<span class="done">' + escapeHtml(content) + '</span><br><br><span style="color:#64748b;font-size:0.75rem;">' + finish + ' ' + usage + '</span>';
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }
    </script>
  </div>
</body>
</html>`);
});

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(d + 'd');
  if (h > 0) parts.push(h + 'h');
  if (m > 0) parts.push(m + 'm');
  return parts.join(' ') || '< 1m';
}

app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptime_seconds: process.uptime(),
      version,
      providers: configs.map(c => c.key),
      models: router.getModelsByTier('default').length,
    });
  });

  return app;
}
