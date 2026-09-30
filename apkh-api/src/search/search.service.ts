import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  KnowledgeChunk,
  KnowledgeChunkDocument,
} from 'src/common/schema/chunk';
import { NoteDocument } from 'src/common/schema/note';
import type { NoteActions, SummaryMode } from 'src/common/schema/summary';
import { htmlToPlainText } from 'src/common/utils/html';
import { errorMessage } from 'src/common/utils/http-error';
import { IndexingService } from 'src/indexing/indexing.service';
import {
  embeddingSpaceFor,
  type EmbeddingSpace,
} from 'src/search-api/embedding-space';
import {
  SearchApiClient,
  SearchApiError,
} from 'src/search-api/search-api.client';
import { LlmProvider, UsersService } from 'src/users/users.service';
import {
  mergeRankings,
  RetrievedChunk,
  RetrievalService,
} from './retrieval.service';
import { isWeakResult, QueryRewriteService } from './query-rewrite.service';

interface NoteSummaryGenerationResult {
  summary: string;
  actions: NoteActions | null;
  model: string | null;
  cacheable: boolean;
}

interface SummaryChunkContext {
  text: string;
  sourceType: string;
  sourceName?: string;
  sourcePage?: number;
}

export interface AiSearchResultReference {
  note_id: string;
  note_title: string;
  source_type: string;
  source_name?: string;
  source_page?: number;
  excerpt: string;
  /** Cosine similarity for a semantic match, 0 for a keyword-only match */
  similarity_score: number;
  /** Why the passage was retrieved */
  match: 'semantic' | 'keyword' | 'both';
  /** The answer cites it as [n], n being its 1-based position */
  cited: boolean;
}

export interface AiSearchResult {
  query: string;
  answer: string;
  confidence: 'high' | 'medium' | 'low' | 'not_found';
  references: AiSearchResultReference[];
  isError: boolean;
  /** Notes still being (re)indexed, which the answer could not use yet */
  pendingNotes?: number;
  /** The rewritten query also searched for, when the question was too vague */
  searchedFor?: string;
}

// Semantic matches below `min` similarity are ignored; at `high` the answer is
// marked "high" confidence. Scores run lower for OpenAI's text-embedding-3
// models than for Gemini's, so each embedding space gets its own scale.
const SIMILARITY_THRESHOLDS: Record<
  EmbeddingSpace['provider'],
  { min: number; high: number }
> = {
  free: { min: 0.45, high: 0.6 },
  gemini: { min: 0.5, high: 0.7 },
  openai: { min: 0.3, high: 0.5 },
};

export function similarityThresholds(provider: LlmProvider) {
  // OpenRouter embeds with OpenAI's model, so it shares OpenAI's scale.
  return SIMILARITY_THRESHOLDS[
    embeddingSpaceFor(provider)?.provider ?? 'gemini'
  ];
}

// Questions about pinned notes skip the similarity cutoff (a broad question
// like "what are the key points?" scores low against every chunk) and get a
// larger share of the note instead.
const PINNED_NOTES_MAX_CHUNKS = 12;

const SIMILAR_NOTES_LIMIT = 5;

const SUMMARY_CONTEXT_CHAR_LIMIT = 24000;
const SUMMARY_CONTEXT_MAX_CHUNKS = 36;

/** AI search answers and note summaries, built on the chunk index. */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @InjectModel(KnowledgeChunk.name)
    private readonly chunkModel: Model<KnowledgeChunkDocument>,
    private readonly usersService: UsersService,
    private readonly searchApi: SearchApiClient,
    private readonly retrieval: RetrievalService,
    private readonly indexing: IndexingService,
    private readonly queryRewrite: QueryRewriteService,
  ) {}

  /**
   * Answer a question from the user's notes: hybrid retrieval over note and
   * attachment chunks (optionally limited to pinned notes), then RAG.
   */
  async performAiSearch(
    token: string,
    userId: string,
    query: string,
    topK = 5,
    referencedNoteIds?: string[],
  ): Promise<AiSearchResult> {
    const activeLlm = await this.usersService.getActiveLlmSettings(userId);
    if (!activeLlm) {
      return this.buildGuidanceResponse(
        query,
        'Add an active API key in Profile settings to enable AI search.',
      );
    }

    // Notes indexed by older versions (or before a provider switch) are
    // brought up to date in the background; throttled per user.
    this.indexing.reconcileUser(userId).catch((err) => {
      this.logger.error(`Index reconcile failed: ${errorMessage(err)}`);
    });

    const space = embeddingSpaceFor(activeLlm.provider);
    let vector: Float32Array | null = null;
    if (space) {
      try {
        vector = await this.searchApi.embedQuery(
          token,
          activeLlm,
          space,
          query,
        );
      } catch (error) {
        const needsCredit =
          error instanceof SearchApiError && error.needsCredit;
        // A bad key or model won't work for the answer either; report it.
        if (
          error instanceof SearchApiError &&
          !error.retryable &&
          !needsCredit
        ) {
          return this.buildGuidanceResponse(query, error.message);
        }
        // No credit for embeddings (OpenRouter) is expected: answer from keywords.
        if (!needsCredit) {
          this.logger.warn(
            `Query embedding failed, answering from keyword matches: ${errorMessage(error)}`,
          );
        }
      }
    }

    const pinned = Boolean(referencedNoteIds?.length);
    const thresholds = similarityThresholds(activeLlm.provider);
    const limit = pinned ? PINNED_NOTES_MAX_CHUNKS : topK;
    const retrieveFor = (text: string, queryVector: Float32Array | null) =>
      this.retrieval.retrieve(userId, text, {
        scope: { sourceTypes: ['note', 'file'], noteIds: referencedNoteIds },
        limit,
        vector: queryVector,
        space,
        minSimilarity: pinned ? null : thresholds.min,
      });

    const [firstPass, pendingNotes] = await Promise.all([
      retrieveFor(query, vector),
      this.indexing.countPendingNotes(userId),
    ]);
    let chunks = firstPass;

    // A vague question finds little: rewrite it ("that thing about the
    // launch" -> "Q3 product launch plan") and search again with both.
    let searchedFor: string | undefined;
    if (!pinned && isWeakResult(chunks, vector !== null, thresholds.high)) {
      const rewritten = await this.queryRewrite.rewrite(
        token,
        activeLlm,
        userId,
        query,
      );
      if (rewritten) {
        const rewrittenVector = space
          ? await this.searchApi
              .embedQuery(token, activeLlm, space, rewritten.query)
              .catch(() => null)
          : null;
        chunks = mergeRankings(
          [chunks, await retrieveFor(rewritten.searchText, rewrittenVector)],
          limit,
        );
        searchedFor = rewritten.query;
      }
    }

    if (!chunks.length) {
      return {
        query,
        answer: "I couldn't find any relevant information in your notes.",
        confidence: 'not_found',
        references: [],
        isError: false,
        pendingNotes,
        searchedFor,
      };
    }

    let answer: string;
    try {
      const result = await this.searchApi.rag(
        token,
        activeLlm,
        query,
        chunks.map(contextBlock),
      );
      if (result.error) {
        return this.buildGuidanceResponse(query, result.text);
      }
      answer = result.text;
      this.trackTokens(userId, result.tokensUsed);
    } catch (error) {
      if (error instanceof SearchApiError) {
        return this.buildGuidanceResponse(query, error.message);
      }
      throw error;
    }

    const cited = citedSources(answer, chunks.length);
    const bestSimilarity = Math.max(...chunks.map((c) => c.similarity ?? -1));
    return {
      query,
      answer,
      // Word overlap says nothing about meaning, so keyword-only answers are
      // never "high"; a semantic search that only found keyword matches is "low".
      confidence: vector
        ? bestSimilarity >= thresholds.high
          ? 'high'
          : 'low'
        : 'medium',
      references: chunks.map((chunk, i) =>
        toReference(chunk, cited.has(i + 1)),
      ),
      isError: false,
      pendingNotes,
      searchedFor,
    };
  }

  /** Notes like a given note (see RetrievalService.similarNotes). */
  async similarNotes(userId: string, noteId: string) {
    const space = embeddingSpaceFor(
      await this.usersService.getActiveProvider(userId),
    );
    return this.retrieval.similarNotes(
      userId,
      noteId,
      space,
      SIMILAR_NOTES_LIMIT,
    );
  }

  async generateNoteSummary(
    token: string,
    userId: string,
    note: Pick<NoteDocument, '_id' | 'title' | 'content' | 'category'>,
    attachedFiles: string[] = [],
    mode: SummaryMode = 'brief',
  ): Promise<NoteSummaryGenerationResult> {
    const noteId = String(note._id);
    const activeLlm = await this.usersService.getActiveLlmSettings(userId);
    if (!activeLlm) {
      return {
        summary:
          'Add an active API key in Profile settings to generate AI summaries.',
        actions: null,
        model: null,
        cacheable: false,
      };
    }

    const [storedChunks, job] = await Promise.all([
      this.chunkModel
        .find({
          noteId: new Types.ObjectId(noteId),
          sourceType: { $in: ['note', 'file'] },
        })
        .sort({ chunkIndex: 1 })
        .select('text sourceType sourceName sourcePage')
        .lean<SummaryChunkContext[]>()
        .exec(),
      this.indexing.getNoteJob(noteId),
    ]);
    const reindexing = job?.status === 'queued' || job?.status === 'processing';
    const fileChunks = storedChunks.filter((c) => c.sourceType === 'file');
    const hasAttachedFiles = attachedFiles.length > 0;

    if (hasAttachedFiles && !fileChunks.length && reindexing) {
      return {
        summary:
          'Attachment text is still being indexed for this note. Please try the summary again in a moment.',
        actions: null,
        model: null,
        cacheable: false,
      };
    }

    // While the note is being re-indexed its note chunks may predate the last
    // edit: summarize the saved text instead, and don't cache the result.
    const chunks: SummaryChunkContext[] = reindexing
      ? [
          { text: htmlToPlainText(note.content), sourceType: 'note' },
          ...fileChunks,
        ]
      : storedChunks;
    const summaryContexts = chunks.length
      ? this.buildSummaryContexts(
          chunks,
          hasAttachedFiles && !fileChunks.length,
        )
      : [];

    try {
      const result = await this.searchApi.summarize(token, activeLlm, {
        noteId,
        title: note.title,
        content: note.content,
        category: note.category,
        contexts: summaryContexts,
        mode,
      });
      this.trackTokens(userId, result.tokensUsed);
      const summary = result.text.trim();
      const complete =
        mode === 'actions' ? Boolean(result.actions) : Boolean(summary);

      // A failure message ("model no longer available", ...) must not be
      // cached as the note's summary.
      return {
        summary,
        actions: result.error ? null : result.actions,
        model: result.error ? null : activeLlm.model,
        cacheable: complete && !result.error && !reindexing,
      };
    } catch (error) {
      if (error instanceof SearchApiError) {
        return {
          summary: this.normalizeSearchServiceMessage(error.message),
          actions: null,
          model: null,
          cacheable: false,
        };
      }
      this.logger.error(
        `Summary generation failed for note ${noteId}: ${errorMessage(error)}`,
      );
      throw error;
    }
  }

  private buildSummaryContexts(
    chunks: SummaryChunkContext[],
    shouldFlagMissingAttachmentText: boolean,
  ) {
    const contexts: string[] = [];
    let totalChars = 0;

    if (shouldFlagMissingAttachmentText) {
      const attachmentNote =
        '[SOURCE: attachment-status]\nThis note has attached files, but no attachment text was indexed from them. Summarize the note content and mention that attachment text was unavailable.';
      contexts.push(attachmentNote);
      totalChars += attachmentNote.length;
    }

    for (const chunk of chunks) {
      if (!chunk.text?.trim()) {
        continue;
      }

      let source = 'Note content';
      if (chunk.sourceType === 'file') {
        source = chunk.sourceName
          ? `Attachment: ${chunk.sourceName}`
          : 'Attachment';
        if (chunk.sourcePage) {
          source += ` | Page ${chunk.sourcePage}`;
        }
      }

      const context = `[SOURCE: ${source}]\n${chunk.text.trim()}`;
      const nextTotal = totalChars + context.length;
      if (
        contexts.length >= SUMMARY_CONTEXT_MAX_CHUNKS ||
        (contexts.length > 0 && nextTotal > SUMMARY_CONTEXT_CHAR_LIMIT)
      ) {
        break;
      }

      contexts.push(context);
      totalChars = nextTotal;
    }

    return contexts;
  }

  private trackTokens(userId: string, tokens: number) {
    if (tokens > 0) {
      this.usersService.addTokenUsage(userId, tokens).catch((err) => {
        this.logger.error(
          `Failed to track token usage for user ${userId}: ${errorMessage(err)}`,
        );
      });
    }
  }

  private buildGuidanceResponse(query: string, answer: string): AiSearchResult {
    return {
      query,
      answer: this.normalizeSearchServiceMessage(answer),
      confidence: 'not_found',
      references: [],
      isError: true,
    };
  }

  private normalizeSearchServiceMessage(rawMessage: string): string {
    const trimmed = rawMessage.trim();

    const prefixedProviderMessage = trimmed.match(
      /^(?:Gemini|OpenAI) embedding request failed:\s*(.+)$/i,
    );
    const normalized = (prefixedProviderMessage?.[1] ?? trimmed).trim();
    const lower = normalized.toLowerCase();

    if (
      lower.includes('api key not found') ||
      lower.includes('api_key_invalid') ||
      lower.includes('invalid api key') ||
      lower.includes('api key is invalid')
    ) {
      return 'Invalid API key for the active AI config. Update it in Profile and test the connection again.';
    }

    const singleQuotedMessage = normalized.match(/'message':\s*'([^']+)'/);
    if (singleQuotedMessage?.[1]) {
      return singleQuotedMessage[1].trim();
    }

    const doubleQuotedMessage = normalized.match(/"message"\s*:\s*"([^"]+)"/);
    if (doubleQuotedMessage?.[1]) {
      return doubleQuotedMessage[1].trim();
    }

    return normalized;
  }
}

/** A retrieved passage labelled with where it came from, for the prompt. */
/**
 * A retrieved passage labelled with where it came from, for the prompt.
 * apkh-search numbers these [1], [2], ... in order, and answers cite them.
 */
export function contextBlock(chunk: RetrievedChunk): string {
  let source = `Note "${chunk.noteTitle}"`;
  if (chunk.sourceType === 'file' && chunk.sourceName) {
    source += ` | File: ${chunk.sourceName}`;
    if (chunk.sourcePage) {
      source += ` | Page ${chunk.sourcePage}`;
    }
  }
  return `${source}\n${chunk.text}`;
}

/** Source numbers (1-based) an answer cites as [n], limited to 1..count. */
export function citedSources(answer: string, count: number): Set<number> {
  const cited = new Set<number>();
  for (const match of answer.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1]);
    if (n >= 1 && n <= count) {
      cited.add(n);
    }
  }
  return cited;
}

function toReference(
  chunk: RetrievedChunk,
  cited: boolean,
): AiSearchResultReference {
  return {
    cited,
    note_id: chunk.noteId ?? '',
    note_title: chunk.noteTitle,
    source_type: chunk.sourceType,
    source_name: chunk.sourceName,
    source_page: chunk.sourcePage,
    excerpt: chunk.text,
    similarity_score: chunk.similarity ?? 0,
    match:
      chunk.similarity !== null && chunk.keywordMatch
        ? 'both'
        : chunk.similarity !== null
          ? 'semantic'
          : 'keyword',
  };
}
