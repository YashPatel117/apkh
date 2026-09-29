/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { firstValueFrom } from 'rxjs';
import {
  KnowledgeChunk,
  KnowledgeChunkDocument,
} from 'src/common/schema/chunk';
import { Note, NoteDocument } from 'src/common/schema/note';
import { ActiveLlmSettings, UsersService } from 'src/users/users.service';
import { FileService } from 'src/file/file.service';
import { SEARCH_API } from 'src/common/constant/endpoint';
import { cosineSimilarity } from 'src/common/utils/vector';

interface IngestChunk {
  chunk_index: number;
  text: string;
  source_type: 'note' | 'file';
  source_name?: string;
  source_page?: number;
  embedding: number[];
}

interface IngestResponse {
  note_id: string;
  chunks: IngestChunk[];
  chunk_count: number;
  status: string;
  embedding_model?: string | null;
}

interface SummarizeResponse {
  summary: string;
  error?: boolean;
  tokens_used: number;
}

interface RagResponse {
  answer: string;
  error?: boolean;
  tokens_used: number;
}

export interface KeywordNoteMatch {
  noteId: string;
  title: string;
  text: string;
  /** MongoDB text score (higher is better; no fixed scale) */
  score: number;
}

/** A retrieved passage the answer is built from. */
interface SearchSource {
  noteId: string;
  noteTitle: string;
  sourceType: string;
  sourceName?: string;
  sourcePage?: number;
  text: string;
  score: number;
}

interface NoteSummaryGenerationResult {
  summary: string;
  model: string | null;
  cacheable: boolean;
}

interface SummaryChunkContext {
  text: string;
  sourceType: 'note' | 'file';
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
  similarity_score: number;
}

export interface AiSearchResult {
  query: string;
  answer: string;
  confidence: 'high' | 'medium' | 'low' | 'not_found';
  references: AiSearchResultReference[];
  isError: boolean;
}

type SemanticProvider = 'gemini' | 'openai';

// Chunks below `min` similarity are ignored; above `high` the answer is marked
// "high" confidence. Scores run lower for OpenAI's text-embedding-3 models than
// for Gemini's, so each provider gets its own scale.
const SIMILARITY_THRESHOLDS: Record<
  SemanticProvider,
  { min: number; high: number }
> = {
  gemini: { min: 0.5, high: 0.7 },
  openai: { min: 0.3, high: 0.5 },
};

// Questions about pinned notes skip the similarity cutoff (a broad question
// like "what are the key points?" scores low against every chunk) and get a
// larger share of the note instead.
const PINNED_NOTES_MAX_CHUNKS = 12;

const KEYWORD_NOTE_CHAR_LIMIT = 3000;

/**
 * Filter for the notes of a user. Note.userId is declared with the BSON
 * ObjectId class instead of a schema type, so Mongoose leaves it untyped and
 * notes store the id exactly as given — a string from the JWT. Matching both
 * forms also covers notes written with an ObjectId.
 */
function noteOwner(userId: string) {
  return { $in: [userId, new Types.ObjectId(userId)] };
}

const SUMMARY_CONTEXT_CHAR_LIMIT = 24000;
const SUMMARY_CONTEXT_MAX_CHUNKS = 36;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  // One ingestion at a time per note: concurrent runs interleave their
  // delete + insert and leave duplicate chunks behind.
  private readonly ingestionRuns = new Map<string, Promise<void>>();
  // Bumped on every request, so a queued run that a newer save superseded is skipped.
  private readonly ingestionRequests = new Map<string, number>();

  constructor(
    private readonly httpService: HttpService,
    @InjectModel(KnowledgeChunk.name)
    private chunkModel: Model<KnowledgeChunkDocument>,
    @InjectModel(Note.name)
    private noteModel: Model<NoteDocument>,
    private readonly usersService: UsersService,
    private readonly fileService: FileService,
  ) {}

  /**
   * Trigger ingestion in the background after note create/update. The note's
   * latest title, content and files are read when the run starts.
   */
  triggerIngestion(token: string, noteId: string, userId: string) {
    void this.scheduleIngestion(token, noteId, userId);
  }

  triggerUserReindex(token: string, userId: string) {
    this.reindexUserNotes(token, userId).catch((err) => {
      this.logger.error(`User reindex failed for ${userId}: ${err.message}`);
    });
  }

  /** Queues ingestion behind any run already in progress for the same note. */
  private scheduleIngestion(
    token: string,
    noteId: string,
    userId: string,
    activeLlm?: ActiveLlmSettings,
  ): Promise<void> {
    const request = (this.ingestionRequests.get(noteId) ?? 0) + 1;
    this.ingestionRequests.set(noteId, request);

    const previous = this.ingestionRuns.get(noteId) ?? Promise.resolve();
    const run = previous
      .then(async () => {
        if (this.ingestionRequests.get(noteId) !== request) {
          return; // a newer request for this note will index its latest state
        }
        await this.processIngestion(token, noteId, userId, activeLlm);
      })
      .catch((err) => {
        this.logger.error(
          `Ingestion failed for note ${noteId}: ${err.message}`,
        );
      })
      .finally(() => {
        if (this.ingestionRuns.get(noteId) === run) {
          this.ingestionRuns.delete(noteId);
          this.ingestionRequests.delete(noteId);
        }
      });

    this.ingestionRuns.set(noteId, run);
    return run;
  }

  /**
   * Call the Search module's /ingest endpoint, then persist chunks.
   */
  private async processIngestion(
    token: string,
    noteId: string,
    userId: string,
    activeLlm?: ActiveLlmSettings,
  ) {
    this.logger.log(`Starting ingestion for note: ${noteId}`);

    try {
      const note = await this.noteModel
        .findOne({ _id: noteId, userId: noteOwner(userId) })
        .select('title content')
        .lean()
        .exec();
      if (!note) {
        await this.deleteChunks(noteId);
        return;
      }
      const { title, content } = note;
      const files = (await this.fileService.getNoteFiles(noteId))?.files ?? [];

      const llmSettings =
        activeLlm ?? (await this.usersService.getActiveLlmSettings(userId));

      if (!llmSettings) {
        this.logger.warn(
          `Skipping ingestion for note ${noteId}: no active AI configuration`,
        );
        return;
      }

      if (!this.supportsSemanticSearch(llmSettings.provider)) {
        this.logger.warn(
          `Skipping ingestion for note ${noteId}: provider ${llmSettings.provider} does not support semantic search embeddings`,
        );
        return;
      }

      const res$ = this.httpService.post<IngestResponse>(
        `${SEARCH_API}/ingest`,
        {
          note_id: noteId,
          user_id: userId,
          title,
          content,
          files,
          api_key: llmSettings.apiKey,
          model: llmSettings.model,
        },
        {
          headers: { Authorization: token },
          // Images and scanned PDF pages are read by the user's vision model,
          // which can take minutes for large attachments.
          timeout: 600000,
        },
      );

      const response = await firstValueFrom(res$);
      const data = response.data;

      this.logger.log(
        `Search module returned ${data.chunk_count} chunks for note ${noteId}`,
      );

      // The note may have been deleted while the search service was working.
      if (!(await this.noteModel.exists({ _id: noteId }))) {
        await this.deleteChunks(noteId);
        return;
      }

      await this.chunkModel.deleteMany({
        noteId: new Types.ObjectId(noteId),
      });

      if (data.chunks.length > 0) {
        const chunkDocs = data.chunks.map((chunk) => ({
          noteId: new Types.ObjectId(noteId),
          userId: new Types.ObjectId(userId),
          noteTitle: title,
          chunkIndex: chunk.chunk_index,
          text: chunk.text,
          sourceType: chunk.source_type,
          sourceName: chunk.source_name || undefined,
          sourcePage: chunk.source_page || undefined,
          embeddingProvider: llmSettings.provider,
          // The model that produced the vectors, not the chat model
          embeddingModel: data.embedding_model || llmSettings.model,
          embedding: chunk.embedding,
        }));

        await this.chunkModel.insertMany(chunkDocs);

        this.logger.log(
          `Stored ${chunkDocs.length} chunks in MongoDB for note ${noteId}`,
        );

        // ...or while the chunks were being written.
        if (!(await this.noteModel.exists({ _id: noteId }))) {
          await this.deleteChunks(noteId);
        }
      }
    } catch (error: any) {
      this.logger.error(
        `Ingestion processing error for note ${noteId}: ${error.message}`,
      );
      throw error;
    }
  }

  private async reindexUserNotes(token: string, userId: string) {
    const activeLlm = await this.usersService.getActiveLlmSettings(userId);

    if (!activeLlm) {
      this.logger.warn(
        `Skipping user reindex for ${userId}: no active AI configuration`,
      );
      return;
    }

    const notes = await this.noteModel
      .find({ userId: noteOwner(userId) })
      .select('_id')
      .lean()
      .exec();

    // One note at a time, so a large library doesn't flood the provider.
    for (const note of notes) {
      const noteId = (note._id as Types.ObjectId).toHexString();
      await this.scheduleIngestion(token, noteId, userId, activeLlm);
    }
  }

  /**
   * Delete all chunks for a note.
   */
  async deleteChunks(noteId: string) {
    try {
      const result = await this.chunkModel.deleteMany({
        noteId: new Types.ObjectId(noteId),
      });
      this.logger.log(
        `Deleted ${result.deletedCount} chunks for note ${noteId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to delete chunks for note ${noteId}: ${error.message}`,
      );
    }
  }

  async generateNoteSummary(
    token: string,
    userId: string,
    note: Pick<NoteDocument, '_id' | 'title' | 'content' | 'category'>,
    attachedFiles: string[] = [],
  ): Promise<NoteSummaryGenerationResult> {
    this.logger.log(`Generating summary for note ${note._id as string}`);

    const activeLlm = await this.usersService.getActiveLlmSettings(userId);

    if (!activeLlm) {
      return {
        summary:
          'Add an active API key in Profile settings to generate AI summaries.',
        model: null,
        cacheable: false,
      };
    }

    const noteId = note._id as string;
    const storedChunks = await this.chunkModel
      .find({
        noteId: new Types.ObjectId(noteId),
        userId: new Types.ObjectId(userId),
      })
      .sort({ chunkIndex: 1 })
      .select('text sourceType sourceName sourcePage chunkIndex')
      .lean()
      .exec();

    const hasAttachedFiles = attachedFiles.length > 0;
    const fileChunkCount = storedChunks.filter(
      (chunk) => chunk.sourceType === 'file',
    ).length;

    if (
      !storedChunks.length &&
      hasAttachedFiles &&
      !this.supportsSemanticSearch(activeLlm.provider)
    ) {
      return {
        summary:
          'This note has attachments, but your active AI model does not create indexed file chunks in this app yet. Switch to an OpenAI or Gemini config once to include attachment text in summaries.',
        model: null,
        cacheable: false,
      };
    }

    if (!storedChunks.length && hasAttachedFiles) {
      return {
        summary:
          'Attachment text is still being indexed for this note. Please try the summary again in a moment.',
        model: null,
        cacheable: false,
      };
    }

    const summaryContexts = storedChunks.length
      ? this.buildSummaryContexts(
          storedChunks.map((chunk) => ({
            text: chunk.text,
            sourceType: chunk.sourceType as 'note' | 'file',
            sourceName: chunk.sourceName,
            sourcePage: chunk.sourcePage,
          })),
          hasAttachedFiles && fileChunkCount === 0,
        )
      : [];

    try {
      const summarizeRes$ = this.httpService.post<SummarizeResponse>(
        `${SEARCH_API}/ai-search/summarize`,
        {
          note_id: noteId,
          title: note.title,
          content: note.content,
          category: note.category,
          contexts: summaryContexts,
          api_key: activeLlm.apiKey,
          model: activeLlm.model,
        },
        {
          headers: { Authorization: token },
          timeout: 60000,
        },
      );

      const summarizeRes = await firstValueFrom(summarizeRes$);
      const summary = summarizeRes.data.summary?.trim() ?? '';
      const failed = Boolean(summarizeRes.data.error);
      const tokensUsed = summarizeRes.data.tokens_used ?? 0;

      if (tokensUsed > 0) {
        this.usersService.addTokenUsage(userId, tokensUsed).catch((err) => {
          this.logger.error(
            `Failed to track summary token usage for user ${userId}: ${err.message}`,
          );
        });
      }

      // A failure message ("model no longer available", ...) must not be
      // cached as the note's summary.
      return {
        summary,
        model: failed ? null : activeLlm.model,
        cacheable: Boolean(summary) && !failed,
      };
    } catch (error: any) {
      const serviceDetail = this.extractSearchServiceError(error);
      if (serviceDetail) {
        return {
          summary: serviceDetail,
          model: null,
          cacheable: false,
        };
      }
      this.logger.error(
        `Summary generation failed for note ${note._id as string}: ${error.message}`,
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

  /**
   * Execute AI RAG Search: rank stored chunks by cosine similarity (or, for
   * providers without embeddings, find notes by keyword) and answer from the best.
   */
  async performAiSearch(
    token: string,
    userId: string,
    query: string,
    topK = 5,
    referencedNoteIds?: string[],
  ): Promise<AiSearchResult> {
    this.logger.log(
      `Performing AI Search for user ${userId}, query: "${query}"`,
    );

    try {
      const activeLlm = await this.usersService.getActiveLlmSettings(userId);

      if (!activeLlm) {
        return this.buildGuidanceResponse(
          query,
          'Add an active API key in Profile settings to enable AI search.',
        );
      }

      let retrieved: {
        sources: SearchSource[];
        confidence: AiSearchResult['confidence'];
      };
      if (this.supportsSemanticSearch(activeLlm.provider)) {
        let queryVector: number[];
        try {
          queryVector = await this.embedQuery(token, activeLlm, query);
        } catch (error: any) {
          const serviceDetail = this.extractSearchServiceError(error);
          if (serviceDetail) {
            return this.buildGuidanceResponse(query, serviceDetail);
          }
          throw error;
        }
        retrieved = await this.findSimilarChunks(
          userId,
          activeLlm.provider,
          queryVector,
          topK,
          referencedNoteIds,
        );
      } else {
        retrieved = await this.findKeywordSources(
          userId,
          query,
          topK,
          referencedNoteIds,
        );
      }

      const topChunks = retrieved.sources;
      if (!topChunks.length) {
        return {
          query,
          answer: "I couldn't find any relevant information in your notes.",
          confidence: 'not_found',
          references: [],
          isError: false,
        };
      }

      const contexts = topChunks.map((chunk) => {
        let source = `Note "${chunk.noteTitle}"`;
        if (chunk.sourceType === 'file' && chunk.sourceName) {
          source += ` | File: ${chunk.sourceName}`;
          if (chunk.sourcePage) {
            source += ` | Page ${chunk.sourcePage}`;
          }
        }
        return `[SOURCE: ${source}]\n${chunk.text}`;
      });

      let answer = '';
      let tokensUsed = 0;

      try {
        const ragRes$ = this.httpService.post<RagResponse>(
          `${SEARCH_API}/ai-search/rag`,
          {
            query,
            contexts,
            api_key: activeLlm.apiKey,
            model: activeLlm.model,
          },
          {
            headers: { Authorization: token },
            timeout: 60000,
          },
        );
        const ragRes = await firstValueFrom(ragRes$);
        if (ragRes.data.error) {
          return this.buildGuidanceResponse(query, ragRes.data.answer);
        }
        answer = ragRes.data.answer;
        tokensUsed = ragRes.data.tokens_used ?? 0;
      } catch (error: any) {
        const serviceDetail = this.extractSearchServiceError(error);
        if (serviceDetail) {
          return this.buildGuidanceResponse(query, serviceDetail);
        }
        throw error;
      }

      if (tokensUsed > 0) {
        this.usersService.addTokenUsage(userId, tokensUsed).catch((err) => {
          this.logger.error(
            `Failed to track token usage for user ${userId}: ${err.message}`,
          );
        });
      }

      return {
        query,
        answer,
        confidence: retrieved.confidence,
        references: topChunks.map((chunk) => ({
          note_id: chunk.noteId,
          note_title: chunk.noteTitle,
          source_type: chunk.sourceType,
          source_name: chunk.sourceName,
          source_page: chunk.sourcePage,
          excerpt: chunk.text,
          similarity_score: chunk.score,
        })),
        isError: false,
      };
    } catch (error: any) {
      this.logger.error(`AI Search failed: ${error.message}`);
      throw error;
    }
  }

  /** The note/file chunks most similar to the query vector. */
  private async findSimilarChunks(
    userId: string,
    provider: SemanticProvider,
    queryVector: number[],
    topK: number,
    referencedNoteIds?: string[],
  ): Promise<{
    sources: SearchSource[];
    confidence: AiSearchResult['confidence'];
  }> {
    const pinned = Boolean(referencedNoteIds?.length);
    const chunkFilter: FilterQuery<KnowledgeChunkDocument> = {
      userId: new Types.ObjectId(userId),
      // Chat transcripts share this collection; only notes and their files are sources here.
      sourceType: { $in: ['note', 'file'] },
      ...this.embeddingProviderFilter(provider),
      ...(pinned
        ? {
            noteId: {
              $in: referencedNoteIds!.map((id) => new Types.ObjectId(id)),
            },
          }
        : {}),
    };

    const thresholds = this.similarityThresholds(provider);
    const userChunks = await this.chunkModel.find(chunkFilter).lean();
    const sources = userChunks
      .map((chunk) => ({
        noteId: chunk.noteId.toString(),
        noteTitle: chunk.noteTitle,
        sourceType: chunk.sourceType,
        sourceName: chunk.sourceName,
        sourcePage: chunk.sourcePage,
        text: chunk.text,
        score: cosineSimilarity(queryVector, chunk.embedding),
      }))
      .filter((chunk) => pinned || chunk.score >= thresholds.min)
      .sort((a, b) => b.score - a.score)
      .slice(0, pinned ? PINNED_NOTES_MAX_CHUNKS : topK);

    return {
      sources,
      confidence: sources[0]?.score >= thresholds.high ? 'high' : 'low',
    };
  }

  /**
   * Keyword retrieval for providers without an embedding model: pinned notes
   * as-is, otherwise the best text-index matches. Scores are relative to the
   * best match, since text scores have no fixed scale.
   */
  private async findKeywordSources(
    userId: string,
    query: string,
    topK: number,
    referencedNoteIds?: string[],
  ): Promise<{
    sources: SearchSource[];
    confidence: AiSearchResult['confidence'];
  }> {
    let matches: KeywordNoteMatch[];
    if (referencedNoteIds?.length) {
      const notes = await this.noteModel
        .find({
          userId: noteOwner(userId),
          _id: { $in: referencedNoteIds.map((id) => new Types.ObjectId(id)) },
        })
        .select('title contentPlain')
        .lean()
        .exec();
      matches = notes.map((note) => ({
        noteId: (note._id as Types.ObjectId).toHexString(),
        title: note.title,
        text: (note.contentPlain ?? '').slice(0, KEYWORD_NOTE_CHAR_LIMIT),
        score: 1,
      }));
    } else {
      matches = await this.findNotesByKeywords(userId, query, topK);
    }

    const bestScore = matches[0]?.score || 1;
    return {
      sources: matches.map((match) => ({
        noteId: match.noteId,
        noteTitle: match.title,
        sourceType: 'note',
        text: match.text,
        score: match.score / bestScore,
      })),
      // Word overlap says nothing about meaning; never claim high confidence.
      confidence: 'medium',
    };
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

  private extractSearchServiceError(error: any): string | null {
    const responseData = error?.response?.data as
      | { detail?: unknown; message?: unknown }
      | undefined;
    const detail = responseData?.detail;
    if (typeof detail === 'string' && detail.trim()) {
      return this.normalizeSearchServiceMessage(detail);
    }

    const message = responseData?.message;
    if (typeof message === 'string' && message.trim()) {
      return this.normalizeSearchServiceMessage(message);
    }

    if (Array.isArray(message)) {
      const combined = message
        .filter(
          (item): item is string => typeof item === 'string' && !!item.trim(),
        )
        .join(' ');
      return combined ? this.normalizeSearchServiceMessage(combined) : null;
    }

    return null;
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
      lower.includes('invalid api key')
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

  supportsSemanticSearch(
    provider: ActiveLlmSettings['provider'],
  ): provider is SemanticProvider {
    return provider === 'gemini' || provider === 'openai';
  }

  similarityThresholds(provider: ActiveLlmSettings['provider']) {
    return this.supportsSemanticSearch(provider)
      ? SIMILARITY_THRESHOLDS[provider]
      : SIMILARITY_THRESHOLDS.gemini;
  }

  /** Only chunks embedded by this provider are comparable with its query vectors. */
  embeddingProviderFilter(
    provider: ActiveLlmSettings['provider'],
  ): FilterQuery<KnowledgeChunkDocument> {
    return provider === 'gemini'
      ? // chunks indexed before embeddingProvider existed are Gemini's
        {
          $or: [
            { embeddingProvider: 'gemini' },
            { embeddingProvider: { $exists: false } },
          ],
        }
      : { embeddingProvider: provider };
  }

  /** Embedding of a search query / chat message. Throws if the provider call fails. */
  async embedQuery(
    token: string,
    activeLlm: ActiveLlmSettings,
    query: string,
  ): Promise<number[]> {
    const embedRes$ = this.httpService.post<{ embedding: number[] }>(
      `${SEARCH_API}/ai-search/embed-query`,
      {
        query,
        api_key: activeLlm.apiKey,
        model: activeLlm.model,
      },
      { headers: { Authorization: token } },
    );
    const embedRes = await firstValueFrom(embedRes$);
    return embedRes.data.embedding;
  }

  /**
   * Notes matching the words of `query`, best first, via the notes text index.
   * Used when semantic search isn't available (e.g. Claude, which has no
   * embedding model).
   */
  async findNotesByKeywords(
    userId: string,
    query: string,
    limit: number,
  ): Promise<KeywordNoteMatch[]> {
    // Quotes and "-" are $text operators (phrase, negation); keep plain words.
    const words = query
      .replace(/["\\]/g, ' ')
      .replace(/(^|\s)-+/g, '$1')
      .trim();
    if (!words) {
      return [];
    }

    const notes = await this.noteModel
      .find(
        { userId: noteOwner(userId), $text: { $search: words } },
        { score: { $meta: 'textScore' }, title: 1, contentPlain: 1 },
      )
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .lean()
      .exec();

    return notes.map((note) => ({
      noteId: (note._id as Types.ObjectId).toHexString(),
      title: note.title,
      text: (note.contentPlain ?? '').slice(0, KEYWORD_NOTE_CHAR_LIMIT),
      score: (note as { score?: number }).score ?? 0,
    }));
  }
}
