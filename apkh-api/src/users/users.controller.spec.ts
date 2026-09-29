import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { HttpService } from '@nestjs/axios';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { SearchService } from 'src/search/search.service';

describe('UsersController', () => {
  let controller: UsersController;
  const usersService = {
    getActiveProvider: jest.fn(),
    addLlmConfig: jest.fn(),
    setActiveConfig: jest.fn(),
    deleteLlmConfig: jest.fn(),
  };
  const searchService = {
    triggerUserReindex: jest.fn(),
    supportsSemanticSearch: (provider: string) =>
      provider === 'gemini' || provider === 'openai',
  };
  const userDoc = { toObject: () => ({ llmConfigs: [] }) };

  beforeEach(async () => {
    jest.clearAllMocks();
    usersService.addLlmConfig.mockResolvedValue(userDoc);
    usersService.setActiveConfig.mockResolvedValue(userDoc);
    usersService.deleteLlmConfig.mockResolvedValue(userDoc);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        // AuthGuard on the controller needs it
        { provide: JwtService, useValue: {} },
        { provide: UsersService, useValue: usersService },
        { provide: HttpService, useValue: {} },
        { provide: SearchService, useValue: searchService },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  const providersBeforeAndAfter = (
    before: string | null,
    after: string | null,
  ) =>
    usersService.getActiveProvider
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);

  it('reindexes when the embedding provider changes', async () => {
    providersBeforeAndAfter('gemini', 'openai');
    await controller.activateLlmConfig('Bearer t', 'u1', 'work');
    expect(searchService.triggerUserReindex).toHaveBeenCalledWith(
      'Bearer t',
      'u1',
    );
  });

  it('reindexes when the first config is added', async () => {
    providersBeforeAndAfter(null, 'gemini');
    await controller.addLlmConfig('Bearer t', 'u1', {
      keyName: 'k',
      apiKey: 'x',
      model: 'gemini-2.5-flash',
    });
    expect(searchService.triggerUserReindex).toHaveBeenCalledTimes(1);
  });

  it('does not reindex for a model switch within the same provider', async () => {
    providersBeforeAndAfter('openai', 'openai');
    await controller.addLlmConfig('Bearer t', 'u1', {
      keyName: 'k',
      model: 'gpt-4o',
    });
    expect(searchService.triggerUserReindex).not.toHaveBeenCalled();
  });

  it('does not reindex when an inactive config is deleted', async () => {
    providersBeforeAndAfter('gemini', 'gemini');
    await controller.deleteLlmConfig('Bearer t', 'u1', 'old-key');
    expect(searchService.triggerUserReindex).not.toHaveBeenCalled();
  });

  it('does not reindex for a provider without embeddings', async () => {
    providersBeforeAndAfter('gemini', 'anthropic');
    await controller.activateLlmConfig('Bearer t', 'u1', 'claude');
    expect(searchService.triggerUserReindex).not.toHaveBeenCalled();
  });
});
