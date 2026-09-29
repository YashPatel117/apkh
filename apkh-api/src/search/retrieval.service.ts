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
  ) {
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
