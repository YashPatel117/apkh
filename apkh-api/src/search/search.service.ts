/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { firstValueFrom } from 'rxjs';
import {
  KnowledgeChunk,
  KnowledgeChunkDocument,
} from 'src/common/schema/chunk';
import { UsersService } from 'src/users/users.service';

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
    private readonly usersService: UsersService,
  ) {}

  /**
   * Trigger ingestion — fire-and-forget.
   * Called after note create/update. Runs in background, doesn't block the response.
   */
  triggerIngestion(
    token: string,
    noteId: string,
    userId: string,
    title: string,
    content: string,
    files: string[],
  ) {
    // Fire async — don't await
    this.processIngestion(token, noteId, userId, title, content, files).catch(
      (err) => {
        this.logger.error(
          `Ingestion failed for note ${noteId}: ${err.message}`,
        );
      },
    );
  }

  /**
   * Internal: call the Search module's /ingest endpoint,
   * then store returned chunks + embeddings in MongoDB.
   */
  private async processIngestion(
    token: string,
    noteId: string,
    userId: string,
    title: string,
    content: string,
    files: string[],
  ) {
    this.logger.log(`Starting ingestion for note: ${noteId}`);

    try {
      // Call the Python Search module
      const res$ = this.httpService.post<IngestResponse>(
        `${SEARCH_API}/ingest`,
        {
          note_id: noteId,
          user_id: userId,
          title,
          content,
          files,
        },
        {
          headers: { Authorization: token },
          timeout: 120000, // 2 min timeout for large files
        },
      );

      const response = await firstValueFrom(res$);
      const data = response.data;

      this.logger.log(
        `Search module returned ${data.chunk_count} chunks for note ${noteId}`,
      );

      // Delete old chunks for this note (clean re-index)
      await this.chunkModel.deleteMany({
        noteId: new Types.ObjectId(noteId),
      });

      // Insert new chunks
      if (data.chunks && data.chunks.length > 0) {
        const chunkDocs = data.chunks.map((chunk) => ({
          noteId: new Types.ObjectId(noteId),
          userId: new Types.ObjectId(userId),
          noteTitle: title,
          chunkIndex: chunk.chunk_index,
          text: chunk.text,
          sourceType: chunk.source_type,
          sourceName: chunk.source_name || undefined,
          sourcePage: chunk.source_page || undefined,
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

  /**
   * Delete all chunks for a note (called when note is deleted).
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
   * Execute AI RAG Search flow using memory-based Cosine Similarity
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
      // 1. Get embedding for the query
      const embedRes$ = this.httpService.post<{ embedding: number[] }>(
        `${SEARCH_API}/ai-search/embed-query`,
        { query },
        { headers: { Authorization: token } },
      );
      const embedRes = await firstValueFrom(embedRes$);
      const queryVector = embedRes.data.embedding;

      // 2. Fetch all user chunks
      const userChunks = await this.chunkModel
        .find({ userId: new Types.ObjectId(userId) })
        .lean();

      if (!userChunks || userChunks.length === 0) {
        return {
          query,
          answer: "I couldn't find any indexed notes to answer your question.",
          confidence: 'not_found',
          references: [],
        };
      }

      // 3. Calculate similarity score for each chunk
      const scoredChunks = userChunks.map((chunk) => ({
        ...chunk,
        score: this.cosineSimilarity(queryVector, chunk.embedding),
      }));

      // Filter out low-relevance chunks and sort descending by score
      const MIN_SIMILARITY_THRESHOLD = 0.5;
      const relevantChunks = scoredChunks.filter(
        (c) => c.score >= MIN_SIMILARITY_THRESHOLD,
      );
      relevantChunks.sort((a, b) => b.score - a.score);

      const topChunks = relevantChunks.slice(0, topK);

      if (topChunks.length === 0) {
        return {
          query,
          answer:
            "I couldn't find any information in your notes relevant to your question.",
          confidence: 'low',
          references: [],
        };
      }

      // Format context strings for the LLM
      const contexts = topChunks.map((c) => {
        let source = `Note "${c.noteTitle}"`;
        if (c.sourceType === 'file' && c.sourceName) {
          source += ` | File: ${c.sourceName}`;
          if (c.sourcePage) source += ` | Page ${c.sourcePage}`;
        }
        return `[SOURCE: ${source}]\n${c.text}`;
      });

      // 4. Generate Answer via RAG endpoint — pass user's key+model
      const { apiKey, model } = await this.usersService.getLlmSettings(userId);

      const ragRes$ = this.httpService.post<{
        answer: string;
        tokens_used: number;
      }>(
        `${SEARCH_API}/ai-search/rag`,
        { query, contexts, api_key: apiKey, model },
        {
          headers: { Authorization: token },
          timeout: 60000,
        },
      );
      const ragRes = await firstValueFrom(ragRes$);
      const answer = ragRes.data.answer;
      const tokensUsed = ragRes.data.tokens_used ?? 0;

      // Track token usage for the user (fire-and-forget)
      if (tokensUsed > 0) {
        this.usersService.addTokenUsage(userId, tokensUsed).catch((err) => {
          this.logger.error(
            `Failed to track token usage for user ${userId}: ${err.message}`,
          );
        });
      }

      // 5. Build Final Response Interface
      return {
        query,
        answer,
        confidence: topChunks[0].score > 0.35 ? 'high' : 'low',
        references: topChunks.map((c) => ({
          note_id: c.noteId.toString(),
          note_title: c.noteTitle,
          source_type: c.sourceType,
          source_name: c.sourceName,
          source_page: c.sourcePage,
          excerpt: c.text,
          similarity_score: c.score,
        })),
      };
    } catch (error: any) {
      this.logger.error(`AI Search failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fast mathematical calculation of Cosine Similarity between two numeric vectors.
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
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
