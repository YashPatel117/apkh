import { Injectable, Logger } from '@nestjs/common';
import { errorMessage } from 'src/common/utils/http-error';
import { SearchApiClient } from 'src/search-api/search-api.client';
import { ActiveLlmSettings, UsersService } from 'src/users/users.service';
import type { RetrievedChunk } from './retrieval.service';

export interface RewrittenQuery {
  /** Standalone query, for embedding */
  query: string;
  /** Query plus extra terms, for keyword search */
  searchText: string;
}

// Words that only make sense with the conversation before them.
const FOLLOW_UP_WORDS =
  /\b(it|its|this|that|these|those|they|them|their|he|him|his|she|her|there|above|previous|earlier|same|more|else|another|former|latter)\b/i;
const SHORT_QUESTION_WORDS = 6;

/**
 * A chat message that probably depends on earlier messages ("and the budget
 * for it?"): short, or leaning on pronouns and references.
 */
export function looksLikeFollowUp(message: string): boolean {
  const words = message.trim().split(/\s+/).filter(Boolean).length;
  return words <= SHORT_QUESTION_WORDS || FOLLOW_UP_WORDS.test(message);
}

/**
 * Retrieval found nothing convincing: no passages, or (with semantic search)
 * no keyword match and no passage close in meaning.
 */
export function isWeakResult(
  chunks: RetrievedChunk[],
  semantic: boolean,
  highSimilarity: number,
): boolean {
  if (!chunks.length) return true;
  if (chunks.some((chunk) => chunk.keywordMatch)) return false;
  return (
    semantic &&
    Math.max(...chunks.map((chunk) => chunk.similarity ?? -1)) < highSimilarity
  );
}

/**
 * Rewrites vague questions and chat follow-ups into standalone search
 * queries. Costs one small model call, so callers only use it when a question
 * needs it.
 */
@Injectable()
export class QueryRewriteService {
  private readonly logger = new Logger(QueryRewriteService.name);

  constructor(
    private readonly searchApi: SearchApiClient,
    private readonly usersService: UsersService,
  ) {}

  /** The rewritten query, or null if it failed or adds nothing. */
  async rewrite(
    token: string,
    llm: ActiveLlmSettings,
    userId: string,
    query: string,
    history: { role: string; content: string }[] = [],
  ): Promise<RewrittenQuery | null> {
    try {
      const result = await this.searchApi.rewriteQuery(
        token,
        llm,
        query,
        history,
      );
      if (result.tokensUsed > 0) {
        this.usersService
          .addTokenUsage(userId, result.tokensUsed)
          .catch(() => undefined);
      }
      const unchanged =
        normalize(result.query) === normalize(query) && !result.keywords.length;
      if (result.error || unchanged) {
        return null;
      }
      return {
        query: result.query,
        searchText: [result.query, ...result.keywords].join(' '),
      };
    } catch (error) {
      this.logger.warn(`Query rewrite failed: ${errorMessage(error)}`);
      return null;
    }
  }
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\W+/g, ' ').trim();
}
