import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ChatSessionDocument = ChatSession & Document;

@Schema({ timestamps: true })
export class ChatSession {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ default: false })
  isChunked: boolean;

  /** Message count when the transcript was last chunked for search. */
  @Prop({ default: 0 })
  chunkedMessageCount: number;

  updatedAt: Date;
}

export const ChatSessionSchema = SchemaFactory.createForClass(ChatSession);
