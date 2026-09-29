/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- tests read untyped HTTP JSON and raw documents, and fakes mirror async APIs */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describeWithDb, dropDatabase, freshDatabaseUri } from './test-db';

describeWithDb('whole API (real AppModule)', () => {
  const uri = freshDatabaseUri('app');
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    process.env.MONGODB_URI = uri;
    // Point the services at nothing: any provider call must fail gracefully.
    process.env.SEARCH_API_URL = 'http://127.0.0.1:9';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require('src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await dropDatabase(uri);
  });

  it('registers, creates a note and reports its index status', async () => {
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        name: 'Test User',
        email: 't@example.com',
        password: 'secret123',
      })
      .expect(201);
    token = `Bearer ${register.body.data}`;

    const created = await request(app.getHttpServer())
      .post('/notes')
      .set('Authorization', token)
      .field('title', '')
      .field('content', '<p>First paragraph</p><p>Second one</p>')
      .field('category', '')
      .expect(201);
    expect(created.body.data.title).toBe('First paragraph');

    const list = await request(app.getHttpServer())
      .get('/notes')
      .set('Authorization', token)
      .expect(200);
    expect(list.body.data).toHaveLength(1);

    // No AI key yet: once the worker gets to it, the note is reported as not indexable
    let status: any;
    for (let i = 0; i < 40; i++) {
      status = (
        await request(app.getHttpServer())
          .get('/notes/index-status')
          .set('Authorization', token)
          .expect(200)
      ).body;
      if (status.counts.skipped) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(status).toMatchObject({
      provider: null,
      semantic: false,
      counts: { skipped: 1 },
    });
    expect(status.notes[0].error).toContain('Add an AI key');
  });

  it('adding a key queues indexing; an unreachable search service is retried, not fatal', async () => {
    await request(app.getHttpServer())
      .post('/users/llm-configs')
      .set('Authorization', token)
      .send({
        keyName: 'main',
        apiKey: 'sk-test-0000000000000000000000',
        model: 'gpt-4o-mini',
      })
      .expect(201);

    let status: any;
    for (let i = 0; i < 40; i++) {
      status = (
        await request(app.getHttpServer())
          .get('/notes/index-status')
          .set('Authorization', token)
      ).body;
      if (status.notes[0]?.error) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(status).toMatchObject({ provider: 'openai', semantic: true });
    expect(status.notes[0]).toMatchObject({ status: 'queued' }); // waiting to retry
    expect(status.notes[0].error).toBeTruthy();
  });

  it('rebuild, retry and per-note reindex endpoints respond', async () => {
    const notes = (
      await request(app.getHttpServer())
        .get('/notes')
        .set('Authorization', token)
    ).body.data;
    await request(app.getHttpServer())
      .post('/notes/reindex')
      .set('Authorization', token)
      .send({ force: true })
      .expect(202);
    await request(app.getHttpServer())
      .post('/notes/index/retry-failed')
      .set('Authorization', token)
      .send({})
      .expect(202);
    await request(app.getHttpServer())
      .post(`/notes/${notes[0].id}/reindex`)
      .set('Authorization', token)
      .send({})
      .expect(202);
    await request(app.getHttpServer())
      .post(`/notes/${notes[0].id}/reindex`)
      .set('Authorization', token)
      .send({ force: 'yes' })
      .expect(400);
  });

  it('AI search with the search service down degrades to keyword search, not a 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/notes/ai-search')
      .set('Authorization', token)
      .send({ query: 'what is in my notes?' })
      .expect(201);
    // Nothing is indexed yet (the service is down), and the answer says which notes are pending
    expect(res.body).toMatchObject({
      isError: false,
      confidence: 'not_found',
      pendingNotes: 1,
    });
  });

  it('deleting a note removes its index job', async () => {
    const notes = (
      await request(app.getHttpServer())
        .get('/notes')
        .set('Authorization', token)
    ).body.data;
    await request(app.getHttpServer())
      .delete(`/notes/${notes[0].id}`)
      .set('Authorization', token)
      .expect(200);
    const status = (
      await request(app.getHttpServer())
        .get('/notes/index-status')
        .set('Authorization', token)
    ).body;
    expect(status.notes).toHaveLength(0);
  });
});
