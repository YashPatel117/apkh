/**
 * Rough blended prices (USD per million tokens, input and output averaged
 * for a typical question-answering mix) used to estimate what a user's own
 * keys cost. Providers bill exactly; this is a guide, and the dashboard says
 * so. First matching prefix wins; the built-in AI is free to the user.
 */
const PRICES: { provider: string; prefix: string; perMillion: number }[] = [
  { provider: 'builtin', prefix: '', perMillion: 0 },
  { provider: 'gemini', prefix: 'gemini-2.5-pro', perMillion: 3.5 },
  { provider: 'gemini', prefix: 'gemini-2.5-flash-lite', perMillion: 0.15 },
  { provider: 'gemini', prefix: 'gemini-2.5-flash', perMillion: 0.6 },
  { provider: 'gemini', prefix: '', perMillion: 0.5 },
  { provider: 'openai', prefix: 'gpt-4o-mini', perMillion: 0.3 },
  { provider: 'openai', prefix: 'gpt-4.1-nano', perMillion: 0.15 },
  { provider: 'openai', prefix: 'gpt-4.1-mini', perMillion: 0.7 },
  { provider: 'openai', prefix: 'gpt-4.1', perMillion: 3.5 },
  { provider: 'openai', prefix: 'gpt-4o', perMillion: 4.5 },
  { provider: 'openai', prefix: 'gpt-5-nano', perMillion: 0.15 },
  { provider: 'openai', prefix: 'gpt-5-mini', perMillion: 0.7 },
  { provider: 'openai', prefix: 'gpt-5', perMillion: 3.5 },
  { provider: 'openai', prefix: 'o', perMillion: 2.5 },
  { provider: 'openai', prefix: '', perMillion: 2 },
  { provider: 'anthropic', prefix: 'claude-haiku', perMillion: 1.5 },
  { provider: 'anthropic', prefix: 'claude-3-5-haiku', perMillion: 1.5 },
  { provider: 'anthropic', prefix: 'claude-opus', perMillion: 12 },
  { provider: 'anthropic', prefix: '', perMillion: 5 },
  // OpenRouter ids ending in ":free" cost nothing; others vary by model.
  { provider: 'openrouter', prefix: '', perMillion: 1 },
];

export function estimateCostUsd(
  provider: string,
  model: string,
  tokens: number,
): number {
  if (provider === 'openrouter' && model.endsWith(':free')) return 0;
  const lower = model.toLowerCase();
  const price = PRICES.find(
    (p) => p.provider === provider && lower.startsWith(p.prefix),
  );
  return price ? (tokens / 1_000_000) * price.perMillion : 0;
}
