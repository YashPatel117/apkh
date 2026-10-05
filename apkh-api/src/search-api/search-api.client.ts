import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { SEARCH_API } from 'src/common/constant/endpoint';
import type { ChunkSourceType } from 'src/common/schema/chunk';
import type { IndexedFileStatus } from 'src/common/schema/index-job';
import type { NoteActions, SummaryMode } from 'src/common/schema/summary';
import { correlationHeaders } from 'src/common/request-context';
import { readSseJson } from 'src/common/utils/sse';
import { decodeVector } from 'src/common/utils/vector';
import { queuePriority } from 'src/users/plans';
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

  /** The key has no credit for a paid model (e.g. OpenRouter embeddings): use keyword search. */
  get needsCredit(): boolean {
    return this.status === 402;
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

/** A streamed answer: its pieces as they arrive, then the whole answer. */
export type AnswerStreamEvent =
  | { type: 'token'; text: string }
  | {
      type: 'done';
      answer: string;
      error: boolean;
      tokens_used: number;
    };

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
const EMBED_BATCH_SIZE = 256;
const ANSWER_TIMEOUT_MS = 90_000;
// The built-in AI runs on the host's CPU and serves one call at a time, so
// calls can wait behind other users' as well as run slower.
const BUILTIN_AI_TIMEOUT_FACTOR = 4;
const BUILTIN_AI_BUSY =
  'The built-in AI is busy right now. Try again in a few minutes, or add your own AI key in Profile.';

function timeoutFor(llm: ActiveLlmSettings, timeoutMs: number) {
  return llm.provider === 'builtin'
    ? timeoutMs * BUILTIN_AI_TIMEOUT_FACTOR
    : timeoutMs;
}

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
      timeoutFor(llm, EXTRACT_TIMEOUT_MS),
      llm,
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
    const vectors: Float32Array[] = [];
    let tokensUsed = 0;
    // apkh-search caps texts per request; large attachments go in batches.
    for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
      const data = await this.post<{ vectors: string[]; tokens_used: number }>(
        '/ingest/embed',
        {
          texts: texts.slice(start, start + EMBED_BATCH_SIZE),
          api_key: llm.apiKey,
          model: llm.model,
          embedding_model: space.model,
          dimensions: space.dimensions,
        },
        token,
        timeoutFor(llm, EMBED_TIMEOUT_MS),
        llm,
      );
      vectors.push(...data.vectors.map(decodeVector));
      tokensUsed += data.tokens_used ?? 0;
    }
    return { vectors, tokensUsed };
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
      timeoutFor(llm, EMBED_TIMEOUT_MS),
      llm,
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
      timeoutFor(llm, ANSWER_TIMEOUT_MS),
      llm,
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
      timeoutFor(llm, ANSWER_TIMEOUT_MS),
      llm,
    );
    return {
      text: data.answer ?? '',
      error: Boolean(data.error),
      tokensUsed: data.tokens_used ?? 0,
    };
  }

  /** rag(), streamed: the answer's pieces as the model writes them. */
  ragStream(
    token: string,
    llm: ActiveLlmSettings,
    query: string,
    contexts: string[],
    signal: AbortSignal,
  ): AsyncGenerator<AnswerStreamEvent> {
    return this.stream(
      '/ai-search/rag/stream',
      { query, contexts, api_key: llm.apiKey, model: llm.model },
      token,
      timeoutFor(llm, ANSWER_TIMEOUT_MS),
      llm,
      signal,
    );
  }

  /** chatRag(), streamed. */
  chatRagStream(
    token: string,
    llm: ActiveLlmSettings,
    params: {
      query: string;
      chatHistory: { role: string; content: string }[];
      currentChatChunks: string[];
      notesChunks: string[];
      similarChatChunks: string[];
    },
    signal: AbortSignal,
  ): AsyncGenerator<AnswerStreamEvent> {
    return this.stream(
      '/ai-search/chat-rag/stream',
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
      timeoutFor(llm, ANSWER_TIMEOUT_MS),
      llm,
      signal,
    );
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
      timeoutFor(llm, ANSWER_TIMEOUT_MS),
      llm,
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
      timeoutFor(llm, ANSWER_TIMEOUT_MS),
      llm,
    );
    return {
      text: data.summary ?? '',
      actions: data.actions ?? null,
      error: Boolean(data.error),
      tokensUsed: data.tokens_used ?? 0,
    };
  }

  /**
   * `llm` is given for calls that use the user's model. On the built-in AI
   * they carry a queue priority from the user's plan; the /ingest calls are
   * indexing, which waits behind questions.
   */
  private headers(path: string, token: string, llm?: ActiveLlmSettings) {
    const headers: Record<string, string> = {
      Authorization: token,
      ...correlationHeaders(),
    };
    if (llm?.provider === 'builtin') {
      headers['X-AI-Priority'] = String(
        queuePriority(llm.plan, path.startsWith('/ingest/')),
      );
    }
    return headers;
  }

  /**
   * POST to a streaming endpoint and yield its events. `idleTimeout` is the
   * longest wait for the next event (the first may wait in the built-in AI's
   * queue); `signal` stops the call, e.g. when the browser goes away.
   */
  private async *stream<T>(
    path: string,
    body: unknown,
    token: string,
    idleTimeout: number,
    llm: ActiveLlmSettings,
    signal: AbortSignal,
  ): AsyncGenerator<T> {
    const idle = new AbortController();
    let timer = setTimeout(() => idle.abort(), idleTimeout);
    const timedOut = () =>
      new SearchApiError(
        llm.provider === 'builtin'
          ? BUILTIN_AI_BUSY
          : 'The AI provider took too long to answer. Please try again.',
        503,
      );
    try {
      let response: globalThis.Response;
      try {
        response = await fetch(`${SEARCH_API}${path}`, {
          method: 'POST',
          headers: {
            ...this.headers(path, token, llm),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.any([signal, idle.signal]),
        });
      } catch (error) {
        if (idle.signal.aborted) throw timedOut();
        throw new SearchApiError(
          error instanceof Error ? error.message : String(error),
          null,
        );
      }
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => null)) as {
          detail?: unknown;
        } | null;
        throw new SearchApiError(
          typeof data?.detail === 'string'
            ? data.detail
            : `Search service error (HTTP ${response.status})`,
          response.status,
        );
      }
      try {
        for await (const event of readSseJson<T>(response.body)) {
          clearTimeout(timer);
          timer = setTimeout(() => idle.abort(), idleTimeout);
          yield event;
        }
      } catch (error) {
        if (idle.signal.aborted) throw timedOut();
        throw error;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async post<T>(
    path: string,
    body: unknown,
    token: string,
    timeout: number,
    llm?: ActiveLlmSettings,
  ): Promise<T> {
    const builtin = llm?.provider === 'builtin';
    const headers = this.headers(path, token, llm);
    try {
      const response = await firstValueFrom(
        this.http.post<T>(`${SEARCH_API}${path}`, body, { headers, timeout }),
      );
      return response.data;
    } catch (error) {
      // Timed out waiting in the built-in AI's queue (or on a slow answer)
      if (builtin && isAxiosError(error) && error.code === 'ECONNABORTED') {
        throw new SearchApiError(BUILTIN_AI_BUSY, 503);
      }
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
