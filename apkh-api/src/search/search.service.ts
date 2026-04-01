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

  /**
   * Execute AI RAG Search flow using cosine similarity over stored embeddings.
   */
  async performAiSearch(
    token: string,
    userId: string,
    query: string,
    topK = 5,
  ) {
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

      if (!userChunks.length) {
        return {
          query,
          answer:
            "I couldn't find any indexed notes compatible with your active AI settings yet.",
          confidence: 'not_found',
          references: [],
        };
      }

      const scoredChunks = userChunks.map((chunk) => ({
        ...chunk,
        score: this.cosineSimilarity(queryVector, chunk.embedding),
      }));

      const minSimilarityThreshold = 0.5;
      const relevantChunks = scoredChunks
        .filter((chunk) => chunk.score >= minSimilarityThreshold)
        .sort((a, b) => b.score - a.score);

      const topChunks = relevantChunks.slice(0, topK);

      if (!topChunks.length) {
        return {
          query,
          answer:
            "I couldn't find any information in your notes relevant to your question.",
          confidence: 'low',
          references: [],
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
        confidence: topChunks[0].score > 0.35 ? 'high' : 'low',
        references: topChunks.map((chunk) => ({
          note_id: chunk.noteId.toString(),
          note_title: chunk.noteTitle,
          source_type: chunk.sourceType,
          source_name: chunk.sourceName,
          source_page: chunk.sourcePage,
          excerpt: chunk.text,
          similarity_score: chunk.score,
        })),
      };
    } catch (error: any) {
      this.logger.error(`AI Search failed: ${error.message}`);
      throw error;
    }
  }

  private buildGuidanceResponse(query: string, answer: string) {
    return {
      query,
      answer,
      confidence: 'not_found',
      references: [],
    };
  }

  private extractSearchServiceError(error: any): string | null {
    const responseData = error?.response?.data as
      | { detail?: unknown; message?: unknown }
      | undefined;
    const detail = responseData?.detail;
    if (typeof detail === 'string' && detail.trim()) {
      return detail;
    }

    const message = responseData?.message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }

    if (Array.isArray(message)) {
      const combined = message
        .filter(
          (item): item is string => typeof item === 'string' && !!item.trim(),
        )
        .join(' ');
      return combined || null;
    }

    return null;
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
