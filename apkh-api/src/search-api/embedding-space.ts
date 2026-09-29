import type { LlmProvider } from 'src/users/users.service';

/**
 * An embedding model at a fixed size. Vectors are only comparable within one
 * space, so every stored vector is labelled with the id of its space.
 */
export interface EmbeddingSpace {
  id: string;
  provider: 'gemini' | 'openai';
  model: string;
  dimensions: number;
}

// Both providers at 1536 dimensions: one vector index definition fits either,
// and Gemini's vectors are half the size of its 3072 default for a negligible
// quality difference.
const SPACES: Record<EmbeddingSpace['provider'], EmbeddingSpace> = {
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

/** The space a provider's vectors live in, or null (Anthropic has no embedding model). */
export function embeddingSpaceFor(
  provider: LlmProvider | null | undefined,
): EmbeddingSpace | null {
  return provider === 'gemini' || provider === 'openai'
    ? SPACES[provider]
    : null;
}
