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
import { ActiveLlmSettings, UsersService } from 'src/users/users.service';
import { errorMessage, toHttpException } from 'src/common/utils/http-error';
import {
  CHAT_INDEX_MIN_MESSAGES,
  IndexingService,
} from 'src/indexing/indexing.service';
import { embeddingSpaceFor } from 'src/search-api/embedding-space';
import {
  SearchApiClient,
  SearchApiError,
} from 'src/search-api/search-api.client';
import { RetrievedChunk, RetrievalService } from 'src/search/retrieval.service';
import { ChatSource } from 'src/common/schema/chat-message';
import {
  citedSources,
  contextBlock,
  similarityThresholds,
} from 'src/search/search.service';
import {
  looksLikeFollowUp,
  QueryRewriteService,
} from 'src/search/query-rewrite.service';

interface ChatContext {
  currentChatChunks: string[];
  notesChunks: string[];
  similarChatChunks: string[];
  /** The passages behind notesChunks, in the same order (cited as [n]) */
  noteSources: RetrievedChunk[];
}

/** A source as the web app receives it. */
export interface ChatSourceView {
  noteId?: string;
  noteTitle: string;
  sourceType: string;
  sourceName?: string;
  sourcePage?: number;
  excerpt: string;
  cited: boolean;
}

// Enough of a passage to show it and to find it again in the note.
const SOURCE_EXCERPT_CHARS = 1000;

const NEW_CHAT_TITLE = 'New chat';
const TITLE_WORDS = 6;

// Previous messages sent along with each question.
const CHAT_HISTORY_LIMIT = 10;
// Retrieved context per source; everything else in the library stays out of the prompt.
const NOTE_CONTEXT_LIMIT = 6;
const CURRENT_CHAT_CONTEXT_LIMIT = 3;
const OTHER_CHATS_CONTEXT_LIMIT = 3;

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
    private readonly usersService: UsersService,
    private readonly searchApi: SearchApiClient,
    private readonly retrieval: RetrievalService,
    private readonly indexing: IndexingService,
    private readonly queryRewrite: QueryRewriteService,
  ) {}

  /**
   * CREATE SESSION: empty ("New chat", titled by its first message), or
   * continuing an AI search answer (its question, answer and sources).
   */
  async createSession(userId: string, createSessionDto: CreateSessionDto) {
    try {
      const { firstMessage, aiResponse } = createSessionDto;
      if (Boolean(firstMessage) !== Boolean(aiResponse)) {
        throw new HttpException(
          'firstMessage and aiResponse go together',
          HttpStatus.BAD_REQUEST,
        );
      }

      const session = new this.sessionModel({
        userId: new Types.ObjectId(userId),
        title: firstMessage ? titleFromMessage(firstMessage) : NEW_CHAT_TITLE,
        isChunked: false,
      });
      await session.save();

      if (firstMessage && aiResponse) {
        const userMessage = new this.messageModel({
          sessionId: session._id,
          role: 'user',
          content: firstMessage,
        });
        const aiMessage = new this.messageModel({
          sessionId: session._id,
          role: 'assistant',
          content: aiResponse,
          sources: createSessionDto.sources?.map((source) =>
            toStoredSource({ ...source, cited: source.cited ?? false }),
          ),
        });
        await Promise.all([userMessage.save(), aiMessage.save()]);
      }

      return {
        id: session._id as string,
        title: session.title,
        updatedAt: session.updatedAt,
        messageCount: firstMessage ? 2 : 0,
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
        sources: m.sources?.map(toSourceView),
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
      await this.indexing.removeChat(sessionId);

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
      const overLimit = await this.usersService.builtinLimitMessage(
        userId,
        activeLlm,
      );
      if (overLimit) {
        throw new HttpException(overLimit, HttpStatus.TOO_MANY_REQUESTS);
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
        chatHistory,
        activeLlm,
      );

      let answer: string;
      let tokensUsed: number;
      try {
        const result = await this.searchApi.chatRag(token, activeLlm, {
          query: sendMessageDto.message,
          chatHistory,
          ...context,
        });
        // Nothing is saved for a failed answer, so the question can simply be
        // asked again instead of leaving an unanswered message in the history.
        if (result.error || !result.text.trim()) {
          throw new HttpException(
            result.text.trim() ||
              'The assistant returned an empty answer. Please try again.',
            HttpStatus.BAD_GATEWAY,
          );
        }
        answer = result.text;
        tokensUsed = result.tokensUsed;
      } catch (error: unknown) {
        if (error instanceof HttpException) throw error;
        this.logger.error(`Chat RAG API failed: ${errorMessage(error)}`);
        throw new HttpException(
          'Sorry, the assistant could not answer right now. Please try again.',
          HttpStatus.BAD_GATEWAY,
        );
      }

      const userMessage = new this.messageModel({
        sessionId: session._id,
        role: 'user',
        content: sendMessageDto.message,
      });
      await userMessage.save();
      const cited = citedSources(answer, context.noteSources.length);
      const sources = context.noteSources.map((chunk, i) =>
        toStoredSource({
          noteId: chunk.noteId,
          noteTitle: chunk.noteTitle,
          sourceType: chunk.sourceType,
          sourceName: chunk.sourceName,
          sourcePage: chunk.sourcePage,
          excerpt: chunk.text,
          cited: cited.has(i + 1),
        }),
      );
      const aiMessage = new this.messageModel({
        sessionId: session._id,
        role: 'assistant',
        content: answer,
        sources,
      });
      await aiMessage.save();

      // A new chat is named after its first question.
      if (session.title === NEW_CHAT_TITLE && !chatHistory.length) {
        session.title = titleFromMessage(sendMessageDto.message);
      }
      // Update session time — assigning marks the doc modified so save() persists and bumps the timestamp
      session.updatedAt = new Date();
      await session.save();

      this.usersService
        .addTokenUsage(userId, tokensUsed, activeLlm, { interactive: true })
        .catch((err) => {
          this.logger.error(
            `Failed to track token usage for user ${userId}: ${errorMessage(err)}`,
          );
        });

      // Index the transcript for "related past chats" once enough new messages
      // accumulate. Counting what is stored keeps this right after failed requests.
      const totalMessages = await this.messageModel.countDocuments({
        sessionId: session._id,
      });
      if (
        totalMessages - (session.chunkedMessageCount ?? 0) >=
        CHAT_INDEX_MIN_MESSAGES
      ) {
        this.indexing.enqueueChat(userId, sessionId).catch((err) => {
          this.logger.error(
            `Queueing chat ${sessionId} for indexing failed: ${errorMessage(err)}`,
          );
        });
      }

      return {
        answer,
        tokens_used: tokensUsed,
        sources: sources.map(toSourceView),
        title: session.title,
      };
    } catch (error: unknown) {
      throw toHttpException(error);
    }
  }

  /**
   * The most relevant context for a message: passages of the user's notes and
   * files, of this conversation, and of other conversations — each found by
   * hybrid (meaning + keyword) search and capped, so the prompt stays small
   * however large the library. Without a query embedding (Claude, or the
   * embedding call failed) the keyword half does the work alone.
   */
  private async buildContext(
    token: string,
    userId: string,
    sessionId: string,
    message: string,
    chatHistory: { role: string; content: string }[],
    activeLlm: ActiveLlmSettings,
  ): Promise<ChatContext> {
    // "And the budget for it?" retrieves nothing useful on its own: search for
    // a standalone version of a follow-up question instead.
    const rewritten =
      chatHistory.length && looksLikeFollowUp(message)
        ? await this.queryRewrite.rewrite(
            token,
            activeLlm,
            userId,
            message,
            chatHistory,
          )
        : null;
    const embedText = rewritten?.query ?? message;
    const searchText = rewritten?.searchText ?? message;

    const space = embeddingSpaceFor(activeLlm.provider);
    let vector: Float32Array | null = null;
    if (space) {
      try {
        vector = await this.searchApi.embedQuery(
          token,
          activeLlm,
          space,
          embedText,
        );
      } catch (error: unknown) {
        const reason =
          error instanceof SearchApiError ? error.message : errorMessage(error);
        this.logger.warn(
          `Embedding the chat message failed, using keyword search: ${reason}`,
        );
      }
    }

    const { min } = similarityThresholds(activeLlm.provider);
    const [notes, currentChat, otherChats] = await Promise.all([
      this.retrieval.retrieve(userId, searchText, {
        scope: { sourceTypes: ['note', 'file'] },
        limit: NOTE_CONTEXT_LIMIT,
        vector,
        space,
        minSimilarity: min,
      }),
      // Already-indexed parts of this conversation are relevant by definition.
      this.retrieval.retrieve(userId, searchText, {
        scope: { sourceTypes: ['chat'], sessionId },
        limit: CURRENT_CHAT_CONTEXT_LIMIT,
        vector,
        space,
        minSimilarity: null,
      }),
      this.retrieval.retrieve(userId, searchText, {
        scope: { sourceTypes: ['chat'], excludeSessionId: sessionId },
        limit: OTHER_CHATS_CONTEXT_LIMIT,
        vector,
        space,
        minSimilarity: min,
      }),
    ]);

    return {
      noteSources: notes,
      currentChatChunks: currentChat.map((chunk) => chunk.text),
      notesChunks: notes.map(contextBlock),
      similarChatChunks: otherChats.map(
        (chunk) => `[RELATED CHAT: ${chunk.noteTitle}]\n${chunk.text}`,
      ),
    };
  }
}

function toStoredSource(source: {
  noteId?: string;
  noteTitle: string;
  sourceType: string;
  sourceName?: string;
  sourcePage?: number;
  excerpt: string;
  cited: boolean;
}): ChatSource {
  const stored: ChatSource = {
    noteTitle: source.noteTitle,
    sourceType: source.sourceType,
    excerpt: source.excerpt.slice(0, SOURCE_EXCERPT_CHARS),
    cited: source.cited,
  };
  if (source.noteId) stored.noteId = new Types.ObjectId(source.noteId);
  if (source.sourceName) stored.sourceName = source.sourceName;
  if (source.sourcePage) stored.sourcePage = source.sourcePage;
  return stored;
}

function toSourceView(source: ChatSource): ChatSourceView {
  return {
    noteId: source.noteId?.toString(),
    noteTitle: source.noteTitle,
    sourceType: source.sourceType,
    sourceName: source.sourceName,
    sourcePage: source.sourcePage,
    excerpt: source.excerpt,
    cited: source.cited,
  };
}

/** A chat title from its first question: the first few words. */
function titleFromMessage(message: string): string {
  const words = message.split(/\s+/).filter(Boolean);
  const title = words.slice(0, TITLE_WORDS).join(' ');
  return words.length > TITLE_WORDS ? `${title}...` : title || NEW_CHAT_TITLE;
}
