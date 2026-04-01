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

@Schema()
export class User {
  @Prop({ required: true })
  name: string;

  @Prop()
  email: string;

  @Prop()
  password: string;

  @Prop({ default: 'free' })
  type: string;

  @Prop({ default: 0 })
  totalTokensUsed: number; // grand total across all configs

  @Prop({ type: [LlmConfigSchema], default: [] })
  llmConfigs: LlmConfig[];
}

export const UserSchema = SchemaFactory.createForClass(User);
