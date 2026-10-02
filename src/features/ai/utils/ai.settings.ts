import type { AiSettings } from "../model/ai.types";

const SETTINGS_KEY = "tagify:ai:settings";

export const AI_MODELS: { id: string; label: string; note: string }[] = [
  { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", note: "Recommended · $4 / $20 per M tokens" },
  { id: "anthropic/claude-fable-5.1", label: "Claude Fable 5.1", note: "Most capable · $10 / $50 per M tokens" },
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", note: "Cheaper · $2 / $10 per M tokens" },
];

export const DEFAULT_AI_SETTINGS: AiSettings = {
  apiKey: "",
  model: AI_MODELS[0].id,
  effort: "high",
};

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { ...DEFAULT_AI_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export function saveAiSettings(settings: AiSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
