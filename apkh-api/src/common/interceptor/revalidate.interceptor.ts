import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';

/**
 * GET responses may be kept by the browser but must be checked before reuse
 * ("private, no-cache"). Express adds an ETag to every response, so a check
 * whose data hasn't changed is answered with an empty 304 instead of the
 * whole payload (notes, profile, ...).
 */
@Injectable()
export class RevalidateInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const http = context.switchToHttp();
      const req = http.getRequest<Request>();
      if (req.method === 'GET') {
        const res = http.getResponse<Response>();
        res.setHeader('Cache-Control', 'private, no-cache');
        res.setHeader('Vary', 'Authorization');
      }
    }
    return next.handle();
  }
}
