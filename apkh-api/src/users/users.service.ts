import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../common/schema/user';
import { EncryptionService } from '../common/utils/encryption.service';

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

  /** Add a new LLM config for a user. If keyName already exists, update it. */
  async addLlmConfig(
    userId: string,
    keyName: string,
    apiKey: string,
    model: string,
    setActive: boolean,
  ): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new NotFoundException('User not found');

    const encryptedKey = this.encryption.encrypt(apiKey);

    // Check if keyName already exists → update in place
    const existing = user.llmConfigs.find((c) => c.keyName === keyName);
    if (existing) {
      existing.llmApiKey = encryptedKey;
      existing.llmModel = model;
    } else {
      (user.llmConfigs as any[]).push({
        keyName,
        llmModel: model,
        llmApiKey: encryptedKey,
        isActive: false,
        tokensUsed: 0,
        createdAt: new Date(),
      });
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
  async setActiveConfig(userId: string, keyName: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new NotFoundException('User not found');

    const target = user.llmConfigs.find((c) => c.keyName === keyName);
    if (!target) throw new BadRequestException(`Config "${keyName}" not found`);

    user.llmConfigs.forEach((c) => {
      c.isActive = c.keyName === keyName;
    });

    return user.save();
  }

  /** Delete a config by keyName */
  async deleteLlmConfig(userId: string, keyName: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new NotFoundException('User not found');

    const idx = user.llmConfigs.findIndex((c) => c.keyName === keyName);
    if (idx === -1) throw new BadRequestException(`Config "${keyName}" not found`);

    const wasActive = user.llmConfigs[idx].isActive;
    user.llmConfigs.splice(idx, 1);

    // If deleted config was active, activate the first remaining one
    if (wasActive && user.llmConfigs.length > 0) {
      user.llmConfigs[0].isActive = true;
    }

    return user.save();
  }

  /** Get the active config's decrypted key + model (used internally for RAG) */
  async getLlmSettings(
    userId: string,
  ): Promise<{ apiKey: string | null; model: string }> {
    const user = await this.userModel
      .findById(userId)
      .select('llmConfigs')
      .lean()
      .exec();

    if (!user || !user.llmConfigs?.length) {
      return { apiKey: null, model: 'gemini-2.5-flash' };
    }

    const active =
      user.llmConfigs.find((c) => c.isActive) ?? user.llmConfigs[0];

    return {
      apiKey: this.encryption.decrypt(active.llmApiKey),
      model: active.llmModel,
    };
  }
}
