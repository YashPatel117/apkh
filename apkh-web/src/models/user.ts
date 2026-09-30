export type LlmProvider = "builtin" | "openrouter" | "gemini" | "openai" | "anthropic";

/** Provider serving a model ID, or null for an unrecognised one. */
export function providerOfModel(model: string): LlmProvider | null {
  const normalized = model.trim().toLowerCase();
  // OpenRouter ids are "author/model"; native Gemini, OpenAI and Claude ids never contain "/"
  if (normalized.includes("/")) return "openrouter";
  if (normalized.startsWith("gemini")) return "gemini";
  if (/^(gpt|chatgpt|o\d)/.test(normalized)) return "openai";
  if (normalized.startsWith("claude")) return "anthropic";
  return null;
}

/**
 * Only these providers have an embedding model, which semantic search needs.
 * OpenRouter's is paid: a key without credit falls back to keyword search.
 */
export function supportsSemanticSearch(model: string) {
  const provider = providerOfModel(model);
  return provider === "openrouter" || provider === "gemini" || provider === "openai";
}

export const BUILTIN_AI_LABEL = "Built-in AI";

/**
 * What powers AI features: the active saved config, else the built-in AI
 * (open-source models the app's server runs, within the plan's allowance),
 * else nothing.
 */
export type ActiveAi = { kind: "key"; config: ILlmConfig; name: string; model: string } | { kind: "builtin"; name: string; model: string };

export function activeAi(user: IUser | null | undefined): ActiveAi | null {
  const config = user?.llmConfigs?.find((c) => c.isActive);
  if (config) return { kind: "key", config, name: config.keyName, model: config.llmModel };
  return user?.builtinAi ? { kind: "builtin", name: BUILTIN_AI_LABEL, model: "Open-source model" } : null;
}

export type PlanId = "free" | "pro";

/** How much of the built-in AI the user gets. Own keys are never limited. */
export interface IPlan {
  id: PlanId;
  label: string;
  /** Built-in AI tokens per session */
  sessionTokens: number;
  sessionHours: number;
  /** Served first in the built-in AI's queue */
  priority: boolean;
}

/** Built-in AI usage in the current session (a window that opens with the first question). */
export interface IBuiltinAiUsage {
  sessionTokens: number;
  sessionLimit: number;
  /** null until the first question of a session */
  sessionResetsAt: string | null;
  totalTokens: number;
}

export interface ILlmModel {
  id: string;
  label: string;
}

export interface ILlmConfig {
  keyName: string;
  llmModel: string;
  isActive: boolean;
  tokensUsed: number;
  createdAt: string;
}

export interface IUser {
  id: string;
  email: string;
  name: string;
  type: string;
  totalTokensUsed: number;
  llmConfigs: ILlmConfig[];
  plan?: IPlan;
  /** Every plan, for comparison */
  plans?: IPlan[];
  /** null when the server doesn't offer the built-in AI */
  builtinAi?: IBuiltinAiUsage | null;
}

/** "2 h 15 min" until a moment. */
export function timeUntil(moment: string | Date): string {
  const minutes = Math.max(1, Math.ceil((new Date(moment).getTime() - Date.now()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
