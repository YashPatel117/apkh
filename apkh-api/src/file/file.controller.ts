/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { FileService } from './file.service';
import { JwtToken } from 'src/common/decorator/jwt.decorator';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';
import { type Response } from 'express';

@UseGuards(AuthGuard)
@ApiBearerAuth()
@Controller('file')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Get('/:noteId/:fileName')
  async getFile(
    @JwtToken() token: string,
    @Param('noteId') noteId: string,
    @Param('fileName') fileName: string,
    @Res() res: Response, // must use @Res() to send manually
  ) {
    const response = await this.fileService.getFile(token, noteId, fileName);

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
