import type { AiSettings, ChatMessage, UsageTotals } from "../model/ai.types";
import { chatCompletion } from "./ai.openrouter";
import { AI_TOOLS, executeTool, type ToolEnv, type ToolState } from "./ai.tools";

export type AgentEvent =
  | { type: "assistant_text"; text: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "usage"; usage: UsageTotals };

const MAX_STEPS = 14;

/**
 * Run model turns until it answers without tool calls. `messages` must start
 * with the system prompt; it is extended in place-order and returned.
 * Assistant messages are appended unmodified (reasoning_details included).
 */
export async function runAgent(options: {
  settings: AiSettings;
  messages: ChatMessage[];
  env: ToolEnv;
  state: ToolState;
  onEvent: (event: AgentEvent) => void;
  signal?: AbortSignal;
  complete?: typeof chatCompletion;
}): Promise<ChatMessage[]> {
  const { settings, env, state, onEvent, signal } = options;
  const complete = options.complete ?? chatCompletion;
  const messages = [...options.messages];

  for (let step = 0; step < MAX_STEPS; step++) {
    const result = await complete(settings, messages, AI_TOOLS, signal);
    messages.push(result.message);
    onEvent({
      type: "usage",
      usage: {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        cost: result.usage.cost,
      },
    });

    const text = result.message.content?.trim();
    if (text) onEvent({ type: "assistant_text", text });

    const calls = result.message.tool_calls ?? [];
    if (calls.length === 0) {
      if (result.finishReason === "length") {
        onEvent({ type: "assistant_text", text: "(The reply was cut off. Ask me to continue.)" });
      }
      return messages;
    }

    const outputs = await Promise.all(
      calls.map(async (call) => {
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          // executeTool reports the bad JSON back to the model
        }
        onEvent({ type: "tool_call", name: call.function.name, args });
        try {
          return await executeTool(call.function.name, call.function.arguments, env, state);
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      }),
    );
    calls.forEach((call, i) => {
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(outputs[i]) });
    });
  }

  onEvent({ type: "assistant_text", text: "(Stopped after too many steps. Try a narrower request.)" });
  return messages;
}
