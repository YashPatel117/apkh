import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { User } from 'src/common/schema/user';
import { EncryptionService } from 'src/common/utils/encryption.service';

describe('UsersService', () => {
  let service: UsersService;
  const userModel = { findById: jest.fn() };

  beforeEach(async () => {
    userModel.findById.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        EncryptionService,
        { provide: getModelToken(User.name), useValue: userModel },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  const mockConfigs = (llmConfigs: { llmModel: string; isActive: boolean }[]) =>
    userModel.findById.mockReturnValue({
      select: () => ({
        lean: () => ({ exec: () => Promise.resolve({ llmConfigs }) }),
      }),
    });

  it('reports the provider of the active config', async () => {
    mockConfigs([
      { llmModel: 'gemini-2.5-flash', isActive: false },
      { llmModel: 'gpt-4o-mini', isActive: true },
    ]);
    await expect(service.getActiveProvider('u1')).resolves.toBe('openai');
  });

  it('returns null without an active config or for an unknown model', async () => {
    mockConfigs([{ llmModel: 'gemini-2.5-flash', isActive: false }]);
    await expect(service.getActiveProvider('u1')).resolves.toBeNull();

    mockConfigs([{ llmModel: 'mystery-model', isActive: true }]);
    await expect(service.getActiveProvider('u1')).resolves.toBeNull();
  });
});
