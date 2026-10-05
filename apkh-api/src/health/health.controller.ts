import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Connection, ConnectionStates } from 'mongoose';
import { fileStorageApi, SEARCH_API } from 'src/common/constant/endpoint';

const DEPENDENCY_TIMEOUT_MS = 3_000;

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(DEPENDENCY_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Liveness and readiness probes (no auth). */
@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** The process is up. */
  @Get('health')
  health() {
    return { status: 'ok', service: 'apkh-api', uptime: process.uptime() };
  }

  /**
   * Ready to serve: the database is connected (required). Storage and search
   * are reported too; without them some features fail, but the API runs.
   */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const database = this.connection.readyState === ConnectionStates.connected;
    const [storage, search] = await Promise.all([
      reachable(`${fileStorageApi.replace(/\/$/, '')}/health`),
      reachable(`${SEARCH_API.replace(/\/$/, '')}/health`),
    ]);
    if (!database) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: database ? 'ready' : 'unavailable',
      checks: { database, storage, search },
    };
  }
}
