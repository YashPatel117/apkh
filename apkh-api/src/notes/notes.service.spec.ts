import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { NotesService } from './notes.service';
import { Note } from 'src/common/schema/note';
import { Summary } from 'src/common/schema/summary';
import { FileService } from 'src/file/file.service';
import { SearchService } from 'src/search/search.service';
import { IndexingService } from 'src/indexing/indexing.service';

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

describe('NotesService.summarize', () => {
  const noteId = new Types.ObjectId().toHexString();
  const userId = new Types.ObjectId().toHexString();
  const actions = {
    tasks: [{ task: 'Ship', owner: null, due: 'Friday', done: false }],
    decisions: [],
    deadlines: [],
    people: [],
  };
  let service: NotesService;
  const noteModel = { findOne: jest.fn() };
  const summaryModel = { findOne: jest.fn(), findOneAndUpdate: jest.fn() };
  const searchService = { generateNoteSummary: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    noteModel.findOne.mockReturnValue(
      query({ _id: noteId, title: 'T', content: '<p>x</p>', category: 'C' }),
    );
    summaryModel.findOne.mockReturnValue(query(null));
    summaryModel.findOneAndUpdate.mockResolvedValue({
      updatedAt: new Date('2026-09-30'),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotesService,
        { provide: getModelToken(Note.name), useValue: noteModel },
        { provide: getModelToken(Summary.name), useValue: summaryModel },
        {
          provide: FileService,
          useValue: { getNoteFiles: () => Promise.resolve({ files: [] }) },
        },
        { provide: SearchService, useValue: searchService },
        { provide: IndexingService, useValue: {} },
      ],
    }).compile();
    service = module.get(NotesService);
  });

  it('caches each mode separately', async () => {
    searchService.generateNoteSummary.mockResolvedValue({
      summary: 'Sprint plan.',
      actions,
      model: 'gpt-4o-mini',
      cacheable: true,
    });

    const result = await service.summarize(
      'Bearer t',
      userId,
      noteId,
      'actions',
    );

    expect(result.data).toMatchObject({
      mode: 'actions',
      actions,
      cached: false,
    });
    expect(summaryModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'actions' }),
    );
    expect(summaryModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'actions' }),
      {
        $set: { summary: 'Sprint plan.', actions, summaryModel: 'gpt-4o-mini' },
      },
      { upsert: true, new: true },
    );
  });

  it('returns a cached action list without calling the model', async () => {
    summaryModel.findOne.mockReturnValue(
      query({ summary: '', actions, summaryModel: 'm', updatedAt: new Date() }),
    );
    const result = await service.summarize(
      'Bearer t',
      userId,
      noteId,
      'actions',
    );
    expect(result.data).toMatchObject({ cached: true, actions });
    expect(searchService.generateNoteSummary).not.toHaveBeenCalled();
  });

  it('does not cache failures', async () => {
    searchService.generateNoteSummary.mockResolvedValue({
      summary: 'The model is no longer available.',
      actions: null,
      model: null,
      cacheable: false,
    });
    const result = await service.summarize('Bearer t', userId, noteId);
    expect(result.data).toMatchObject({ mode: 'brief', cached: false });
    expect(summaryModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
