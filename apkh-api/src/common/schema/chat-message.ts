import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type ChatMessageDocument = ChatMessage & Document;

/** A note passage an assistant answer was given, cited in it as [n] (n = position + 1). */
@Schema({ _id: false })
export class ChatSource {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Note' })
  noteId?: Types.ObjectId;

  @Prop({ required: true })
  noteTitle: string;

  @Prop({ required: true, enum: ['note', 'file'] })
  sourceType: string;

  @Prop()
  sourceName?: string;

  @Prop()
  sourcePage?: number;

  /** The start of the passage (enough to show it and find it in the note) */
  @Prop({ required: true })
  excerpt: string;

  @Prop({ default: false })
  cited: boolean;
}

export const ChatSourceSchema = SchemaFactory.createForClass(ChatSource);

@Schema({ timestamps: true })
export class ChatMessage {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'ChatSession',
    required: true,
    index: true,
  })
  sessionId: Types.ObjectId;

  @Prop({ required: true, enum: ['user', 'assistant'] })
  role: string;

  @Prop({ required: true })
  content: string;

  /** Assistant messages: the note passages the answer drew on */
  @Prop({ type: [ChatSourceSchema], default: undefined })
  sources?: ChatSource[];

  createdAt: string;
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);
