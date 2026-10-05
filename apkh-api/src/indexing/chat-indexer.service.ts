import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChatMessage,
  ChatMessageDocument,
} from 'src/common/schema/chat-message';
import {
  ChatSession,
  ChatSessionDocument,
} from 'src/common/schema/chat-session';
import { sha256 } from 'src/common/utils/content-hash';
import { errorMessage } from 'src/common/utils/http-error';
import { embeddingSpaceFor } from 'src/search-api/embedding-space';
import { SearchApiClient } from 'src/search-api/search-api.client';
import { UsersService } from 'src/users/users.service';
import { ChunkStoreService } from './chunk-store.service';
import { IndexOutcome } from './index-outcome';
import type { ClaimedJob } from './index-queue.service';
import { PIPELINE_VERSION } from './note-indexer.service';
import { ServiceTokenService } from './service-token.service';

/**
 * Indexes a chat transcript so later conversations can draw on it. The
 * transcript only grows, so earlier chunks keep their text — and their vectors.
 */
@Injectable()
export class ChatIndexerService {
  private readonly logger = new Logger(ChatIndexerService.name);

  constructor(
    @InjectModel(ChatSession.name)
    private readonly sessionModel: Model<ChatSessionDocument>,
    @InjectModel(ChatMessage.name)
    private readonly messageModel: Model<ChatMessageDocument>,
    private readonly usersService: UsersService,
    private readonly searchApi: SearchApiClient,
    private readonly chunkStore: ChunkStoreService,
    private readonly serviceTokens: ServiceTokenService,
  ) {}

  async index(job: ClaimedJob): Promise<IndexOutcome> {
    const sessionId = job.targetId;
    const session = await this.sessionModel
      .findById(sessionId)
      .select('userId title')
      .lean()
      .exec();
    if (!session) {
      await this.chunkStore.deleteFor({ sessionId });
      return { kind: 'deleted' };
    }

    const userId = session.userId.toHexString();
    const llm = await this.usersService.getActiveLlmSettings(userId);
    if (!llm) {
      return { kind: 'skipped', reason: 'No active AI config.' };
    }
    const space = embeddingSpaceFor(llm.provider);

    const messages = await this.messageModel
      .find({ sessionId })
      .sort({ createdAt: 1, _id: 1 })
      .select('role content')
      .lean()
      .exec();
    const sourceHash = sha256(
      JSON.stringify([
        PIPELINE_VERSION,
        session.title,
        messages.length,
        (messages.at(-1)?._id as Types.ObjectId | undefined)?.toHexString() ??
          null,
        space?.id ?? null,
      ]),
    );
    if (!job.force && job.sourceHash === sourceHash) {
      return { kind: 'unchanged' };
    }

    const transcript = messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');
    const token = this.serviceTokens.forUser(userId);
    const chunks = await this.searchApi.chunk(token, {
      content: `Chat title: ${session.title}\n\n${transcript}`,
      contentFormat: 'text',
      sourceType: 'chat',
    });

    const owner = { userId: session.userId, sessionId };
    const stored = await this.chunkStore.replace({
      token,
      llm,
      space,
      owner,
      title: session.title,
      pieces: chunks.map((c) => ({ sourceType: 'chat', text: c.text })),
      existing: await this.chunkStore.findExisting(owner),
      stillExists: async () =>
        Boolean(await this.sessionModel.exists({ _id: sessionId })),
    });
    if (stored.chunkCount === null) {
      return { kind: 'deleted' };
    }
    this.usersService
      .addTokenUsage(userId, stored.tokensUsed, llm, {
        interactive: false,
        kind: 'index',
      })
      .catch((err) => {
        this.logger.error(
          `Failed to track indexing tokens: ${errorMessage(err)}`,
        );
      });

    await this.sessionModel.updateOne(
      { _id: sessionId },
      { $set: { isChunked: true, chunkedMessageCount: messages.length } },
      { timestamps: false },
    );

    return {
      kind: 'indexed',
      chunkCount: stored.chunkCount,
      embeddingModel: space?.id ?? null,
      sourceHash,
      files: [],
      retryFiles: false,
    };
  }
}
