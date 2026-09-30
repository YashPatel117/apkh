import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../common/schema/user';
import { EncryptionService } from '../common/utils/encryption.service';

export type LlmProvider =
  | 'free'
  | 'openrouter'
  | 'gemini'
  | 'openai'
  | 'anthropic';
/** Providers used with a user's own key (their models can be listed). */
export const LLM_PROVIDERS: LlmProvider[] = [
  'openrouter',
  'gemini',
  'openai',
  'anthropic',
];

/**
 * The free built-in AI: open-source models the host runs (apkh-search picks
 * them), used whenever a user has no active key of their own. On unless
 * FREE_AI=off.
 */
export const FREE_MODEL_ID = 'free';
export function freeAiEnabled(): boolean {
  return process.env.FREE_AI?.trim().toLowerCase() !== 'off';
}
const FREE_AI_SETTINGS: ActiveLlmSettings = {
  keyName: 'Free AI',
  apiKey: '',
  model: FREE_MODEL_ID,
  provider: 'free',
};

export interface ActiveLlmSettings {
  keyName: string;
  apiKey: string;
  model: string;
  provider: LlmProvider;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly encryption: EncryptionService,
  ) {}

  async create(name: string, email: string, password: string): Promise<User> {
    const newUser = new this.userModel({ name, email, password });
    return newUser.save();
  }

  async findOne(username: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: username }).exec();
  }

  async findOneById(userId: string): Promise<UserDocument | null> {
    return await this.userModel.findOne({ _id: userId }).exec();
  }

  async updatePassword(
    email: string,
    passwordHash: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findOneAndUpdate({ email }, { password: passwordHash }, { new: true })
      .exec();
  }

  /** Increment grand total + per-config tokens for the active config */
  async addTokenUsage(userId: string, tokens: number): Promise<void> {
    // Increment grand total
    await this.userModel
      .findByIdAndUpdate(userId, { $inc: { totalTokensUsed: tokens } })
      .exec();

    // Increment the active config's tokensUsed
    await this.userModel
      .updateOne(
        { _id: userId, 'llmConfigs.isActive': true },
        { $inc: { 'llmConfigs.$.tokensUsed': tokens } },
      )
      .exec();
  }

  /**
   * Add a new LLM config for a user. If keyName already exists, update it;
   * an empty apiKey then keeps the saved key (used to switch models).
   */
  async addLlmConfig(
    userId: string,
    keyName: string,
    apiKey: string | undefined,
    model: string,
    setActive: boolean,
  ): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new NotFoundException('User not found');

    // Check if keyName already exists → update in place
    const existing = user.llmConfigs.find((c) => c.keyName === keyName);
    if (existing) {
      if (apiKey) existing.llmApiKey = this.encryption.encrypt(apiKey);
      existing.llmModel = model;
    } else if (apiKey) {
      (user.llmConfigs as any[]).push({
        keyName,
        llmModel: model,
        llmApiKey: this.encryption.encrypt(apiKey),
        isActive: false,
        tokensUsed: 0,
        createdAt: new Date(),
      });
    } else {
      throw new BadRequestException('apiKey is required for a new config');
    }

    // Set active if requested — deactivate all others
    if (setActive) {
      user.llmConfigs.forEach((c) => {
        c.isActive = c.keyName === keyName;
      });
    }

    return user.save();
  }

  /** Set a specific config as active by keyName */
  async setActiveConfig(
    userId: string,
    keyName: string,
  ): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new NotFoundException('User not found');

    const target = user.llmConfigs.find((c) => c.keyName === keyName);
    if (!target) throw new BadRequestException(`Config "${keyName}" not found`);

    user.llmConfigs.forEach((c) => {
      c.isActive = c.keyName === keyName;
    });

    return user.save();
  }

  /** Switch to the free built-in AI: no saved config stays active. */
  async useFreeAi(userId: string): Promise<UserDocument> {
    if (!freeAiEnabled()) {
      throw new BadRequestException('The free AI is turned off on this server');
    }
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new NotFoundException('User not found');

    user.llmConfigs.forEach((c) => {
      c.isActive = false;
    });
    return user.save();
  }

  /** Delete a config by keyName */
  async deleteLlmConfig(
    userId: string,
    keyName: string,
  ): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new NotFoundException('User not found');

    const idx = user.llmConfigs.findIndex((c) => c.keyName === keyName);
    if (idx === -1)
      throw new BadRequestException(`Config "${keyName}" not found`);

    const wasActive = user.llmConfigs[idx].isActive;
    user.llmConfigs.splice(idx, 1);

    // If deleted config was active, activate the first remaining one
    if (wasActive && user.llmConfigs.length > 0) {
      user.llmConfigs[0].isActive = true;
    }

    return user.save();
  }

  /** Decrypted API key of a saved config (never sent to the frontend) */
  async getLlmConfigApiKey(userId: string, keyName: string): Promise<string> {
    const user = await this.userModel
      .findById(userId)
      .select('llmConfigs')
      .lean()
      .exec();
    if (!user) throw new NotFoundException('User not found');

    const config = user.llmConfigs?.find((c) => c.keyName === keyName);
    if (!config) throw new BadRequestException(`Config "${keyName}" not found`);

    return this.encryption.decrypt(config.llmApiKey);
  }

  /**
   * Provider of the active config (no key decryption); the free AI when no
   * config is active; null if neither is available or the model is unknown.
   */
  async getActiveProvider(userId: string): Promise<LlmProvider | null> {
    const user = await this.userModel
      .findById(userId)
      .select('llmConfigs.llmModel llmConfigs.isActive')
      .lean()
      .exec();
    const active = user?.llmConfigs?.find((config) => config.isActive);
    if (!active) {
      return user && freeAiEnabled() ? 'free' : null;
    }
    try {
      return this.detectProvider(active.llmModel);
    } catch {
      return null;
    }
  }

  /**
   * The active config's decrypted key + model (used internally for RAG), or
   * the free AI when no config is active.
   */
  async getActiveLlmSettings(
    userId: string,
  ): Promise<ActiveLlmSettings | null> {
    const user = await this.userModel
      .findById(userId)
      .select('llmConfigs')
      .lean()
      .exec();

    const active = user?.llmConfigs?.find((config) => config.isActive);
    if (!active) {
      return user && freeAiEnabled() ? FREE_AI_SETTINGS : null;
    }

    return {
      keyName: active.keyName,
      apiKey: this.encryption.decrypt(active.llmApiKey),
      model: active.llmModel,
      provider: this.detectProvider(active.llmModel),
    };
  }

  private detectProvider(model: string): LlmProvider {
    const normalized = model.toLowerCase();

    // OpenRouter ids are "author/model"; native Gemini, OpenAI and Claude ids never contain "/"
    if (normalized.includes('/')) {
      return 'openrouter';
    }

    if (normalized.startsWith('gemini')) {
      return 'gemini';
    }

    // gpt-*, chatgpt-* and the o-series (o1, o3, o4-mini, ...)
    if (/^(gpt|chatgpt|o\d)/.test(normalized)) {
      return 'openai';
    }

    if (normalized.startsWith('claude')) {
      return 'anthropic';
    }

    throw new BadRequestException(
      `Unsupported model "${model}". Choose an OpenRouter, Gemini, OpenAI or Claude model.`,
    );
  }
}
