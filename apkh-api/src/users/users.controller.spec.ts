import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { HttpService } from '@nestjs/axios';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { IndexingService } from 'src/indexing/indexing.service';

describe('UsersController', () => {
  let controller: UsersController;
  const usersService = {
    getActiveProvider: jest.fn(),
    addLlmConfig: jest.fn(),
    setActiveConfig: jest.fn(),
    deleteLlmConfig: jest.fn(),
  };
  const indexing = { reconcileUser: jest.fn() };
  const userDoc = { toObject: () => ({ llmConfigs: [] }) };

  beforeEach(async () => {
    jest.clearAllMocks();
    usersService.addLlmConfig.mockResolvedValue(userDoc);
    usersService.setActiveConfig.mockResolvedValue(userDoc);
    usersService.deleteLlmConfig.mockResolvedValue(userDoc);
    indexing.reconcileUser.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        // AuthGuard on the controller needs it
        { provide: JwtService, useValue: {} },
        { provide: UsersService, useValue: usersService },
        { provide: HttpService, useValue: {} },
        { provide: IndexingService, useValue: indexing },
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

  it('re-embeds when the embedding provider changes', async () => {
    providersBeforeAndAfter('gemini', 'openai');
    await controller.activateLlmConfig('u1', 'work');
    expect(indexing.reconcileUser).toHaveBeenCalledWith('u1', { force: true });
  });

  it('indexes notes when the first config is added', async () => {
    providersBeforeAndAfter(null, 'gemini');
    await controller.addLlmConfig('u1', {
      keyName: 'k',
      apiKey: 'x',
      model: 'gemini-2.5-flash',
    });
    expect(indexing.reconcileUser).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a model switch within the same provider', async () => {
    providersBeforeAndAfter('openai', 'openai');
    await controller.addLlmConfig('u1', { keyName: 'k', model: 'gpt-4o' });
    expect(indexing.reconcileUser).not.toHaveBeenCalled();
  });

  it('does nothing when an inactive config is deleted', async () => {
    providersBeforeAndAfter('gemini', 'gemini');
    await controller.deleteLlmConfig('u1', 'old-key');
    expect(indexing.reconcileUser).not.toHaveBeenCalled();
  });

  it('does nothing when the last config is removed', async () => {
    providersBeforeAndAfter('gemini', null);
    await controller.deleteLlmConfig('u1', 'only-key');
    expect(indexing.reconcileUser).not.toHaveBeenCalled();
  });
});
