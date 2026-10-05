import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { JwtTokenUserId } from 'src/common/decorator/jwt.decorator';
import { ApiResponseDto } from 'src/common/dto/api/response';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { UPLOAD_OPTIONS } from 'src/common/constant/upload';
import type { ExternalFormat } from './external-content';
import { IntegrationsService } from './integrations.service';

class CreateTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;
}

/** POST /integrations/notes — a note from a webhook, Zapier/Make or the clipper */
class ExternalNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @IsString()
  @MaxLength(2_000_000)
  content!: string;

  @IsOptional()
  @IsIn(['html', 'markdown', 'text'])
  format?: ExternalFormat;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  url?: string;
}

@ApiTags('Integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  // ── Managed from the app (signed-in user) ──────────────────────────────

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Get()
  async list(@JwtTokenUserId() userId: string) {
    return new ApiResponseDto().ok(await this.integrations.list(userId));
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Post('tokens')
  async createToken(
    @JwtTokenUserId() userId: string,
    @Body() dto: CreateTokenDto,
  ) {
    return new ApiResponseDto().ok(
      await this.integrations.createToken(userId, dto.name),
    );
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Delete('tokens/:id')
  async revokeToken(@JwtTokenUserId() userId: string, @Param('id') id: string) {
    return new ApiResponseDto().ok(
      await this.integrations.revokeToken(userId, id),
    );
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Post('inbox')
  async rotateInbox(@JwtTokenUserId() userId: string) {
    return new ApiResponseDto().ok(await this.integrations.rotateInbox(userId));
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Delete('inbox')
  async removeInbox(@JwtTokenUserId() userId: string) {
    return new ApiResponseDto().ok(await this.integrations.removeInbox(userId));
  }

  // ── Called from outside (integration token / inbox key) ────────────────

  /**
   * Create a note. Authenticate with `Authorization: Bearer apkh_…` or
   * `X-API-Key: apkh_…` (a token from Profile → Integrations).
   */
  @Post('notes')
  @HttpCode(HttpStatus.CREATED)
  async addNote(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-api-key') apiKey: string | undefined,
    @Body() dto: ExternalNoteDto,
  ) {
    const secret = apiKey?.trim() || authorization?.replace(/^Bearer\s+/i, '');
    const userId = await this.integrations.userForToken(secret);
    const created = await this.integrations.addNote(userId, {
      ...dto,
      format: dto.format ?? 'html',
    });
    return { id: created.data.id, title: created.data.title };
  }

  /**
   * Email-to-note: point an email provider's inbound webhook here (Mailgun,
   * SendGrid Inbound Parse, Postmark, a Cloudflare Email Worker…). The
   * subject becomes the title and the body the note, in "Email".
   */
  @Post('email/:key')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(AnyFilesInterceptor(UPLOAD_OPTIONS))
  async inboundEmail(
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
  ) {
    const userId = await this.integrations.userForInbox(key);
    const field = (...names: string[]) => {
      for (const name of names) {
        const value = body?.[name];
        if (typeof value === 'string' && value.trim()) return value;
      }
      return '';
    };
    const subject = field('subject', 'Subject');
    const from = field('from', 'From', 'sender', 'FromFull');
    const html = field('html', 'HtmlBody', 'body-html', 'stripped-html');
    const text = field('text', 'TextBody', 'stripped-text', 'body-plain', 'plain');
    if (!html && !text) throw new BadRequestException('The email has no body.');

    const created = await this.integrations.addNote(userId, {
      title: subject || (from ? `Email from ${from}` : 'Email'),
      content: html || text,
      format: html ? 'html' : 'text',
      category: 'Email',
    });
    return { id: created.data.id };
  }
}
