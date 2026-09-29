import { JwtService } from '@nestjs/jwt';
import { JwtSecretKey } from '../constant/jwt';

// Created once and reused — decorators run outside Nest's DI container.
const jwtService = new JwtService({ secret: JwtSecretKey });

export function getIdFromToken(token: string) {
  const payload: { _id: string } = jwtService.verify(token);
  return payload._id;
}
