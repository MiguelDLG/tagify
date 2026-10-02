import type { TagTaxonomy, TrackData } from "@/types/tagData";

export type AiEffort = "medium" | "high" | "xhigh" | "max";

export interface AiSettings {
  apiKey: string;
  model: string;
  effort: AiEffort;
}

/** OpenAI-compatible chat message as OpenRouter expects it. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  /** Must be sent back unmodified on assistant turns (OpenRouter reasoning). */
  reasoning_details?: unknown;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface TrackChange {
  trackUri: string;
  addTagIds: string[];
  removeTagIds: string[];
  energy?: number | null;
  rating?: number | null;
}

/** A tag the AI wants created; referenced from changes as `new:<ref>`. */
export interface NewTagSpec {
  ref: string;
  name: string;
  subcategoryId: string;
}

export type ProposalStatus = "pending" | "applied" | "discarded" | "undone";

export interface Proposal {
  id: string;
  summary: string;
  changes: TrackChange[];
  newTags: NewTagSpec[];
  /** Display names for tracks the AI touched (also used to create new entries). */
  trackInfo: Record<string, { name: string; artists: string }>;
  status: ProposalStatus;
}

export interface AppliedEntry {
  id: string;
  proposalId: string;
  summary: string;
  appliedAt: number;
  trackCount: number;
  before: Record<string, TrackData | null>;
  after: Record<string, TrackData | null>;
  createdTagIds: string[];
  undone?: boolean;
}

export type AiContextKind = "track" | "tracks" | "album" | "artist" | "playlist" | "general";

/** Where the chat was opened from; turned into a context block for the model. */
export interface AiContext {
  kind: AiContextKind;
  uris: string[];
  /** Playlist/album the right-clicked tracks were in, if any. */
  contextUri?: string;
}

export interface TagStoreSnapshot {
  taxonomy: TagTaxonomy;
  tracks: Record<string, TrackData>;
}

export interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  cost: number;
}
