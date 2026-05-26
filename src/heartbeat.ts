/**
 * 主动唤醒机制 (Heartbeat)
 *
 * Implementation note:
 * - src/infra/heartbeat-wake.ts — 事件驱动唤醒 + 请求合并 (coalesce)
 * - src/infra/heartbeat-runner.ts — 定时调度 + HEARTBEAT.md 上下文传递
 *
 * 核心设计理念 (对齐 mini-agent):
 * HEARTBEAT.md 不是任务列表——不做 checkbox 解析、不做结构化任务管理。
 * 它是 LLM 的上下文输入: HeartbeatManager 读取内容原样传递给回调
 * (对应 mini-agent 的 getReplyFromConfig)，由 LLM 自行决定如何响应。
 *
 * 分层:
 * 1. HeartbeatWake — 请求合并层
 *    - 多个请求在 coalesceMs 内合并为一次执行
 *    - 双重缓冲: 运行中的新请求排队，运行结束后立即再执行
 *    - requests-in-flight 跳过时自动重试 (1s 延迟)
 *
 * 2. HeartbeatManager — 调度 + 策略层
 *    - setTimeout 精确调度 (非 setInterval，对齐 mini-agent)
 *    - 活跃时间窗口 (activeHours)，支持跨午夜
 *    - HEARTBEAT.md 空内容检测 (去除 frontmatter/注释后判断)
 *    - exec 事件豁免空内容跳过 (命令完成通知总是传递)
 *    - 重复消息抑制 (24h 窗口 + 文本比较)
 */

import fs from "node:fs/promises";
import path from "node:path";

// ============== 类型定义 ==============

/**
 * 活跃时间窗口
 *
 * Implementation note: heartbeat-runner.ts: isWithinActiveHours()
 * - 控制 heartbeat 仅在指定时间段内运行
 * - 支持跨午夜 (如 start=22:00, end=06:00)
 */
export interface ActiveHours {
  /** 开始时间 "HH:MM" 格式 */
  start: string;
  /** 结束时间 "HH:MM" 格式 */
  end: string;
  /** 时区标识，默认本地时区 */
  timezone?: string;
}

export interface HeartbeatConfig {
  /** 检查间隔 (毫秒)，默认 30 分钟 */
  intervalMs?: number;
  /** HEARTBEAT.md 路径（相对于 workspaceDir 或绝对路径） */
  heartbeatPath?: string;
  /** 活跃时间窗口 */
  activeHours?: ActiveHours;
  /** 是否启用 */
  enabled?: boolean;
  /** 请求合并窗口 (毫秒)，默认 250ms */
  coalesceMs?: number;
  /** 重复检测窗口 (毫秒)，默认 24 小时 */
  duplicateWindowMs?: number;
}

/**
 * 唤醒原因
 *
 * Implementation note: heartbeat-runner.ts 中的多种触发来源:
 * - interval: 定时器到期 (scheduleNext)
 * - exec: 异步命令执行完成 (EXEC_EVENT_PROMPT，豁免空内容跳过)
 * - requested: 外部手动请求
 * - retry: 上次因 requests-in-flight 跳过后的自动重试
 */
export type WakeReason =
  | "interval"
  | "exec"
  | "requested"
  | "retry";

export interface WakeRequest {
  reason: WakeReason;
  source?: string;
}

/**
 * Heartbeat 运行结果
 *
 * Implementation note: HeartbeatRunResult
 * - ran: 成功执行并产生了输出
 * - skipped: 因某种原因跳过 (活跃时间/空内容/重复)
 * - failed: 执行出错
 */
export interface HeartbeatResult {
  status: "ran" | "skipped" | "failed";
  durationMs?: number;
  reason?: string;
}

/**
 * Heartbeat 回调
 *
 * Implementation note: heartbeat-runner.ts 中 getReplyFromConfig() 的角色:
 * 接收 HEARTBEAT.md 原始内容作为上下文，由调用方（通常是 LLM）
 * 生成回复文本。
 *
 * 返回值:
 * - { text: "..." }: 有内容要发送（会经过重复抑制检查）
 * - { text: undefined } 或 null: 等同于 mini-agent 的 HEARTBEAT_OK
 *   (LLM 判定当前没有需要主动通知的内容)
 */
export type HeartbeatCallback = (opts: {
  /** HEARTBEAT.md 文件内容（原样传递，不做解析） */
  content: string;
  /** 唤醒原因 */
  reason: WakeReason;
  /** 来源标识 */
  source?: string;
}) => Promise<{ text?: string } | null>;

/**
 * Heartbeat 内部处理器
 *
 * Implementation note: HeartbeatWakeHandler
 * HeartbeatWake 层调用此处理器执行一次 heartbeat
 */
export type HeartbeatHandler = (opts: {
  reason?: string;
}) => Promise<HeartbeatResult>;

// ============== HeartbeatWake (请求合并层) ==============

/**
 * Implementation note: src/infra/heartbeat-wake.ts
 *
 * 核心机制:
 * 1. 多个请求在 coalesceMs 内合并为一次执行
 * 2. 如果正在运行，新请求排队等待 (scheduled flag)
 * 3. 运行完成后，如果有排队请求，继续调度
 * 4. requests-in-flight 跳过时自动重试 (retryMs)
 *
 * 与 mini-agent heartbeat-wake.ts 的结构一一对应:
 * - handler / pendingReason / scheduled / running / timer 五个全局变量
 * - schedule() / setHandler() / requestNow()
 */
class HeartbeatWake {
  private handler: HeartbeatHandler | null = null;
  private pendingReason: string | null = null;
  private scheduled = false;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private readonly coalesceMs: number;
  private readonly retryMs = 1_000;

  constructor(coalesceMs = 250) {
    this.coalesceMs = coalesceMs;
  }

  setHandler(handler: HeartbeatHandler | null): void {
    this.handler = handler;
    if (handler && this.pendingReason) {
      this.schedule(this.coalesceMs);
    }
  }

  /**
   * 请求唤醒
   *
   * 对应 mini-agent: requestHeartbeatNow()
   */
  request(reason: string = "requested", coalesceMs?: number): void {
    this.pendingReason = reason;
    this.schedule(coalesceMs ?? this.coalesceMs);
  }

  private schedule(delayMs: number): void {
    // 对齐 mini-agent: 如果 timer 已存在，不重复创建（请求合并）
    if (this.timer) {
      return;
    }

    this.timer = setTimeout(async () => {
      this.timer = null;
      this.scheduled = false;

      const active = this.handler;
      if (!active) return;

      // 对齐 mini-agent: 如果正在运行，标记为 scheduled 并重新调度
      if (this.running) {
        this.scheduled = true;
        this.schedule(this.coalesceMs);
        return;
      }

      const reason = this.pendingReason;
      this.pendingReason = null;
      this.running = true;

      try {
        const res = await active({ reason: reason ?? undefined });

        // 对齐 mini-agent: requests-in-flight 时自动重试
        if (res.status === "skipped" && res.reason === "requests-in-flight") {
          this.pendingReason = reason ?? "retry";
          this.schedule(this.retryMs);
        }
      } catch {
        // 对齐 mini-agent: 错误时也自动重试
        this.pendingReason = reason ?? "retry";
        this.schedule(this.retryMs);
      } finally {
        this.running = false;
        if (this.pendingReason || this.scheduled) {
          this.schedule(this.coalesceMs);
        }
      }
    }, delayMs);
  }

  hasPending(): boolean {
    return this.pendingReason !== null || Boolean(this.timer) || this.scheduled;
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.scheduled = false;
    this.pendingReason = null;
  }
}

// ============== 辅助函数 ==============

/**
 * HEARTBEAT.md 空内容检测
 *
 * Implementation note: heartbeat-runner.ts: isHeartbeatContentEffectivelyEmpty()
 * 去除 frontmatter 和 HTML 注释后，判断是否只剩空白
 */
function isContentEffectivelyEmpty(content: string): boolean {
  // 去除 YAML frontmatter
  const noFrontmatter = content.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, "");
  // 去除 HTML 注释
  const noComments = noFrontmatter.replace(/<!--[\s\S]*?-->/g, "");
  return noComments.trim().length === 0;
}

// ============== HeartbeatManager (调度 + 策略层) ==============

/**
 * 调度器内部状态
 *
 * Implementation note: heartbeat-runner.ts: HeartbeatAgentState
 */
interface RunnerState {
  /** 下一次到期时间戳 (ms) */
  nextDueMs: number;
  /** 调度定时器 */
  timer: ReturnType<typeof setTimeout> | null;
  /** 上次运行时间戳 */
  lastRunMs: number | null;
  /** 上次发送的文本 (用于重复抑制) */
  lastText: string | null;
  /** 上次发送文本的时间戳 */
  lastTextAt: number | null;
}

/**
 * Heartbeat Manager - 主动唤醒管理器
 *
 * Implementation note: heartbeat-runner.ts 中 startHeartbeatRunner() 的角色:
 * - setTimeout 精确调度（非 setInterval，mini-agent 的做法）
 * - 活跃时间窗口检查
 * - HEARTBEAT.md 空内容检测（非任务解析——这是与 mini-agent 对齐的关键）
 * - 重复消息抑制 (24h)
 * - exec 事件豁免空内容跳过
 * - 通过 HeartbeatWake 支持事件驱动唤醒
 */
export class HeartbeatManager {
  private workspaceDir: string;
  private config: Required<Omit<HeartbeatConfig, "activeHours">> & {
    activeHours?: ActiveHours;
  };

  private state: RunnerState = {
    nextDueMs: 0,
    timer: null,
    lastRunMs: null,
    lastText: null,
    lastTextAt: null,
  };

  private wake: HeartbeatWake;
  private callback: HeartbeatCallback | null = null;
  private started = false;

  constructor(workspaceDir: string, config: HeartbeatConfig = {}) {
    this.workspaceDir = workspaceDir;
    this.config = {
      intervalMs: config.intervalMs ?? 30 * 60 * 1000,
      heartbeatPath: config.heartbeatPath ?? "HEARTBEAT.md",
      enabled: config.enabled ?? true,
      coalesceMs: config.coalesceMs ?? 250,
      duplicateWindowMs: config.duplicateWindowMs ?? 24 * 60 * 60 * 1000,
      activeHours: config.activeHours,
    };

    this.wake = new HeartbeatWake(this.config.coalesceMs);
    // HeartbeatWake 的 handler 对应 mini-agent 的 runHeartbeatOnce
    this.wake.setHandler((opts) => this.runOnce(opts.reason));
  }

  // ============== 公共 API ==============

  /**
   * 注册回调
   *
   * Implementation note: 中 heartbeat-runner 内部调用 getReplyFromConfig():
   * 回调接收 HEARTBEAT.md 原始内容，由调用方决定如何响应
   */
  onHeartbeat(callback: HeartbeatCallback): void {
    this.callback = callback;
  }

  /**
   * 启动 Heartbeat 调度
   *
   * Implementation note: startHeartbeatRunner()
   */
  start(): void {
    if (!this.config.enabled || this.started) return;
    this.started = true;
    this.scheduleNext();
  }

  /**
   * 停止 Heartbeat 调度
   */
  stop(): void {
    this.started = false;
    this.wake.stop();
    if (this.state.timer) {
      clearTimeout(this.state.timer);
      this.state.timer = null;
    }
  }

  /**
   * 请求立即唤醒 (事件驱动)
   *
   * Implementation note: requestHeartbeatNow()
   */
  requestNow(reason: WakeReason = "requested"): void {
    this.wake.request(reason);
  }

  /**
   * 手动触发一次 (同步等待结果)
   */
  async trigger(): Promise<HeartbeatResult> {
    return this.runOnce("requested");
  }

  /**
   * 读取 HEARTBEAT.md 内容
   *
   * 公开给外部使用（如 agent 构建系统提示时可选引用）
   */
  async readContent(): Promise<string | null> {
    const filePath = this.getHeartbeatPath();
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * 更新配置 (热加载)
   */
  updateConfig(config: Partial<HeartbeatConfig>): void {
    if (config.intervalMs !== undefined) {
      this.config.intervalMs = config.intervalMs;
    }
    if (config.activeHours !== undefined) {
      this.config.activeHours = config.activeHours;
    }
    if (config.enabled !== undefined) {
      this.config.enabled = config.enabled;
      if (!config.enabled) {
        this.stop();
      } else if (this.started) {
        this.scheduleNext();
      }
    }

    // 重新调度
    if (this.started && this.config.enabled) {
      if (this.state.timer) {
        clearTimeout(this.state.timer);
      }
      this.scheduleNext();
    }
  }

  /**
   * 获取状态信息 (调试用)
   */
  getStatus(): {
    enabled: boolean;
    started: boolean;
    nextDueMs: number;
    lastRunMs: number | null;
    intervalMs: number;
    activeHours?: ActiveHours;
  } {
    return {
      enabled: this.config.enabled,
      started: this.started,
      nextDueMs: this.state.nextDueMs,
      lastRunMs: this.state.lastRunMs,
      intervalMs: this.config.intervalMs,
      activeHours: this.config.activeHours,
    };
  }

  // ============== 调度逻辑 ==============

  /**
   * 调度下一次运行
   *
   * Implementation note: heartbeat-runner.ts: scheduleNext()
   * 使用 setTimeout 精确调度，每次运行后重新计算延迟
   */
  private scheduleNext(): void {
    if (!this.started) return;

    const now = Date.now();
    const lastRun = this.state.lastRunMs ?? now;
    const nextDue = lastRun + this.config.intervalMs;
    this.state.nextDueMs = nextDue;

    const delay = Math.max(0, nextDue - now);

    this.state.timer = setTimeout(() => {
      this.state.timer = null;
      this.wake.request("interval");
    }, delay);
  }

  /**
   * 执行一次 Heartbeat
   *
   * Implementation note: heartbeat-runner.ts: runHeartbeatOnce()
   * 流程:
   * 1. 活跃时间窗口检查
   * 2. 读取 HEARTBEAT.md 内容
   * 3. 空内容检测 (exec 事件豁免)
   * 4. 调用回调获取回复 (对应 getReplyFromConfig)
   * 5. 重复消息抑制
   * 6. 更新状态 + 调度下一次
   */
  private async runOnce(reason?: string): Promise<HeartbeatResult> {
    const startMs = Date.now();
    const wakeReason = (reason as WakeReason) || "requested";

    // 1. 活跃时间窗口检查
    if (!this.isWithinActiveHours(startMs)) {
      this.state.lastRunMs = startMs;
      this.scheduleNext();
      return { status: "skipped", reason: "outside-active-hours" };
    }

    // 2. 读取 HEARTBEAT.md 内容（原样，不做解析）
    const content = await this.readContent();

    // 3. 空内容检测 — exec 事件豁免（对齐 mini-agent: EXEC_EVENT_PROMPT 例外）
    if (
      (!content || isContentEffectivelyEmpty(content)) &&
      wakeReason !== "exec"
    ) {
      this.state.lastRunMs = startMs;
      this.scheduleNext();
      return { status: "skipped", reason: "empty-content" };
    }

    // 4. 调用回调获取回复
    if (!this.callback) {
      this.state.lastRunMs = startMs;
      this.scheduleNext();
      return { status: "skipped", reason: "no-callback" };
    }

    try {
      const result = await this.callback({
        content: content ?? "",
        reason: wakeReason,
      });

      const replyText = result?.text?.trim();
      const durationMs = Date.now() - startMs;

      // 空回复 = HEARTBEAT_OK（LLM 无话可说）
      if (!replyText) {
        this.state.lastRunMs = startMs;
        this.scheduleNext();
        return { status: "ran", durationMs, reason: "ack" };
      }

      // 5. 重复消息抑制
      if (this.isDuplicateMessage(replyText, startMs)) {
        this.state.lastRunMs = startMs;
        this.scheduleNext();
        return { status: "skipped", durationMs, reason: "duplicate-message" };
      }

      // 6. 更新状态
      this.state.lastRunMs = startMs;
      this.state.lastText = replyText;
      this.state.lastTextAt = startMs;
      this.scheduleNext();

      return { status: "ran", durationMs };
    } catch {
      this.state.lastRunMs = startMs;
      this.scheduleNext();
      return { status: "failed", reason: "callback-error" };
    }
  }

  // ============== 辅助方法 ==============

  /**
   * 检查是否在活跃时间窗口内
   *
   * Implementation note: heartbeat-runner.ts: isWithinActiveHours()
   * 支持跨午夜的时间段 (如 22:00-06:00)
   */
  private isWithinActiveHours(nowMs: number): boolean {
    const { activeHours } = this.config;
    if (!activeHours) return true;

    const date = new Date(nowMs);
    const currentMinutes = date.getHours() * 60 + date.getMinutes();

    const [startH, startM] = activeHours.start.split(":").map(Number);
    const [endH, endM] = activeHours.end.split(":").map(Number);

    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    // 跨午夜: 如 22:00-06:00
    if (endMinutes <= startMinutes) {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  /**
   * 重复消息抑制
   *
   * Implementation note: heartbeat-runner.ts 中的 lastHeartbeatText/lastHeartbeatSentAt 检查:
   * 24h 窗口内文本相同则跳过，防止频繁发送相同通知
   */
  private isDuplicateMessage(text: string, nowMs: number): boolean {
    if (!this.state.lastText || !this.state.lastTextAt) {
      return false;
    }

    const timeSinceLast = nowMs - this.state.lastTextAt;
    if (timeSinceLast >= this.config.duplicateWindowMs) {
      return false;
    }

    return text.trim() === this.state.lastText.trim();
  }

  private getHeartbeatPath(): string {
    if (path.isAbsolute(this.config.heartbeatPath)) {
      return this.config.heartbeatPath;
    }
    return path.join(this.workspaceDir, this.config.heartbeatPath);
  }
}
