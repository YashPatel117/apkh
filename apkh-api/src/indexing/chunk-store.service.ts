import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChunkSourceType,
  KnowledgeChunk,
  KnowledgeChunkDocument,
} from 'src/common/schema/chunk';
import { sha256 } from 'src/common/utils/content-hash';
import { toStoredVector } from 'src/common/utils/vector';
import type { EmbeddingSpace } from 'src/search-api/embedding-space';
import {
  SearchApiClient,
  SearchApiError,
} from 'src/search-api/search-api.client';
import type { ActiveLlmSettings } from 'src/users/users.service';

/** A passage to store, before hashing and embedding. */
export interface ChunkPiece {
  sourceType: ChunkSourceType;
  text: string;
  sourceName?: string;
  sourcePage?: number;
}

/** What a re-index needs from the chunks it replaces. */
export type StoredChunk = Pick<
  KnowledgeChunk,
  | 'sourceType'
  | 'sourceName'
  | 'sourcePage'
  | 'chunkIndex'
  | 'text'
  | 'textHash'
  | 'embeddingModel'
  | 'vector'
>;

export const STORED_CHUNK_FIELDS =
  'sourceType sourceName sourcePage chunkIndex text textHash embeddingModel vector';

export type ChunkOwner =
  | { userId: Types.ObjectId; noteId: Types.ObjectId }
  | { userId: Types.ObjectId; sessionId: Types.ObjectId };

@Injectable()
export class ChunkStoreService {
  constructor(
    @InjectModel(KnowledgeChunk.name)
    private readonly chunkModel: Model<KnowledgeChunkDocument>,
    private readonly searchApi: SearchApiClient,
  ) {}

  /** Current chunks of a note or chat, in order. */
  findExisting(owner: ChunkOwner): Promise<StoredChunk[]> {
    return this.chunkModel
      .find(ownerFilter(owner))
      .select(STORED_CHUNK_FIELDS)
      .sort({ chunkIndex: 1 })
      .lean<StoredChunk[]>()
      .exec();
  }

  /**
   * Replace a note's or chat's chunks with `pieces`. A piece whose text is
   * unchanged keeps its stored vector; only new text is sent to the provider.
   * New chunks are written before old ones are removed, so search never sees
   * the target without chunks. Returns chunkCount null if the target was
   * deleted meanwhile (its chunks are then removed too).
   */
  async replace(params: {
    token: string;
    llm: ActiveLlmSettings;
    space: EmbeddingSpace | null;
    owner: ChunkOwner;
    title: string;
    pieces: ChunkPiece[];
    existing: StoredChunk[];
    stillExists: () => Promise<boolean>;
  }): Promise<{
    chunkCount: number | null;
    embedded: number;
    tokensUsed: number;
    /** The key has no credit for embeddings: new passages are keyword-only */
    needsCredit: boolean;
  }> {
    const { token, llm, space, owner, title, pieces, existing } = params;
    const hashes = pieces.map((piece) => sha256(piece.text));

    const vectors = new Map<string, unknown>();
    let embedded = 0;
    let tokensUsed = 0;
    let needsCredit = false;
    if (space) {
      for (const chunk of existing) {
        if (
          chunk.embeddingModel === space.id &&
          chunk.vector &&
          chunk.textHash
        ) {
          vectors.set(chunk.textHash, chunk.vector);
        }
      }
      const missing = new Map<string, string>();
      pieces.forEach((piece, i) => {
        if (!vectors.has(hashes[i])) {
          missing.set(hashes[i], piece.text);
        }
      });
      if (missing.size) {
        try {
          const result = await this.searchApi.embed(token, llm, space, [
            ...missing.values(),
          ]);
          [...missing.keys()].forEach((hash, i) =>
            vectors.set(hash, toStoredVector(result.vectors[i])),
          );
          embedded = missing.size;
          tokensUsed = result.tokensUsed;
        } catch (error) {
          // A key without credit for (paid) embeddings still gets keyword
          // search; the next edit or a rebuild embeds what is missing.
          if (!(error instanceof SearchApiError && error.needsCredit)) {
            throw error;
          }
          needsCredit = true;
        }
      }
    }

    if (!(await params.stillExists())) {
      await this.deleteFor(owner);
      return { chunkCount: null, embedded, tokensUsed, needsCredit };
    }

    const docs = pieces.map((piece, i) => {
      const vector = space ? vectors.get(hashes[i]) : undefined;
      return withoutUndefined({
        _id: new Types.ObjectId(),
        ...owner,
        sourceType: piece.sourceType,
        noteTitle: title,
        chunkIndex: i,
        text: piece.text,
        textHash: hashes[i],
        sourceName: piece.sourceName,
        sourcePage: piece.sourcePage,
        // Only chunks with a vector belong to the space
        embeddingModel: vector ? space?.id : undefined,
        vector,
      });
    });

    if (docs.length) {
      await this.chunkModel.insertMany(docs);
    }
    await this.chunkModel.deleteMany({
      ...ownerFilter(owner),
      _id: { $nin: docs.map((doc) => doc._id) },
    });

    if (!(await params.stillExists())) {
      await this.deleteFor(owner);
      return { chunkCount: null, embedded, tokensUsed, needsCredit };
    }
    return { chunkCount: docs.length, embedded, tokensUsed, needsCredit };
  }

  async deleteFor(
    owner:
      | ChunkOwner
      | { noteId: Types.ObjectId }
      | { sessionId: Types.ObjectId },
  ) {
    await this.chunkModel.deleteMany(ownerFilter(owner));
  }

  /** Keep result titles in sync without re-indexing (e.g. a renamed chat). */
  async retitle(
    owner: { sessionId: Types.ObjectId } | { noteId: Types.ObjectId },
    title: string,
  ) {
    await this.chunkModel.updateMany(ownerFilter(owner), {
      $set: { noteTitle: title },
    });
  }
}

function ownerFilter(
  owner: { noteId: Types.ObjectId } | { sessionId: Types.ObjectId },
) {
  return 'noteId' in owner
    ? { noteId: owner.noteId }
    : { sessionId: owner.sessionId };
}

function withoutUndefined<T extends Record<string, unknown>>(doc: T): T {
  for (const key of Object.keys(doc)) {
    if (doc[key] === undefined) {
      delete doc[key];
    }
  }
  return doc;
}
