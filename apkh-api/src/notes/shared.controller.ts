import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiResponseDto } from 'src/common/dto/api/response';
import { ShareService, type SharedNoteView } from './share.service';
import { displayFileName } from './utils/markdown';

/** Shared notes, for anyone with the link: no sign-in. */
@Controller('shared')
export class SharedController {
  constructor(private readonly shares: ShareService) {}

  @Get(':token')
  async open(@Param('token') token: string) {
    return new ApiResponseDto<SharedNoteView>().ok(
      await this.shares.open(token),
    );
  }

  @Get(':token/files/:fileName')
  async file(
    @Param('token') token: string,
    @Param('fileName') fileName: string,
    @Res() res: Response,
  ) {
    const file = await this.shares.file(token, fileName);
    const name = displayFileName(fileName);
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
    res.set({
      'Content-Type': file.type,
      ...(file.length ? { 'Content-Length': file.length } : {}),
      'Content-Disposition': `${file.inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=300',
    });
    file.stream.pipe(res);
  }
}
