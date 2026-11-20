/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { FileService } from './file.service';
import { JwtToken, JwtTokenUserId } from 'src/common/decorator/jwt.decorator';
import { AccessService } from 'src/collab/access.service';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';
import { type Response } from 'express';

@UseGuards(AuthGuard)
@ApiBearerAuth()
@Controller('file')
export class FileController {
  constructor(
    private readonly fileService: FileService,
    private readonly access: AccessService,
  ) {}

  @Get('/:noteId/:fileName')
  async getFile(
    @JwtToken() token: string,
    @JwtTokenUserId() userId: string,
    @Param('noteId') noteId: string,
    @Param('fileName') fileName: string,
    @Res() res: Response, // must use @Res() to send manually
  ) {
    // Files of a note in a shared folder live in the owner's storage. Any
    // other note (own, or in the trash) is read with the user's own token,
    // and storage only serves their own files to it.
    const access = await this.access.noteAccess(userId, noteId);
    const response = await this.fileService.getFile(
      access ? this.access.tokenFor(access, token) : token,
      noteId,
      fileName,
    );

    // Set headers from the remote file server
    res.set({
      'Content-Type':
        response.headers['content-type'] || 'application/octet-stream',
      'Content-Length': response.headers['content-length'],
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });

    // Pipe the stream directly to the response
    response.data.pipe(res);
  }
}
