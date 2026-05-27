/**
 * Basic ecommerce support example.
 *
 * This example shows the lightest way to "shape" an Agent:
 * give it a role, a small policy, and a session. No custom tools are needed
 * when the answer can be produced from the user message and the prompt.
 */

import { Agent } from "../src/index.js";

const ecommerceSupportPrompt = `你是一个电商售后客服 Agent。

客服规则：
1. 未拆封商品可在签收后 7 天内无理由退货。
2. 质量问题可在签收后 15 天内退货，需要用户描述问题。
3. 已发货订单不可直接取消，只能拒收后申请退款。
4. 电子礼品卡、定制商品不支持无理由退货。
5. 运费不退；优惠券按商品金额比例分摊。

回复要求：
- 先给结论，再解释依据。
- 信息不足时先追问，不要替用户编订单号、商品或状态。
- 涉及取消、创建退货、创建工单等写操作时，必须先让用户确认。`;

async function main() {
  const agent = new Agent({
    provider: process.env.MINI_AGENT_PROVIDER ?? "anthropic",
    model: process.env.MINI_AGENT_MODEL,
    workspaceDir: process.cwd(),
    systemPrompt: ecommerceSupportPrompt,
    enableSkills: false,
    enableMemory: false,
    enableHeartbeat: false,
  });

  const sessionKey = "example-basic-ecommerce";

  console.log("Mini Agent basic ecommerce support example\n");

  const unsubscribe = agent.subscribe((event) => {
    if (event.type === "message_delta") process.stdout.write(event.delta);
    if (event.type === "turn_end") console.log(`\n[turn ${event.turn} ended]\n`);
  });

  console.log("--- Example 1: direct policy reasoning ---");
  await agent.run(
    sessionKey,
    "规则是未拆封 7 天内可退。我 3 月 20 日签收，今天 3 月 25 日，还没拆，能退吗？",
  );

  console.log("--- Example 2: follow up before action ---");
  await agent.run(sessionKey, "帮我退了吧。");

  unsubscribe();
  await agent.reset(sessionKey);
}

main().catch(console.error);
