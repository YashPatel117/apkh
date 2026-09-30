/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- tests read untyped HTTP JSON and raw documents, and fakes mirror async APIs */
import { INestApplication } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model, Types, mongo } from 'mongoose';
import {
  KnowledgeChunk,
  KnowledgeChunkDocument,
} from 'src/common/schema/chunk';
import { IndexJob, IndexJobDocument } from 'src/common/schema/index-job';
import { Note, NoteDocument } from 'src/common/schema/note';
import { ChatSession } from 'src/common/schema/chat-session';
import { ChatMessage } from 'src/common/schema/chat-message';
import { DatabaseModule } from 'src/database/database.module';
import { FileService } from 'src/file/file.service';
import { IndexingModule } from 'src/indexing/indexing.module';
import { IndexingService } from 'src/indexing/indexing.service';
import { IndexQueueService } from 'src/indexing/index-queue.service';
import { IndexWorkerService } from 'src/indexing/index-worker.service';
import { NoteIndexerService } from 'src/indexing/note-indexer.service';
import { ChatIndexerService } from 'src/indexing/chat-indexer.service';
import {
  SearchApiClient,
  SearchApiError,
} from 'src/search-api/search-api.client';
import { RetrievalService } from 'src/search/retrieval.service';
import { SearchModule } from 'src/search/search.module';
import { SearchService } from 'src/search/search.service';
import { UsersService } from 'src/users/users.service';
import { fromStoredVector } from 'src/common/utils/vector';
import { FakeSearchApi, fakeVector } from './fake-search-api';
import { describeWithDb, dropDatabase, freshDatabaseUri } from './test-db';

// ───────────────────────────────────────────────────────────── migrations ──

describeWithDb('migrations on legacy data', () => {
  const uri = freshDatabaseUri('migrate');
  const dbName = new URL(uri).pathname.slice(1);
  afterAll(() => dropDatabase(uri));
  const userId = new Types.ObjectId();
  const noteId = new Types.ObjectId();
  const sessionId = new Types.ObjectId();

  const openaiVector = Array.from({ length: 1536 }, (_, i) => (i % 7) - 3);
  const geminiVector = Array.from({ length: 3072 }, (_, i) => i % 5);

  async function bootApp() {
    const moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(uri), DatabaseModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init(); // runs pending migrations
    return app;
  }

  it('converts ids, chunks and plain text, once', async () => {
    const client = new mongo.MongoClient(uri);
    await client.connect();
    const db = client.db(dbName);
    await db.collection('notes').insertOne({
      _id: noteId,
      userId: userId.toHexString(),
      title: 'Legacy',
      category: 'General',
      content: '<p>Alpha</p><p>Beta &amp; gamma</p>',
      contentPlain: 'AlphaBeta &amp; gamma',
    });
    await db.collection('knowledgechunks').insertMany([
      {
        noteId,
        userId,
        noteTitle: 'Legacy',
        chunkIndex: 0,
        text: 'openai text',
        sourceType: 'note',
        embeddingProvider: 'openai',
        embeddingModel: 'gpt-4o-mini',
        embedding: openaiVector,
      },
      {
        noteId,
        userId,
        noteTitle: 'Legacy',
        chunkIndex: 1,
        text: 'gemini text',
        sourceType: 'note',
        embeddingProvider: 'gemini',
        embeddingModel: 'gemini-embedding-001',
        embedding: geminiVector,
      },
      {
        noteId: sessionId,
        userId,
        noteTitle: 'Chat',
        chunkIndex: 0,
        text: 'chat text',
        sourceType: 'chat',
        sourceId: sessionId.toHexString(),
        embeddingProvider: 'openai',
        embeddingModel: 'gpt-4o',
        embedding: openaiVector,
      },
    ]);
    await db
      .collection('summary')
      .createIndex({ noteId: 1, userId: 1 }, { unique: true });
    await db.collection('summary').insertOne({
      noteId,
      userId,
      summary: 'Old summary',
      summaryModel: 'gpt-4o-mini',
    });
    await db.collection('chatsessions').insertOne({
      _id: sessionId,
      userId,
      title: 'Chat',
      isChunked: true,
      chunkedMessageCount: 10,
    });

    const app = await bootApp();

    const note = await db.collection('notes').findOne({ _id: noteId });
    expect(note!.userId).toBeInstanceOf(mongo.ObjectId);
    expect(note!.contentPlain).toBe('Alpha\nBeta & gamma');

    const chunks = await db
      .collection('knowledgechunks')
      .find({})
      .sort({ chunkIndex: 1 })
      .toArray();
    expect(chunks.map((c) => c.sourceType)).toEqual(['note', 'note']); // chat chunk removed
    const [openai, gemini] = chunks;
    expect(openai.embeddingModel).toBe('text-embedding-3-small@1536');
    expect(openai.vector).toBeInstanceOf(mongo.Binary);
    expect((openai.vector as mongo.Binary).sub_type).toBe(9);
    const decoded = fromStoredVector(openai.vector)!;
    expect(decoded).toHaveLength(1536);
    expect(Math.hypot(...decoded)).toBeCloseTo(1, 4);
    expect(openai.embedding).toBeUndefined();
    expect(openai.embeddingProvider).toBeUndefined();
    expect(openai.textHash).toHaveLength(64);
    expect(gemini.vector).toBeUndefined();
    expect(gemini.embeddingModel).toBeUndefined();
    expect(gemini.embedding).toBeUndefined();
    expect(gemini.textHash).toHaveLength(64);

    const session = await db
      .collection('chatsessions')
      .findOne({ _id: sessionId });
    expect(session).toMatchObject({ isChunked: false, chunkedMessageCount: 0 });
    expect(await db.collection('migrations').countDocuments()).toBe(4);

    // Summaries: the old one is "brief", and a second mode can now be cached
    expect(await db.collection('summary').findOne({ noteId })).toMatchObject({
      mode: 'brief',
    });
    await db
      .collection('summary')
      .insertOne({ noteId, userId, mode: 'actions', summary: '' });
    expect(await db.collection('summary').countDocuments({ noteId })).toBe(2);

    // Mongoose now finds the note by the string id in the JWT
    const noteModel = app.get<Model<NoteDocument>>(getModelToken(Note.name));
    expect(
      await noteModel.countDocuments({ userId: userId.toHexString() }),
    ).toBe(1);
    await app.close();

    // A second start changes nothing
    await db
      .collection('notes')
      .updateOne({ _id: noteId }, { $set: { contentPlain: 'untouched' } });
    const again = await bootApp();
    expect(
      (await db.collection('notes').findOne({ _id: noteId }))!.contentPlain,
    ).toBe('untouched');
    await again.close();
    await client.close();
  });
});

// ───────────────────────────────────────────── queue, indexers and search ──

describeWithDb('indexing pipeline', () => {
  const uri = freshDatabaseUri('indexing');
  let app: INestApplication;
  let fake: FakeSearchApi;
  let noteModel: Model<NoteDocument>;
  let chunkModel: Model<KnowledgeChunkDocument>;
  let jobModel: Model<IndexJobDocument>;
  let queue: IndexQueueService;
  let indexing: IndexingService;
  let retrieval: RetrievalService;
  let noteIndexer: NoteIndexerService;
  const noteFiles = new Map<string, string[]>();
  const user = {
    provider: 'openai' as 'openai' | 'gemini' | 'anthropic' | null,
  };
  const userId = new Types.ObjectId();

  const llm = () =>
    user.provider && {
      provider: user.provider,
      apiKey: 'k',
      model:
        user.provider === 'openai'
          ? 'gpt-4o-mini'
          : user.provider === 'gemini'
            ? 'gemini-2.5-flash'
            : 'claude-sonnet-4-5',
      keyName: 'n',
    };

  beforeAll(async () => {
    process.env.INDEX_WORKER = 'off';
    fake = new FakeSearchApi();
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri),
        JwtModule.register({ global: true, secret: 'test-jwt-secret' }),
        IndexingModule,
        SearchModule,
      ],
    })
      .overrideProvider(SearchApiClient)
      .useValue(fake)
      .overrideProvider(FileService)
      .useValue({
        getNoteFiles: async (id: string) => ({
          files: noteFiles.get(id) ?? [],
        }),
      })
      .overrideProvider(UsersService)
      .useValue({
        getActiveLlmSettings: async () => llm(),
        getActiveProvider: async () => user.provider,
        addTokenUsage: async () => undefined,
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    noteModel = app.get(getModelToken(Note.name));
    chunkModel = app.get(getModelToken(KnowledgeChunk.name));
    jobModel = app.get(getModelToken(IndexJob.name));
    queue = app.get(IndexQueueService);
    indexing = app.get(IndexingService);
    retrieval = app.get(RetrievalService);
    noteIndexer = app.get(NoteIndexerService);
    await Promise.all([
      noteModel.syncIndexes(),
      chunkModel.syncIndexes(),
      jobModel.syncIndexes(),
    ]);
  });

  afterAll(async () => {
    await app.close();
    await dropDatabase(uri);
  });

  beforeEach(async () => {
    await Promise.all([
      noteModel.deleteMany({}),
      chunkModel.deleteMany({}),
      jobModel.deleteMany({}),
    ]);
    fake.reset();
    fake.files.clear();
    fake.failingFiles.clear();
    noteFiles.clear();
    user.provider = 'openai';
  });

  const createNote = async (
    title: string,
    content: string,
    files: string[] = [],
  ) => {
    // Mongoose 8 types a created document's _id as unknown
    const note = (await noteModel.create({
      userId: userId.toHexString(),
      title,
      content,
      category: 'General',
    })) as unknown as NoteDocument & { _id: Types.ObjectId };
    noteFiles.set(note._id.toHexString(), files);
    return note;
  };

  /** Claim and run every runnable job, like the worker does. */
  async function drain(max = 50) {
    for (let i = 0; i < max; i++) {
      const job = await queue.claim('test-worker');
      if (!job) return;
      try {
        const outcome =
          job.kind === 'note'
            ? await noteIndexer.index(job)
            : await app.get(ChatIndexerService).index(job);
        await queue.complete(job, 'test-worker', outcome);
      } catch (error) {
        await queue.fail(job, 'test-worker', error);
      }
    }
  }

  const jobOf = (noteId: Types.ObjectId) =>
    jobModel.findOne({ targetId: noteId }).lean();
  const chunksOf = (noteId: Types.ObjectId) =>
    chunkModel.find({ noteId }).sort({ chunkIndex: 1 }).lean();

  it('stores binary vectors that Mongoose reads back as-is', async () => {
    const note = await createNote('T', '<p>hello world</p>');
    await indexing.enqueueNote(userId.toHexString(), note._id.toHexString());
    await drain();
    const [chunk] = await chunksOf(note._id);
    expect(chunk.vector).toBeInstanceOf(mongo.Binary);
    expect((chunk.vector as mongo.Binary).sub_type).toBe(9);
    expect(fromStoredVector(chunk.vector)).toHaveLength(1536);
  });

  it('indexes incrementally: unchanged attachments and passages are reused', async () => {
    fake.files.set('a.txt', 'Attachment alpha text');
    fake.files.set(
      'b.pdf',
      '[Page 1]\nFirst page about budgets\n\n[Page 2]\nSecond page about hiring',
    );
    const note = await createNote(
      'Plan',
      '<p>Intro paragraph</p><p>Second paragraph</p>',
      ['a.txt', 'b.pdf'],
    );
    const id = note._id.toHexString();

    await indexing.enqueueNote(userId.toHexString(), id);
    await drain();
    expect(fake.extractCalls).toEqual([['a.txt', 'b.pdf']]);
    expect(fake.embeddedTexts).toHaveLength(5);
    expect(
      (await chunksOf(note._id)).map((c) => [
        c.sourceType,
        c.sourceName ?? null,
        c.sourcePage ?? null,
      ]),
    ).toEqual([
      ['note', null, null],
      ['note', null, null],
      ['file', 'a.txt', null],
      ['file', 'b.pdf', 1],
      ['file', 'b.pdf', 2],
    ]);
    expect(await jobOf(note._id)).toMatchObject({
      status: 'ready',
      chunkCount: 5,
      embeddingModel: 'text-embedding-3-small@1536',
    });

    // 1. Edit one paragraph: no attachment is read again, one passage re-embedded
    fake.reset();
    await noteModel.updateOne(
      { _id: note._id },
      { content: '<p>Intro paragraph</p><p>Second paragraph, edited</p>' },
    );
    await indexing.enqueueNote(userId.toHexString(), id);
    await drain();
    expect(fake.extractCalls).toEqual([]);
    expect(fake.embeddedTexts).toEqual(['Second paragraph, edited']);
    expect(await chunkModel.countDocuments({ noteId: note._id })).toBe(5);

    // 2. Save with no change: nothing at all
    fake.reset();
    await indexing.enqueueNote(userId.toHexString(), id);
    await drain();
    expect(fake.extractCalls).toEqual([]);
    expect(fake.embedCalls).toEqual([]);

    // 3. Rename: titles on the chunks change, nothing is re-embedded
    fake.reset();
    await noteModel.updateOne({ _id: note._id }, { title: 'Plan v2' });
    await indexing.enqueueNote(userId.toHexString(), id);
    await drain();
    expect(fake.embedCalls).toEqual([]);
    expect(
      (await chunksOf(note._id)).every((c) => c.noteTitle === 'Plan v2'),
    ).toBe(true);

    // 4. Add an attachment, remove another: only the new one is read
    fake.reset();
    fake.files.set('c.md', 'Fresh markdown file');
    noteFiles.set(id, ['b.pdf', 'c.md']);
    await indexing.enqueueNote(userId.toHexString(), id);
    await drain();
    expect(fake.extractCalls).toEqual([['c.md']]);
    expect(fake.embeddedTexts).toEqual(['Fresh markdown file']);
    const names = (await chunksOf(note._id))
      .map((c) => c.sourceName)
      .filter(Boolean);
    expect(names).toEqual(['b.pdf', 'b.pdf', 'c.md']);

    // 5. Provider switch: vectors rebuilt from stored text, no attachment re-read
    fake.reset();
    user.provider = 'gemini';
    await indexing.reconcileUser(userId.toHexString(), { force: true });
    await drain();
    expect(fake.extractCalls).toEqual([]);
    expect(fake.embeddedTexts).toHaveLength(5);
    expect(
      new Set((await chunksOf(note._id)).map((c) => c.embeddingModel)),
    ).toEqual(new Set(['gemini-embedding-001@1536']));

    // 6. Switch to Claude: existing chunks serve keyword search as they are
    fake.reset();
    user.provider = 'anthropic';
    await indexing.reconcileUser(userId.toHexString(), { force: true });
    await drain();
    expect(fake.embedCalls).toEqual([]);
    expect(await jobModel.countDocuments({ status: 'queued' })).toBe(0);
  });

  it('retries a failed attachment without redoing the rest', async () => {
    fake.files.set('ok.txt', 'Readable text');
    fake.failingFiles.add('flaky.pdf');
    const note = await createNote('Report', '<p>Body</p>', [
      'ok.txt',
      'flaky.pdf',
    ]);
    await indexing.enqueueNote(userId.toHexString(), note._id.toHexString());
    await drain();

    let job = await jobOf(note._id);
    expect(job).toMatchObject({ status: 'queued', attempts: 1 }); // backoff pending
    expect(job!.error).toContain('flaky.pdf');
    expect(await chunkModel.countDocuments({ noteId: note._id })).toBe(2); // note + ok.txt already searchable

    fake.reset();
    fake.failingFiles.clear();
    fake.files.set('flaky.pdf', 'Recovered pdf text');
    await jobModel.updateOne({ targetId: note._id }, { runAt: new Date() }); // skip the backoff wait
    await drain();
    expect(fake.extractCalls).toEqual([['flaky.pdf']]);
    expect(fake.embeddedTexts).toEqual(['Recovered pdf text']);
    job = await jobOf(note._id);
    expect(job).toMatchObject({ status: 'ready' });
    expect(job!.error).toBeUndefined();
  });

  it('never re-downloads settled files (empty or unsupported) unless forced', async () => {
    fake.files.set('blank.txt', '');
    const note = await createNote('N', '<p>x</p>', ['blank.txt']);
    const id = note._id.toHexString();
    await indexing.enqueueNote(userId.toHexString(), id);
    await drain();
    expect((await jobOf(note._id))!.files).toMatchObject([
      { name: 'blank.txt', status: 'empty' },
    ]);

    fake.reset();
    await noteModel.updateOne({ _id: note._id }, { content: '<p>y</p>' });
    await indexing.enqueueNote(userId.toHexString(), id);
    await drain();
    expect(fake.extractCalls).toEqual([]);

    fake.reset();
    await indexing.enqueueNote(userId.toHexString(), id, { force: true });
    await drain();
    expect(fake.extractCalls).toEqual([['blank.txt']]);
  });

  it('marks jobs failed after repeated provider errors, and retries rate limits', async () => {
    const note = await createNote('N', '<p>x</p>');
    fake.embedError = new SearchApiError('API key is invalid', 401);
    await indexing.enqueueNote(userId.toHexString(), note._id.toHexString());
    await drain();
    expect(await jobOf(note._id)).toMatchObject({
      status: 'failed',
      error: 'API key is invalid',
    });

    fake.embedError = new SearchApiError('rate limit', 429);
    await indexing.enqueueNote(userId.toHexString(), note._id.toHexString());
    await drain();
    const job = await jobOf(note._id);
    expect(job).toMatchObject({ status: 'queued', attempts: 1 });
    expect(job!.runAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('a save during indexing runs the note again afterwards (never twice at once)', async () => {
    const note = await createNote('N', '<p>v1</p>');
    const id = note._id.toHexString();
    await indexing.enqueueNote(userId.toHexString(), id);
    const job = await queue.claim('w1');
    expect(await queue.claim('w2')).toBeNull(); // nothing else runnable

    await noteModel.updateOne({ _id: note._id }, { content: '<p>v2</p>' });
    await indexing.enqueueNote(userId.toHexString(), id); // while processing
    expect(await jobModel.countDocuments({ targetId: note._id })).toBe(1);

    const outcome = await noteIndexer.index(job!);
    await queue.complete(job!, 'w1', outcome);
    expect(await jobOf(note._id)).toMatchObject({ status: 'queued' });
    await drain();
    expect((await chunksOf(note._id)).map((c) => c.text)).toEqual(['v2']);
  });

  it('interactive saves jump ahead of a bulk reindex', async () => {
    const bulk = await Promise.all(
      [1, 2, 3].map((i) => createNote(`B${i}`, `<p>b${i}</p>`)),
    );
    await queue.enqueueMany(
      'note',
      userId.toHexString(),
      bulk.map((n) => n._id.toHexString()),
    );
    const edited = await createNote('Edited', '<p>now</p>');
    await indexing.enqueueNote(userId.toHexString(), edited._id.toHexString());
    const first = await queue.claim('w');
    expect(first!.targetId.toHexString()).toBe(edited._id.toHexString());
  });

  it('recovers jobs abandoned by a crashed worker', async () => {
    const note = await createNote('N', '<p>x</p>');
    await indexing.enqueueNote(userId.toHexString(), note._id.toHexString());
    await queue.claim('crashed');
    await jobModel.updateOne(
      { targetId: note._id },
      { lockedAt: new Date(Date.now() - 10 * 60_000) },
    );
    expect(await queue.recoverStale()).toBe(1);
    expect(await jobOf(note._id)).toMatchObject({ status: 'queued' });
  });

  it('deleting a note mid-run leaves no chunks or job behind', async () => {
    const note = await createNote('N', '<p>x</p>');
    await indexing.enqueueNote(userId.toHexString(), note._id.toHexString());
    const job = await queue.claim('w');
    const originalEmbed = fake.embed.bind(fake);
    fake.embed = async (...args) => {
      await noteModel.deleteOne({ _id: note._id }); // user deletes while vectors are computed
      return originalEmbed(...args);
    };
    const outcome = await noteIndexer.index(job!);
    fake.embed = originalEmbed;
    await queue.complete(job!, 'w', outcome);
    expect(outcome.kind).toBe('deleted');
    expect(await chunkModel.countDocuments({ noteId: note._id })).toBe(0);
    expect(await jobModel.countDocuments({ targetId: note._id })).toBe(0);
  });

  it('reconcile adopts usable legacy chunks and queues the rest; status reports every note', async () => {
    const adopted = await createNote('Adopted', '<p>a</p>');
    const stale = await createNote('Stale', '<p>s</p>');
    const never = await createNote('Never', '<p>n</p>');
    const vec = mongo.Binary.fromFloat32Array(fakeVector('a', 1536));
    await chunkModel.collection.insertMany([
      {
        userId,
        noteId: adopted._id,
        sourceType: 'note',
        noteTitle: 'Adopted',
        chunkIndex: 0,
        text: 'a',
        textHash: 'h1',
        embeddingModel: 'text-embedding-3-small@1536',
        vector: vec,
      },
      {
        userId,
        noteId: stale._id,
        sourceType: 'note',
        noteTitle: 'Stale',
        chunkIndex: 0,
        text: 's',
        textHash: 'h2',
      },
    ]);
    await indexing.reconcileUser(userId.toHexString(), { force: true });
    expect(await jobOf(adopted._id)).toMatchObject({
      status: 'ready',
      chunkCount: 1,
    });
    expect(await jobOf(stale._id)).toMatchObject({ status: 'queued' });
    expect(await jobOf(never._id)).toMatchObject({ status: 'queued' });

    const status = await indexing.getStatus(userId.toHexString());
    expect(status).toMatchObject({
      provider: 'openai',
      semantic: true,
      counts: { ready: 1, queued: 2 },
    });
    expect(status.notes).toHaveLength(3);
  });

  it('hybrid retrieval: meaning and exact words both count, scopes are respected', async () => {
    const a = await createNote(
      'Deploy runbook',
      '<p>Rollout steps for the production cluster</p>',
    );
    const b = await createNote(
      'Error codes',
      '<p>ERR_4312 means the token expired</p>',
    );
    const c = await createNote('Recipes', '<p>Banana bread with walnuts</p>');
    await indexing.reindexAll(userId.toHexString());
    await drain();

    const vector = fakeVector('production rollout steps', 1536);
    const space = {
      id: 'text-embedding-3-small@1536',
      provider: 'openai' as const,
      model: 'text-embedding-3-small',
      dimensions: 1536,
    };
    const semantic = await retrieval.retrieve(
      userId.toHexString(),
      'production rollout steps',
      {
        scope: { sourceTypes: ['note', 'file'] },
        limit: 3,
        vector,
        space,
        minSimilarity: 0.3,
      },
    );
    expect(semantic[0]).toMatchObject({
      noteTitle: 'Deploy runbook',
      keywordMatch: true,
    });
    expect(semantic[0].similarity).toBeGreaterThan(0.5);
    expect(semantic.find((r) => r.noteTitle === 'Recipes')).toBeUndefined();

    // An exact code the embedding knows nothing about is found by the keyword leg
    const exact = await retrieval.retrieve(
      userId.toHexString(),
      'what is ERR_4312',
      {
        scope: { sourceTypes: ['note', 'file'] },
        limit: 3,
        vector: fakeVector('unrelated words', 1536),
        space,
        minSimilarity: 0.9,
      },
    );
    expect(exact.map((r) => r.noteTitle)).toEqual(['Error codes']);
    expect(exact[0]).toMatchObject({ keywordMatch: true, similarity: null });

    // Pinned notes only
    const pinned = await retrieval.retrieve(
      userId.toHexString(),
      'anything at all',
      {
        scope: {
          sourceTypes: ['note', 'file'],
          noteIds: [c._id.toHexString()],
        },
        limit: 5,
        vector,
        space,
        minSimilarity: null,
      },
    );
    expect(pinned.map((r) => r.noteTitle)).toEqual(['Recipes']);
    void a;
    void b;
  });

  it('AI search answers from hybrid retrieval and reports notes still indexing', async () => {
    await createNote(
      'Deploy runbook',
      '<p>Rollout steps for the production cluster</p>',
    );
    await indexing.reindexAll(userId.toHexString());
    await drain();
    await createNote('Later', '<p>not indexed yet</p>');
    await indexing.reconcileUser(userId.toHexString(), { force: true });

    let ragContexts: string[] = [];
    (fake as any).rag = async (
      _t: string,
      _l: unknown,
      _q: string,
      contexts: string[],
    ) => {
      ragContexts = contexts;
      return { text: 'Use the rollout steps.', error: false, tokensUsed: 3 };
    };
    const result = await app
      .get(SearchService)
      .performAiSearch('Bearer t', userId.toHexString(), 'production rollout');
    expect(result).toMatchObject({
      isError: false,
      answer: 'Use the rollout steps.',
      pendingNotes: 1,
    });
    expect(result.references[0]).toMatchObject({
      note_title: 'Deploy runbook',
      match: 'both',
    });
    expect(ragContexts[0]).toContain('Note "Deploy runbook"');
  });

  it('a vague question is rewritten and searched again', async () => {
    await createNote('Launch', '<p>Q3 product launch plan and dates</p>');
    await createNote('Recipes', '<p>Banana bread with walnuts</p>');
    await indexing.reindexAll(userId.toHexString());
    await drain();
    (fake as any).rag = async () => ({
      text: 'The plan.',
      error: false,
      tokensUsed: 1,
    });
    fake.rewrites.set('that thing about shipping', {
      query: 'product launch plan',
      keywords: ['launch', 'release'],
    });

    const result = await app
      .get(SearchService)
      .performAiSearch(
        'Bearer t',
        userId.toHexString(),
        'that thing about shipping',
      );

    expect(fake.rewriteCalls).toEqual(['that thing about shipping']);
    expect(result).toMatchObject({
      isError: false,
      searchedFor: 'product launch plan',
    });
    expect(result.references[0].note_title).toBe('Launch');

    // A question that finds good matches is not rewritten
    fake.rewriteCalls = [];
    await app
      .get(SearchService)
      .performAiSearch('Bearer t', userId.toHexString(), 'product launch plan');
    expect(fake.rewriteCalls).toEqual([]);
  });

  it('ATLAS_VECTOR_INDEX falls back to in-app similarity where $vectorSearch is unavailable', async () => {
    await createNote('Deploy runbook', '<p>Rollout steps for production</p>');
    await indexing.reindexAll(userId.toHexString());
    await drain();

    const setting = process.env.ATLAS_VECTOR_INDEX;
    process.env.ATLAS_VECTOR_INDEX = 'chunk_vectors';
    const atlasRetrieval = new RetrievalService(chunkModel);
    process.env.ATLAS_VECTOR_INDEX = setting;
    const aggregate = jest.spyOn(chunkModel, 'aggregate');
    const search = () =>
      atlasRetrieval.retrieve(userId.toHexString(), 'rollout', {
        scope: { sourceTypes: ['note', 'file'] },
        limit: 3,
        vector: fakeVector('rollout steps production', 1536),
        space: {
          id: 'text-embedding-3-small@1536',
          provider: 'openai',
          model: 'text-embedding-3-small',
          dimensions: 1536,
        },
        minSimilarity: 0.3,
      });

    const first = await search();
    expect(first[0]).toMatchObject({ noteTitle: 'Deploy runbook' });
    expect(first[0].similarity).toBeGreaterThan(0.5);
    const pipeline = aggregate.mock.calls[0][0] as any[];
    expect(pipeline[0].$vectorSearch).toMatchObject({
      index: 'chunk_vectors',
      path: 'vector',
      filter: {
        embeddingModel: 'text-embedding-3-small@1536',
        sourceType: { $in: ['note', 'file'] },
      },
    });

    // After a failure it stops trying for a while
    await search();
    expect(aggregate).toHaveBeenCalledTimes(1);
    aggregate.mockRestore();
  });

  it('similar notes shortlist on Atlas and fall back to comparing every note', async () => {
    const note = await createNote('Deploy runbook', '<p>Rollout steps</p>');
    await createNote('Deploy runbook copy', '<p>Rollout steps</p>');
    await indexing.reindexAll(userId.toHexString());
    await drain();

    const setting = process.env.ATLAS_VECTOR_INDEX;
    process.env.ATLAS_VECTOR_INDEX = 'chunk_vectors';
    const atlasRetrieval = new RetrievalService(chunkModel);
    process.env.ATLAS_VECTOR_INDEX = setting;
    const aggregate = jest.spyOn(chunkModel, 'aggregate');

    const similar = await atlasRetrieval.similarNotes(
      userId.toHexString(),
      note._id.toHexString(),
      {
        id: 'text-embedding-3-small@1536',
        provider: 'openai',
        model: 'text-embedding-3-small',
        dimensions: 1536,
      },
      5,
    );

    const pipeline = aggregate.mock.calls[0][0] as any[];
    expect(pipeline[0].$vectorSearch).toMatchObject({
      index: 'chunk_vectors',
      filter: {
        embeddingModel: 'text-embedding-3-small@1536',
        noteId: { $ne: note._id },
      },
    });
    expect(similar[0]).toMatchObject({
      noteTitle: 'Deploy runbook copy',
      nearDuplicate: true,
    });
    aggregate.mockRestore();
  });

  it('finds similar notes by meaning (or keywords for Claude) and flags near-duplicates', async () => {
    const note = await createNote(
      'Deploy runbook',
      '<p>Rollout steps for the production cluster</p>',
    );
    await createNote(
      'Deploy runbook copy',
      '<p>Rollout steps for the production cluster</p>',
    );
    await createNote(
      'Cluster upgrade',
      '<p>Production cluster rollout plan</p>',
    );
    await createNote('Recipes', '<p>Banana bread with walnuts</p>');
    await indexing.reindexAll(userId.toHexString());
    await drain();

    const byMeaning = await app
      .get(SearchService)
      .similarNotes(userId.toHexString(), note._id.toHexString());
    expect(byMeaning.semantic).toBe(true);
    expect(byMeaning.notes[0]).toMatchObject({
      noteTitle: 'Deploy runbook copy',
      nearDuplicate: true,
    });
    const related = byMeaning.notes.map((n) => n.noteTitle);
    expect(related).toContain('Cluster upgrade');
    expect(related).not.toContain('Recipes');
    expect(related).not.toContain('Deploy runbook');

    user.provider = 'anthropic';
    const byKeywords = await app
      .get(SearchService)
      .similarNotes(userId.toHexString(), note._id.toHexString());
    expect(byKeywords.semantic).toBe(false);
    expect(byKeywords.notes.map((n) => n.noteTitle).sort()).toEqual([
      'Cluster upgrade',
      'Deploy runbook copy',
    ]);
  });

  it('chat transcripts are indexed and extended incrementally', async () => {
    const sessionModel = app.get<Model<any>>(getModelToken(ChatSession.name));
    const messageModel = app.get<Model<any>>(getModelToken(ChatMessage.name));
    const session = await sessionModel.create({
      userId,
      title: 'Chat about budgets',
    });
    await messageModel.create([
      {
        sessionId: session._id,
        role: 'user',
        content: 'How big is the budget?',
      },
      { sessionId: session._id, role: 'assistant', content: 'About 10k.' },
    ]);
    await indexing.enqueueChat(userId.toHexString(), session._id.toHexString());
    await drain();
    expect(fake.embeddedTexts).toEqual([
      'Chat title: Chat about budgets',
      'User: How big is the budget?',
      'Assistant: About 10k.',
    ]);
    expect(
      (await sessionModel
        .findById(session._id)
        .lean<{ chunkedMessageCount: number }>())!.chunkedMessageCount,
    ).toBe(2);

    fake.reset();
    await messageModel.create([
      { sessionId: session._id, role: 'user', content: 'And hiring?' },
    ]);
    await indexing.enqueueChat(userId.toHexString(), session._id.toHexString());
    await drain();
    expect(fake.embeddedTexts).toEqual(['User: And hiring?']);
    expect(await chunkModel.countDocuments({ sessionId: session._id })).toBe(4);
  });

  it('the worker picks up queued jobs on its own', async () => {
    const worker = app.get(IndexWorkerService);
    const note = await createNote('Worker', '<p>background</p>');
    worker.start();
    await indexing.enqueueNote(userId.toHexString(), note._id.toHexString());
    for (
      let i = 0;
      i < 50 && (await jobOf(note._id))?.status !== 'ready';
      i++
    ) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await worker.stop();
    expect(await jobOf(note._id)).toMatchObject({
      status: 'ready',
      chunkCount: 1,
    });
  });
});
