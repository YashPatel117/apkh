import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

const SERVICE_TOKEN_TTL = '15m';

/**
 * Bearer tokens for work done on a user's behalf outside a request (the
 * indexing worker). Storage and apkh-search verify the shared JWT secret and
 * scope everything to `_id`, so a short-lived token for the user is all they
 * need — no user token has to be stored with queued jobs.
 */
@Injectable()
export class ServiceTokenService {
  constructor(private readonly jwtService: JwtService) {}

  forUser(userId: string): string {
    const token = this.jwtService.sign(
      { _id: userId, svc: 'indexer' },
      { expiresIn: SERVICE_TOKEN_TTL },
    );
    return `Bearer ${token}`;
  }
}
