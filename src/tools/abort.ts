/**
 * 工具中止信号（AbortSignal）传播
 *
 * Implementation note: src/agents/pi-tools.abort.ts
 *
 * 设计要点:
 * 1. 每次 run() 创建一个 runAbortController，作为本次运行的中止源
 * 2. 每个工具执行时可能收到两层 signal:
 *    - run-level signal (runAbortController.signal) — 整个 run 被取消
 *    - tool-level signal (来自 SDK 或外部) — 单个工具被取消
 * 3. combineAbortSignals 合并两层：任一触发即中止
 * 4. abortable() 包装 LLM 调用 Promise，使其可被 abort 中断
 */

import type { Tool, ToolContext } from "./types.js";

/**
 * 合并两个 AbortSignal，任一触发即中止
 *
 * Implementation note: pi-tools.abort.ts → combineAbortSignals()
 * - 优先使用 AbortSignal.any()（Node 20+）
 * - 不可用时回退到手动监听
 */
export function combineAbortSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (!a && !b) return undefined;
  if (a && !b) return a;
  if (b && !a) return b;
  if (a?.aborted) return a;
  if (b?.aborted) return b;

  // Node 20+ 原生支持
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([a as AbortSignal, b as AbortSignal]);
  }

  // 回退: 手动合并
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a?.addEventListener("abort", onAbort, { once: true });
  b?.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

/**
 * 包装工具，注入 run-level abort signal
 *
 * Implementation note: pi-tools.abort.ts → wrapToolWithAbortSignal()
 * - 合并 tool 自身 signal 和 run-level signal
 * - 如果已中止则直接抛错
 */
export function wrapToolWithAbortSignal<T>(tool: Tool<T>, runSignal: AbortSignal): Tool<T> {
  const original = tool.execute;
  return {
    ...tool,
    async execute(input: T, ctx: ToolContext): Promise<string> {
      const combined = combineAbortSignals(ctx.abortSignal, runSignal);
      if (combined?.aborted) {
        throw new Error("操作已中止");
      }
      return original(input, { ...ctx, abortSignal: combined });
    },
  };
}

/**
 * 包装 Promise 使其可被 abort 中断
 *
 * Implementation note: pi-embedded-runner/run/attempt.ts → abortable()
 * - 用于包装 LLM 流式调用
 * - signal 触发时 reject，中断等待
 */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new Error("操作已中止"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error("操作已中止"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}
