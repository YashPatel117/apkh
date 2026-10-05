import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule } from 'nestjs-pino';
import { HealthController } from './health/health.controller';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { JwtModule } from '@nestjs/jwt';
import { NotesModule } from './notes/notes.module';
import { JwtSecretKey } from './common/constant/jwt';
import { requireEnv } from './common/constant/env';
import { FileModule } from './file/file.module';
import { ChatModule } from './chat/chat.module';
import { DatabaseModule } from './database/database.module';
import { IndexingModule } from './indexing/indexing.module';
import { FoldersModule } from './folders/folders.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AdminModule } from './admin/admin.module';
import { IntegrationsModule } from './integrations/integrations.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        base: { service: 'apkh-api' },
        // main.ts sets the id (and the X-Request-Id header) first.
        genReqId: (req) => (req as unknown as { id: string }).id,
        autoLogging: {
          ignore: (req) => req.url === '/health' || req.url === '/ready',
        },
        customLogLevel: (_req, res, err) =>
          err || res.statusCode >= 500
            ? 'error'
            : res.statusCode >= 400
              ? 'warn'
              : 'info',
        serializers: {
          req: (req: { id: string; method: string; url: string }) => ({
            id: req.id,
            method: req.method,
            url: req.url,
          }),
          res: (res: { statusCode: number }) => ({
            statusCode: res.statusCode,
          }),
        },
        // Never log tokens or API keys.
        redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
      },
    }),
    MongooseModule.forRoot(requireEnv('MONGODB_URI'), {
      maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE) || 20,
      minPoolSize: Number(process.env.MONGODB_MIN_POOL_SIZE) || 2,
      serverSelectionTimeoutMS: 5_000,
      socketTimeoutMS: 45_000,
    }),
    // Data migrations run while modules initialise, before the index worker
    // starts (application bootstrap) and before requests are served.
    DatabaseModule,
    UsersModule,
    AuthModule,
    JwtModule.register({
      global: true,
      secret: JwtSecretKey,
      signOptions: { expiresIn: '7d' },
    }),
    NotesModule,
    FileModule,
    ChatModule,
    IndexingModule,
    FoldersModule,
    RealtimeModule,
    AnalyticsModule,
    AdminModule,
    IntegrationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
