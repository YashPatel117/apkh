import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { AnyBulkWriteOperation, Connection, Model, Types } from 'mongoose';
import {
  ChatMessage,
  ChatMessageDocument,
} from 'src/common/schema/chat-message';
import {
  ChatSession,
  ChatSessionDocument,
} from 'src/common/schema/chat-session';
import {
  KnowledgeChunk,
  KnowledgeChunkDocument,
} from 'src/common/schema/chunk';
import { NoteFiles, NoteFileDocument } from 'src/common/schema/file';
import { Note, NoteDocument } from 'src/common/schema/note';
import { Summary, SummaryDocument } from 'src/common/schema/summary';
import { sha256 } from 'src/common/utils/content-hash';
import { htmlToPlainText } from 'src/common/utils/html';
import { toStoredVector } from 'src/common/utils/vector';
import { embeddingSpaceFor } from 'src/search-api/embedding-space';

interface Migration {
  name: string;
  up: () => Promise<Record<string, number>>;
}

interface MigrationRecord {
  _id: string;
  appliedAt: Date;
  result: Record<string, number>;
}

const BATCH_SIZE = 500;

/**
 * One-off data migrations, run in order at startup before the API serves
 * requests. Each runs once (recorded in the `migrations` collection) and is
 * safe to re-run if interrupted. Set RUN_MIGRATIONS=off to skip them.
 */
@Injectable()
export class MigrationsService implements OnModuleInit {
  private readonly logger = new Logger(MigrationsService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    @InjectModel(KnowledgeChunk.name)
    private readonly chunkModel: Model<KnowledgeChunkDocument>,
    @InjectModel(Summary.name)
    private readonly summaryModel: Model<SummaryDocument>,
    @InjectModel(ChatSession.name)
    private readonly sessionModel: Model<ChatSessionDocument>,
    @InjectModel(ChatMessage.name)
    private readonly messageModel: Model<ChatMessageDocument>,
    @InjectModel(NoteFiles.name)
    private readonly noteFilesModel: Model<NoteFileDocument>,
  ) {}

  async onModuleInit() {
    if (process.env.RUN_MIGRATIONS === 'off') {
      return;
    }
    await this.runPending();
  }

  async runPending() {
    const records = this.connection.collection<MigrationRecord>('migrations');
    for (const migration of this.migrations()) {
      if (await records.findOne({ _id: migration.name })) {
        continue;
      }
      this.logger.log(`Running migration ${migration.name}...`);
      const started = Date.now();
      const result = await migration.up();
      await records.insertOne({
        _id: migration.name,
        appliedAt: new Date(),
        result,
      });
      this.logger.log(
        `Migration ${migration.name} done in ${Date.now() - started} ms: ${JSON.stringify(result)}`,
      );
    }
  }

  private migrations(): Migration[] {
    return [
      {
        name: '2026-09-30-object-id-refs',
        up: () => this.convertIdStrings(),
      },
      { name: '2026-09-30-chunks-v2', up: () => this.upgradeChunks() },
      {
        name: '2026-09-30-note-plain-text',
        up: () => this.recomputeNotePlainText(),
      },
      { name: '2026-09-30-summary-modes', up: () => this.addSummaryModes() },
    ];
  }

  /**
   * Id references were declared with the BSON ObjectId class, which Mongoose
   * treats as untyped: notes saved by the API hold `userId` as a string.
   * The schemas now use real ObjectId paths (which cast query values), so
   * stored strings must become ObjectIds or those notes would stop matching.
   */
  private async convertIdStrings() {
    const fields: [Model<any>, string][] = [
      [this.noteModel, 'userId'],
      [this.chunkModel, 'userId'],
      [this.chunkModel, 'noteId'],
      [this.summaryModel, 'userId'],
      [this.summaryModel, 'noteId'],
      [this.sessionModel, 'userId'],
      [this.messageModel, 'sessionId'],
      [this.noteFilesModel, 'noteId'],
    ];
    const result: Record<string, number> = {};
    for (const [model, field] of fields) {
      const { modifiedCount } = await model.collection.updateMany(
        { [field]: { $type: 'string' } },
        [
          {
            $set: {
              // a value that isn't a valid id is left as it was
              [field]: {
                $convert: {
                  input: `$${field}`,
                  to: 'objectId',
                  onError: `$${field}`,
                },
              },
            },
          },
        ],
      );
      result[`${model.collection.collectionName}.${field}`] = modifiedCount;
    }
    return result;
  }

  /**
   * Chunks v2: every chunk gets a text hash (unchanged text reuses its vector);
   * vectors move to compact float32 binaries labelled with their embedding
   * space. Legacy OpenAI vectors are already in today's OpenAI space and are
   * converted. Legacy Gemini vectors (3072 dimensions, or 768 from the old
   * fallback model) can't be compared with the new 1536-dimension space, so
   * they are dropped; the index queue re-embeds those notes from the stored
   * text without re-reading attachments. Old chat-transcript chunks (keyed by
   * noteId) are removed and rebuilt by the queue.
   */
  private async upgradeChunks() {
    const chunks = this.chunkModel.collection;
    const openaiSpace = embeddingSpaceFor('openai')!;

    const chats = await chunks.deleteMany({ sourceType: 'chat' });
    await this.sessionModel.collection.updateMany(
      {},
      { $set: { isChunked: false, chunkedMessageCount: 0 } },
    );

    let converted = 0;
    let dropped = 0;
    let hashed = 0;
    let batch: AnyBulkWriteOperation[] = [];
    const cursor = chunks.find(
      { textHash: { $exists: false } },
      { projection: { text: 1, embedding: 1, embeddingProvider: 1 } },
    );
    for await (const doc of cursor) {
      const set: Record<string, unknown> = {
        textHash: sha256(typeof doc.text === 'string' ? doc.text : ''),
      };
      const unset: Record<string, ''> = {
        embedding: '',
        embeddingProvider: '',
        sourceId: '',
      };
      const legacy = Array.isArray(doc.embedding)
        ? (doc.embedding as number[])
        : null;
      if (
        legacy &&
        doc.embeddingProvider === 'openai' &&
        legacy.length === openaiSpace.dimensions
      ) {
        set.vector = toStoredVector(normalize(legacy));
        set.embeddingModel = openaiSpace.id;
        converted++;
      } else {
        unset.embeddingModel = '';
        if (legacy) dropped++;
      }
      hashed++;
      batch.push({
        updateOne: {
          filter: { _id: doc._id as Types.ObjectId },
          update: { $set: set, $unset: unset },
        },
      });
      if (batch.length >= BATCH_SIZE) {
        await chunks.bulkWrite(batch as never, { ordered: false });
        batch = [];
      }
    }
    if (batch.length) {
      await chunks.bulkWrite(batch as never, { ordered: false });
    }

    // Index over the removed sourceId field
    await chunks
      .dropIndex('userId_1_sourceType_1_sourceId_1')
      .catch(() => undefined);

    return {
      chatChunksRemoved: chats.deletedCount,
      hashed,
      vectorsConverted: converted,
      vectorsDropped: dropped,
    };
  }

  /**
   * Summaries are cached per mode now (brief, actions): existing ones are
   * brief, and the unique index moves from (noteId, userId) to (noteId,
   * userId, mode), since the old one would reject a second mode for a note.
   */
  private async addSummaryModes() {
    const summaries = this.summaryModel.collection;
    const { modifiedCount } = await summaries.updateMany(
      { mode: { $exists: false } },
      { $set: { mode: 'brief' } },
    );
    const indexDropped = await summaries
      .dropIndex('noteId_1_userId_1')
      .then(() => 1)
      .catch(() => 0);
    return { summariesUpdated: modifiedCount, indexDropped };
  }

  /** contentPlain used to glue paragraphs together ("<p>a</p><p>b</p>" → "ab"). */
  private async recomputeNotePlainText() {
    const notes = this.noteModel.collection;
    let updated = 0;
    let batch: AnyBulkWriteOperation[] = [];
    for await (const note of notes.find({}, { projection: { content: 1 } })) {
      batch.push({
        updateOne: {
          filter: { _id: note._id as Types.ObjectId },
          update: {
            $set: {
              contentPlain: htmlToPlainText(
                typeof note.content === 'string' ? note.content : '',
              ),
            },
          },
        },
      });
      updated++;
      if (batch.length >= BATCH_SIZE) {
        await notes.bulkWrite(batch as never, { ordered: false });
        batch = [];
      }
    }
    if (batch.length) {
      await notes.bulkWrite(batch as never, { ordered: false });
    }
    return { notesUpdated: updated };
  }
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return norm ? vector.map((v) => v / norm) : vector;
}
