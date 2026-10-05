import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { JwtTokenUserId } from 'src/common/decorator/jwt.decorator';
import { ApiResponseDto } from 'src/common/dto/api/response';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { AnalyticsService } from './analytics.service';

class DashboardQueryDto {
  @ApiPropertyOptional({ description: 'Days to cover (7–365), default 30' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(365)
  days?: number;

  @ApiPropertyOptional({ description: 'IANA time zone for daily totals' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tz?: string;
}

function validTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** The user's own usage: tokens over time, notes, top questions, cost */
  @Get()
  async dashboard(
    @JwtTokenUserId() userId: string,
    @Query() query: DashboardQueryDto,
  ) {
    return new ApiResponseDto().ok(
      await this.analytics.dashboard(
        userId,
        Number(query.days) || 30,
        validTimeZone(query.tz),
      ),
    );
  }
}
