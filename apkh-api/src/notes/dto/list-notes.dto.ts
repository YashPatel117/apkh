import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsMongoId } from 'class-validator';

/** GET /notes: without `limit`, every note (older clients); with it, one page. */
export class ListNotesDto {
  @ApiPropertyOptional({ description: 'Notes per page (1–200)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'nextCursor of the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({ description: 'Words to find in title, category or text' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  category?: string;

  @ApiPropertyOptional({ description: 'A folder id, or "root" for unfiled notes' })
  @IsOptional()
  @ValidateIf((_, value) => value !== 'root')
  @IsMongoId()
  folderId?: string;
}

export class ExportNoteDto {
  @ApiPropertyOptional({ enum: ['md', 'zip'] })
  @IsOptional()
  @IsIn(['md', 'zip'])
  format?: 'md' | 'zip';
}

export class MoveNoteDto {
  /** null takes the note out of every folder */
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsMongoId()
  folderId!: string | null;
}
