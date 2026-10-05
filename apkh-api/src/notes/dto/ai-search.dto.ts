import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class AiSearchDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @MaxLength(4000)
  query: string;

  @ApiProperty({
    required: false,
    isArray: true,
    type: String,
    description: 'Optional array of note IDs to reference',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  referencedNoteIds?: string[];
}
