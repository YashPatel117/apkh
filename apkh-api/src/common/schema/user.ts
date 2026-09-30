import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ _id: false })
export class LlmConfig {
  @Prop({ required: true })
  keyName: string; // user-given display name e.g. "My GPT-4o Key"

  @Prop({ required: true })
  llmModel: string; // e.g. "gpt-4o"

  @Prop({ required: true })
  llmApiKey: string; // AES-256-GCM encrypted

  @Prop({ default: false })
  isActive: boolean; // only one should be true at a time

  @Prop({ default: 0 })
  tokensUsed: number; // tokens consumed using this specific config

  @Prop({ default: () => new Date() })
  createdAt: Date;
}

export const LlmConfigSchema = SchemaFactory.createForClass(LlmConfig);

/** Built-in AI usage: all-time, and in the current session (see users/plans.ts). */
@Schema({ _id: false })
export class BuiltinUsage {
  @Prop({ default: 0 })
  totalTokens: number;

  @Prop()
  sessionStartedAt?: Date;

  @Prop({ default: 0 })
  sessionTokens: number;
}

export const BuiltinUsageSchema = SchemaFactory.createForClass(BuiltinUsage);

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop()
  password: string;

  @Prop({ default: 'free' })
  type: string; // plan: "free" or "pro" (set with `npm run plan:set`)

  @Prop({ default: 0 })
  totalTokensUsed: number; // grand total across all configs and the built-in AI

  @Prop({ type: [LlmConfigSchema], default: [] })
  llmConfigs: LlmConfig[];

  @Prop({ type: BuiltinUsageSchema, default: () => ({}) })
  builtinUsage: BuiltinUsage;
}

export const UserSchema = SchemaFactory.createForClass(User);
