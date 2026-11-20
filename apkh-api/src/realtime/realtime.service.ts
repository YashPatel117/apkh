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
  | 'trash:changed'
  | 'profile:changed'
  /** The bell: a notification arrived or was read */
  | 'notifications:changed'
  /** Folder sharing changed: invites, members, roles */
  | 'shares:changed';

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

  /** emit() to several users (e.g. everyone in a shared folder). */
  emitMany(
    userIds: Iterable<string>,
    event: RealtimeEvent,
    data: unknown = {},
  ) {
    for (const userId of new Set(userIds)) this.emit(userId, event, data);
  }
}
