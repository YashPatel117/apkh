import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { getIdFromToken } from '../utils/jwt';

export const JwtToken = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.headers['authorization'] as string;
  },
);

export const JwtTokenUserId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const auth = request.headers['authorization'] as string | undefined;
    const [type, token] = auth?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException();
    }
    try {
      return getIdFromToken(token);
    } catch {
      throw new UnauthorizedException();
    }
  },
);
