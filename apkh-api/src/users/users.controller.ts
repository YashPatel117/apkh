/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Headers,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { UsersService } from './users.service';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtTokenUserId } from 'src/common/decorator/jwt.decorator';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { UserDocument } from 'src/common/schema/user';

const SEARCH_API = 'http://localhost:8000';

class TestLlmDto {
  @IsString()
  @IsNotEmpty()
  apiKey!: string;

  @IsString()
  @IsNotEmpty()
  model!: string;
}

class AddLlmConfigDto {
  @IsString()
  @IsNotEmpty()
  keyName!: string;

  @IsString()
  @IsNotEmpty()
  apiKey!: string;

  @IsString()
  @IsNotEmpty()
  model!: string;

  @IsBoolean()
  @IsOptional()
  setActive?: boolean;
}

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly httpService: HttpService,
  ) {}

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Get('/profile')
  async getProfile(@JwtTokenUserId() userId: string) {
    return await this.usersService.findOneById(userId);
  }

  /** Test if the given API key + model combo works — does NOT save anything */
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Post('/llm-settings/test')
  @HttpCode(HttpStatus.OK)
  async testLlmSettings(
    @Headers('authorization') authHeader: string,
    @Body() body: TestLlmDto,
  ) {
    if (!body.apiKey || !body.model) {
      throw new BadRequestException('apiKey and model are required');
    }
    try {
      const res$ = this.httpService.post<{
        ok: boolean;
        error: string | null;
        provider?: string;
      }>(
        `${SEARCH_API}/ai-search/test`,
        { api_key: body.apiKey, model: body.model },
        { headers: { Authorization: authHeader } },
      );
      const res = await firstValueFrom(res$);
      return res.data;
    } catch {
      return { ok: false, error: 'Could not reach the search service.' };
    }
  }

  /** Add (or update) a named LLM config for the user */
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Post('/llm-configs')
  async addLlmConfig(
    @JwtTokenUserId() userId: string,
    @Body() body: AddLlmConfigDto,
  ) {
    const user = await this.usersService.addLlmConfig(
      userId,
      body.keyName,
      body.apiKey,
      body.model,
      body.setActive ?? true,
    );
    return this.sanitizeUser(user);
  }

  /** Set a config as the active one */
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Patch('/llm-configs/:keyName/activate')
  async activateLlmConfig(
    @JwtTokenUserId() userId: string,
    @Param('keyName') keyName: string,
  ) {
    const user = await this.usersService.setActiveConfig(userId, keyName);
    return this.sanitizeUser(user);
  }

  /** Delete a named config */
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Delete('/llm-configs/:keyName')
  async deleteLlmConfig(
    @JwtTokenUserId() userId: string,
    @Param('keyName') keyName: string,
  ) {
    const user = await this.usersService.deleteLlmConfig(userId, keyName);
    return this.sanitizeUser(user);
  }

  /** Strip encrypted keys before sending to frontend */
  private sanitizeUser(user: UserDocument) {
    const obj = user.toObject();
    obj.llmConfigs = obj.llmConfigs.map(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ({ llmApiKey: _k, ...rest }) => rest,
    );
    return obj;
  }
}
