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
  Inject,
  forwardRef,
} from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { UsersService } from './users.service';
import type { LlmProvider } from './users.service';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtTokenUserId } from 'src/common/decorator/jwt.decorator';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { UserDocument } from 'src/common/schema/user';
import { IndexingService } from 'src/indexing/indexing.service';

import { SEARCH_API } from 'src/common/constant/endpoint';

/** Either a new apiKey, or the keyName of a saved config whose key to reuse */
class LlmKeySourceDto {
  @IsString()
  @IsOptional()
  apiKey?: string;

  @IsString()
  @IsOptional()
  keyName?: string;
}

class TestLlmDto extends LlmKeySourceDto {
  @IsString()
  @IsNotEmpty()
  model!: string;
}

class ListLlmModelsDto extends LlmKeySourceDto {
  @IsIn(['gemini', 'openai', 'anthropic'])
  provider!: LlmProvider;
}

class AddLlmConfigDto {
  @IsString()
  @IsNotEmpty()
  keyName!: string;

  /** Optional when updating an existing config: the saved key is kept */
  @IsString()
  @IsOptional()
  apiKey?: string;

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
    @Inject(forwardRef(() => IndexingService))
    private readonly indexing: IndexingService,
  ) {}

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Get('/profile')
  async getProfile(@JwtTokenUserId() userId: string) {
    const user = await this.usersService.findOneById(userId);
    return user ? this.sanitizeUser(user) : null;
  }

  /** Test if the given API key + model combo works — does NOT save anything */
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Post('/llm-settings/test')
  @HttpCode(HttpStatus.OK)
  async testLlmSettings(
    @Headers('authorization') authHeader: string,
    @JwtTokenUserId() userId: string,
    @Body() body: TestLlmDto,
  ) {
    const apiKey = await this.resolveApiKey(userId, body);
    try {
      const res$ = this.httpService.post<{
        ok: boolean;
        error: string | null;
        provider?: string;
      }>(
        `${SEARCH_API}/ai-search/test`,
        { api_key: apiKey, model: body.model },
        { headers: { Authorization: authHeader } },
      );
      const res = await firstValueFrom(res$);
      return res.data;
    } catch {
      return { ok: false, error: 'Could not reach the search service.' };
    }
  }

  /** List the chat models the key can use, fetched live from the provider */
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Post('/llm-settings/models')
  @HttpCode(HttpStatus.OK)
  async listLlmModels(
    @Headers('authorization') authHeader: string,
    @JwtTokenUserId() userId: string,
    @Body() body: ListLlmModelsDto,
  ) {
    const apiKey = await this.resolveApiKey(userId, body);
    try {
      const res$ = this.httpService.post<{
        ok: boolean;
        error: string | null;
        models: { id: string; label: string }[];
      }>(
        `${SEARCH_API}/ai-search/models`,
        { provider: body.provider, api_key: apiKey },
        { headers: { Authorization: authHeader }, timeout: 30000 },
      );
      const res = await firstValueFrom(res$);
      return res.data;
    } catch {
      return {
        ok: false,
        error: 'Could not reach the search service.',
        models: [],
      };
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
    const previousProvider = await this.usersService.getActiveProvider(userId);
    const user = await this.usersService.addLlmConfig(
      userId,
      body.keyName,
      body.apiKey?.trim() || undefined,
      body.model,
      body.setActive ?? true,
    );
    await this.reindexIfProviderChanged(userId, previousProvider);
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
    const previousProvider = await this.usersService.getActiveProvider(userId);
    const user = await this.usersService.setActiveConfig(userId, keyName);
    await this.reindexIfProviderChanged(userId, previousProvider);
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
    const previousProvider = await this.usersService.getActiveProvider(userId);
    const user = await this.usersService.deleteLlmConfig(userId, keyName);
    await this.reindexIfProviderChanged(userId, previousProvider);
    return this.sanitizeUser(user);
  }

  /**
   * The index only needs work when the embedding provider changes (vectors
   * then move to the new provider's embedding space): the embedding model is
   * fixed per provider, so switching models within a provider or deleting an
   * inactive key changes nothing. Re-embedding reuses the stored chunk text, so
   * attachments are not downloaded or read again.
   */
  private async reindexIfProviderChanged(
    userId: string,
    previousProvider: LlmProvider | null,
  ) {
    const provider = await this.usersService.getActiveProvider(userId);
    if (provider && provider !== previousProvider) {
      await this.indexing.reconcileUser(userId, { force: true });
    }
  }

  /** Use the key typed in the form, else the saved key of the named config */
  private async resolveApiKey(
    userId: string,
    source: LlmKeySourceDto,
  ): Promise<string> {
    const apiKey = source.apiKey?.trim();
    if (apiKey) return apiKey;
    if (source.keyName) {
      return this.usersService.getLlmConfigApiKey(userId, source.keyName);
    }
    throw new BadRequestException('apiKey or keyName is required');
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
