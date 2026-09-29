import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotesService } from './notes.service';
import { Note } from 'src/common/schema/note';
import { Summary } from 'src/common/schema/summary';
import { FileService } from 'src/file/file.service';
import { SearchService } from 'src/search/search.service';
import { IndexingService } from 'src/indexing/indexing.service';

describe('NotesService', () => {
  let service: NotesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotesService,
        { provide: getModelToken(Note.name), useValue: {} },
        { provide: getModelToken(Summary.name), useValue: {} },
        { provide: FileService, useValue: {} },
        { provide: SearchService, useValue: {} },
        { provide: IndexingService, useValue: {} },
      ],
    }).compile();

    service = module.get<NotesService>(NotesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
