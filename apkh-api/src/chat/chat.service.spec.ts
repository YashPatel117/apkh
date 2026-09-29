import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { HttpException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { of } from 'rxjs';
import { ChatService } from './chat.service';
import { ChatSession } from 'src/common/schema/chat-session';
import { ChatMessage } from 'src/common/schema/chat-message';
import { KnowledgeChunk } from 'src/common/schema/chunk';
import { UsersService } from 'src/users/users.service';
import { SearchService } from 'src/search/search.service';

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
  let postBodies: { notes_chunks: string[] }[];
  let autoChunk: jest.SpyInstance;
  let ragResponse: { answer: string; error?: boolean; tokens_used: number };

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
  const chunkModel = { find: jest.fn() };
  const usersService = {
    getActiveLlmSettings: jest.fn(),
    addTokenUsage: jest.fn(),
  };
  const searchService = {
    supportsSemanticSearch: (provider: string) =>
      provider === 'gemini' || provider === 'openai',
    embedQuery: jest.fn(),
    similarityThresholds: () => ({ min: 0.3, high: 0.5 }),
    embeddingProviderFilter: () => ({}),
    findNotesByKeywords: jest.fn(),
  };
  const httpService = {
    post: jest.fn((url: string, body: unknown) => {
      postBodies.push(body as { notes_chunks: string[] });
      return of({ data: ragResponse });
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    saved = [];
    postBodies = [];
    ragResponse = { answer: 'The answer', tokens_used: 42 };
    session = {
      _id: new Types.ObjectId(sessionId),
      title: 'Chat',
      chunkedMessageCount: 0,
      save: jest.fn(),
    };

    sessionModel.findOne.mockReturnValue(query(session));
    MessageModel.find.mockReturnValue(query([]));
    MessageModel.countDocuments.mockResolvedValue(4);
    chunkModel.find.mockReturnValue(query([]));
    usersService.getActiveLlmSettings.mockResolvedValue({
      provider: 'openai',
      apiKey: 'k',
      model: 'gpt-4o-mini',
      keyName: 'n',
    });
    usersService.addTokenUsage.mockResolvedValue(undefined);
    searchService.embedQuery.mockResolvedValue([1, 0]);
    searchService.findNotesByKeywords.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: getModelToken(ChatSession.name), useValue: sessionModel },
        { provide: getModelToken(ChatMessage.name), useValue: MessageModel },
        { provide: getModelToken(KnowledgeChunk.name), useValue: chunkModel },
        { provide: HttpService, useValue: httpService },
        { provide: UsersService, useValue: usersService },
        { provide: SearchService, useValue: searchService },
      ],
    }).compile();

    service = module.get(ChatService);
    autoChunk = jest
      .spyOn(service, 'autoChunkSession')
      .mockResolvedValue(undefined);
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
    ragResponse = { answer: 'Model unavailable', error: true, tokens_used: 0 };
    await expect(send()).rejects.toBeInstanceOf(HttpException);
    expect(saved).toEqual([]);
  });

  it('re-chunks the transcript once 10 new messages have accumulated', async () => {
    MessageModel.countDocuments.mockResolvedValue(9);
    await send();
    expect(autoChunk).not.toHaveBeenCalled();

    MessageModel.countDocuments.mockResolvedValue(10);
    await send();
    expect(autoChunk).toHaveBeenCalledTimes(1);

    session.chunkedMessageCount = 10;
    MessageModel.countDocuments.mockResolvedValue(12);
    await send();
    expect(autoChunk).toHaveBeenCalledTimes(1);
  });

  it('sends only the most similar note chunks, best first', async () => {
    const chunks = Array.from({ length: 20 }, (_, i) => ({
      text: `chunk ${i}`,
      sourceType: 'note',
      noteTitle: `Note ${i}`,
      // similarity to [1, 0] grows with i
      embedding: [i / 20, 1 - i / 20],
    }));
    chunkModel.find.mockReturnValue(query(chunks));

    await send();

    const notesChunks = postBodies[0].notes_chunks;
    expect(notesChunks).toHaveLength(6);
    expect(notesChunks[0]).toContain('chunk 19');
    expect(notesChunks[5]).toContain('chunk 14');
  });

  it('finds notes by keyword when the provider has no embeddings', async () => {
    usersService.getActiveLlmSettings.mockResolvedValue({
      provider: 'anthropic',
      apiKey: 'k',
      model: 'claude-sonnet-4-5',
      keyName: 'n',
    });
    searchService.findNotesByKeywords.mockResolvedValue([
      { noteId: 'n1', title: 'Roadmap', text: 'Ship chat in Q3' },
    ]);

    await send('roadmap for chat');

    expect(searchService.embedQuery).not.toHaveBeenCalled();
    expect(searchService.findNotesByKeywords).toHaveBeenCalledWith(
      userId,
      'roadmap for chat',
      expect.any(Number),
    );
    expect(postBodies[0].notes_chunks).toEqual([
      '[SOURCE: Note "Roadmap"]\nShip chat in Q3',
    ]);
  });
});
