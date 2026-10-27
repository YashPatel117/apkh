import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { JwtTokenUserId } from 'src/common/decorator/jwt.decorator';
import { ApiResponseDto } from 'src/common/dto/api/response';
import { AuthGuard } from 'src/common/guard/auth.guard';
import {
  FEEDBACK_KINDS,
  type FeedbackKind,
} from 'src/common/schema/answer-feedback';
import { FeedbackService } from './feedback.service';

class FeedbackDto {
  @ApiProperty({ enum: FEEDBACK_KINDS })
  @IsIn(FEEDBACK_KINDS)
  kind!: FeedbackKind;

  @ApiProperty({ description: 'A chat message id, or a hash of the answer' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  answerKey!: string;

  @ApiProperty()
  @IsBoolean()
  helpful!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  query?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  answer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  comment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sourceCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sessionId?: string;
}

/** Helpful / not helpful votes on AI answers. */
@ApiTags('Feedback')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async vote(@JwtTokenUserId() userId: string, @Body() dto: FeedbackDto) {
    return new ApiResponseDto().ok(await this.feedback.vote(userId, dto));
  }
}
