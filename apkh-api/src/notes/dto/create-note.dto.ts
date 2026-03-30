import { ApiProperty } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';

export class CreateNoteDto {
  @ApiProperty()
  title: string;

  @ApiProperty()
  content: string;

  @ApiProperty()
  category: string;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    isArray: true,
    required: false,
  })
  @IsOptional()
  files?: Express.Multer.File[];
}
