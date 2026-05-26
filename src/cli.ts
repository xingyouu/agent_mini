#!/usr/bin/env node
/**
 * Mini Agent CLI
 *
 * 濠电偛鐡ㄩ崵搴ㄥ磹閹炬儼濮抽柟娈垮枟婵ジ鏌熺憴鍕Е闁告埃鍋?
 * - 缂傚倷鑳堕崑鎾垛偓绗涘洤鐒垫い鎴墮鐎氼喖鈻旀繝鍥ㄧ厱闁哄倽顕ф慨鈧紓渚€顤傞崣鍐ㄧ暦濞嗘挻鍋栭悗闈涙憸椤︻喗绻涢幋鐐村碍缂佸纾幑銏狀潩閼搁潧浠煎┑鐐叉缁绘垹绮婃總鍛婂€甸悷娆忓婢规绱掗妸锕€鈻曢柡灞界墦婵℃悂濡烽妷鈺傤唭闂?
 * - 闂佸搫顦悧濠囧箰閹间礁鐭楅柛鈩冪☉缁犵敻鏌熼柇锕€鏋斿ù鐘崇☉閳规垿顢欑喊鍗炲壋缂備緡鍠楅幐楣冨箲閸曨垱鍋勯柛蹇曗拡閸氬倿姊洪棃鈺勭闁告柨绉撮妴鎺楀醇閺囩偠袝闁圭厧鐡ㄧ换鍕敂闁秵鐓涘璺烘婢ц尙绱掓径灞藉幋妤犵偘绶氶、娑樷枎閹搭厼鎮堥梻?
 * - 闂備礁鎲￠敋婵☆偅顨夐妵鎰板醇閺囩偟顦遍柡澶屽仦婢瑰棝鎯岀仦瑙掑酣宕堕妸褏鐣奸梺鍝勬閸嬫捇姊哄ú缁樺▏闁告柨绉瑰畷?婵犵妲呴崹顏堝焵椤掆偓绾绢參鍩€?闁诲氦顫夐幃鍫曞磿闁秴鐭楅柟绋挎捣椤╂煡鎮楅敐鍌涙珕妞ゆ劒绮欓弻銊モ槈濡警娈紓浣诡殔椤︽壆绮氶崡鐐╂斀闁割偆鍠愰悾顒勬煛婢跺﹦澧涢柟鍛婃倐瀹曪綁宕卞Δ濠冪闂佺硶鍓濋崙鐟拔涢崨顓?
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Writable } from "node:stream";
import { Agent } from "./index.js";
import { resolveSessionKey } from "./session-key.js";
import { getEnvApiKey } from "@mariozechner/pi-ai";
import type { ApprovalConfig, ApprovalDecision, ApprovalRequest } from "./tool-approval.js";

// ============== .env 闂備礁鎲″缁樻叏閹灐?==============

function loadEnvFile(dir: string = process.cwd()): void {
  const envPath = path.join(dir, ".env");
  let content: string;
  try {
    content = fs.readFileSync(envPath, "utf-8");
  } catch {
    return;
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();
function findWorkspaceDir(startDir: string): string {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, "package.json")) || fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

// ============== 闂備礁鎼粔鎾床閼碱剚顫?==============

const styles = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",

  black: "\x1b[30m",
  white: "\x1b[37m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",

  bgWhite: "\x1b[47m",
  bgYellow: "\x1b[43m",
  bgGreen: "\x1b[42m",
  bgCyan: "\x1b[46m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
} as const;

const badgeStyles = {
  system: `${styles.black}${styles.bgWhite}`,
  input: `${styles.black}${styles.bgYellow}`,
  user: `${styles.black}${styles.bgGreen}`,
  model: `${styles.black}${styles.bgCyan}`,
  tool: `${styles.white}${styles.bgBlue}`,
  think: `${styles.white}${styles.bgMagenta}`,
  approve: `${styles.black}${styles.bgYellow}`,
} as const;

function color(text: string, c: keyof typeof styles): string {
  return `${styles[c]}${text}${styles.reset}`;
}

function badge(text: string, style: string): string {
  return `${style} ${text} ${styles.reset}`;
}

// ============== 闂佸搫顦悧濠囧箰閹间礁鍚规い鎾卞灪閸嬫劙鏌ら崫銉毌闁?==============

let unsubscribe: (() => void) | null = null;
let outputMode: "idle" | "thinking" | "assistant" = "idle";
type BlockKind = "system" | "user" | "tool" | "thinking" | "assistant" | "meta";
let lastBlockKind: BlockKind | null = null;

// 闁诲氦顫夐幃鍫曞磿闁秴鐭楅悹鎭掑妽鐎氼剟鏌涢幇鍏哥凹闁哄棗绻橀弻娑樷枎韫囨挴鍋撹ぐ鎺戞辈闁绘棁娅ｇ壕浠嬫煙閹咃紞闁圭晫濞€閺屻劌鈽夊Ο鑽ょ獩tart 闂?args闂備焦瀵х粙鎴︽偩缁夋亯 闂?result闂備焦瀵х粙鎴︽儗閸屾哎鈧帡宕奸弴鐐殿槯闁诲骸婀辨慨宕囧垝閹剧粯鐓?
const pendingToolArgs = new Map<string, unknown>();

function resetTerminal(): void {
  process.stdout.write("\x1b[?25h");
}

function closeOutputLine(): void {
  if (outputMode !== "idle") {
    process.stdout.write("\n");
    outputMode = "idle";
  }
}

function ensureBlockSpacing(kind: BlockKind): void {
  if (lastBlockKind && lastBlockKind !== kind) {
    process.stdout.write("\n");
  }
  lastBlockKind = kind;
}

function beginThinkingLine(): void {
  if (outputMode !== "thinking") {
    closeOutputLine();
    ensureBlockSpacing("thinking");
    process.stdout.write(`${badge("THINK", badgeStyles.think)} `);
    outputMode = "thinking";
  }
}

function beginAssistantLine(): void {
  if (outputMode !== "assistant") {
    closeOutputLine();
    ensureBlockSpacing("assistant");
    process.stdout.write(`${badge("MODEL", badgeStyles.model)} `);
    outputMode = "assistant";
  }
}

function printSystemLine(text: string, tone: "info" | "warn" | "error" = "info"): void {
  closeOutputLine();
  ensureBlockSpacing("system");
  let body = text;
  if (tone === "warn") body = color(text, "yellow");
  if (tone === "error") body = color(text, "yellow");
  console.log(`${badge("SYS", badgeStyles.system)} ${body}`);
}

function printUserLine(text: string): void {
  closeOutputLine();
  ensureBlockSpacing("user");
  console.log(`${badge("USER", badgeStyles.user)} ${text}`);
}

function printToolLine(text: string, isError = false): void {
  closeOutputLine();
  ensureBlockSpacing("tool");
  const body = isError ? color(text, "yellow") : color(text, "dim");
  console.log(`${badge("TOOL", badgeStyles.tool)} ${body}`);
}

function printMetaLine(text: string): void {
  closeOutputLine();
  ensureBlockSpacing("meta");
  console.log(`${color("->", "dim")} ${text}`);
}

function clearPromptEchoLine(): void {
  // 闂備礁鎲＄敮鐐寸箾閳ь剚绻?readline 闂備礁鎲＄敮妤呮嚌閹灐娲冀椤撶偛寮烽梺鍛婃寙閸曨厽娈?"INPUT 闂?xxx" 闂佽崵鍋炵粙鎴︽儗婢跺本顫曟繝闈涱儐閻掑ジ鏌涢…鎴濇灈閻㈩垱濞婇弻娑樜熼悜姗嗘閻熸粍濯藉▔娑欐櫏闂佹枼鏅涢崯浼村储?
  process.stdout.write("\x1b[1A\x1b[2K\r");
}

// ============== 濠电偞鍨堕幑渚€顢氳瀹曠敻鏌嗗鍛€?==============

async function main() {
  const args = process.argv.slice(2);
  const provider = readFlag(args, "--provider") ?? process.env.MINI_AGENT_PROVIDER ?? "anthropic";
  const model = readFlag(args, "--model") ?? process.env.MINI_AGENT_MODEL;
  const baseUrl = readFlag(args, "--base-url") ?? process.env.MINI_AGENT_BASE_URL;
  const reasoningFlag = readFlag(args, "--reasoning") ?? process.env.MINI_AGENT_REASONING;
  const reasoning = reasoningFlag === "none" ? undefined : (reasoningFlag as any) ?? "medium";
  const apiKey = readFlag(args, "--api-key") ?? getEnvApiKey(provider);
  if (!apiKey) {
    console.error(`Missing API key for ${provider}. Set env vars or pass --api-key.`);
    process.exit(1);
  }

  const agentId =
    readFlag(args, "--agent") ??
    process.env.MINI_AGENT_AGENT_ID ??
    "main";
  const sessionId = resolveSessionIdArg(args) || `session-${Date.now()}`;
  const workspaceDir = path.resolve(
    readFlag(args, "--workspace") ??
    process.env.MINI_AGENT_WORKSPACE_DIR ??
    findWorkspaceDir(process.cwd()),
  );
  const sessionKey = resolveSessionKey({ agentId, sessionId });

  // --approval 闂備礁鎲￠悷銉╁磹瑜版帒姹查柣鏃傚劋閸犲棝鏌ㄥ┑鍡橆棤闁?
  const approvalFlag = readFlag(args, "--approval");
  const approvalEnabled = args.includes("--approval");
  let approval: ApprovalConfig | undefined;
  if (approvalEnabled) {
    const ask = approvalFlag === "always" ? "always" as const : "on-miss" as const;
    approval = {
      ask,
      security: "full",
      tools: { exec: "allowlist", write: "allowlist", edit: "allowlist" },
    };
  }

  // readline闂備焦瀵х粙鎴︽偋閸℃鑰?agent 濠电偞鍨堕弻銊╊敄閸涱喗娅犻柣妯款嚙缁€鍡樼箾閹寸儐鐒界紒鎲嬬畵閺屻劌鈽夊Ο渚缂備礁澧庨弫鎼佸焵椤掆偓閸樻粓宕滃┑鍥╃彾闁圭儤鎸哥欢鐐烘煕閺囥劌骞楅柛濠勫仱閺屾盯鏁愰崘銊ヮ瀱婵犵數鍋涘ú顓㈠箖娴犲鈧箓骞掗弮鍌ゆТ
  const rlOutput = new Writable({
    write(chunk, _encoding, callback) {
      const text = typeof chunk === "string" ? chunk : chunk.toString();
      process.stdout.write(text.replace(/\x1b\[0?J/g, ""), callback);
    },
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output: rlOutput,
  });

  // 闂佽楠搁崢婊堝礈濠靛洨鐝堕柟鐑樻尭缁剁偤鏌涢弴銊ュ箺闁稿﹦鍋ら弻娑㈡晲鎼达絽甯ㄧ紓浣介哺閻熝囧焵椤掑嫭娑х紓宥咃功缁?mini-agent: CLI 婵犵妲呴崹顏堝焵椤掆偓绾绢厾娑甸埀顒佺箾閹寸偞灏い鎴濇搐閳?approval prompt闂?
  const onApprovalRequest = approval
    ? async (request: ApprovalRequest): Promise<ApprovalDecision> => {
        closeOutputLine();
        const label = formatToolCompact(request.toolName, request.args);
        return new Promise((resolve) => {
          rl.question(
            `${badge("?", badgeStyles.approve)} ${color("approve", "yellow")} ${label}? ${color("[y/n/a]", "dim")} `,
            (answer) => {
              const a = answer.trim().toLowerCase();
              if (a === "a" || a === "always") resolve("allow-always");
              else if (a === "n" || a === "no" || a === "d" || a === "deny") resolve("deny");
              else resolve("allow-once");
            },
          );
        });
      }
    : undefined;

  // Banner
  console.log(`${badge("MINI", badgeStyles.system)} ${color("Mini Agent", "bold")}`);
  console.log(color(`  ${provider}${model ? ` | ${model}` : ""}${reasoning ? ` | thinking:${reasoning}` : ""} | ${agentId}`, "dim"));
  console.log(color(`  ${workspaceDir}`, "dim"));
  const hints = ["/help show commands"];
  if (approval) hints.push(`approval: ${approval.ask}`);
  hints.push("Ctrl+C to exit");
  console.log(color(`  ${hints.join(" | ")}`, "dim"));
  console.log();

  const agent = new Agent({
    apiKey,
    provider,
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    agentId,
    workspaceDir,
    reasoning,
    approval,
    onApprovalRequest,
  });

  // 濠电偛鐡ㄧ划宀勵敄閸曨偀鏋庨柕蹇嬪灪婵ジ鏌曡箛瀣偓鏍綖婢舵劖鐓ユ繛鎴烆焽婢ф洘銇勯弴銊ユ灍妞?pi-agent-core: Agent.subscribe 闂?缂傚倷绶￠崑澶愵敋瑜旈幃妤呮倻閽樺顦遍梺鍝勭▌婵″洭鎯冮幋婢濆綊鎮╅悜妯笺€愬銈忚吂閺呯娀骞冮崼鏇炲耿妞ゆ挾濮烽ˇ?
  unsubscribe = agent.subscribe((event) => {
    switch (event.type) {
      case "agent_start":
        printSystemLine(`run ${event.runId.slice(0, 8)} 闁?${event.model}`);
        break;
      case "agent_end":
        break;
      case "agent_error":
        printSystemLine(`error: ${event.error}`, "error");
        break;

      case "thinking_delta":
        beginThinkingLine();
        process.stdout.write(color(event.delta, "dim"));
        break;

      case "message_delta":
        beginAssistantLine();
        process.stdout.write(event.delta);
        break;
      case "message_end":
        closeOutputLine();
        break;

      case "tool_execution_start": {
        pendingToolArgs.set(event.toolCallId, event.args);
        break;
      }
      case "tool_execution_end": {
        const toolArgs = pendingToolArgs.get(event.toolCallId);
        pendingToolArgs.delete(event.toolCallId);
        const label = formatToolCompact(event.toolName, toolArgs);
        const symbol = event.isError ? "x" : "ok";
        printToolLine(`${symbol} ${label}`, event.isError);
        break;
      }
      case "tool_skipped":
        printToolLine(`skip ${event.toolName}`);
        break;

      case "tool_approval_resolved":
        if (event.decision === "deny") {
          printToolLine(`闂?${event.toolName} (denied)`, true);
        } else if (event.decision === "allow-always") {
          printToolLine(`闂?${event.toolName} (always allowed)`);
        }
        break;

      case "compaction":
        printSystemLine(`compaction: dropped ${event.droppedMessages} messages`);
        break;

      case "subagent_summary": {
        const l = event.label ? ` (${event.label})` : "";
        printSystemLine(`subagent${l}: ${event.summary.slice(0, 120)}`);
        break;
      }
      case "subagent_error":
        printSystemLine(`subagent error: ${event.error}`, "error");
        break;
    }
  });

  const prompt = () => {
    rl.question(`${badge("INPUT", badgeStyles.input)} ${color(">", "green")} `, async (input) => {
      clearPromptEchoLine();

      const trimmed = input.trim();
      if (!trimmed) {
        prompt();
        return;
      }

      // 濠电偛顕慨鎾箠韫囨柧绻嗛柟闂寸閻忚櫕绻濇繝鍌涘櫤闁糕晛鍊归幈銊モ攽閹捐泛鍩岄悷婊勬緲閸婂潡寮婚崨顔藉闁绘垶顭囬弳鐘绘⒑閸涘﹤濮囬柟鍐查叄椤㈡瑩骞囬弶璺ㄤ紜濠电娀娼уΛ妤呭疾閹间焦鐓曢煫鍥ь儏閸旀氨鈧湱顭堥…宄扮暦閿濆鐭楀璺侯儌閺嬫牜绱撴担鎻掍壕?
      printUserLine(trimmed);

      // 闂備礁鎲＄粙鎺楀垂濠靛绠柕鍫濇缁剁偤鏌涢弴銊ュ箺闁?
      if (trimmed.startsWith("/")) {
        await handleCommand(trimmed, agent, sessionKey);
        console.log();
        prompt();
        return;
      }

      // Agent 闂備礁婀遍悷鎶藉幢閳哄倹鏉?
      outputMode = "idle";

      try {
        const result = await agent.run(sessionKey, trimmed);

        const parts = [
          `${color(String(result.turns), "cyan")} turns`,
          `${color(String(result.toolCalls), "yellow")} tools`,
          `${color(String(result.memoriesUsed ?? 0), "magenta")} memories`,
          `${color(String(result.text.length), "green")} chars`,
        ];
        printMetaLine(parts.join(color(" 闁?", "dim")));
      } catch (err) {
        closeOutputLine();
        printSystemLine((err as Error).message, "error");
      }
      prompt();
    });
  };

  prompt();
}

// ============== 闁诲氦顫夐幃鍫曞磿闁秴鐭楅柛褎顨呯粈鍕煠閹帒鍔滄繛?==============

function readFlag(args: string[], name: string): string | undefined {
  const idx = args.findIndex((arg) => arg === name);
  if (idx === -1) return undefined;
  const next = args[idx + 1];
  if (!next || next.startsWith("--")) return undefined;
  return next.trim() || undefined;
}

const FLAGS_WITH_VALUE = new Set(["--agent", "--model", "--provider", "--api-key", "--base-url", "--reasoning", "--workspace"]);

function resolveSessionIdArg(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "chat") continue;
    if (FLAGS_WITH_VALUE.has(arg)) { i += 1; continue; }
    if (arg.startsWith("--")) continue;
    return arg.trim() || undefined;
  }
  return undefined;
}

/** 闂備礁婀辩划顖炲礉閺嚶颁汗闁搞儜灞芥櫊闂侀潧顦崕鍗烆嚗閺冨牊鍋ｉ悗锝庝簻閺嗙喖鏌℃担闈涒偓婵嬪箚閸愵喖绀嬫い鎰╁灩缂嶆﹢姊绘担璇″劌闁哥姵鐗曢锝夘敆閸曨偅鐎柣銏╁灱閸犳氨绮堟径鎰厽闁靛繈鍨归弸鎴︽煕閵婏附鐨戞俊鍙夊姌椤︽煡鏌涢敐澶岀暫妤犵偞顨呰灒婵炲棛鍋撻惌?*/
function formatToolCompact(name: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, string>;
  switch (name) {
    case "read": return `read(${shortPath(a.file_path)})`;
    case "write": return `write(${shortPath(a.file_path)})`;
    case "edit": return `edit(${shortPath(a.file_path)})`;
    case "list": return `list(${a.path || "."})`;
    case "exec": return `exec(\`${String(a.command || "").slice(0, 50)}\`)`;
    case "grep": return `grep("${a.pattern || ""}"${a.path ? `, ${a.path}` : ""})`;
    case "memory_search": return `memory_search("${(a.query || "").slice(0, 30)}")`;
    case "memory_get": return `memory_get(${a.id || ""})`;
    case "memory_save": return `memory_save(${(a.content || "").slice(0, 30)}...)`;
    case "subagent": return `subagent("${(a.task || "").slice(0, 40)}")`;
    default: return name;
  }
}

function shortPath(p: string | undefined): string {
  if (!p) return "";
  const parts = p.split("/");
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : p;
}

async function handleCommand(cmd: string, agent: Agent, sessionKey: string) {
  const [command] = cmd.slice(1).split(" ");

  switch (command) {
    case "help":
      console.log(`Commands:\n  /help     show help\n  /reset    reset current session\n  /history  show session history\n  /sessions list sessions\n  /quit     exit\n\nFlags:\n  --provider <name>\n  --model <id>\n  --base-url <url>\n  --api-key <key>\n  --reasoning <level>\n  --workspace <dir>\n  --approval\n  --approval always`);
      break;

    case "reset":
      await agent.reset(sessionKey);
      console.log(color("session reset", "green"));
      break;

    case "history": {
      const history = agent.getHistory(sessionKey);
      if (history.length === 0) {
        console.log(color("no history", "dim"));
      } else {
        for (const msg of history) {
          const role = msg.role === "user" ? "User" : "Agent";
          const content =
            typeof msg.content === "string"
              ? msg.content
              : msg.content.map((c) => c.text || `[${c.type}]`).join(" ");
          console.log(`${color(role + ":", role === "User" ? "green" : "blue")} ${content.slice(0, 100)}...`);
        }
      }
      break;
    }

    case "sessions": {
      const sessions = await agent.listSessions();
      if (sessions.length === 0) {
        console.log(color("no sessions", "dim"));
      } else {
        console.log("sessions:");
        for (const s of sessions) {
          console.log(`  - ${s}${s === sessionKey ? color(" (current)", "cyan") : ""}`);
        }
      }
      break;
    }
    case "quit":
    case "exit":
      resetTerminal();
      process.exit(0);

    default:
      console.log(color(`unknown command: ${command}`, "yellow"));
  }
}

// Handle Ctrl+C
process.on("SIGINT", () => {
  closeOutputLine();
  resetTerminal();
  console.log(color("\nBye!", "dim"));
  unsubscribe?.();
  process.exit(0);
});

main().catch((err) => {
  closeOutputLine();
  resetTerminal();
  console.error("startup failed:", err);
  process.exit(1);
});
