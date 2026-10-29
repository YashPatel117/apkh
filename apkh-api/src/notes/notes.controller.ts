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
  UploadedFile,
  Query,
  HttpCode,
  HttpStatus,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { sendSse } from 'src/common/utils/sse';
import { NotesService } from './notes.service';
import {
  TrashService,
  trashRetentionDays,
  type TrashedNoteView,
} from './trash.service';
import { ApiResponseDto } from 'src/common/dto/api/response';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { AiSearchDto } from './dto/ai-search.dto';
import { ReindexDto } from './dto/reindex.dto';
import { SummaryQueryDto } from './dto/summary-query.dto';
import {
  ExportNoteDto,
  ListNotesDto,
  MoveNoteDto,
  SuggestTagsDto,
} from './dto/list-notes.dto';
import { IndexingService } from 'src/indexing/indexing.service';
import { SearchService } from 'src/search/search.service';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { ApiBearerAuth, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { JwtToken, JwtTokenUserId } from 'src/common/decorator/jwt.decorator';
import {
  IMPORT_UPLOAD_OPTIONS,
  TRANSCRIBE_UPLOAD_OPTIONS,
  MAX_FILES_PER_UPLOAD,
  UPLOAD_OPTIONS,
} from 'src/common/constant/upload';
import { ShareService, type ShareView } from './share.service';
import { CreateShareDto } from './dto/share.dto';
import { ImportService, type ImportResult } from './import/import.service';

@UseGuards(AuthGuard)
@ApiBearerAuth()
@Controller('notes')
export class NotesController {
  constructor(
    private readonly notesService: NotesService,
    private readonly searchService: SearchService,
    private readonly indexing: IndexingService,
    private readonly trash: TrashService,
    private readonly shares: ShareService,
    private readonly importer: ImportService,
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

  /** Every tag in use, with its note count */
  @Get('tags')
  tags(@JwtTokenUserId() userId: string) {
    return this.notesService.tags(userId);
  }

  /** Tags the AI suggests for a note (saved or still being written) */
  @Post('suggest-tags')
  @HttpCode(HttpStatus.OK)
  suggestTags(
    @JwtToken() token: string,
    @JwtTokenUserId() userId: string,
    @Body() dto: SuggestTagsDto,
  ) {
    return this.notesService.suggestTags(token, userId, dto);
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

  /**
   * IMPORT another app's export: an Obsidian vault, Notion or NotebookLM
   * export (ZIP), an Evernote .enex file, or Markdown / HTML / text files.
   */
  @Post('import')
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  async importNotes(
    @JwtTokenUserId() userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return new ApiResponseDto<ImportResult>().ok(
      await this.importer.import(userId, file),
    );
  }

  /** TRANSCRIBE a voice note recorded in the editor */
  @Post('transcribe')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', TRANSCRIBE_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  async transcribe(
    @JwtToken() token: string,
    @JwtTokenUserId() userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('The recording is empty.');
    }
    return new ApiResponseDto<{ available: boolean; text: string }>().ok(
      await this.searchService.transcribe(
        token,
        userId,
        file.buffer,
        file.originalname || 'voice-note.webm',
      ),
    );
  }

  /** Every read-only link the user has shared */
  @Get('shares')
  async listShares(@JwtTokenUserId() userId: string) {
    return new ApiResponseDto<ShareView[]>().ok(await this.shares.list(userId));
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

  // ── Trash (before the ':id' routes, which would match "trash") ─────────

  /** Deleted notes, newest first, with when each is deleted for good */
  @Get('trash')
  async listTrash(@JwtTokenUserId() userId: string) {
    return new ApiResponseDto<{
      retentionDays: number;
      notes: TrashedNoteView[];
    }>().ok({
      retentionDays: trashRetentionDays(),
      notes: await this.trash.list(userId),
    });
  }

  @Post('trash/:id/restore')
  async restoreFromTrash(
    @JwtTokenUserId() userId: string,
    @Param('id') id: string,
  ) {
    return new ApiResponseDto().ok(await this.trash.restore(userId, id));
  }

  /** Delete one trashed note for good */
  @Delete('trash/:id')
  async purgeFromTrash(
    @JwtToken() token: string,
    @JwtTokenUserId() userId: string,
    @Param('id') id: string,
  ) {
    await this.trash.purge(token, userId, id);
    return new ApiResponseDto().ok({ deleted: true });
  }

  /** Empty the trash */
  @Delete('trash')
  async emptyTrash(
    @JwtToken() token: string,
    @JwtTokenUserId() userId: string,
  ) {
    return new ApiResponseDto().ok(await this.trash.empty(token, userId));
  }

  /** DELETE: moves the note to the trash */
  @Delete(':id')
  remove(@JwtTokenUserId() userId: string, @Param('id') id: string) {
    return this.notesService.remove(userId, id);
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
    await this.indexing.reindexAll(userId, { force: dto?.force });
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

  /** BACKLINKS: notes that link to this one */
  @Get(':id/backlinks')
  backlinks(@JwtTokenUserId() userId: string, @Param('id') id: string) {
    return this.notesService.backlinks(userId, id);
  }

  /** RE-INDEX one note */
  @Post(':id/reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  reindexNote(
    @JwtTokenUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: ReindexDto,
  ) {
    return this.notesService.reindex(userId, id, dto?.force);
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

  /** SHARE LINK of a note (null when it has none) */
  @Get(':id/share')
  async getShare(@JwtTokenUserId() userId: string, @Param('id') id: string) {
    return new ApiResponseDto<ShareView | null>().ok(
      await this.shares.get(userId, id),
    );
  }

  /** A new read-only link (replaces the old one) */
  @Post(':id/share')
  async createShare(
    @JwtTokenUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: CreateShareDto,
  ) {
    return new ApiResponseDto<ShareView>().ok(
      await this.shares.create(userId, id, dto.expiresInDays ?? null),
    );
  }

  /** Stop the link working */
  @Delete(':id/share')
  async revokeShare(@JwtTokenUserId() userId: string, @Param('id') id: string) {
    return new ApiResponseDto().ok(await this.shares.revoke(userId, id));
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
