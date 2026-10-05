import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BuiltinUsage, User, UserDocument } from '../common/schema/user';
import { Voucher, VoucherDocument } from '../common/schema/voucher';
import {
  UsageEvent,
  UsageEventDocument,
  type UsageKind,
} from '../common/schema/usage-event';
import { RealtimeService } from '../realtime/realtime.service';
import { EncryptionService } from '../common/utils/encryption.service';
import { planDetails, planOf, sessionHours, type PlanId } from './plans';

export type LlmProvider =
  | 'builtin'
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
 * The built-in AI: open-source models the host runs (apkh-search picks them),
 * used whenever a user has no active key of their own, within their plan's
 * allowance (see plans.ts). On unless BUILTIN_AI=off.
 */
export const BUILTIN_MODEL_ID = 'builtin';
export function builtinAiEnabled(): boolean {
  return process.env.BUILTIN_AI?.trim().toLowerCase() !== 'off';
}

export interface ActiveLlmSettings {
  keyName: string;
  apiKey: string;
  model: string;
  provider: LlmProvider;
  /** The user's plan; decides queue priority on the built-in AI */
  plan: PlanId;
}

/** A user's built-in AI allowance in the current session. */
export interface BuiltinAllowance {
  used: number;
  limit: number;
  /** When the session ends; null before the first counted request */
  resetsAt: Date | null;
  exhausted: boolean;
}

export function builtinAllowance(
  usage: Partial<BuiltinUsage> | undefined,
  plan: PlanId,
  now = new Date(),
): BuiltinAllowance {
  const limit = planDetails(plan).sessionTokens;
  const started = usage?.sessionStartedAt
    ? new Date(usage.sessionStartedAt)
    : null;
  const resetsAt = started
    ? new Date(started.getTime() + sessionHours() * 3_600_000)
    : null;
  const active = resetsAt !== null && resetsAt > now;
  const used = active ? (usage?.sessionTokens ?? 0) : 0;
  return {
    used,
    limit,
    resetsAt: active ? resetsAt : null,
    exhausted: used >= limit,
  };
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly encryption: EncryptionService,
    @InjectModel(Voucher.name)
    private readonly voucherModel: Model<VoucherDocument>,
    @InjectModel(UsageEvent.name)
    private readonly usageModel: Model<UsageEventDocument>,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Move a user to Pro with a one-time voucher code. The code is claimed
   * atomically, so it can't be used twice even by simultaneous requests;
   * users already on Pro don't use one up.
   */
  async redeemVoucher(userId: string, input: string): Promise<UserDocument> {
    const code = normalizeVoucherCode(input);
    if (!code) {
      throw new BadRequestException(
        'Enter the 8-character code, for example ABCD-2345.',
      );
    }
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new NotFoundException('User not found');
    if (planOf(user.type) === 'pro') {
      throw new BadRequestException("You're already on the Pro plan.");
    }

    const voucher = await this.voucherModel
      .findOneAndUpdate(
        { code, redeemed: false },
        {
          $set: {
            redeemed: true,
            redeemedAt: new Date(),
            redeemedBy: user._id,
          },
        },
      )
      .exec();
    if (!voucher) {
      const used = await this.voucherModel.exists({ code });
      throw new BadRequestException(
        used
          ? 'This code has already been used.'
          : "This code isn't valid. Check it and try again.",
      );
    }

    user.type = 'pro';
    return user.save();
  }

  /** Without a password for accounts that only sign in with Google. */
  async create(
    name: string,
    email: string,
    password?: string,
  ): Promise<UserDocument> {
    const newUser = new this.userModel({ name, email, password });
    return newUser.save();
  }

  async findOne(username: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: username }).exec();
  }

  /** Emails differ in case between providers and what people typed at sign-up. */
  async findOneByEmailIgnoringCase(
    email: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email })
      .collation({ locale: 'en', strength: 2 })
      .exec();
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

  /**
   * Record tokens a request used: in the grand total, and in the active
   * config's count or, on the built-in AI, its usage. `interactive` requests
   * (questions, chat, summaries) also count toward the plan's session
   * allowance; indexing doesn't.
   */
  async addTokenUsage(
    userId: string,
    tokens: number,
    llm: ActiveLlmSettings,
    options: { interactive: boolean; kind: UsageKind; query?: string },
  ): Promise<void> {
    // Every request is recorded for the usage dashboard, even when the
    // provider reported no tokens.
    await this.usageModel.create({
      userId: new Types.ObjectId(userId),
      kind: options.kind,
      provider: llm.provider,
      model: llm.model,
      tokens: Math.max(0, tokens),
      query: options.query?.trim().slice(0, 200) || undefined,
    });
    if (tokens <= 0) return;
    if (options.interactive) this.realtime.emit(userId, 'profile:changed');
    if (llm.provider === 'builtin') {
      await this.addBuiltinUsage(userId, tokens, options.interactive);
      return;
    }

    await this.userModel
      .findByIdAndUpdate(userId, { $inc: { totalTokensUsed: tokens } })
      .exec();
    await this.userModel
      .updateOne(
        { _id: userId, 'llmConfigs.isActive': true },
        { $inc: { 'llmConfigs.$.tokensUsed': tokens } },
      )
      .exec();
  }

  /**
   * One atomic update: a counted request after the session ended starts a
   * new session with its own tokens.
   */
  private async addBuiltinUsage(
    userId: string,
    tokens: number,
    interactive: boolean,
  ) {
    const now = new Date();
    const sessionStartCutoff = new Date(
      now.getTime() - sessionHours() * 3_600_000,
    );
    const sessionOver = {
      $or: [
        { $not: ['$builtinUsage.sessionStartedAt'] },
        { $lte: ['$builtinUsage.sessionStartedAt', sessionStartCutoff] },
      ],
    };
    const add = (field: string) => ({
      $add: [{ $ifNull: [field, 0] }, tokens],
    });
    await this.userModel
      .updateOne({ _id: new Types.ObjectId(userId) }, [
        {
          $set: {
            totalTokensUsed: add('$totalTokensUsed'),
            'builtinUsage.totalTokens': add('$builtinUsage.totalTokens'),
            ...(interactive && {
              'builtinUsage.sessionStartedAt': {
                $cond: [sessionOver, now, '$builtinUsage.sessionStartedAt'],
              },
              'builtinUsage.sessionTokens': {
                $cond: [
                  sessionOver,
                  tokens,
                  add('$builtinUsage.sessionTokens'),
                ],
              },
            }),
          },
        },
      ])
      .exec();
  }

  /**
   * Why an interactive request can't use the built-in AI right now (the plan's
   * session allowance is used up), or null if it can. Own keys always can.
   */
  async builtinLimitMessage(
    userId: string,
    llm: ActiveLlmSettings,
  ): Promise<string | null> {
    if (llm.provider !== 'builtin') return null;
    const user = await this.userModel
      .findById(userId)
      .select('builtinUsage')
      .lean()
      .exec();
    const allowance = builtinAllowance(user?.builtinUsage, llm.plan);
    if (!allowance.exhausted) return null;

    const plan = planDetails(llm.plan);
    const resets = allowance.resetsAt
      ? ` It resets in ${timeUntil(allowance.resetsAt)}.`
      : '';
    const next =
      plan.id === 'pro'
        ? 'Add your own AI key in Profile to keep going now.'
        : 'Upgrade to Pro for a larger allowance, or add your own AI key in Profile to keep going now.';
    return `You've used this session's built-in AI allowance on the ${plan.label} plan (${plan.sessionTokens.toLocaleString('en-US')} tokens).${resets} ${next}`;
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

  /** Switch to the built-in AI: no saved config stays active. */
  async useBuiltinAi(userId: string): Promise<UserDocument> {
    if (!builtinAiEnabled()) {
      throw new BadRequestException(
        'The built-in AI is turned off on this server',
      );
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

    return this.decryptApiKey(config.keyName, config.llmApiKey);
  }

  /**
   * A saved key can't be decrypted when it was saved under a different
   * ENCRYPTION_SECRET (the secret changed, or another server shares the
   * database): the user has to enter the key again.
   */
  private decryptApiKey(keyName: string, encrypted: string): string {
    try {
      return this.encryption.decrypt(encrypted);
    } catch {
      throw new BadRequestException(
        `Your saved AI key "${keyName}" can't be read on this server. Enter the key again in Profile.`,
      );
    }
  }

  /**
   * Provider of the active config (no key decryption); the built-in AI when
   * no config is active; null if neither is available or the model is unknown.
   */
  async getActiveProvider(userId: string): Promise<LlmProvider | null> {
    const user = await this.userModel
      .findById(userId)
      .select('llmConfigs.llmModel llmConfigs.isActive')
      .lean()
      .exec();
    const active = user?.llmConfigs?.find((config) => config.isActive);
    if (!active) {
      return user && builtinAiEnabled() ? 'builtin' : null;
    }
    try {
      return this.detectProvider(active.llmModel);
    } catch {
      return null;
    }
  }

  /**
   * The active config's decrypted key + model (used internally for RAG), or
   * the built-in AI when no config is active.
   */
  async getActiveLlmSettings(
    userId: string,
  ): Promise<ActiveLlmSettings | null> {
    const user = await this.userModel
      .findById(userId)
      .select('llmConfigs type')
      .lean()
      .exec();
    if (!user) {
      return null;
    }

    const plan = planOf(user.type);
    const active = user.llmConfigs?.find((config) => config.isActive);
    if (!active) {
      return builtinAiEnabled()
        ? {
            keyName: 'Built-in AI',
            apiKey: '',
            model: BUILTIN_MODEL_ID,
            provider: 'builtin',
            plan,
          }
        : null;
    }

    return {
      keyName: active.keyName,
      apiKey: this.decryptApiKey(active.keyName, active.llmApiKey),
      model: active.llmModel,
      provider: this.detectProvider(active.llmModel),
      plan,
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

/** "abcd 2345" / "ABCD2345" -> "ABCD-2345"; null unless it is 8 letters and digits. */
function normalizeVoucherCode(input: string): string | null {
  const chars = (input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return chars.length === 8 ? `${chars.slice(0, 4)}-${chars.slice(4)}` : null;
}

/** "2 h 15 min" / "40 min" until a moment (the server doesn't know the user's time zone). */
function timeUntil(moment: Date): string {
  const minutes = Math.max(
    1,
    Math.ceil((moment.getTime() - Date.now()) / 60_000),
  );
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
