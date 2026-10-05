import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Query,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { sendSse } from 'src/common/utils/sse';
import { NotesService } from './notes.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { AiSearchDto } from './dto/ai-search.dto';
import { ReindexDto } from './dto/reindex.dto';
import { SummaryQueryDto } from './dto/summary-query.dto';
import { ExportNoteDto, ListNotesDto, MoveNoteDto } from './dto/list-notes.dto';
import { IndexingService } from 'src/indexing/indexing.service';
import { SearchService } from 'src/search/search.service';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { ApiBearerAuth, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { JwtToken, JwtTokenUserId } from 'src/common/decorator/jwt.decorator';
import {
  MAX_FILES_PER_UPLOAD,
  UPLOAD_OPTIONS,
} from 'src/common/constant/upload';

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
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_UPLOAD, UPLOAD_OPTIONS),
  )
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

  /** READ: one page with `limit` (filters: q, category, folderId), else every note */
  @Get()
  findAll(@JwtTokenUserId() userId: string, @Query() query: ListNotesDto) {
    if (!query.limit) return this.notesService.findAll(userId);
    return this.notesService.findPage(userId, {
      ...query,
      limit: Number(query.limit),
    });
  }

  /** CATEGORIES in use, with note counts */
  @Get('categories')
  categories(@JwtTokenUserId() userId: string) {
    return this.notesService.categories(userId);
  }

  /** EXPORT every note (Markdown + attachments + JSON) as a ZIP */
  @Get('export')
  async exportAll(
    @JwtToken() token: string,
    @JwtTokenUserId() userId: string,
    @Res() res: Response,
  ) {
    await this.notesService.exportAll(token, userId, res);
  }

  /** UPDATE */
  @Put(':id')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_UPLOAD, UPLOAD_OPTIONS),
  )
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

  /**
   * AI SEARCH, streamed as server-sent events: `sources`, then `token` for
   * each piece of the answer, then `done` with the full result.
   */
  @Post('ai-search/stream')
  @ApiBody({ type: AiSearchDto })
  async aiSearchStream(
    @JwtToken() token: string,
    @JwtTokenUserId() userId: string,
    @Body() aiSearchDto: AiSearchDto,
    @Res() res: Response,
  ) {
    const abort = new AbortController();
    await sendSse(
      res,
      this.searchService.streamAiSearch(
        token,
        userId,
        aiSearchDto.query,
        abort.signal,
        aiSearchDto.referencedNoteIds,
      ),
      abort,
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

  /** SIMILAR NOTES: related notes and near-duplicates */
  @Get(':id/similar')
  similar(@JwtTokenUserId() userId: string, @Param('id') id: string) {
    return this.notesService.similar(userId, id);
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

  /** EXPORT one note: ?format=md (default) or zip (with attachments) */
  @Get(':id/export')
  async exportNote(
    @JwtToken() token: string,
    @JwtTokenUserId() userId: string,
    @Param('id') id: string,
    @Query() query: ExportNoteDto,
    @Res() res: Response,
  ) {
    await this.notesService.exportNote(
      token,
      userId,
      id,
      query.format ?? 'md',
      res,
    );
  }

  /** VERSION HISTORY of a note, newest first */
  @Get(':id/versions')
  versions(@JwtTokenUserId() userId: string, @Param('id') id: string) {
    return this.notesService.listVersions(userId, id);
  }

  @Get(':id/versions/:versionId')
  version(
    @JwtTokenUserId() userId: string,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.notesService.getVersion(userId, id, versionId);
  }

  /** RESTORE an earlier version (the current one stays in the history) */
  @Post(':id/versions/:versionId/restore')
  restoreVersion(
    @JwtTokenUserId() userId: string,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.notesService.restoreVersion(userId, id, versionId);
  }

  /** MOVE a note into a folder (null: out of every folder) */
  @Patch(':id/folder')
  move(
    @JwtTokenUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: MoveNoteDto,
  ) {
    return this.notesService.move(userId, id, dto.folderId);
  }

  /** READ ONE */
  @Get(':id')
  findOne(@JwtTokenUserId() userId: string, @Param('id') id: string) {
    return this.notesService.findOne(userId, id);
  }
}
