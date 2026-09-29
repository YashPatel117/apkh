import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ReindexDto {
  @ApiPropertyOptional({
    description:
      'Download and read every attachment again instead of reusing what was extracted before',
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
