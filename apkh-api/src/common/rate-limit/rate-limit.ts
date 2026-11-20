import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { getIdFromToken } from '../utils/jwt';

/**
 * Who a limit is counted for:
 * - `ip`: the caller's address (sign-in, public share links)
 * - `user`: the signed-in user, from the bearer token (falls back to the IP)
 * - `email`: the `email` in the request body, so one account can't be
 *   brute-forced from many addresses (falls back to the IP)
 */
export type RateLimitKey = 'ip' | 'user' | 'email';

export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
  by: RateLimitKey;
  /** Shared bucket name, so related routes can count together. Defaults to the route. */
  bucket?: string;
}

const RATE_LIMIT_KEY = 'apkh:rate-limit';
const MINUTE = 60_000;

/**
 * Limits how often a route can be called. Several rules can be stacked (e.g.
 * per IP and per email); the first one that is exhausted answers 429 with
 * Retry-After. Counters live in this process, so with several API instances
 * each one counts on its own.
 */
export const RateLimit = (...rules: RateLimitRule[]) =>
  SetMetadata(RATE_LIMIT_KEY, rules);

/** Ready-made rules for the routes that need them. */
export const Limits = {
  /** Password sign-in: guessing passwords. */
  login: [
    { limit: 10, windowMs: MINUTE, by: 'ip', bucket: 'login' },
    { limit: 20, windowMs: 15 * MINUTE, by: 'email', bucket: 'login' },
  ],
  /** Account creation from one address. */
  register: [{ limit: 5, windowMs: 60 * MINUTE, by: 'ip', bucket: 'register' }],
  /** Changing a password (needs the current one, so it is a guessing target too). */
  resetPassword: [
    { limit: 5, windowMs: 15 * MINUTE, by: 'ip', bucket: 'reset' },
    { limit: 5, windowMs: 15 * MINUTE, by: 'email', bucket: 'reset' },
  ],
  /** Voucher codes: guessing codes. */
  redeem: [{ limit: 10, windowMs: 60 * MINUTE, by: 'user', bucket: 'redeem' }],
  /** Questions, chat replies, summaries, transcription: each one costs AI tokens. */
  ai: [{ limit: 30, windowMs: MINUTE, by: 'user', bucket: 'ai' }],
  /** Testing a key / listing a provider's models. */
  providerCheck: [
    { limit: 20, windowMs: MINUTE, by: 'user', bucket: 'provider-check' },
  ],
  /** Heavy jobs: import, export of everything, rebuilding the index. */
  heavy: [{ limit: 5, windowMs: 10 * MINUTE, by: 'user', bucket: 'heavy' }],
  /** Public share links (no sign-in). */
  publicShare: [
    { limit: 120, windowMs: MINUTE, by: 'ip', bucket: 'public-share' },
  ],
} satisfies Record<string, RateLimitRule[]>;

/** Keys with no recent hits are swept once the map grows past this. */
const SWEEP_AT = 5_000;

/**
 * Applies @RateLimit rules. It is an interceptor rather than a guard so it runs
 * after AuthGuard: by then a `user` key comes from a verified token.
 */
@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const rules = this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (rules?.length) {
      const http = context.switchToHttp();
      const req = http.getRequest<Request>();
      const res = http.getResponse<Response>();
      const route = `${context.getClass().name}.${context.getHandler().name}`;
      this.check(rules, req, res, route);
    }
    return next.handle();
  }

  private check(
    rules: RateLimitRule[],
    req: Request,
    res: Response,
    route: string,
  ) {
    const now = Date.now();
    // Check every rule first, then count: a refused request uses up nothing.
    const keys = rules.map((rule) => {
      const key = `${rule.bucket ?? route}|${rule.by}|${keyFor(rule.by, req)}`;
      const recent = (this.hits.get(key) ?? []).filter(
        (at) => now - at < rule.windowMs,
      );
      if (recent.length >= rule.limit) {
        this.hits.set(key, recent);
        const retryAfter = Math.max(
          1,
          Math.ceil((recent[0] + rule.windowMs - now) / 1000),
        );
        res.setHeader('Retry-After', String(retryAfter));
        throw new HttpException(
          `Too many requests. Try again in ${formatWait(retryAfter)}.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return { key, recent };
    });
    for (const { key, recent } of keys) {
      recent.push(now);
      this.hits.set(key, recent);
    }
    if (this.hits.size > SWEEP_AT) {
      this.sweep(now);
    }
  }

  private sweep(now: number) {
    // The longest window in use is an hour; anything older is dead.
    for (const [key, times] of this.hits) {
      if (!times.some((at) => now - at < 60 * MINUTE)) {
        this.hits.delete(key);
      }
    }
  }
}

function keyFor(by: RateLimitKey, req: Request): string {
  if (by === 'user') {
    const [type, token] = req.headers.authorization?.split(' ') ?? [];
    if (type === 'Bearer' && token) {
      try {
        return `u:${getIdFromToken(token)}`;
      } catch {
        // fall through to the address
      }
    }
  }
  if (by === 'email') {
    const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
    if (typeof email === 'string' && email.trim()) {
      return `e:${email.trim().toLowerCase()}`;
    }
  }
  return `ip:${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`;
}

function formatWait(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
