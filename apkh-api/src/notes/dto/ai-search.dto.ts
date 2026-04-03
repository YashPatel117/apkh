import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsArray } from 'class-validator';

export class AiSearchDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  query: string;

  @ApiProperty({
    required: false,
    isArray: true,
    type: String,
    description: 'Optional array of note IDs to reference',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  referencedNoteIds?: string[];
}
