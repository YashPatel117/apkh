import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ChatService } from './chat.service';
import { ChatSession } from 'src/common/schema/chat-session';
import { ChatMessage } from 'src/common/schema/chat-message';
import { UsersService } from 'src/users/users.service';
import { IndexingService } from 'src/indexing/indexing.service';
import { SearchApiClient } from 'src/search-api/search-api.client';
import { RetrievalService } from 'src/search/retrieval.service';

/** A mongoose query stand-in: every builder method chains, exec() resolves `result`. */
function query<T>(result: T) {
  const proxy: object = new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === 'exec' ? () => Promise.resolve(result) : () => proxy,
    },
  );
  return proxy;
}

const chunk = (text: string, extra: Record<string, unknown> = {}) => ({
  id: text,
  noteTitle: 'Plan',
  sourceType: 'note',
  text,
  similarity: 0.8,
  keywordMatch: false,
  score: 1,
  ...extra,
});

type RetrieveOptions = {
  scope: { sessionId?: string; excludeSessionId?: string };
  vector: Float32Array | null;
  space: unknown;
};

describe('ChatService.sendMessage', () => {
  const sessionId = new Types.ObjectId().toHexString();
  const userId = new Types.ObjectId().toHexString();
  let service: ChatService;
  let saved: { role: string; content: string }[];
  let session: {
    _id: Types.ObjectId;
    title: string;
    chunkedMessageCount: number;
    updatedAt?: Date;
    save: jest.Mock;
  };

  class MessageModel {
    static find = jest.fn();
    static countDocuments = jest.fn();
    constructor(private readonly doc: { role: string; content: string }) {}
    save() {
      saved.push(this.doc);
      return Promise.resolve(this);
    }
  }

  const sessionModel = { findOne: jest.fn() };
  const usersService = {
    getActiveLlmSettings: jest.fn(),
    addTokenUsage: jest.fn(),
  };
  const searchApi = { embedQuery: jest.fn(), chatRag: jest.fn() };
  const retrieval = {
    retrieve: jest.fn<Promise<unknown[]>, [string, string, RetrieveOptions]>(),
  };
  const indexing = { enqueueChat: jest.fn(), removeChat: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    saved = [];
    session = {
      _id: new Types.ObjectId(sessionId),
      title: 'Chat',
      chunkedMessageCount: 0,
      save: jest.fn(),
    };

    sessionModel.findOne.mockReturnValue(query(session));
    MessageModel.find.mockReturnValue(query([]));
    MessageModel.countDocuments.mockResolvedValue(4);
    usersService.getActiveLlmSettings.mockResolvedValue({
      provider: 'openai',
      apiKey: 'k',
      model: 'gpt-4o-mini',
      keyName: 'n',
    });
    usersService.addTokenUsage.mockResolvedValue(undefined);
    searchApi.embedQuery.mockResolvedValue(Float32Array.from([1, 0]));
    searchApi.chatRag.mockResolvedValue({
      text: 'The answer',
      error: false,
      tokensUsed: 42,
    });
    retrieval.retrieve.mockResolvedValue([]);
    indexing.enqueueChat.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: getModelToken(ChatSession.name), useValue: sessionModel },
        { provide: getModelToken(ChatMessage.name), useValue: MessageModel },
        { provide: UsersService, useValue: usersService },
        { provide: SearchApiClient, useValue: searchApi },
        { provide: RetrievalService, useValue: retrieval },
        { provide: IndexingService, useValue: indexing },
      ],
    }).compile();

    service = module.get(ChatService);
  });

  const send = (message = 'What did we decide?') =>
    service.sendMessage('Bearer t', userId, sessionId, { message });

  it('saves the question and then the answer', async () => {
    await expect(send()).resolves.toEqual({
      answer: 'The answer',
      tokens_used: 42,
    });
    expect(saved).toEqual([
      expect.objectContaining({ role: 'user', content: 'What did we decide?' }),
      expect.objectContaining({ role: 'assistant', content: 'The answer' }),
    ]);
  });

  it('saves nothing when the model fails, so the question can be retried', async () => {
    searchApi.chatRag.mockResolvedValue({
      text: 'Model unavailable',
      error: true,
      tokensUsed: 0,
    });
    await expect(send()).rejects.toBeInstanceOf(HttpException);
    expect(saved).toEqual([]);
  });

  it('queues the transcript for indexing once 10 new messages have accumulated', async () => {
    MessageModel.countDocuments.mockResolvedValue(9);
    await send();
    expect(indexing.enqueueChat).not.toHaveBeenCalled();

    MessageModel.countDocuments.mockResolvedValue(10);
    await send();
    expect(indexing.enqueueChat).toHaveBeenCalledWith(userId, sessionId);

    session.chunkedMessageCount = 10;
    MessageModel.countDocuments.mockResolvedValue(12);
    await send();
    expect(indexing.enqueueChat).toHaveBeenCalledTimes(1);
  });

  it('builds the prompt from notes, this chat and other chats separately', async () => {
    retrieval.retrieve.mockImplementation((_user, _query, options) => {
      if (options.scope.sessionId) {
        return Promise.resolve([chunk('earlier in this chat')]);
      }
      if (options.scope.excludeSessionId) {
        return Promise.resolve([
          chunk('another chat', { noteTitle: 'Old chat' }),
        ]);
      }
      return Promise.resolve([chunk('from a note')]);
    });

    await send();

    const prompt = (
      searchApi.chatRag.mock.calls as [
        unknown,
        unknown,
        Record<string, string[]>,
      ][]
    )[0][2];
    expect(prompt.notesChunks).toEqual(['[SOURCE: Note "Plan"]\nfrom a note']);
    expect(prompt.currentChatChunks).toEqual(['earlier in this chat']);
    expect(prompt.similarChatChunks).toEqual([
      '[RELATED CHAT: Old chat]\nanother chat',
    ]);
  });

  it('searches by keyword alone when the provider has no embeddings', async () => {
    usersService.getActiveLlmSettings.mockResolvedValue({
      provider: 'anthropic',
      apiKey: 'k',
      model: 'claude-sonnet-4-5',
      keyName: 'n',
    });

    await send('roadmap for chat');

    expect(searchApi.embedQuery).not.toHaveBeenCalled();
    expect(retrieval.retrieve).toHaveBeenCalledTimes(3);
    for (const [, query, options] of retrieval.retrieve.mock.calls) {
      expect(query).toBe('roadmap for chat');
      expect(options).toMatchObject({ vector: null, space: null });
    }
  });

  it('falls back to keyword search when embedding the message fails', async () => {
    searchApi.embedQuery.mockRejectedValue(new Error('rate limited'));
    await expect(send()).resolves.toBeDefined();
    expect(retrieval.retrieve.mock.calls[0][2]).toMatchObject({ vector: null });
  });
});
