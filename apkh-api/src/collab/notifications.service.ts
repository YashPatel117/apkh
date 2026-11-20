import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import {
  AppNotification,
  NotificationDocument,
  NotificationKind,
} from 'src/common/schema/notification';
import { errorMessage } from 'src/common/utils/http-error';
import { RealtimeService } from 'src/realtime/realtime.service';

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  actorName: string;
  folderId: string | null;
  folderName: string;
  role: string | null;
  read: boolean;
  createdAt: Date;
}

const LIST_LIMIT = 50;

/** In-app notifications (the bell): stored, and pushed to open tabs. */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(AppNotification.name)
    private readonly model: Model<NotificationDocument>,
    private readonly realtime: RealtimeService,
  ) {}

  /** Never throws: a lost notification must not fail the action behind it. */
  async notify(
    userId: string,
    data: {
      kind: NotificationKind;
      actorId?: string | null;
      actorName?: string;
      folderId?: string | null;
      folderName?: string;
      role?: string | null;
    },
  ) {
    try {
      await this.model.create({
        userId: new Types.ObjectId(userId),
        kind: data.kind,
        actorId: data.actorId ? new Types.ObjectId(data.actorId) : null,
        actorName: data.actorName ?? '',
        folderId: data.folderId ? new Types.ObjectId(data.folderId) : null,
        folderName: data.folderName ?? '',
        role: data.role ?? null,
      });
      this.realtime.emit(userId, 'notifications:changed');
    } catch (error) {
      this.logger.error(
        `Notification ${data.kind} for ${userId} failed: ${errorMessage(error)}`,
      );
    }
  }

  async list(
    userId: string,
  ): Promise<{ notifications: NotificationView[]; unread: number }> {
    const uid = new Types.ObjectId(userId);
    const [rows, unread] = await Promise.all([
      this.model
        .find({ userId: uid })
        .sort({ createdAt: -1 })
        .limit(LIST_LIMIT)
        .lean()
        .exec(),
      this.model.countDocuments({ userId: uid, readAt: null }).exec(),
    ]);
    return {
      unread,
      notifications: rows.map((n) => ({
        id: (n._id as Types.ObjectId).toHexString(),
        kind: n.kind,
        actorName: n.actorName,
        folderId: n.folderId ? String(n.folderId) : null,
        folderName: n.folderName,
        role: n.role,
        read: Boolean(n.readAt),
        createdAt: n.createdAt,
      })),
    };
  }

  /** Mark one notification read, or all of them (id omitted). */
  async markRead(userId: string, id?: string) {
    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
      readAt: null,
    };
    if (id) {
      if (!isValidObjectId(id)) return { updated: 0 };
      filter._id = new Types.ObjectId(id);
    }
    const res = await this.model
      .updateMany(filter, { $set: { readAt: new Date() } })
      .exec();
    if (res.modifiedCount) this.realtime.emit(userId, 'notifications:changed');
    return { updated: res.modifiedCount };
  }

  /** An invite that was answered or withdrawn no longer needs answering. */
  async resolveInvite(userId: string, folderId: string) {
    await this.model
      .updateMany(
        {
          userId: new Types.ObjectId(userId),
          folderId: new Types.ObjectId(folderId),
          kind: 'folder-invite',
          readAt: null,
        },
        { $set: { readAt: new Date() } },
      )
      .exec()
      .catch(() => undefined);
    this.realtime.emit(userId, 'notifications:changed');
  }
}
