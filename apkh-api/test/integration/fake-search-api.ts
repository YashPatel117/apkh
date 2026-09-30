/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- tests read untyped HTTP JSON and raw documents, and fakes mirror async APIs */
import { SearchApiError } from 'src/search-api/search-api.client';

/**
 * Deterministic stand-in for apkh-search: records every call so tests can
 * assert what was (not) re-read or re-embedded.
 */
export class FakeSearchApi {
  files = new Map<string, string>(); // file name -> text ('' = unreadable)
  failingFiles = new Set<string>();
  extractCalls: string[][] = [];
  embedCalls: string[][] = [];
  queryCalls: string[] = [];
  embedError: SearchApiError | null = null;
  rewrites = new Map<string, { query: string; keywords: string[] }>();
  rewriteCalls: string[] = [];

  async extractFiles(
    _token: string,
    _llm: unknown,
    params: { files: string[] },
  ) {
    this.extractCalls.push([...params.files]);
    return {
      tokensUsed: 0,
      files: params.files.map((name) => {
        if (this.failingFiles.has(name)) {
          return {
            file_name: name,
            status: 'failed',
            text: '',
            page_count: 0,
            error: 'storage down',
          };
        }
        const text = this.files.get(name);
        if (text === undefined)
          return {
            file_name: name,
            status: 'missing',
            text: '',
            page_count: 0,
          };
        if (!text)
          return { file_name: name, status: 'empty', text: '', page_count: 0 };
        return {
          file_name: name,
          status: 'ok',
          method: 'direct',
          text,
          page_count: 0,
        };
      }),
    };
  }

  async chunk(
    _token: string,
    params: {
      content: string;
      contentFormat: string;
      sourceType: string;
      files?: { name: string; text: string }[];
    },
  ) {
    const main =
      params.contentFormat === 'html'
        ? params.content
            .split(/<\/p>/)
            .map((p) => p.replace(/<[^>]+>/g, '').trim())
            .filter(Boolean)
        : params.content
            .split(/\n\n/)
            .map((p) => p.trim())
            .filter(Boolean);
    const chunks: any[] = main.map((text) => ({
      text,
      source_type: params.sourceType,
    }));
    for (const file of params.files ?? []) {
      const pages = file.text.split(/\[Page (\d+)\]\n?/);
      if (pages.length > 1) {
        for (let i = 1; i < pages.length; i += 2) {
          chunks.push({
            text: pages[i + 1].trim(),
            source_type: 'file',
            source_name: file.name,
            source_page: Number(pages[i]),
          });
        }
      } else {
        chunks.push({
          text: file.text,
          source_type: 'file',
          source_name: file.name,
        });
      }
    }
    return chunks;
  }

  async embed(
    _token: string,
    _llm: unknown,
    space: { dimensions: number },
    texts: string[],
  ) {
    if (this.embedError) throw this.embedError;
    this.embedCalls.push([...texts]);
    return {
      vectors: texts.map((t) => fakeVector(t, space.dimensions)),
      tokensUsed: texts.length,
    };
  }

  async embedQuery(
    _token: string,
    _llm: unknown,
    space: { dimensions: number },
    query: string,
  ) {
    this.queryCalls.push(query);
    return fakeVector(query, space.dimensions);
  }

  async rewriteQuery(_token: string, _llm: unknown, query: string) {
    this.rewriteCalls.push(query);
    const rewrite = this.rewrites.get(query);
    return rewrite
      ? { ...rewrite, error: false, tokensUsed: 1 }
      : { query, keywords: [], error: true, tokensUsed: 0 };
  }

  get embeddedTexts() {
    return this.embedCalls.flat();
  }

  reset() {
    this.extractCalls = [];
    this.embedCalls = [];
    this.queryCalls = [];
    this.rewriteCalls = [];
    this.rewrites.clear();
    this.embedError = null;
  }
}

/** Bag-of-words vector: texts sharing words are similar. */
export function fakeVector(text: string, dims: number): Float32Array {
  const v = new Float32Array(dims);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let h = 0;
    for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) % dims;
    v[h] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}
