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

  @ApiProperty({
    type: 'string',
    format: 'binary',
    isArray: true,
    required: false,
  })
  @IsOptional()
  files?: Express.Multer.File[];
}
