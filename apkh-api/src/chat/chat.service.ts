import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateSessionDto } from './dto/create-session.dto';
import { SendMessageDto } from './dto/send-message.dto';
import {
  ChatSession,
  ChatSessionDocument,
} from 'src/common/schema/chat-session';
import {
  ChatMessage,
  ChatMessageDocument,
} from 'src/common/schema/chat-message';
import {
  KnowledgeChunk,
  KnowledgeChunkDocument,
} from 'src/common/schema/chunk';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ActiveLlmSettings, UsersService } from 'src/users/users.service';
import { SearchService } from 'src/search/search.service';

import { SEARCH_API } from 'src/common/constant/endpoint';
import { cosineSimilarity } from 'src/common/utils/vector';
import { errorMessage, toHttpException } from 'src/common/utils/http-error';

interface ChatRagResponse {
  answer: string;
  error?: boolean;
  tokens_used: number;
}

interface ChatIngestResponse {
  chunks: { chunk_index: number; text: string; embedding: number[] }[];
  embedding_model?: string | null;
}

interface ChatContext {
  currentChatChunks: string[];
  notesChunks: string[];
  similarChatChunks: string[];
}

// Previous messages sent along with each question.
const CHAT_HISTORY_LIMIT = 10;
// Retrieved context per source; everything else in the library stays out of the prompt.
const NOTE_CONTEXT_LIMIT = 6;
const CURRENT_CHAT_CONTEXT_LIMIT = 3;
const OTHER_CHATS_CONTEXT_LIMIT = 3;
const KEYWORD_NOTE_LIMIT = 4;
// The transcript is (re)chunked for search every time this many new messages accumulate.
const CHUNK_EVERY_MESSAGES = 10;

// Messages saved in the same millisecond keep their insertion order via _id.
const MESSAGE_ORDER = { createdAt: 1, _id: 1 } as const;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectModel(ChatSession.name)
    private sessionModel: Model<ChatSessionDocument>,
    @InjectModel(ChatMessage.name)
    private messageModel: Model<ChatMessageDocument>,
    @InjectModel(KnowledgeChunk.name)
    private chunkModel: Model<KnowledgeChunkDocument>,
    private readonly httpService: HttpService,
    private readonly usersService: UsersService,
    private readonly searchService: SearchService,
  ) {}

  /** CREATE SESSION */
  async createSession(userId: string, createSessionDto: CreateSessionDto) {
    try {
      const words = createSessionDto.firstMessage
        .split(' ')
        .filter((w) => w.trim());
      const rawTitle = words.slice(0, 6).join(' ');
      const title = words.length > 6 ? `${rawTitle}...` : rawTitle;

      const session = new this.sessionModel({
        userId: new Types.ObjectId(userId),
        title,
        isChunked: false,
      });
      await session.save();

      const userMessage = new this.messageModel({
        sessionId: session._id,
        role: 'user',
        content: createSessionDto.firstMessage,
      });
      const aiMessage = new this.messageModel({
        sessionId: session._id,
        role: 'assistant',
        content: createSessionDto.aiResponse,
      });

      await Promise.all([userMessage.save(), aiMessage.save()]);

      return {
        id: session._id as string,
        title: session.title,
        updatedAt: session.updatedAt,
        messageCount: 2,
      };
    } catch (error: unknown) {
      this.logger.error(`Failed to create session: ${errorMessage(error)}`);
      throw toHttpException(error);
    }
  }

  /** LIST SESSIONS */
  async listSessions(userId: string) {
    try {
      const sessions = await this.sessionModel
        .find({ userId: new Types.ObjectId(userId) })
        .sort({ updatedAt: -1 })
        .lean()
        .exec();

      const sessionIds = sessions.map((s) => s._id);

      const messageCounts = await this.messageModel
        .aggregate<{
          _id: Types.ObjectId;
          count: number;
        }>([
          { $match: { sessionId: { $in: sessionIds } } },
          { $group: { _id: '$sessionId', count: { $sum: 1 } } },
        ])
        .exec();

      const MapMessageCount = new Map(
        messageCounts.map((m) => [m._id.toString(), m.count]),
      );

      return sessions.map((s) => ({
        id: (s._id as Types.ObjectId).toHexString(),
        title: s.title,
        updatedAt: s.updatedAt,
        messageCount:
          MapMessageCount.get((s._id as Types.ObjectId).toHexString()) || 0,
      }));
    } catch (error: unknown) {
      throw toHttpException(error);
    }
  }

  /** GET SESSION MESSAGES */
  async getSessionMessages(userId: string, sessionId: string) {
    try {
      const session = await this.sessionModel
        .findOne({
          _id: new Types.ObjectId(sessionId),
          userId: new Types.ObjectId(userId),
        })
        .exec();

      if (!session) {
        throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
      }

      const messages = await this.messageModel
        .find({ sessionId: session._id })
        .sort(MESSAGE_ORDER)
        .lean()
        .exec();

      return messages.map((m) => ({
        id: (m._id as Types.ObjectId).toHexString(),
        sessionId: (session._id as Types.ObjectId).toHexString(),
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      }));
    } catch (error: unknown) {
      throw toHttpException(error);
    }
  }

  /** DELETE SESSION */
  async deleteSession(userId: string, sessionId: string) {
    try {
      const session = await this.sessionModel.findOneAndDelete({
        _id: new Types.ObjectId(sessionId),
        userId: new Types.ObjectId(userId),
      });

      if (!session) {
        throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
      }

      await this.messageModel.deleteMany({ sessionId: session._id });
      await this.chunkModel.deleteMany({
        sourceType: 'chat',
        sourceId: sessionId,
      });

      return { success: true };
    } catch (error: unknown) {
      throw toHttpException(error);
    }
  }

  /** SEND MESSAGE (RAG) */
  async sendMessage(
    token: string,
    userId: string,
    sessionId: string,
    sendMessageDto: SendMessageDto,
  ) {
    try {
      const activeLlm = await this.usersService.getActiveLlmSettings(userId);
      if (!activeLlm) {
        throw new HttpException(
          'No active AI config found in Profile',
          HttpStatus.BAD_REQUEST,
        );
      }

      const session = await this.sessionModel
        .findOne({
          _id: new Types.ObjectId(sessionId),
          userId: new Types.ObjectId(userId),
        })
        .exec();

      if (!session) {
        throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
      }

      const recentMessages = await this.messageModel
        .find({ sessionId: session._id })
        .sort({ createdAt: -1, _id: -1 })
        .limit(CHAT_HISTORY_LIMIT)
        .lean()
        .exec();
      const chatHistory = recentMessages.reverse().map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const context = await this.buildContext(
        token,
        userId,
        sessionId,
        sendMessageDto.message,
        activeLlm,
      );

      let ragData: ChatRagResponse;
      try {
        const ragRes$ = this.httpService.post<ChatRagResponse>(
          `${SEARCH_API}/ai-search/chat-rag`,
          {
            query: sendMessageDto.message,
            chat_history: chatHistory,
            current_chat_chunks: context.currentChatChunks,
            notes_chunks: context.notesChunks,
            similar_chat_chunks: context.similarChatChunks,
            api_key: activeLlm.apiKey,
            model: activeLlm.model,
          },
          {
            headers: { Authorization: token },
            timeout: 90000,
          },
        );
        ragData = (await firstValueFrom(ragRes$)).data;
      } catch (error: unknown) {
        this.logger.error(`Chat RAG API failed: ${errorMessage(error)}`);
        throw new HttpException(
          'Sorry, the assistant could not answer right now. Please try again.',
          HttpStatus.BAD_GATEWAY,
        );
      }

      // Nothing is saved for a failed answer, so the question can simply be
      // asked again instead of leaving an unanswered message in the history.
      if (ragData.error || !ragData.answer?.trim()) {
        throw new HttpException(
          ragData.answer?.trim() ||
            'The assistant returned an empty answer. Please try again.',
          HttpStatus.BAD_GATEWAY,
        );
      }

      const userMessage = new this.messageModel({
        sessionId: session._id,
        role: 'user',
        content: sendMessageDto.message,
      });
      await userMessage.save();
      const aiMessage = new this.messageModel({
        sessionId: session._id,
        role: 'assistant',
        content: ragData.answer,
      });
      await aiMessage.save();

      // Update session time — assigning marks the doc modified so save() persists and bumps the timestamp
      session.updatedAt = new Date();
      await session.save();

      const tokensUsed = ragData.tokens_used ?? 0;
      if (tokensUsed > 0) {
        this.usersService
          .addTokenUsage(userId, tokensUsed)
          .catch((err: unknown) => {
            this.logger.error(
              `Failed to track token usage for user ${userId}: ${errorMessage(err)}`,
            );
          });
      }

      // Re-chunk the transcript for search once enough new messages accumulate.
      // Counting what is stored (rather than inferring it) keeps this correct
      // even after failed requests.
      const totalMessages = await this.messageModel.countDocuments({
        sessionId: session._id,
      });
      if (
        totalMessages - (session.chunkedMessageCount ?? 0) >=
        CHUNK_EVERY_MESSAGES
      ) {
        this.autoChunkSession(token, userId, sessionId, session.title).catch(
          (err: unknown) => {
            this.logger.error(
              `Auto chunk failed for session ${sessionId}: ${errorMessage(err)}`,
            );
          },
        );
      }

      return {
        answer: ragData.answer,
        tokens_used: tokensUsed,
      };
    } catch (error: unknown) {
      throw toHttpException(error);
    }
  }

  /**
   * The most relevant context for a message: chunks of this conversation, of
   * the user's notes/files, and of other conversations — each ranked by
   * similarity and capped, so the prompt stays small however large the library.
   * Without a query embedding (Claude, or the embedding call failed) notes are
   * found by keyword instead.
   */
  private async buildContext(
    token: string,
    userId: string,
    sessionId: string,
    message: string,
    activeLlm: ActiveLlmSettings,
  ): Promise<ChatContext> {
    let queryVector: number[] | null = null;
    if (this.searchService.supportsSemanticSearch(activeLlm.provider)) {
      try {
        queryVector = await this.searchService.embedQuery(
          token,
          activeLlm,
          message,
        );
      } catch (error: unknown) {
        this.logger.warn(
          `Embedding the chat message failed, using keyword search: ${errorMessage(error)}`,
        );
      }
    }

    if (!queryVector?.length) {
      const notes = await this.searchService.findNotesByKeywords(
        userId,
        message,
        KEYWORD_NOTE_LIMIT,
      );
      return {
        currentChatChunks: [],
        notesChunks: notes.map(
          (note) => `[SOURCE: Note "${note.title}"]\n${note.text}`,
        ),
        similarChatChunks: [],
      };
    }

    const { min } = this.searchService.similarityThresholds(activeLlm.provider);
    const chunks = await this.chunkModel
      .find({
        userId: new Types.ObjectId(userId),
        ...this.searchService.embeddingProviderFilter(activeLlm.provider),
      })
      .select(
        'text sourceType sourceId sourceName sourcePage noteTitle embedding',
      )
      .lean()
      .exec();

    const scored = chunks
      .map((chunk) => ({
        chunk,
        score: cosineSimilarity(queryVector, chunk.embedding),
      }))
      .sort((a, b) => b.score - a.score);

    const pick = (
      matches: (chunk: (typeof chunks)[number]) => boolean,
      limit: number,
      minScore: number,
    ) =>
      scored
        .filter(({ chunk, score }) => matches(chunk) && score >= minScore)
        .slice(0, limit)
        .map(({ chunk }) => chunk);

    const isCurrentChat = (chunk: (typeof chunks)[number]) =>
      chunk.sourceType === 'chat' && chunk.sourceId === sessionId;

    return {
      // Already-chunked parts of this conversation are relevant by definition.
      currentChatChunks: pick(isCurrentChat, CURRENT_CHAT_CONTEXT_LIMIT, 0).map(
        (chunk) => chunk.text,
      ),
      notesChunks: pick(
        (chunk) => chunk.sourceType === 'note' || chunk.sourceType === 'file',
        NOTE_CONTEXT_LIMIT,
        min,
      ).map((chunk) => {
        let source = `Note "${chunk.noteTitle}"`;
        if (chunk.sourceType === 'file' && chunk.sourceName) {
          source += ` | File: ${chunk.sourceName}`;
          if (chunk.sourcePage) {
            source += ` | Page ${chunk.sourcePage}`;
          }
        }
        return `[SOURCE: ${source}]\n${chunk.text}`;
      }),
      similarChatChunks: pick(
        (chunk) => chunk.sourceType === 'chat' && !isCurrentChat(chunk),
        OTHER_CHATS_CONTEXT_LIMIT,
        min,
      ).map((chunk) => `[RELATED CHAT: ${chunk.noteTitle}]\n${chunk.text}`),
    };
  }

  async autoChunkSession(
    token: string,
    userId: string,
    sessionId: string,
    title: string,
  ) {
    this.logger.log(`Auto chunking session ${sessionId}...`);

    const activeLlm = await this.usersService.getActiveLlmSettings(userId);
    if (
      !activeLlm ||
      !this.searchService.supportsSemanticSearch(activeLlm.provider)
    )
      return;

    // Fetch all messages
    const allMessages = await this.messageModel
      .find({ sessionId: new Types.ObjectId(sessionId) })
      .sort(MESSAGE_ORDER)
      .lean()
      .exec();

    let chatText = `Chat Title: ${title}\n\n`;
    for (const msg of allMessages) {
      const prefix = msg.role === 'user' ? 'User: ' : 'Assistant: ';
      chatText += prefix + msg.content + '\n\n';
    }

    // We send this to /ingest in apkh-search
    const res$ = this.httpService.post<ChatIngestResponse>(
      `${SEARCH_API}/ingest`,
      {
        note_id: sessionId, // Use session ID as note_id
        user_id: userId,
        title: title,
        // /ingest parses HTML; escape so "<" in messages isn't taken for a tag
        content: escapeHtml(chatText),
        files: [],
        api_key: activeLlm.apiKey,
        model: activeLlm.model,
      },
      {
        headers: { Authorization: token },
        timeout: 120000,
      },
    );

    const response = await firstValueFrom(res$);
    const data = response.data;

    // Delete existing 'chat' chunks for this session ID
    await this.chunkModel.deleteMany({
      noteId: new Types.ObjectId(sessionId), // noteId holds the sessionId in these chunks for backwards API compat
      sourceType: 'chat',
    });

    if (data.chunks && data.chunks.length > 0) {
      const chunkDocs = data.chunks.map((chunk) => ({
        noteId: new Types.ObjectId(sessionId),
        userId: new Types.ObjectId(userId),
        noteTitle: title,
        chunkIndex: chunk.chunk_index,
        text: chunk.text,
        sourceType: 'chat',
        sourceId: sessionId,
        embeddingProvider: activeLlm.provider,
        embeddingModel: data.embedding_model || activeLlm.model,
        embedding: chunk.embedding,
      }));

      await this.chunkModel.insertMany(chunkDocs);
    }

    await this.sessionModel.updateOne(
      { _id: new Types.ObjectId(sessionId) },
      { $set: { isChunked: true, chunkedMessageCount: allMessages.length } },
      { timestamps: false },
    );
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
