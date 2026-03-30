import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { getIdFromToken } from '../utils';

export const JwtToken = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.headers['authorization'] as string;
  },
);

export const JwtTokenUserId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const token = (request.headers['authorization'] as string).split(' ')[1];
    return getIdFromToken(token);
  },
);
