import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/** A source of the AI answer the conversation continues from. */
export class ChatSourceDto {
  @IsOptional()
  @IsMongoId()
  noteId?: string;

  @IsString()
  noteTitle: string;

  @IsIn(['note', 'file'])
  sourceType: string;

  @IsOptional()
  @IsString()
  sourceName?: string;

  @IsOptional()
  @IsInt()
  sourcePage?: number;

  @IsString()
  excerpt: string;

  @IsOptional()
  @IsBoolean()
  cited?: boolean;
}

export class CreateSessionDto {
  @IsString()
  @IsNotEmpty()
  firstMessage: string;

  @IsString()
  @IsNotEmpty()
  aiResponse: string;

  /** Sources of `aiResponse`, so its citations keep working in the chat */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatSourceDto)
  sources?: ChatSourceDto[];
}
