export type LlmProvider = "openrouter" | "gemini" | "openai" | "anthropic";

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
}

