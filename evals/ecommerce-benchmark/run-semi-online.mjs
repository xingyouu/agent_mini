import fs from 'node:fs';
import path from 'node:path';
import { Agent } from '../../dist/src/index.js';

const ROOT = process.cwd();
const EVAL_DIR = path.join(ROOT, 'evals', 'ecommerce-benchmark');
const rows = fs.readFileSync(path.join(EVAL_DIR, 'benchmark-semi-online.jsonl'), 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

const provider = process.env.MINI_AGENT_PROVIDER ?? 'google';
const model = process.env.MINI_AGENT_MODEL ?? 'gemini-2.5-flash';
const apiKey = process.env.GEMINI_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY;
const RUN_SLEEP_MS = Number(process.env.SEMI_ONLINE_SLEEP_MS ?? 4000);
const BACKOFF_BASE_MS = Number(process.env.SEMI_ONLINE_BACKOFF_BASE_MS ?? 5000);
const BACKOFF_MAX_MS = Number(process.env.SEMI_ONLINE_BACKOFF_MAX_MS ?? 60000);
const MAX_QUOTA_RETRIES = Number(process.env.SEMI_ONLINE_MAX_QUOTA_RETRIES ?? 4);

function normalize(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function includesAll(text, list = []) {
  return list.every((item) => text.includes(item));
}

function includesAny(text, list = []) {
  return list.some((item) => text.includes(item));
}

function semanticPass(caseDef, finalText) {
  const text = normalize(finalText);
  const checks = caseDef.auto_checks ?? {};
  const positives = [];
  if (checks.answer_should_semantically_include) positives.push(includesAll(text, checks.answer_should_semantically_include));
  if (checks.answer_should_semantically_include_one_of) positives.push(includesAny(text, checks.answer_should_semantically_include_one_of));
  if (checks.must_not_conclude) positives.push(!includesAny(text, checks.must_not_conclude));
  return positives.length === 0 ? true : positives.every(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isQuotaError(message) {
  const text = normalize(message).toLowerCase();
  return text.includes('429') || text.includes('quota') || text.includes('resource_exhausted');
}

function formatPct(value) {
  return value === null ? 'N/A' : (value * 100).toFixed(1) + '%';
}

function buildTools(caseDef, runtime) {
  const mock = caseDef.fixture?.mock_tools ?? {};
  const fault = caseDef.fixture?.fault_injection ?? {};
  const count = (name) => {
    runtime.toolAttempts[name] = (runtime.toolAttempts[name] ?? 0) + 1;
    return runtime.toolAttempts[name];
  };
  const resolveQuery = (table, key) => {
    if (key in table) return table[key];
    const found = Object.entries(table).find(([k]) => key.includes(k) || k.includes(key));
    return found?.[1];
  };
  return [
    {
      name: 'kb_search',
      description: 'Search policy knowledge base',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      execute: async (input) => {
        const attempt = count('kb_search');
        const injected = fault.kb_search;
        if (injected?.attempt_1 === 'timeout' && attempt === 1) throw new Error('timeout');
        const value = resolveQuery(mock.kb_search ?? {}, input.query);
        if (value == null) throw new Error('kb result not found');
        return typeof value === 'string' ? value : JSON.stringify(value);
      },
    },
    {
      name: 'get_order',
      description: 'Get order detail',
      inputSchema: { type: 'object', properties: { order_id: { type: 'string' } }, required: ['order_id'] },
      execute: async (input) => {
        const attempt = count('get_order');
        const injected = fault.get_order;
        if (injected?.attempt_1 === 'malformed' && attempt === 1) return 'malformed response';
        const value = mock.get_order?.[input.order_id];
        if (value == null) throw new Error('order not found');
        return typeof value === 'string' ? value : JSON.stringify(value);
      },
    },
    {
      name: 'get_product',
      description: 'Get product detail',
      inputSchema: { type: 'object', properties: { sku_or_name: { type: 'string' } }, required: ['sku_or_name'] },
      execute: async (input) => {
        const value = resolveQuery(mock.get_product ?? {}, input.sku_or_name);
        if (value == null) throw new Error('product not found');
        return typeof value === 'string' ? value : JSON.stringify(value);
      },
    },
    {
      name: 'calc',
      description: 'Calculate expression',
      inputSchema: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
      execute: async (input) => {
        count('calc');
        const value = resolveQuery(mock.calc ?? {}, input.expression);
        if (value == null) throw new Error('calc unavailable');
        return String(value);
      },
    },
    {
      name: 'cancel_order',
      description: 'Cancel order',
      inputSchema: { type: 'object', properties: { order_id: { type: 'string' } }, required: ['order_id'] },
      execute: async (input) => {
        const attempt = count('cancel_order');
        const injected = fault.cancel_order;
        if (injected?.always === '500') throw new Error('500 internal error #' + attempt);
        const value = mock.cancel_order?.[input.order_id] ?? { result: 'success' };
        return typeof value === 'string' ? value : JSON.stringify(value);
      },
    },
    {
      name: 'create_return',
      description: 'Create return request',
      inputSchema: { type: 'object', properties: { order_id: { type: 'string' }, item: { type: 'string' }, reason: { type: 'string' } }, required: ['order_id', 'item', 'reason'] },
      execute: async (input) => JSON.stringify({ ok: true, return_id: 'R-' + input.order_id, ...input }),
    },
    {
      name: 'create_ticket',
      description: 'Create support ticket',
      inputSchema: { type: 'object', properties: { order_id: { type: 'string' }, reason: { type: 'string' } }, required: ['order_id', 'reason'] },
      execute: async (input) => JSON.stringify({ ok: true, ticket_id: 'T-' + input.order_id, ...input }),
    },
    {
      name: 'escalate_to_human',
      description: 'Escalate to human',
      inputSchema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
      execute: async (input) => JSON.stringify({ ok: true, escalated: true, ...input }),
    },
  ];
}

function promptsForCase(caseDef) {
  if (caseDef.fixture?.conversation_plan) return caseDef.fixture.conversation_plan;
  return [caseDef.user_prompt];
}

async function preseed(agent, sessionKey, caseDef) {
  const history = caseDef.fixture?.history_turns ?? [];
  for (const item of history) {
    await agent.run(sessionKey, `������Ϣ��${item}`);
  }
}

function grade(caseDef, trace, finalText, blockedReason = null) {
  const blockedByQuota = blockedReason ? isQuotaError(blockedReason) : false;
  if (blockedReason) {
    return {
      status: 'blocked',
      blocked_by_quota: blockedByQuota ? 1 : 0,
      blocked_reason: blockedReason,
      success: 0,
      route_pass: 0,
      tool_pass: 0,
      arg_pass: 0,
      followup_pass: caseDef.followup_required ? 0 : 'NA',
      approval_pass: caseDef.approval_required ? 0 : 'NA',
      retry_pass: caseDef.retry_expected ? 0 : 'NA',
      compaction_pass: caseDef.category === 'compaction' ? 0 : 'NA',
      quality_score: 0,
      steps: trace.turns,
      tool_calls: trace.toolCalls.length,
      latency_ms: trace.latencyMs,
      final_text: normalize(finalText),
    };
  }
  const text = normalize(finalText);
  const toolNames = trace.toolCalls.map((t) => t.toolName);
  const toolPass = (caseDef.expected_tools ?? []).every((name) => toolNames.includes(name)) && !(caseDef.auto_checks?.tool_call_should_not_include ?? []).some((name) => toolNames.includes(name));
  let argPass = true;
  for (let i = 0; i < (caseDef.expected_args ?? []).length; i++) {
    const expected = caseDef.expected_args[i];
    const toolName = caseDef.expected_tools?.[i];
    const matched = trace.toolCalls.find((call) => call.toolName === toolName && Object.entries(expected).every(([k, v]) => JSON.stringify(call.args?.[k]) === JSON.stringify(v)));
    if (!matched) argPass = false;
  }
  let routePass = true;
  if (caseDef.expected_route === 'follow_up_first') routePass = trace.toolCalls.length === 0;
  if (caseDef.expected_route.includes('tool') || caseDef.expected_route.includes('read') || caseDef.expected_route.includes('multi') || caseDef.expected_route.includes('check') || caseDef.expected_route.includes('retry')) routePass = toolPass;
  let followupPass = 'NA';
  if (caseDef.followup_required) followupPass = trace.toolCalls.length === 0 && (text.includes('������') || text.includes('��Ʒ') || text.includes('��ַ')) ? 1 : 0;
  let approvalPass = 'NA';
  if (caseDef.approval_required) {
    const approvalRequests = trace.approvalEvents.filter((e) => e.type === 'tool_approval_request').map((e) => e.toolName);
    const writeCalls = trace.toolCalls.filter((t) => ['cancel_order', 'create_return', 'create_ticket'].includes(t.toolName)).map((t) => t.toolName);
    approvalPass = writeCalls.every((name) => approvalRequests.includes(name)) ? 1 : 0;
  }
  let retryPass = 'NA';
  if (caseDef.retry_expected) retryPass = trace.retryCount > 0 ? 1 : 0;
  let compactionPass = 'NA';
  if (caseDef.category === 'compaction') compactionPass = semanticPass(caseDef, text) ? 1 : 0;
  const success = semanticPass(caseDef, text) && routePass && toolPass && argPass ? 1 : 0;
  return {
    status: 'ok',
    blocked_by_quota: 0,
    blocked_reason: null,
    success,
    route_pass: routePass ? 1 : 0,
    tool_pass: toolPass ? 1 : 0,
    arg_pass: argPass ? 1 : 0,
    followup_pass: followupPass,
    approval_pass: approvalPass,
    retry_pass: retryPass,
    compaction_pass: compactionPass,
    quality_score: success ? 5 : (semanticPass(caseDef, text) ? 3 : 1),
    steps: trace.turns,
    tool_calls: trace.toolCalls.length,
    latency_ms: trace.latencyMs,
    final_text: text,
  };
}

async function runOne(caseDef, iteration) {
  let quotaRetryCount = 0;
  while (true) {
    const runtime = { toolAttempts: {} };
    const trace = { toolCalls: [], approvalEvents: [], turns: 0, retryCount: 0, latencyMs: 0 };
    const agent = new Agent({
      provider,
      model,
      apiKey,
      workspaceDir: ROOT,
      tools: buildTools(caseDef, runtime),
      approval: { ask: 'always', security: 'full' },
      onApprovalRequest: async () => 'allow-once',
      enableSkills: false,
      enableMemory: false,
      enableHeartbeat: false,
    });
    const unsubscribe = agent.subscribe((event) => {
      if (event.type === 'tool_execution_start') trace.toolCalls.push({ toolName: event.toolName, args: event.args, turn: trace.turns + 1 });
      if (event.type === 'tool_approval_request' || event.type === 'tool_approval_resolved') trace.approvalEvents.push(event);
      if (event.type === 'turn_end') trace.turns = Math.max(trace.turns, event.turn);
      if (event.type === 'retry') trace.retryCount += 1;
    });

    const sessionKey = `semi-${caseDef.id}-${iteration}-q${quotaRetryCount}`;
    let lastText = '';
    let blockedReason = null;
    const started = Date.now();
    try {
      await agent.reset(sessionKey);
      await preseed(agent, sessionKey, caseDef);
      for (const prompt of promptsForCase(caseDef)) {
        const result = await agent.run(sessionKey, prompt);
        lastText = result.text;
      }
    } catch (error) {
      blockedReason = error instanceof Error ? error.message : String(error);
    } finally {
      trace.latencyMs = Date.now() - started;
      unsubscribe();
    }

    const quotaBlocked = blockedReason && isQuotaError(blockedReason);
    if (quotaBlocked && quotaRetryCount < MAX_QUOTA_RETRIES) {
      const delayMs = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * (2 ** quotaRetryCount));
      quotaRetryCount += 1;
      await sleep(delayMs);
      continue;
    }

    return {
      id: caseDef.id,
      iteration,
      category: caseDef.category,
      quota_retry_count: quotaRetryCount,
      ...grade(caseDef, trace, lastText, blockedReason),
    };
  }
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

function rate(values) {
  const valid = values.filter((v) => v !== 'NA' && v !== 'BLOCKED');
  return valid.length ? mean(valid) : null;
}

const perRun = [];
for (const [rowIndex, row] of rows.entries()) {
  const repeats = row.fixture?.run_repeats ?? 3;
  for (let i = 1; i <= repeats; i++) {
    perRun.push(await runOne(row, i));
    const isLastRun = rowIndex === rows.length - 1 && i === repeats;
    if (!isLastRun && RUN_SLEEP_MS > 0) {
      await sleep(RUN_SLEEP_MS);
    }
  }
}

const grouped = Object.values(Object.groupBy(perRun, (row) => row.id));
const blocked = perRun.filter((r) => r.status === 'blocked');
const blockedByQuota = perRun.filter((r) => r.blocked_by_quota === 1);
const scorableRuns = perRun.filter((r) => r.status !== 'blocked' && r.blocked_by_quota !== 1);
const scorableGroups = grouped.filter((group) => group.some((row) => row.status !== 'blocked' && row.blocked_by_quota !== 1));
const pass3Groups = grouped.filter((group) => group.every((row) => row.blocked_by_quota !== 1));

const summary = {
  mode: 'semi-online',
  provider,
  model,
  execution_mode: 'serial',
  sleep_between_runs_ms: RUN_SLEEP_MS,
  quota_backoff: {
    base_ms: BACKOFF_BASE_MS,
    max_ms: BACKOFF_MAX_MS,
    max_retries: MAX_QUOTA_RETRIES,
  },
  total_cases: rows.length,
  total_runs: perRun.length,
  blocked_runs: blocked.length,
  blocked_by_quota_runs: blockedByQuota.length,
  scorable_runs: scorableRuns.length,
  scorable_cases: scorableGroups.length,
  success_at_1: scorableGroups.length ? mean(scorableGroups.map((group) => {
    const firstScorable = group.find((row) => row.status !== 'blocked' && row.blocked_by_quota !== 1);
    return firstScorable ? firstScorable.success : 0;
  })) : null,
  pass_at_3: pass3Groups.length ? mean(pass3Groups.map((group) => group.every((row) => row.status !== 'blocked' && row.success === 1) ? 1 : 0)) : null,
  route_accuracy: rate(scorableRuns.map((r) => r.route_pass)),
  tool_accuracy: rate(scorableRuns.map((r) => r.tool_pass)),
  arg_accuracy: rate(scorableRuns.map((r) => r.arg_pass)),
  followup_accuracy: rate(scorableRuns.map((r) => r.followup_pass)),
  approval_compliance: rate(scorableRuns.map((r) => r.approval_pass)),
  retry_recovery: rate(scorableRuns.map((r) => r.retry_pass)),
  compaction_retention: rate(scorableRuns.map((r) => r.compaction_pass)),
  quality_score: scorableRuns.length ? mean(scorableRuns.map((r) => r.quality_score)) : null,
  avg_steps: scorableRuns.length ? mean(scorableRuns.map((r) => r.steps)) : null,
  avg_tool_calls: scorableRuns.length ? mean(scorableRuns.map((r) => r.tool_calls)) : null,
  avg_latency_ms: mean(perRun.map((r) => r.latency_ms)),
};

const outJson = path.join(EVAL_DIR, 'results-semi-online.json');
const outMd = path.join(EVAL_DIR, 'results-semi-online.md');
fs.writeFileSync(outJson, JSON.stringify({ summary, per_run: perRun }, null, 2));

const md = [
  '# Semi-Online Benchmark Results',
  '',
  `- provider: \`${provider}\``,
  `- model: \`${model}\``,
  `- execution mode: \`${summary.execution_mode}\``,
  `- sleep between runs: ${summary.sleep_between_runs_ms} ms`,
  `- quota backoff: base ${summary.quota_backoff.base_ms} ms, max ${summary.quota_backoff.max_ms} ms, retries ${summary.quota_backoff.max_retries}`,
  `- total cases: ${summary.total_cases}`,
  `- total runs: ${summary.total_runs}`,
  `- blocked runs: ${summary.blocked_runs}`,
  `- blocked by quota: ${summary.blocked_by_quota_runs}`,
  `- scorable runs: ${summary.scorable_runs}`,
  `- scorable cases: ${summary.scorable_cases}`,
  `- Success@1: ${formatPct(summary.success_at_1)}`,
  `- Pass^3: ${formatPct(summary.pass_at_3)}`,
  `- Route Accuracy: ${formatPct(summary.route_accuracy)}`,
  `- Tool Accuracy: ${formatPct(summary.tool_accuracy)}`,
  `- Arg Accuracy: ${formatPct(summary.arg_accuracy)}`,
  `- Follow-up Accuracy: ${formatPct(summary.followup_accuracy)}`,
  `- Approval Compliance: ${formatPct(summary.approval_compliance)}`,
  `- Retry Recovery: ${formatPct(summary.retry_recovery)}`,
  `- Compaction Retention: ${formatPct(summary.compaction_retention)}`,
  `- Quality Score: ${summary.quality_score === null ? 'N/A' : summary.quality_score.toFixed(2) + ' / 5'}`,
  `- Avg Steps: ${summary.avg_steps === null ? 'N/A' : summary.avg_steps.toFixed(2)}`,
  `- Avg Tool Calls: ${summary.avg_tool_calls === null ? 'N/A' : summary.avg_tool_calls.toFixed(2)}`,
  `- Avg Latency: ${summary.avg_latency_ms === null ? 'N/A' : summary.avg_latency_ms.toFixed(2) + ' ms'}`,
  '',
  '## Note',
  '',
  'This run uses a real configured LLM together with controlled mock tools.',
  '',
  'Quota-blocked runs are tracked separately as `blocked_by_quota` and are excluded from success-rate denominators.',
  'The runner executes serially, sleeps a fixed interval between runs, and applies exponential backoff when it sees 429/quota-style failures.',
];
fs.writeFileSync(outMd, md.join('\n'));
console.log(JSON.stringify(summary, null, 2));
