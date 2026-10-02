import type { AiSettings, ChatMessage } from "../model/ai.types";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface CompletionResult {
  message: ChatMessage;
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number; cost: number };
}

export class OpenRouterError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function friendlyError(status: number, body: any): string {
  const detail = body?.error?.message || body?.message || "";
  switch (status) {
    case 401:
      return "OpenRouter rejected the API key. Check it in AI settings.";
    case 402:
      return "Your OpenRouter account is out of credits.";
    case 429:
      return "OpenRouter rate limit hit. Wait a moment and try again.";
    default:
      return `OpenRouter error ${status}${detail ? `: ${detail}` : ""}`;
  }
}

export async function chatCompletion(
  settings: AiSettings,
  messages: ChatMessage[],
  tools: unknown[],
  signal?: AbortSignal,
): Promise<CompletionResult> {
  const resp = await fetch(OPENROUTER_URL, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/MiguelDLG/tagify",
      "X-Title": "Tagify",
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      tools,
      tool_choice: "auto",
      reasoning: { effort: settings.effort },
      max_tokens: 16000,
      usage: { include: true },
    }),
  });

  const body = await resp.json().catch(() => null);
  if (!resp.ok || !body) {
    throw new OpenRouterError(friendlyError(resp.status, body), resp.status);
  }
  if (body.error) {
    throw new OpenRouterError(friendlyError(body.error.code ?? 500, body), body.error.code ?? 500);
  }

  const choice = body.choices?.[0];
  if (!choice?.message) throw new OpenRouterError("OpenRouter returned no message", 502);
  const raw = choice.message;
  const message: ChatMessage = {
    role: "assistant",
    content: raw.content ?? null,
    ...(raw.tool_calls?.length ? { tool_calls: raw.tool_calls } : {}),
    ...(raw.reasoning_details !== undefined ? { reasoning_details: raw.reasoning_details } : {}),
  };
  return {
    message,
    finishReason: choice.finish_reason ?? null,
    usage: {
      promptTokens: body.usage?.prompt_tokens ?? 0,
      completionTokens: body.usage?.completion_tokens ?? 0,
      cost: Number(body.usage?.cost ?? 0),
    },
  };
}
