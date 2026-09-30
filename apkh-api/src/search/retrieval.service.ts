import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  ChunkSourceType,
  KnowledgeChunk,
  KnowledgeChunkDocument,
} from 'src/common/schema/chunk';
import { errorMessage } from 'src/common/utils/http-error';
import { cosineSimilarity, fromStoredVector } from 'src/common/utils/vector';
import type { EmbeddingSpace } from 'src/search-api/embedding-space';

export interface RetrievalScope {
  sourceTypes: ChunkSourceType[];
  /** Only these notes (pinned notes) */
  noteIds?: string[];
  /** Only this chat */
  sessionId?: string;
  /** Every chat but this one */
  excludeSessionId?: string;
}

export interface RetrievedChunk {
  id: string;
  noteId?: string;
  sessionId?: string;
  noteTitle: string;
  sourceType: ChunkSourceType;
  sourceName?: string;
  sourcePage?: number;
  text: string;
  /** Cosine similarity to the query, when it matched by meaning */
  similarity: number | null;
  /** Matched the words of the query */
  keywordMatch: boolean;
  /** Fused rank score, higher is better */
  score: number;
}

interface CandidateDoc {
  _id: Types.ObjectId;
  noteId?: Types.ObjectId;
  sessionId?: Types.ObjectId;
  noteTitle: string;
  sourceType: ChunkSourceType;
  sourceName?: string;
  sourcePage?: number;
  text: string;
  textHash?: string;
  vector?: unknown;
}

const CANDIDATE_FIELDS =
  'noteId sessionId noteTitle sourceType sourceName sourcePage text textHash';
// Each search leg contributes at most this many candidates to the fusion.
const CANDIDATES_PER_LEG = 30;
// Reciprocal rank fusion constant: dampens the weight of the very top ranks.
const RRF_K = 60;
// Atlas Vector Search: approximate candidates examined per result (its docs suggest 10-20x).
const ATLAS_NUM_CANDIDATES = CANDIDATES_PER_LEG * 15;
// After an Atlas Vector Search error, scan in the API for a while before trying again.
const ATLAS_RETRY_MS = 10 * 60_000;

/**
 * Hybrid retrieval over the chunk index: a semantic leg (cosine similarity in
 * the active embedding space) and a keyword leg (MongoDB text search), merged
 * by reciprocal rank fusion. Keyword search catches exact terms — names, codes,
 * error messages — that embeddings blur; it is also all Claude users get, as
 * Anthropic has no embedding model.
 */
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);
  /**
   * Name of an Atlas Vector Search index on knowledgechunks.vector
   * (ATLAS_VECTOR_INDEX; create it with `npm run search:vector-index`). Without
   * one, similarity is computed in the API over the user's vectors.
   */
  private readonly atlasIndex = process.env.ATLAS_VECTOR_INDEX?.trim() || null;
  private atlasPausedUntil = 0;

  constructor(
    @InjectModel(KnowledgeChunk.name)
    private readonly chunkModel: Model<KnowledgeChunkDocument>,
  ) {}

  async retrieve(
    userId: string,
    query: string,
    options: {
      scope: RetrievalScope;
      limit: number;
      /** Query embedding; without it only the keyword leg runs */
      vector?: Float32Array | null;
      space?: EmbeddingSpace | null;
      /** Semantic matches below this similarity are dropped; null keeps all */
      minSimilarity?: number | null;
    },
  ): Promise<RetrievedChunk[]> {
    const filter = scopeFilter(new Types.ObjectId(userId), options.scope);

    const [semantic, keyword] = await Promise.all([
      options.vector && options.space
        ? this.semanticLeg(
            filter,
            options.vector,
            options.space,
            options.minSimilarity ?? null,
          )
        : Promise.resolve([]),
      this.keywordLeg(filter, query),
    ]);

    const fused = new Map<string, RetrievedChunk>();
    const add = (
      doc: CandidateDoc,
      rank: number,
      similarity: number | null,
    ) => {
      // The same passage can exist twice while a note is being re-indexed.
      const key = `${String(doc.noteId ?? doc.sessionId)}:${doc.textHash ?? String(doc._id)}`;
      const chunk = fused.get(key) ?? toRetrievedChunk(doc);
      chunk.score += 1 / (RRF_K + rank);
      if (similarity === null) {
        chunk.keywordMatch = true;
      } else {
        chunk.similarity = Math.max(chunk.similarity ?? -1, similarity);
      }
      fused.set(key, chunk);
    };
    semantic.forEach(({ doc, similarity }, i) => add(doc, i + 1, similarity));
    keyword.forEach((doc, i) => add(doc, i + 1, null));

    return [...fused.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit);
  }

  private async semanticLeg(
    filter: FilterQuery<KnowledgeChunkDocument>,
    vector: Float32Array,
    space: EmbeddingSpace,
    minSimilarity: number | null,
  ): Promise<{ doc: CandidateDoc; similarity: number }[]> {
    if (this.atlasIndex && Date.now() >= this.atlasPausedUntil) {
      try {
        return await this.atlasSemanticLeg(
          this.atlasIndex,
          filter,
          vector,
          space,
          minSimilarity,
        );
      } catch (error) {
        this.atlasPausedUntil = Date.now() + ATLAS_RETRY_MS;
        this.logger.warn(
          `Atlas Vector Search failed (${errorMessage(error)}); computing similarity in the API for the next ${ATLAS_RETRY_MS / 60_000} minutes`,
        );
      }
    }

    const docs = await this.chunkModel
      .find({ ...filter, embeddingModel: space.id })
      .select(`${CANDIDATE_FIELDS} vector`)
      .lean<CandidateDoc[]>()
      .exec();
    return docs
      .map((doc) => ({
        doc,
        similarity: cosineSimilarity(vector, fromStoredVector(doc.vector)),
      }))
      .filter(
        ({ similarity }) =>
          minSimilarity === null || similarity >= minSimilarity,
      )
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, CANDIDATES_PER_LEG);
  }

  /** The semantic leg on Atlas: the database ranks vectors instead of the API. */
  private async atlasSemanticLeg(
    index: string,
    filter: FilterQuery<KnowledgeChunkDocument>,
    vector: Float32Array,
    space: EmbeddingSpace,
    minSimilarity: number | null,
  ) {
    const projection = Object.fromEntries(
      CANDIDATE_FIELDS.split(' ').map((field) => [field, 1]),
    );
    const docs = await this.chunkModel
      .aggregate<CandidateDoc & { score: number }>([
        {
          $vectorSearch: {
            index,
            path: 'vector',
            queryVector: Array.from(vector),
            numCandidates: ATLAS_NUM_CANDIDATES,
            limit: CANDIDATES_PER_LEG,
            filter: { ...filter, embeddingModel: space.id },
          },
        },
        { $project: { ...projection, score: { $meta: 'vectorSearchScore' } } },
      ])
      .exec();
    return (
      docs
        // Atlas reports cosine similarity rescaled to 0..1 as (1 + cosine) / 2
        .map(({ score, ...doc }) => ({ doc, similarity: score * 2 - 1 }))
        .filter(
          ({ similarity }) =>
            minSimilarity === null || similarity >= minSimilarity,
        )
    );
  }

  private async keywordLeg(
    filter: FilterQuery<KnowledgeChunkDocument>,
    query: string,
  ): Promise<CandidateDoc[]> {
    const words = toTextSearch(query);
    if (!words) {
      return [];
    }
    try {
      return await this.chunkModel
        .find(
          { ...filter, $text: { $search: words } },
          { score: { $meta: 'textScore' } },
        )
        .select(CANDIDATE_FIELDS)
        .sort({ score: { $meta: 'textScore' } })
        .limit(CANDIDATES_PER_LEG)
        .lean<CandidateDoc[]>()
        .exec();
    } catch (error) {
      // e.g. the text index is still being built after an upgrade
      this.logger.warn(`Keyword search unavailable: ${errorMessage(error)}`);
      return [];
    }
  }
}

/**
 * Merge several ranked result lists (e.g. the original and a rewritten query)
 * by reciprocal rank fusion; a passage found by both rises to the top.
 */
export function mergeRankings(
  lists: RetrievedChunk[][],
  limit: number,
): RetrievedChunk[] {
  const merged = new Map<string, RetrievedChunk>();
  for (const list of lists) {
    list.forEach((chunk, i) => {
      const existing = merged.get(chunk.id);
      const score = 1 / (RRF_K + i + 1);
      if (existing) {
        existing.score += score;
        existing.keywordMatch ||= chunk.keywordMatch;
        if (chunk.similarity !== null) {
          existing.similarity = Math.max(
            existing.similarity ?? -1,
            chunk.similarity,
          );
        }
      } else {
        merged.set(chunk.id, { ...chunk, score });
      }
    });
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

function scopeFilter(
  userId: Types.ObjectId,
  scope: RetrievalScope,
): FilterQuery<KnowledgeChunkDocument> {
  const filter: FilterQuery<KnowledgeChunkDocument> = {
    userId,
    sourceType: { $in: scope.sourceTypes },
  };
  if (scope.noteIds?.length) {
    filter.noteId = { $in: scope.noteIds.map((id) => new Types.ObjectId(id)) };
  }
  if (scope.sessionId) {
    filter.sessionId = new Types.ObjectId(scope.sessionId);
  } else if (scope.excludeSessionId) {
    filter.sessionId = { $ne: new Types.ObjectId(scope.excludeSessionId) };
  }
  return filter;
}

/** Plain words for $text: quotes and a leading "-" are its phrase and negation operators. */
export function toTextSearch(query: string): string {
  return query
    .replace(/["\\]/g, ' ')
    .replace(/(^|\s)-+/g, '$1')
    .trim();
}

function toRetrievedChunk(doc: CandidateDoc): RetrievedChunk {
  const chunk: RetrievedChunk = {
    id: String(doc._id),
    noteTitle: doc.noteTitle,
    sourceType: doc.sourceType,
    text: doc.text,
    similarity: null,
    keywordMatch: false,
    score: 0,
  };
  if (doc.noteId) chunk.noteId = String(doc.noteId);
  if (doc.sessionId) chunk.sessionId = String(doc.sessionId);
  if (doc.sourceName) chunk.sourceName = doc.sourceName;
  if (doc.sourcePage) chunk.sourcePage = doc.sourcePage;
  return chunk;
}
