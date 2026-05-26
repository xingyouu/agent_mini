# agent_mini
# Mini Agent

一个用于学习和实验的 TypeScript Agent 骨架。它把对话循环、工具调用、会话持久化、上下文管理、长期记忆、技能系统、主动调度和 WebSocket Gateway 放在同一个最小项目里，方便阅读、运行和二次扩展。

## 适合做什么

- 学习一个可运行 Agent 的核心结构，而不是只看单轮工具调用示例。
- 研究会话、上下文裁剪、摘要压缩、工具审批等工程问题。
- 快速搭建本地 CLI Agent、远程 Gateway 或简单 Web UI。
- 作为个人实验项目，继续增加工具、渠道、记忆策略和评估集。

## 功能概览

| 能力 | 说明 | 入口文件 |
| --- | --- | --- |
| Agent 主体 | 统一运行入口、事件订阅、模型与工具编排 | `src/agent.ts` |
| Agent Loop | 支持多轮工具调用、follow-up、steering 注入 | `src/agent-loop.ts` |
| 事件流 | 类型化事件、流式文本、工具事件、错误事件 | `src/agent-events.ts` |
| 会话管理 | JSONL 持久化、历史加载、会话重置 | `src/session.ts` |
| 上下文管理 | bootstrap 文件加载、裁剪、摘要压缩、窗口保护 | `src/context/*` |
| 工具系统 | 内置文件、命令、记忆等工具抽象 | `src/tools/*` |
| Provider | 支持 Anthropic、OpenAI 兼容接口等模型接入 | `src/provider/*` |
| 长期记忆 | 记忆写入、读取、关键词检索 | `src/memory.ts` |
| 技能系统 | 读取 `SKILL.md`，按 frontmatter 和命令匹配技能 | `src/skills.ts` |
| 主动调度 | 定时或手动触发的 heartbeat 流程 | `src/heartbeat.ts` |
| Gateway | HTTP + WebSocket RPC、鉴权、广播、客户端重连 | `src/gateway/*` |
| 工程保护 | 工具策略、审批、路径沙箱、命令队列、结果修复 | `src/tool-policy.ts` 等 |

## 项目结构

```text
src/
  agent.ts                    # Agent 入口与事件分发
  agent-loop.ts               # 核心运行循环
  agent-events.ts             # 事件类型与异步事件流
  session.ts                  # 会话持久化
  memory.ts                   # 长期记忆
  skills.ts                   # 技能加载与匹配
  heartbeat.ts                # 主动调度
  cli.ts                      # 本地 CLI
  gateway/                    # Gateway 服务、协议、客户端、Web UI
  context/                    # 上下文加载、裁剪、压缩、窗口保护
  provider/                   # 模型 Provider 封装
  tools/                      # 工具定义与内置工具

examples/                     # 使用示例
workspace-templates/          # 工作区模板
docs/                         # 设计与评估文档
evals/                        # 评估脚本与样例
```

## 快速开始

要求：Node.js `>=20`，推荐使用 `pnpm`。

```bash
pnpm install
pnpm build
```

创建 `.env` 文件并写入你的模型 API Key，例如：

```env
ANTHROPIC_API_KEY=sk-xxx
```

启动本地 CLI：

```bash
pnpm dev
```

也可以通过参数指定 provider、model 或代理地址：

```bash
pnpm dev -- --provider anthropic --model claude-sonnet-4-20250514
pnpm dev -- --provider openai --model gpt-4o
pnpm dev -- --provider openai --model glm-4-flash --base-url https://open.bigmodel.cn/api/paas/v4 --reasoning none
```

其中 `--reasoning none` 适用于不支持 extended thinking 的模型。

## Gateway 模式

Gateway 可以把本地 Agent 暴露成 WebSocket RPC 服务，让多个客户端共享同一个后端 Agent。

```bash
# 终端 1：启动 Gateway 服务
pnpm gateway

# 终端 2：连接 Gateway
pnpm gateway:connect
```

常用参数：

```bash
pnpm gateway -- --port 8080 --token mySecret
pnpm gateway:connect -- --url ws://localhost:18789
pnpm gateway:connect -- --session work
```

Gateway 客户端内置命令：

| 命令 | 作用 |
| --- | --- |
| `/health` | 查看服务状态 |
| `/sessions` | 列出会话 |
| `/reset` | 重置当前会话 |
| `/quit` | 断开连接 |

浏览器 UI 默认挂载在 Gateway 服务的 `/ui` 路径。

## 代码示例

```typescript
import { Agent } from "./dist/index.js";

const agent = new Agent({
  provider: "anthropic",
  agentId: "main",
  workspaceDir: process.cwd(),
  reasoning: "medium",
});

const unsubscribe = agent.subscribe((event) => {
  switch (event.type) {
    case "thinking_delta":
    case "message_delta":
      process.stdout.write(event.delta);
      break;
    case "tool_execution_start":
      console.log(`[${event.toolName}]`, event.args);
      break;
    case "agent_error":
      console.error(event.error);
      break;
  }
});

const result = await agent.run("session-1", "请列出当前目录的文件");
console.log(`\n${result.turns} turns, ${result.toolCalls} tool calls`);

unsubscribe();
```

## 核心设计

### 1. 双层 Agent Loop

运行循环分成两层：

- outer loop：处理多轮 follow-up，控制最大轮次。
- inner loop：处理模型响应、工具调用、工具结果、用户 steering。

这种结构让 Agent 可以在一次任务中连续调用工具，也能在工具执行过程中接收新的用户指令。

### 2. 事件流

Agent 运行时会持续产生事件，包括：

- `message_delta`：流式文本输出。
- `thinking_delta`：模型思考片段。
- `tool_execution_start` / `tool_execution_end`：工具执行状态。
- `agent_error`：运行错误。

调用方既可以直接等待 `agent.run()` 的最终结果，也可以通过 `agent.subscribe()` 实时消费事件。

### 3. 会话持久化

会话以 JSONL 形式保存，每行一条记录。这样做便于追加写入、局部恢复和人工排查。会话管理层同时维护内存缓存，减少频繁读取磁盘。

### 4. 上下文治理

上下文窗口有限时，项目按顺序使用三类策略：

1. 裁剪旧的工具结果，保留最近的重要记录。
2. 将历史消息压缩成摘要。
3. 按需加载工作区说明文件，并对超长文件做截断。

### 5. 长期记忆

记忆模块提供保存、检索和读取能力。当前实现偏轻量，适合学习机制和做本地实验；如果要用于更复杂场景，可以替换为向量检索、全文索引或混合检索方案。

### 6. 技能系统

技能以 `SKILL.md` 描述，支持 frontmatter 元信息和命令式触发。Agent 可以把技能说明拼进系统提示，也可以根据用户输入解析显式技能命令。

### 7. Heartbeat

Heartbeat 用于让 Agent 在定时、手动请求或外部事件触发时主动工作。实现上拆成 wake 层和 runner 层：前者合并触发请求，后者负责调度、去重和执行。

### 8. Gateway

Gateway 使用 WebSocket RPC 协议，包含：

- challenge-response 鉴权。
- request / response / event 三类帧。
- chat 事件广播。
- 客户端自动重连。
- tick 心跳和序列号检查。
- 慢消费者背压处理。

## 推荐阅读顺序

1. `src/agent-loop.ts`：理解核心循环。
2. `src/agent.ts`：理解 Agent 如何组织配置、事件和工具。
3. `src/agent-events.ts`：理解事件流。
4. `src/session.ts` 与 `src/context/*`：理解历史和上下文。
5. `src/tools/*`：理解工具抽象。
6. `src/memory.ts`、`src/skills.ts`、`src/heartbeat.ts`：理解扩展能力。
7. `src/gateway/*`：理解远程访问和多客户端模式。

## 开发命令

```bash
pnpm dev                 # 启动本地 CLI
pnpm build               # TypeScript 构建
pnpm start               # 运行构建后的 CLI
pnpm gateway             # 启动 Gateway
pnpm gateway:connect     # 连接 Gateway
pnpm channel:telegram    # 启动 Telegram channel  
pnpm example             # 运行示例
```

## 评估与改进方向

- 为核心 CLI、Gateway、Memory 增加端到端测试。
- 将 `evals/` 中的评估样例整理成可重复运行的数据集。
- 为工具审批、路径沙箱、上下文溢出补充边界用例。
- 增加更强的检索实现和结果质量评估。
