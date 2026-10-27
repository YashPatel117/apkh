import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';

export class CreateNoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  title?: string;

  @ApiProperty()
  content: string;

  @ApiPropertyOptional()
  @IsOptional()
  category?: string;

  /** Tags: a JSON list or "a, b" (multipart forms send strings) */
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  tags?: string | string[];

  /** Folder to file the note in; empty for none */
  @ApiPropertyOptional()
  @IsOptional()
  folderId?: string;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    isArray: true,
    required: false,
  })
  @IsOptional()
  files?: Express.Multer.File[];
}
