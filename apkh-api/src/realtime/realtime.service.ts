import { Injectable } from '@nestjs/common';
import { RealtimeGateway, userRoom } from './realtime.gateway';

/** What the web app is told about (see apkh-web hooks/useRealtime). */
export type RealtimeEvent =
  | 'note:saved'
  | 'note:deleted'
  | 'notes:refresh'
  | 'folders:changed'
  | 'index:changed'
  | 'chat:updated'
  | 'profile:changed';

@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

  /** Push an event to every open tab of a user. Never throws. */
  emit(userId: string, event: RealtimeEvent, data: unknown = {}) {
    try {
      this.gateway.server?.to(userRoom(userId)).emit(event, data);
    } catch {
      // Live updates are best-effort; the app also reloads on focus.
    }
  }
}
