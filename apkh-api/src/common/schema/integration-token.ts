import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type IntegrationTokenDocument = IntegrationToken & Document;

/** What a token may do: add notes, and read / search them (AI assistants over MCP) */
export const TOKEN_SCOPES = ['notes:write', 'notes:read'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/** Tokens made before scopes existed could only add notes, and still can only do that. */
export const DEFAULT_TOKEN_SCOPES: TokenScope[] = ['notes:write'];

/**
 * A personal access token for adding notes from outside the app (webhooks,
 * Zapier/Make, the browser clipper) and, with `notes:read`, for reading and
 * searching them (the MCP server). Only its SHA-256 hash is stored; the
 * token itself is shown once, when it is created.
 */
@Schema({ timestamps: true, collection: 'integration_tokens' })
export class IntegrationToken {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({ required: true, maxlength: 60 })
  name: string;

  /** "token" (API / webhook / clipper) or "inbox" (email-to-note address) */
  @Prop({ required: true, enum: ['token', 'inbox'], default: 'token' })
  kind: 'token' | 'inbox';

  @Prop({ required: true, unique: true })
  secretHash: string;

  /** Token only; unset on tokens made before scopes (DEFAULT_TOKEN_SCOPES) */
  @Prop({ type: [String], enum: TOKEN_SCOPES, default: undefined })
  scopes?: TokenScope[];

  /** The first characters, to tell tokens apart in the list */
  @Prop({ required: true })
  prefix: string;

  /** Inbox only: the key of the address (it must stay visible to the user) */
  @Prop()
  inboxKey?: string;

  @Prop()
  lastUsedAt?: Date;

  createdAt: Date;
}

export const IntegrationTokenSchema =
  SchemaFactory.createForClass(IntegrationToken);
