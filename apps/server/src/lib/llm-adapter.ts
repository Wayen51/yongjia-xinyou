import { config } from "./config.ts";

export interface ChatOptions {
  /** 采样温度：创意扩写类任务可提到 0.8，默认由模型侧决定 */
  temperature?: number;
  /** 超时毫秒：超时抛 AbortError，由调用方决定回落策略 */
  timeoutMs?: number;
}

export async function chatCompletions(messages: { role: string; content: string }[], opts: ChatOptions = {}) {
  if (!config.llmApiKey || !config.llmBaseUrl) {
    throw new Error("LLM_NOT_CONFIGURED");
  }
  const body: Record<string, unknown> = {
    model: config.llmModel,
    messages,
    stream: false,
  };
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;
  const res = await fetch(`${config.llmBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.llmApiKey}`,
    },
    body: JSON.stringify(body),
    signal: opts.timeoutMs ? AbSignalTimeout(opts.timeoutMs) : undefined,
  });
  if (!res.ok) throw new Error(`LLM_HTTP_${res.status}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content || "";
}

/** 兼容 Node 18/20 的超时信号（AbortSignal.timeout 在部分运行时不可用） */
function AbSignalTimeout(ms: number): AbortSignal {
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(new Error("LLM_TIMEOUT")), ms).unref?.();
  return ctl.signal;
}
