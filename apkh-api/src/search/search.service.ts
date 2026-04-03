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

const SEARCH_API = 'http://localhost:8000';

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
}

interface SummarizeResponse {
  summary: string;
  tokens_used: number;
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
  confidence: 'high' | 'low' | 'not_found';
  references: AiSearchResultReference[];
  isError: boolean;
}

const SUMMARY_CONTEXT_CHAR_LIMIT = 24000;
const SUMMARY_CONTEXT_MAX_CHUNKS = 36;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly httpService: HttpService,
    @InjectModel(KnowledgeChunk.name)
    private chunkModel: Model<KnowledgeChunkDocument>,
    @InjectModel(Note.name)
    private noteModel: Model<NoteDocument>,
    private readonly usersService: UsersService,
    private readonly fileService: FileService,
  ) { }

  /**
   * Trigger ingestion in the background after note create/update.
   */
  triggerIngestion(
    token: string,
    noteId: string,
    userId: string,
    title: string,
    content: string,
    files: string[],
  ) {
    this.processIngestion(token, noteId, userId, title, content, files).catch(
      (err) => {
        this.logger.error(
          `Ingestion failed for note ${noteId}: ${err.message}`,
        );
      },
    );
  }

  triggerUserReindex(token: string, userId: string) {
    this.reindexUserNotes(token, userId).catch((err) => {
      this.logger.error(`User reindex failed for ${userId}: ${err.message}`);
    });
  }

  /**
   * Call the Search module's /ingest endpoint, then persist chunks.
   */
  private async processIngestion(
    token: string,
    noteId: string,
    userId: string,
    title: string,
    content: string,
    files: string[],
    activeLlm?: ActiveLlmSettings,
  ) {
    this.logger.log(`Starting ingestion for note: ${noteId}`);

    try {
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
          timeout: 120000,
        },
      );

      const response = await firstValueFrom(res$);
      const data = response.data;

      this.logger.log(
        `Search module returned ${data.chunk_count} chunks for note ${noteId}`,
      );

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
          embeddingModel: llmSettings.model,
          embedding: chunk.embedding,
        }));

        await this.chunkModel.insertMany(chunkDocs);

        this.logger.log(
          `Stored ${chunkDocs.length} chunks in MongoDB for note ${noteId}`,
        );
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
      .find({ userId: new Types.ObjectId(userId) })
      .select('_id title content')
      .lean()
      .exec();

    for (const note of notes) {
      const noteId = (note._id as Types.ObjectId).toHexString();
      const noteFiles = await this.fileService.getNoteFiles(noteId);

      await this.processIngestion(
        token,
        noteId,
        userId,
        note.title,
        note.content,
        noteFiles?.files || [],
        activeLlm,
      );
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
      const tokensUsed = summarizeRes.data.tokens_used ?? 0;

      if (tokensUsed > 0) {
        this.usersService.addTokenUsage(userId, tokensUsed).catch((err) => {
          this.logger.error(
            `Failed to track summary token usage for user ${userId}: ${err.message}`,
          );
        });
      }

      return {
        summary,
        model: activeLlm.model,
        cacheable: Boolean(summary),
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
        source = chunk.sourceName ? `Attachment: ${chunk.sourceName}` : 'Attachment';
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
   * Execute AI RAG Search flow using cosine similarity over stored embeddings.
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

      if (!this.supportsSemanticSearch(activeLlm.provider)) {
        return this.buildGuidanceResponse(
          query,
          `The active model "${activeLlm.model}" cannot be used for semantic search embeddings yet. Switch your active AI config to Gemini or OpenAI in Profile to use AI search.`,
        );
      }

      let queryVector: number[];
      try {
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
        queryVector = embedRes.data.embedding;
      } catch (error: any) {
        const serviceDetail = this.extractSearchServiceError(error);
        if (serviceDetail) {
          return this.buildGuidanceResponse(query, serviceDetail);
        }
        throw error;
      }

      const chunkFilter: FilterQuery<KnowledgeChunkDocument> = {
        userId: new Types.ObjectId(userId),
        ...(referencedNoteIds?.length
          ? {
            noteId: {
              $in: referencedNoteIds.map((id) => new Types.ObjectId(id)),
            },
          }
          : {}),
      };

      if (activeLlm.provider === 'gemini') {
        chunkFilter.$or = [
          { embeddingProvider: 'gemini' },
          { embeddingProvider: { $exists: false } },
        ];
      } else {
        chunkFilter.embeddingProvider = activeLlm.provider;
      }

      const userChunks = await this.chunkModel.find(chunkFilter).lean();
      let contexts: string[] = ["search on web for more information on this topic"];
      let topChunks: any[] = [];

      if (userChunks.length) {
        const scoredChunks = userChunks.map((chunk) => ({
          ...chunk,
          score: this.cosineSimilarity(queryVector, chunk.embedding),
        }));

        const minSimilarityThreshold = 0.5;
        const relevantChunks = scoredChunks
          .filter((chunk) => chunk.score >= minSimilarityThreshold)
          .sort((a, b) => b.score - a.score);

        topChunks = relevantChunks.slice(0, topK);

        if (topChunks.length)
          contexts = topChunks.map((chunk) => {
            let source = `Note "${chunk.noteTitle}"`;
            if (chunk.sourceType === 'file' && chunk.sourceName) {
              source += ` | File: ${chunk.sourceName}`;
              if (chunk.sourcePage) {
                source += ` | Page ${chunk.sourcePage}`;
              }
            }
            return `[SOURCE: ${source}]\n${chunk.text}`;
          });
      }

      let answer = '';
      let tokensUsed = 0;

      try {
        const ragRes$ = this.httpService.post<{
          answer: string;
          tokens_used: number;
        }>(
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
        confidence: topChunks[0]?.score > 0.35 ? 'high' : 'low',
        references: topChunks.map((chunk) => ({
          note_id: chunk.noteId.toString(),
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

  private supportsSemanticSearch(provider: ActiveLlmSettings['provider']) {
    return provider === 'gemini' || provider === 'openai';
  }

  /**
   * Fast cosine similarity between two numeric vectors.
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
