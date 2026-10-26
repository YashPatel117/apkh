import {
  BUILTIN_MODEL_ID,
  builtinAiEnabled,
  type ActiveLlmSettings,
  type LlmProvider,
} from 'src/users/users.service';

/**
 * An embedding model at a fixed size. Vectors are only comparable within one
 * space, so every stored vector is labelled with the id of its space.
 */
export interface EmbeddingSpace {
  id: string;
  provider: 'builtin' | 'gemini' | 'openai';
  model: string;
  dimensions: number;
}

// Every space at 1536 dimensions: one vector index definition fits all of
// them. Gemini's vectors are half the size of its 3072 default for a
// negligible quality difference; the built-in AI's Qwen3-Embedding-0.6B vectors
// (1024) are zero-padded by apkh-search, which leaves similarities unchanged.
const SPACES: Record<EmbeddingSpace['provider'], EmbeddingSpace> = {
  builtin: {
    id: 'qwen3-embedding-0.6b@1536',
    provider: 'builtin',
    model: 'qwen3-embedding-0.6b',
    dimensions: 1536,
  },
  gemini: {
    id: 'gemini-embedding-001@1536',
    provider: 'gemini',
    model: 'gemini-embedding-001',
    dimensions: 1536,
  },
  openai: {
    id: 'text-embedding-3-small@1536',
    provider: 'openai',
    model: 'text-embedding-3-small',
    dimensions: 1536,
  },
};

/**
 * The space a provider's vectors live in. OpenRouter embeds with OpenAI's
 * text-embedding-3-small, so its vectors share OpenAI's space: switching
 * between the two needs no reindex. Claude (a key or Claude Code) has no
 * embedding model, so its notes are embedded by the built-in AI's model while
 * Claude answers; with the built-in AI off they get keyword search only (null).
 */
export function embeddingSpaceFor(
  provider: LlmProvider | null | undefined,
): EmbeddingSpace | null {
  switch (provider) {
    case 'openrouter':
      return SPACES.openai;
    case 'builtin':
    case 'gemini':
    case 'openai':
      return SPACES[provider];
    case 'anthropic':
    case 'claude-code':
      return builtinAiEnabled() ? SPACES.builtin : null;
    default:
      return null;
  }
}

/**
 * Who embeds for a user: their own provider, or the built-in AI when their
 * space is the built-in one (Claude). Embedding calls and their token counts
 * go to this, so built-in embeddings queue and count as the built-in AI's.
 */
export function embeddingLlm(
  llm: ActiveLlmSettings,
  space: EmbeddingSpace,
): ActiveLlmSettings {
  if (space.provider !== 'builtin' || llm.provider === 'builtin') return llm;
  return {
    keyName: 'Built-in AI',
    apiKey: '',
    model: BUILTIN_MODEL_ID,
    provider: 'builtin',
    plan: llm.plan,
  };
}
