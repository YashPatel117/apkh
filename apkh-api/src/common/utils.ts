import { JwtService } from '@nestjs/jwt';
import { JwtSecretKey } from './constant/jwt';

export function getIdFromToken(token: string) {
  const service = new JwtService();
  const payload: { _id: string } = service.verify(token, {
    secret: JwtSecretKey,
  });
  return payload._id;
}
