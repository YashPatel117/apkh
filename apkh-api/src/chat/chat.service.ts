import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateSessionDto } from './dto/create-session.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ChatSession, ChatSessionDocument } from 'src/common/schema/chat-session';
import { ChatMessage, ChatMessageDocument } from 'src/common/schema/chat-message';
import { KnowledgeChunk, KnowledgeChunkDocument } from 'src/common/schema/chunk';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { UsersService } from 'src/users/users.service';
import { SearchService } from 'src/search/search.service';

const SEARCH_API = 'http://localhost:8000';

interface ChatRagResponse {
  answer: string;
  tokens_used: number;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectModel(ChatSession.name) private sessionModel: Model<ChatSessionDocument>,
    @InjectModel(ChatMessage.name) private messageModel: Model<ChatMessageDocument>,
    @InjectModel(KnowledgeChunk.name) private chunkModel: Model<KnowledgeChunkDocument>,
    private readonly httpService: HttpService,
    private readonly usersService: UsersService,
    private readonly searchService: SearchService,
  ) { }

  /** CREATE SESSION */
  async createSession(userId: string, createSessionDto: CreateSessionDto) {
    try {
      const words = createSessionDto.firstMessage.split(' ').filter(w => w.trim());
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
    } catch (error: any) {
      this.logger.error(`Failed to create session: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
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

      const sessionIds = sessions.map(s => s._id);
      
      const messageCounts = await this.messageModel.aggregate([
        { $match: { sessionId: { $in: sessionIds } } },
        { $group: { _id: "$sessionId", count: { $sum: 1 } } }
      ]).exec();

      const MapMessageCount = new Map(messageCounts.map(m => [m._id.toString(), m.count]));

      return sessions.map(s => ({
        id: (s._id as Types.ObjectId).toHexString(),
        title: s.title,
        updatedAt: (s as any).updatedAt,
        messageCount: MapMessageCount.get((s._id as Types.ObjectId).toHexString()) || 0,
      }));
    } catch (error: any) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  /** GET SESSION MESSAGES */
  async getSessionMessages(userId: string, sessionId: string) {
    try {
      const session = await this.sessionModel.findOne({
        _id: new Types.ObjectId(sessionId),
        userId: new Types.ObjectId(userId),
      }).exec();

      if (!session) {
        throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
      }

      const messages = await this.messageModel
        .find({ sessionId: session._id })
        .sort({ createdAt: 1 })
        .lean()
        .exec();

      return messages.map(m => ({
        id: (m._id as Types.ObjectId).toHexString(),
        sessionId: (session._id as Types.ObjectId).toHexString(),
        role: m.role,
        content: m.content,
        createdAt: (m as any).createdAt,
      }));
    } catch (error: any) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
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
    } catch (error: any) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  /** SEND MESSAGE (RAG) */
  async sendMessage(token: string, userId: string, sessionId: string, sendMessageDto: SendMessageDto) {
    try {
      const activeLlm = await this.usersService.getActiveLlmSettings(userId);
      if (!activeLlm) {
        throw new HttpException('No active AI config found in Profile', HttpStatus.BAD_REQUEST);
      }

      const session = await this.sessionModel.findOne({
        _id: new Types.ObjectId(sessionId),
        userId: new Types.ObjectId(userId),
      }).exec();

      if (!session) {
        throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
      }

      // Save user message
      const userMessage = new this.messageModel({
        sessionId: session._id,
        role: 'user',
        content: sendMessageDto.message,
      });
      await userMessage.save();

      // Retrieve all history for the session (to pass to LLM)
      const allMessages = await this.messageModel
        .find({ sessionId: session._id })
        .sort({ createdAt: 1 })
        .lean()
        .exec();

      const chatHistory = allMessages.map(m => ({
        role: m.role,
        content: m.content
      }));
      
      // Limit to last 10 messages for prompt history to avoid massive context
      const recentChatHistory = chatHistory.slice(-10);

      // Context Assembly
      const chunkFilter: any = { userId: new Types.ObjectId(userId) };

      if (activeLlm.provider === 'gemini') {
        chunkFilter.$or = [
          { embeddingProvider: 'gemini' },
          { embeddingProvider: { $exists: false } }, // backwards compat
        ];
      } else {
        chunkFilter.embeddingProvider = activeLlm.provider;
      }

      const userChunks = await this.chunkModel.find(chunkFilter).lean();

      let currentChatChunks: string[] = [];
      let notesChunks: string[] = [];
      let similarChatChunks: string[] = [];
      
      // For similar chat chunks retrieval
      let queryVector: number[] = [];
      try {
        const embedRes$ = this.httpService.post<{ embedding: number[] }>(
          `${SEARCH_API}/ai-search/embed-query`,
          {
            query: sendMessageDto.message, // Embed the latest message
            api_key: activeLlm.apiKey,
            model: activeLlm.model,
          },
          { headers: { Authorization: token } },
        );
        const embedRes = await firstValueFrom(embedRes$);
        queryVector = embedRes.data.embedding;
      } catch (error: any) {
        this.logger.error(`Embed query failed: ${error.message}`);
        throw new HttpException('Failed to generate embedding for search query', HttpStatus.BAD_GATEWAY);
      }

      const scoredOtherChatChunks: { text: string; score: number }[] = [];

      for (const chunk of userChunks) {
        if (chunk.sourceType === 'chat' && chunk.sourceId === sessionId) {
          // Priority 1
          currentChatChunks.push(chunk.text);
        } else if (chunk.sourceType === 'note' || chunk.sourceType === 'file') {
          // Priority 2
          let source = `Note "${chunk.noteTitle}"`;
          if (chunk.sourceType === 'file' && chunk.sourceName) {
            source += ` | File: ${chunk.sourceName}`;
            if (chunk.sourcePage) {
               source += ` | Page ${chunk.sourcePage}`;
            }
          }
          notesChunks.push(`[SOURCE: ${source}]\n${chunk.text}`);
        } else if (chunk.sourceType === 'chat' && chunk.sourceId !== sessionId) {
          // Priority 3 (prepare for ranking)
          scoredOtherChatChunks.push({
            text: `[RELATED CHAT: ${chunk.noteTitle}]\n${chunk.text}`,
            score: this.cosineSimilarity(queryVector, chunk.embedding),
          });
        }
      }

      // Rank Priority 3
      scoredOtherChatChunks.sort((a, b) => b.score - a.score);
      similarChatChunks = scoredOtherChatChunks
        .filter(c => c.score >= 0.5) // similarity threshold
        .slice(0, 5) // top 5
        .map(c => c.text);


      let aiResponseText = '';
      let tokensUsed = 0;

      try {
        const ragRes$ = this.httpService.post<ChatRagResponse>(
          `${SEARCH_API}/ai-search/chat-rag`,
          {
            query: sendMessageDto.message,
            chat_history: recentChatHistory,
            current_chat_chunks: currentChatChunks,
            notes_chunks: notesChunks,
            similar_chat_chunks: similarChatChunks,
            api_key: activeLlm.apiKey,
            model: activeLlm.model,
          },
          {
            headers: { Authorization: token },
            timeout: 90000,
          },
        );
        const ragRes = await firstValueFrom(ragRes$);
        aiResponseText = ragRes.data.answer;
        tokensUsed = ragRes.data.tokens_used ?? 0;
      } catch (error: any) {
        this.logger.error(`Chat RAG API failed: ${error.message}`);
        // Handle gracefully
        aiResponseText = "Sorry, I ran into an error while attempting to generate a response.";
      }

      // Save AI Response
      const aiMessage = new this.messageModel({
        sessionId: session._id,
        role: 'assistant',
        content: aiResponseText,
      });
      await aiMessage.save();

      // Update session time
      session.updatedAt = new Date().toISOString();
      await session.save();

      if (tokensUsed > 0) {
        this.usersService.addTokenUsage(userId, tokensUsed).catch((err) => {
          this.logger.error(`Failed to track token usage for user ${userId}: ${err.message}`);
        });
      }

      // Auto chunking check
      // We had chatHistory.length messages. We just added 2 (user+ai).
      const newTotalMessages = chatHistory.length + 2; // Includes the ones we just added
      
      // If we reach 10 messages and it hasn't been chunked, chunk it! Or if we reach 20, 30...
      // Open Question resolved: Re-chunking every 10 messages makes sense to keep state up-to-date.
      if (newTotalMessages > 0 && newTotalMessages % 10 === 0) { 
          // Fire and forget
          this.autoChunkSession(token, userId, sessionId, session.title).catch(err => {
              this.logger.error(`Auto chunk failed for session ${sessionId}: ${err.message}`);
          });
      }

      return {
        answer: aiResponseText,
        tokens_used: tokensUsed,
      };
    } catch (error: any) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  async autoChunkSession(token: string, userId: string, sessionId: string, title: string) {
    this.logger.log(`Auto chunking session ${sessionId}...`);
    
    // Fetch all messages
    const allMessages = await this.messageModel
        .find({ sessionId: new Types.ObjectId(sessionId) })
        .sort({ createdAt: 1 })
        .lean()
        .exec();
        
    let chatText = `Chat Title: ${title}\n\n`;
    for (const msg of allMessages) {
        let prefix = msg.role === 'user' ? 'User: ' : 'Assistant: ';
        chatText += prefix + msg.content + '\n\n';
    }

    const activeLlm = await this.usersService.getActiveLlmSettings(userId);
    if (!activeLlm) return;
    
    // We send this to /ingest in apkh-search
    const res$ = this.httpService.post(
        `${SEARCH_API}/ingest`,
        {
          note_id: sessionId, // Use session ID as note_id
          user_id: userId,
          title: title,
          content: chatText,
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
        sourceType: 'chat'
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
          embeddingModel: activeLlm.model,
          embedding: chunk.embedding,
        }));

        await this.chunkModel.insertMany(chunkDocs);
    }

    // Set isChunked
    await this.sessionModel.updateOne(
        { _id: new Types.ObjectId(sessionId) }, 
        { $set: { isChunked: true } }
    );
  }

  /**
   * Fast cosine similarity between two numeric vectors.
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) {
        return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
