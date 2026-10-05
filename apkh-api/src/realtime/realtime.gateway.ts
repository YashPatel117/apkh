import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { getCorsOrigins } from 'src/common/constant/env';
import { JwtSecretKey } from 'src/common/constant/jwt';

export const userRoom = (userId: string) => `user:${userId}`;

/**
 * Live updates for the web app. A browser connects with its token and joins
 * its user's room; everything that changes a user's data is pushed there, so
 * every open tab and device stays in sync without polling.
 */
@WebSocketGateway({
  namespace: 'realtime',
  cors: { origin: getCorsOrigins(), credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    const auth = client.handshake.auth as { token?: unknown } | undefined;
    const token = typeof auth?.token === 'string' ? auth.token : '';
    try {
      const payload = await this.jwtService.verifyAsync<{ _id: string }>(
        token,
        { secret: JwtSecretKey },
      );
      await client.join(userRoom(String(payload._id)));
    } catch {
      this.logger.debug('Realtime connection refused: invalid token');
      client.disconnect(true);
    }
  }
}
