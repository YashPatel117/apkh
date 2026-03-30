import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { CreateNoteDto } from './create-note.dto';

export class UpdateNoteDto extends PartialType(CreateNoteDto) {
  @ApiPropertyOptional({
    type: [String],
    description: 'IDs or names of files to remove',
  })
  @IsOptional()
  removedFiles?: string;
}
