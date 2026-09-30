import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { SUMMARY_MODES } from 'src/common/schema/summary';
import type { SummaryMode } from 'src/common/schema/summary';

export class SummaryQueryDto {
  @ApiPropertyOptional({
    enum: SUMMARY_MODES,
    description: 'brief (default) or actions (action items first)',
  })
  @IsOptional()
  @IsIn(SUMMARY_MODES)
  mode?: SummaryMode;
}
