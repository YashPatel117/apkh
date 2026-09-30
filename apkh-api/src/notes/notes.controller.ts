import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { NotesService } from './notes.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { AiSearchDto } from './dto/ai-search.dto';
import { ReindexDto } from './dto/reindex.dto';
import { SummaryQueryDto } from './dto/summary-query.dto';
import { IndexingService } from 'src/indexing/indexing.service';
import { SearchService } from 'src/search/search.service';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { ApiBearerAuth, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { JwtToken, JwtTokenUserId } from 'src/common/decorator/jwt.decorator';

@UseGuards(AuthGuard)
@ApiBearerAuth()
@Controller('notes')
export class NotesController {
  constructor(
    private readonly notesService: NotesService,
    private readonly searchService: SearchService,
    private readonly indexing: IndexingService,
  ) {}

  /** CREATE */
  @Post()
  @UseInterceptors(FilesInterceptor('files'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreateNoteDto })
  create(
    @JwtToken() token: string,
    @JwtTokenUserId() userId: string,
    @Body() createNoteDto: Omit<CreateNoteDto, 'files'>,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.notesService.create(token, userId, createNoteDto, files);
  }

  /** READ ALL */
  @Get()
  findAll(@JwtTokenUserId() userId: string) {
    return this.notesService.findAll(userId);
  }

  /** UPDATE */
  @Put(':id')
  @UseInterceptors(FilesInterceptor('files'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UpdateNoteDto })
  update(
    @JwtToken() token: string,
    @JwtTokenUserId() userId: string,
    @Param('id') id: string,
    @Body() updateNoteDto: UpdateNoteDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.notesService.update(token, userId, id, updateNoteDto, files);
  }

  /** DELETE */
  @Delete(':id')
  remove(
    @JwtToken() token: string,
    @JwtTokenUserId() userId: string,
    @Param('id') id: string,
  ) {
    return this.notesService.remove(token, userId, id);
  }

  /** GET LATEST UPDATED TIME */
  @Get('last-updated')
  getLastUpdated(@JwtTokenUserId() userId: string) {
    return this.notesService.getLastUpdated(userId);
  }

  @Get('search')
  searchNotes(
    @JwtTokenUserId() userId: string,
    @Query('search') search: string,
  ) {
    return this.notesService.searchNotes(userId, search);
  }

  /** SEARCH INDEX STATUS of every note (polled while indexing runs) */
  @Get('index-status')
  async indexStatus(@JwtTokenUserId() userId: string) {
    await this.indexing.reconcileUser(userId);
    return this.indexing.getStatus(userId);
  }

  /** REBUILD THE SEARCH INDEX of all notes */
  @Post('reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  async reindexAll(@JwtTokenUserId() userId: string, @Body() dto: ReindexDto) {
    await this.indexing.reindexAll(userId, { force: dto.force });
    return this.indexing.getStatus(userId);
  }

  /** RETRY notes (and attachments) that failed to index */
  @Post('index/retry-failed')
  @HttpCode(HttpStatus.ACCEPTED)
  async retryFailed(@JwtTokenUserId() userId: string) {
    await this.indexing.retryFailed(userId);
    return this.indexing.getStatus(userId);
  }

  /** AI SEARCH (RAG) */
  @Post('ai-search')
  @ApiBody({ type: AiSearchDto })
  async aiSearch(
    @JwtToken() token: string,
    @JwtTokenUserId() userId: string,
    @Body() aiSearchDto: AiSearchDto,
  ) {
    return this.searchService.performAiSearch(
      token,
      userId,
      aiSearchDto.query,
      5,
      aiSearchDto.referencedNoteIds,
    );
  }

  /** SUMMARY of a note: ?mode=brief (default) or ?mode=actions (action items first) */
  @Post(':id/summary')
  summarize(
    @JwtToken() token: string,
    @JwtTokenUserId() userId: string,
    @Param('id') id: string,
    @Query() query: SummaryQueryDto,
  ) {
    return this.notesService.summarize(token, userId, id, query.mode);
  }

  /** RE-INDEX one note */
  @Post(':id/reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  reindexNote(
    @JwtTokenUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: ReindexDto,
  ) {
    return this.notesService.reindex(userId, id, dto.force);
  }

  /** READ ONE */
  @Get(':id')
  findOne(@JwtTokenUserId() userId: string, @Param('id') id: string) {
    return this.notesService.findOne(userId, id);
  }
}
