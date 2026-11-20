// Must be the first import so .env is loaded before any module reads process.env
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { RateLimitInterceptor } from './common/rate-limit/rate-limit';
import { swaggerConfig } from './common/openapi';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { getCorsOrigins } from './common/constant/env';
import { REQUEST_ID_HEADER, runWithRequestId } from './common/request-context';
import { RevalidateInterceptor } from './common/interceptor/revalidate.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  // Behind a reverse proxy (Hugging Face Space, nginx) the caller's address is
  // in X-Forwarded-For; TRUST_PROXY says how many proxy hops to trust, so
  // per-IP rate limits see the real client. Off by default: trusting the
  // header without a proxy would let callers pick their own address.
  const trustProxy = Number(process.env.TRUST_PROXY);
  if (Number.isInteger(trustProxy) && trustProxy > 0) {
    app.set('trust proxy', trustProxy);
  }

  // Every request gets an id (the caller's X-Request-Id, or a new one): it is
  // on every log line and forwarded to the other services.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId =
      typeof incoming === 'string' && /^[\w-]{1,100}$/.test(incoming)
        ? incoming
        : randomUUID();
    (req as Request & { id: string }).id = requestId;
    res.setHeader('X-Request-Id', requestId);
    runWithRequestId(requestId, next);
  });

  const config = swaggerConfig(new DocumentBuilder());
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, documentFactory);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalInterceptors(
    new RevalidateInterceptor(),
    new RateLimitInterceptor(app.get(Reflector)),
  );
  app.enableCors({
    origin: getCorsOrigins(), // Next.js frontend
    credentials: true, // allows cookies & auth headers
    exposedHeaders: ['ETag', 'X-Request-Id', 'Content-Disposition'],
  });
  // SIGTERM/SIGINT run onModuleDestroy hooks: the index worker finishes its
  // jobs and the database connection closes cleanly.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
