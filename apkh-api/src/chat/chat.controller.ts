import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { sendSse } from 'src/common/utils/sse';
import { ChatService } from './chat.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtToken, JwtTokenUserId } from 'src/common/decorator/jwt.decorator';
import { ApiResponseDto } from 'src/common/dto/api/response';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('session')
  async createSession(
    @JwtTokenUserId() userId: string,
    @Body() dto: CreateSessionDto,
  ) {
    const data = await this.chatService.createSession(userId, dto);
    return new ApiResponseDto().ok(data);
  }

  @Get('sessions')
  async listSessions(@JwtTokenUserId() userId: string) {
    const data = await this.chatService.listSessions(userId);
    return new ApiResponseDto().ok(data);
  }

  @Get('session/:id')
  async getSessionMessages(
    @JwtTokenUserId() userId: string,
    @Param('id') sessionId: string,
  ) {
    const data = await this.chatService.getSessionMessages(userId, sessionId);
    return new ApiResponseDto().ok(data);
  }

  @Delete('session/:id')
  async deleteSession(
    @JwtTokenUserId() userId: string,
    @Param('id') sessionId: string,
  ) {
    const data = await this.chatService.deleteSession(userId, sessionId);
    return new ApiResponseDto().ok(data);
  }

  @Post('session/:id/message')
  async sendMessage(
    @JwtToken() token: string,
    @JwtTokenUserId() userId: string,
    @Param('id') sessionId: string,
    @Body() dto: SendMessageDto,
  ) {
    const data = await this.chatService.sendMessage(
      token,
      userId,
      sessionId,
      dto,
    );
    return new ApiResponseDto().ok(data);
  }

  /** SEND MESSAGE, streamed as server-sent events (see ChatService.sendMessageStream) */
  @Post('session/:id/message/stream')
  async sendMessageStream(
    @JwtToken() token: string,
    @JwtTokenUserId() userId: string,
    @Param('id') sessionId: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ) {
    const abort = new AbortController();
    await sendSse(
      res,
      this.chatService.sendMessageStream(
        token,
        userId,
        sessionId,
        dto.message,
        abort.signal,
      ),
      abort,
    );
  }
}
