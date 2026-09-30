import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { SEARCH_API } from 'src/common/constant/endpoint';
import type { ChunkSourceType } from 'src/common/schema/chunk';
import type { IndexedFileStatus } from 'src/common/schema/index-job';
import type { NoteActions, SummaryMode } from 'src/common/schema/summary';
import { decodeVector } from 'src/common/utils/vector';
import type { ActiveLlmSettings } from 'src/users/users.service';
import type { EmbeddingSpace } from './embedding-space';

/** A failed call to apkh-search. `status` is null when it couldn't be reached. */
export class SearchApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'SearchApiError';
  }

  /** Rate limits, provider/server errors and network failures are worth retrying. */
  get retryable(): boolean {
    return this.status === null || this.status === 429 || this.status >= 500;
  }
}

export interface ExtractedFile {
  file_name: string;
  status: IndexedFileStatus;
  method?: string | null;
  text: string;
  page_count: number;
  warning?: string | null;
  error?: string | null;
}

export interface TextChunk {
  text: string;
  source_type: ChunkSourceType;
  source_name?: string | null;
  source_page?: number | null;
}

export interface GeneratedText {
  text: string;
  /** apkh-search flags failures (unavailable model, provider error, ...) */
  error: boolean;
  tokensUsed: number;
}

// Images and scanned PDF pages are read by the user's vision model, which can
// take minutes for large attachments.
const EXTRACT_TIMEOUT_MS = 10 * 60_000;
const EMBED_TIMEOUT_MS = 2 * 60_000;
const ANSWER_TIMEOUT_MS = 90_000;

/** Typed client for the apkh-search service. */
@Injectable()
export class SearchApiClient {
  constructor(private readonly http: HttpService) {}

  async extractFiles(
    token: string,
    llm: ActiveLlmSettings,
    params: { noteId: string; userId: string; files: string[] },
  ): Promise<{ files: ExtractedFile[]; tokensUsed: number }> {
    const data = await this.post<{
      files: ExtractedFile[];
      tokens_used: number;
    }>(
      '/ingest/extract',
      {
        note_id: params.noteId,
        user_id: params.userId,
        files: params.files,
        api_key: llm.apiKey,
        model: llm.model,
      },
      token,
      EXTRACT_TIMEOUT_MS,
    );
    return { files: data.files, tokensUsed: data.tokens_used ?? 0 };
  }

  async chunk(
    token: string,
    params: {
      content: string;
      contentFormat: 'html' | 'text';
      sourceType: 'note' | 'chat';
      files?: { name: string; text: string }[];
    },
  ): Promise<TextChunk[]> {
    const data = await this.post<{ chunks: TextChunk[] }>(
      '/ingest/chunk',
      {
        content: params.content,
        content_format: params.contentFormat,
        source_type: params.sourceType,
        files: (params.files ?? []).map((file) => ({
          file_name: file.name,
          text: file.text,
        })),
      },
      token,
      EMBED_TIMEOUT_MS,
    );
    return data.chunks;
  }

  async embed(
    token: string,
    llm: ActiveLlmSettings,
    space: EmbeddingSpace,
    texts: string[],
  ): Promise<{ vectors: Float32Array[]; tokensUsed: number }> {
    if (!texts.length) {
      return { vectors: [], tokensUsed: 0 };
    }
    const data = await this.post<{ vectors: string[]; tokens_used: number }>(
      '/ingest/embed',
      {
        texts,
        api_key: llm.apiKey,
        model: llm.model,
        embedding_model: space.model,
        dimensions: space.dimensions,
      },
      token,
      EMBED_TIMEOUT_MS,
    );
    return {
      vectors: data.vectors.map(decodeVector),
      tokensUsed: data.tokens_used ?? 0,
    };
  }

  async embedQuery(
    token: string,
    llm: ActiveLlmSettings,
    space: EmbeddingSpace,
    query: string,
  ): Promise<Float32Array> {
    const data = await this.post<{ embedding: number[] }>(
      '/ai-search/embed-query',
      {
        query,
        api_key: llm.apiKey,
        model: llm.model,
        embedding_model: space.model,
        dimensions: space.dimensions,
      },
      token,
      EMBED_TIMEOUT_MS,
    );
    return Float32Array.from(data.embedding);
  }

  async rag(
    token: string,
    llm: ActiveLlmSettings,
    query: string,
    contexts: string[],
  ): Promise<GeneratedText> {
    const data = await this.post<{
      answer: string;
      error?: boolean;
      tokens_used: number;
    }>(
      '/ai-search/rag',
      { query, contexts, api_key: llm.apiKey, model: llm.model },
      token,
      ANSWER_TIMEOUT_MS,
    );
    return {
      text: data.answer ?? '',
      error: Boolean(data.error),
      tokensUsed: data.tokens_used ?? 0,
    };
  }

  async chatRag(
    token: string,
    llm: ActiveLlmSettings,
    params: {
      query: string;
      chatHistory: { role: string; content: string }[];
      currentChatChunks: string[];
      notesChunks: string[];
      similarChatChunks: string[];
    },
  ): Promise<GeneratedText> {
    const data = await this.post<{
      answer: string;
      error?: boolean;
      tokens_used: number;
    }>(
      '/ai-search/chat-rag',
      {
        query: params.query,
        chat_history: params.chatHistory,
        current_chat_chunks: params.currentChatChunks,
        notes_chunks: params.notesChunks,
        similar_chat_chunks: params.similarChatChunks,
        api_key: llm.apiKey,
        model: llm.model,
      },
      token,
      ANSWER_TIMEOUT_MS,
    );
    return {
      text: data.answer ?? '',
      error: Boolean(data.error),
      tokensUsed: data.tokens_used ?? 0,
    };
  }

  /**
   * A standalone search query (plus extra keywords) for a vague question or a
   * chat follow-up. `error` is set, and the original query returned, on failure.
   */
  async rewriteQuery(
    token: string,
    llm: ActiveLlmSettings,
    query: string,
    history: { role: string; content: string }[] = [],
  ): Promise<{
    query: string;
    keywords: string[];
    error: boolean;
    tokensUsed: number;
  }> {
    const data = await this.post<{
      query: string;
      keywords: string[];
      error?: boolean;
      tokens_used: number;
    }>(
      '/ai-search/rewrite-query',
      { query, history, api_key: llm.apiKey, model: llm.model },
      token,
      ANSWER_TIMEOUT_MS,
    );
    return {
      query: data.query || query,
      keywords: data.keywords ?? [],
      error: Boolean(data.error),
      tokensUsed: data.tokens_used ?? 0,
    };
  }

  async summarize(
    token: string,
    llm: ActiveLlmSettings,
    params: {
      noteId: string;
      title: string;
      content: string;
      category: string;
      contexts: string[];
      mode: SummaryMode;
    },
  ): Promise<GeneratedText & { actions: NoteActions | null }> {
    const data = await this.post<{
      summary: string;
      actions?: NoteActions | null;
      error?: boolean;
      tokens_used: number;
    }>(
      '/ai-search/summarize',
      {
        mode: params.mode,
        note_id: params.noteId,
        title: params.title,
        content: params.content,
        category: params.category,
        contexts: params.contexts,
        api_key: llm.apiKey,
        model: llm.model,
      },
      token,
      ANSWER_TIMEOUT_MS,
    );
    return {
      text: data.summary ?? '',
      actions: data.actions ?? null,
      error: Boolean(data.error),
      tokensUsed: data.tokens_used ?? 0,
    };
  }

  private async post<T>(
    path: string,
    body: unknown,
    token: string,
    timeout: number,
  ): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.http.post<T>(`${SEARCH_API}${path}`, body, {
          headers: { Authorization: token },
          timeout,
        }),
      );
      return response.data;
    } catch (error) {
      throw toSearchApiError(error);
    }
  }
}

function toSearchApiError(error: unknown): SearchApiError {
  if (isAxiosError(error)) {
    const data = error.response?.data as
      | { detail?: unknown; message?: unknown }
      | undefined;
    const detail =
      (typeof data?.detail === 'string' && data.detail) ||
      (typeof data?.message === 'string' && data.message) ||
      error.message;
    return new SearchApiError(detail, error.response?.status ?? null);
  }
  return new SearchApiError(
    error instanceof Error ? error.message : String(error),
    null,
  );
}
