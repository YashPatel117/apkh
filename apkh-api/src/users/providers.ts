/**
 * The AI providers, in one place: how a model id maps to its provider, and
 * what each provider can do. Everything else asks this module instead of
 * testing provider names itself, so adding a provider means adding one entry
 * here (and its counterpart in apkh-search's services/providers.py).
 */

export type LlmProvider =
  | 'builtin'
  | 'openrouter'
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'claude-code';

/** Embedding models that have a space of their own (see embedding-space.ts). */
export type EmbeddingProvider = 'builtin' | 'gemini' | 'openai';

export interface ProviderInfo {
  id: LlmProvider;
  label: string;
  /**
   * False when the provider works without the user's key: the built-in AI,
   * and Claude Code, which uses the CLI's own login on the server.
   */
  needsKey: boolean;
  /** Used with a user's own config (its models can be listed in Profile). */
  userConfigurable: boolean;
  /**
   * Whose embedding model makes this provider's vectors:
   * - an EmbeddingProvider: that model's space (OpenRouter embeds with
   *   OpenAI's model, so it shares OpenAI's space)
   * - `borrow-builtin`: no embedding model of its own (Anthropic), so the
   *   built-in AI embeds while this provider answers
   */
  embedsWith: EmbeddingProvider | 'borrow-builtin';
  /** Recognises the provider's model ids (case-insensitive, trimmed). */
  matches: (model: string) => boolean;
}

/**
 * The built-in AI: open-source models the host runs (apkh-search picks them),
 * used whenever a user has no active key of their own, within their plan's
 * allowance (see plans.ts). On unless BUILTIN_AI=off.
 */
export const BUILTIN_MODEL_ID = 'builtin';
export function builtinAiEnabled(): boolean {
  return process.env.BUILTIN_AI?.trim().toLowerCase() !== 'off';
}

/**
 * Claude Code: the `claude` CLI on the server machine (apkh-search runs it).
 * It uses the CLI's own login, so a key is optional; one given is a token
 * from `claude setup-token`.
 */
export const CLAUDE_CODE_PREFIX = 'claude-code';
export function isClaudeCodeModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return (
    normalized === CLAUDE_CODE_PREFIX ||
    normalized.startsWith(`${CLAUDE_CODE_PREFIX}:`)
  );
}

/**
 * In matching order: Claude Code before Anthropic ("claude-code:sonnet" also
 * starts with "claude"), OpenRouter before the native ones (its ids are
 * "author/model", and no native id contains a "/").
 */
const PROVIDERS: ProviderInfo[] = [
  {
    id: 'builtin',
    label: 'Built-in AI',
    needsKey: false,
    userConfigurable: false,
    embedsWith: 'builtin',
    matches: (m) => m === BUILTIN_MODEL_ID,
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    needsKey: false,
    userConfigurable: true,
    embedsWith: 'borrow-builtin',
    matches: isClaudeCodeModel,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    needsKey: true,
    userConfigurable: true,
    embedsWith: 'openai',
    matches: (m) => m.includes('/'),
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    needsKey: true,
    userConfigurable: true,
    embedsWith: 'gemini',
    matches: (m) => m.startsWith('gemini'),
  },
  {
    id: 'openai',
    label: 'OpenAI',
    needsKey: true,
    userConfigurable: true,
    embedsWith: 'openai',
    // gpt-*, chatgpt-* and the o-series (o1, o3, o4-mini, ...)
    matches: (m) => /^(gpt|chatgpt|o\d)/.test(m),
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    needsKey: true,
    userConfigurable: true,
    embedsWith: 'borrow-builtin',
    matches: (m) => m.startsWith('claude'),
  },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

/** Providers used with a user's own key, in the order Profile lists them. */
const PROFILE_ORDER: LlmProvider[] = [
  'openrouter', // first: it has free models
  'gemini',
  'openai',
  'anthropic',
  'claude-code',
];
export const LLM_PROVIDERS: LlmProvider[] = PROFILE_ORDER.filter(
  (id) => BY_ID.get(id)?.userConfigurable,
);

export function providerInfo(provider: LlmProvider): ProviderInfo {
  const info = BY_ID.get(provider);
  if (!info) throw new Error(`Unknown provider "${provider}"`);
  return info;
}

/** The provider serving a model id, or null for an unrecognised one. */
export function providerOfModel(model: string): LlmProvider | null {
  const normalized = (model ?? '').trim().toLowerCase();
  if (!normalized) return null;
  return PROVIDERS.find((p) => p.matches(normalized))?.id ?? null;
}

/**
 * The embedding model behind a provider's vectors, or null when it has none
 * (Anthropic / Claude Code with the built-in AI off: keyword search only).
 */
export function embeddingProviderFor(
  provider: LlmProvider | null | undefined,
): EmbeddingProvider | null {
  if (!provider) return null;
  const { embedsWith } = providerInfo(provider);
  if (embedsWith === 'borrow-builtin') {
    return builtinAiEnabled() ? 'builtin' : null;
  }
  return embedsWith;
}

/**
 * Whether notes are searched by meaning with this provider. OpenRouter keys
 * without credit still fall back to keywords at run time (402), which only
 * shows up when they embed.
 */
export function supportsSemanticSearch(
  provider: LlmProvider | null | undefined,
): boolean {
  return embeddingProviderFor(provider) !== null;
}
