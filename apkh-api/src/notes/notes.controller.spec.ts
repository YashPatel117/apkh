import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { SearchService } from 'src/search/search.service';
import { IndexingService } from 'src/indexing/indexing.service';

describe('NotesController', () => {
  let controller: NotesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotesController],
      providers: [
        // AuthGuard on the controller needs it
        { provide: JwtService, useValue: {} },
        { provide: NotesService, useValue: {} },
        { provide: SearchService, useValue: {} },
        { provide: IndexingService, useValue: {} },
      ],
    }).compile();

    controller = module.get<NotesController>(NotesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
