/**
 * Plans decide how much of the built-in AI a user gets. A user's own keys are
 * never limited: the provider bills them.
 *
 * Usage is counted per session, a window that opens with the first counted
 * request and lasts PLAN_SESSION_HOURS; the allowance then starts over.
 * Questions, chat replies, summaries and query rewrites count. Indexing does
 * not, so search keeps working when the allowance runs out.
 *
 * Pro requests also go first in the built-in AI's queue.
 */
export type PlanId = 'free' | 'pro';

export interface Plan {
  id: PlanId;
  label: string;
  /** Built-in AI tokens per session */
  sessionTokens: number;
  sessionHours: number;
  /** Served before Free requests in the built-in AI's queue */
  priority: boolean;
}

const DEFAULT_SESSION_HOURS = 5;
const DEFAULT_SESSION_TOKENS: Record<PlanId, number> = {
  free: 30_000,
  pro: 200_000,
};

/** The plan stored on a user (`type`); anything unknown is Free. */
export function planOf(type: string | undefined | null): PlanId {
  return type?.trim().toLowerCase() === 'pro' ? 'pro' : 'free';
}

export function planDetails(id: PlanId): Plan {
  return {
    id,
    label: id === 'pro' ? 'Pro' : 'Free',
    sessionTokens: positiveNumber(
      process.env[`PLAN_${id.toUpperCase()}_SESSION_TOKENS`],
      DEFAULT_SESSION_TOKENS[id],
    ),
    sessionHours: sessionHours(),
    priority: id === 'pro',
  };
}

export function sessionHours(): number {
  return positiveNumber(process.env.PLAN_SESSION_HOURS, DEFAULT_SESSION_HOURS);
}

/**
 * Queue position sent to apkh-search with every built-in AI call (lower goes
 * first): Pro questions, Free questions, Pro indexing, Free indexing.
 */
export function queuePriority(plan: PlanId, background: boolean): number {
  return (background ? 2 : 0) + (plan === 'pro' ? 0 : 1);
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
