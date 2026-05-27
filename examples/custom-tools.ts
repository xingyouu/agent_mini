/**
 * Ecommerce support example with custom tools.
 *
 * This is close to the benchmark shape:
 * - kb_search gives the Agent policy knowledge.
 * - get_order gives the Agent order state.
 * - calc gives the Agent deterministic arithmetic.
 * - create_return is a write tool, so this example enables approval.
 */

import { Agent, type ApprovalHandler, type Tool } from "../src/index.js";

type Order = {
  order_id: string;
  item: string;
  status: "delivered" | "pending_fulfillment" | "shipped_in_transit";
  signed_at: string | null;
  opened: boolean;
  shipping_fee: number;
  coupon: number;
  amount: number;
};

const policy = `售后规则：
1. 未拆封商品可在签收后 7 天内无理由退货。
2. 质量问题可在签收后 15 天内退货，需要用户描述问题。
3. 已发货订单不可直接取消，只能拒收后申请退款。
4. 电子礼品卡、定制商品不支持无理由退货。
5. 运费不退；优惠券按商品金额比例分摊。
6. 取消订单、创建退货、创建工单都属于写操作，必须先获得用户确认。`;

const orders = new Map<string, Order>([
  ["O1001", {
    order_id: "O1001",
    item: "蓝牙耳机",
    status: "delivered",
    signed_at: "2026-03-20",
    opened: false,
    shipping_fee: 12,
    coupon: 40,
    amount: 399,
  }],
  ["O1003", {
    order_id: "O1003",
    item: "键盘 + 鼠标",
    status: "pending_fulfillment",
    signed_at: null,
    opened: false,
    shipping_fee: 15,
    coupon: 70,
    amount: 698,
  }],
  ["O1006", {
    order_id: "O1006",
    item: "手机壳",
    status: "shipped_in_transit",
    signed_at: null,
    opened: false,
    shipping_fee: 8,
    coupon: 0,
    amount: 59,
  }],
]);

const kbSearchTool: Tool<{ query: string }> = {
  name: "kb_search",
  description: "查询电商售后规则。适合回答退货、取消、运费、优惠券、写操作确认等政策问题。",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "要查询的售后规则关键词" },
    },
    required: ["query"],
  },
  async execute(input) {
    return `query=${input.query}\n\n${policy}`;
  },
};

const getOrderTool: Tool<{ order_id: string }> = {
  name: "get_order",
  description: "根据订单号查询订单状态、商品、签收时间、优惠券、运费和金额。",
  inputSchema: {
    type: "object",
    properties: {
      order_id: { type: "string", description: "订单号，例如 O1001" },
    },
    required: ["order_id"],
  },
  async execute(input) {
    const order = orders.get(input.order_id);
    if (!order) throw new Error(`order not found: ${input.order_id}`);
    return JSON.stringify(order, null, 2);
  },
};

const calcTool: Tool<{ expression: string }> = {
  name: "calc",
  description: "计算简单退款金额表达式。只用于数字、加减乘除和括号。",
  inputSchema: {
    type: "object",
    properties: {
      expression: { type: "string", description: "数学表达式，例如 399 - 40" },
    },
    required: ["expression"],
  },
  async execute(input) {
    if (!/^[\d\s+\-*/().]+$/.test(input.expression)) {
      throw new Error("unsupported expression");
    }
    const result = Function(`"use strict"; return (${input.expression})`)();
    return String(result);
  },
};

const createReturnTool: Tool<{ order_id: string; item: string; reason: string }> = {
  name: "create_return",
  description: "创建退货申请。写操作，只能在用户明确确认后调用。",
  inputSchema: {
    type: "object",
    properties: {
      order_id: { type: "string", description: "订单号" },
      item: { type: "string", description: "要退的商品" },
      reason: { type: "string", description: "退货原因" },
    },
    required: ["order_id", "item", "reason"],
  },
  async execute(input) {
    return JSON.stringify({ ok: true, return_id: `R-${input.order_id}`, ...input });
  },
};

const supportPrompt = `你是一个电商售后客服 Agent。

你可以使用工具查询订单、查询售后规则、计算退款金额和创建退货申请。

工作原则：
1. 不知道订单状态时，先调用 get_order，不要猜。
2. 不确定规则时，先调用 kb_search，不要套用常识。
3. 涉及退款金额时，说明运费和优惠券规则，必要时调用 calc。
4. create_return 是写操作，只有用户明确确认后才能调用。
5. 回复要像客服：先给结论，再给依据和下一步。`;

const autoApproveWrites: ApprovalHandler = async (request) => {
  console.log(`\n[approval] ${request.toolName} requested; allowing once for the example.`);
  return "allow-once";
};

async function main() {
  const agent = new Agent({
    provider: process.env.MINI_AGENT_PROVIDER ?? "anthropic",
    model: process.env.MINI_AGENT_MODEL,
    workspaceDir: process.cwd(),
    tools: [kbSearchTool, getOrderTool, calcTool, createReturnTool],
    systemPrompt: supportPrompt,
    approval: {
      ask: "on-miss",
      security: "full",
      tools: { create_return: "allowlist" },
    },
    onApprovalRequest: autoApproveWrites,
    enableSkills: false,
    enableMemory: false,
    enableHeartbeat: false,
  });

  const sessionKey = "example-custom-tools-ecommerce";

  console.log("Mini Agent ecommerce custom tools example\n");

  const unsubscribe = agent.subscribe((event) => {
    if (event.type === "message_delta") process.stdout.write(event.delta);
    if (event.type === "tool_execution_start") {
      console.log(`\n[tool:start] ${event.toolName}`, event.args);
    }
    if (event.type === "tool_execution_end") {
      console.log(`\n[tool:end] ${event.toolName}`, event.isError ? "ERROR" : "OK");
    }
    if (event.type === "turn_end") console.log(`\n[turn ${event.turn} ended]\n`);
  });

  console.log("--- Example 1: read tools + policy reasoning ---");
  await agent.run(sessionKey, "O1006 现在能取消吗？");

  console.log("--- Example 2: multi-tool refund estimate ---");
  await agent.run(sessionKey, "O1001 退货大概能退多少钱？");

  console.log("--- Example 3: confirm before write ---");
  await agent.run(sessionKey, "帮我给 O1001 的蓝牙耳机申请退货。");
  await agent.run(sessionKey, "确认提交。");

  unsubscribe();
  await agent.reset(sessionKey);
}

main().catch(console.error);
