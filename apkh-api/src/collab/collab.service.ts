import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Folder, FolderDocument } from 'src/common/schema/folder';
import {
  FolderMember,
  FolderMemberDocument,
  FolderRole,
  MemberStatus,
} from 'src/common/schema/folder-member';
import { User, UserDocument } from 'src/common/schema/user';
import { RealtimeService } from 'src/realtime/realtime.service';
import { AccessService } from './access.service';
import { NotificationsService } from './notifications.service';

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  role: FolderRole | 'owner';
  status: MemberStatus;
  invitedAt: Date | null;
}

export interface InviteView {
  folderId: string;
  folderName: string;
  ownerName: string;
  role: FolderRole;
  invitedAt: Date;
}

// Members (and pending invites) per shared folder.
const MAX_MEMBERS = 50;

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sharing folders: the owner invites existing users by email as viewer or
 * editor; the invitee gets an in-app notification and accepts or declines.
 * The owner can change roles and remove people; members can leave.
 */
@Injectable()
export class CollabService {
  constructor(
    @InjectModel(Folder.name)
    private readonly folderModel: Model<FolderDocument>,
    @InjectModel(FolderMember.name)
    private readonly memberModel: Model<FolderMemberDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Invite someone (again) to a folder of the owner. */
  async invite(
    ownerId: string,
    folderId: string,
    email: string,
    role: FolderRole,
  ): Promise<MemberView> {
    const folder = await this.ownFolder(ownerId, folderId);
    const invitee = await this.userModel
      .findOne({
        email: new RegExp(`^${escapeRegExp(email.trim())}$`, 'i'),
      })
      .select('name email')
      .lean()
      .exec();
    if (!invitee) {
      throw new NotFoundException(
        'No account uses that email. They need to sign up first.',
      );
    }
    const inviteeId = (invitee._id as Types.ObjectId).toHexString();
    if (inviteeId === ownerId) {
      throw new BadRequestException("You can't invite yourself.");
    }

    const existing = await this.memberModel
      .findOne({ folderId: folder._id, userId: invitee._id })
      .exec();
    if (existing?.status === 'accepted') {
      throw new ConflictException(
        `${invitee.name} is already a member. Change their role instead.`,
      );
    }
    if (!existing) {
      const count = await this.memberModel
        .countDocuments({ folderId: folder._id })
        .exec();
      if (count >= MAX_MEMBERS) {
        throw new BadRequestException(
          `A folder can be shared with at most ${MAX_MEMBERS} people.`,
        );
      }
    }

    const member = await this.memberModel
      .findOneAndUpdate(
        { folderId: folder._id, userId: invitee._id },
        {
          $set: { role, status: 'pending', ownerId: folder.userId },
          $setOnInsert: { acceptedAt: null },
        },
        { upsert: true, new: true },
      )
      .exec();

    const ownerName = await this.nameOf(ownerId);
    await this.notifications.notify(inviteeId, {
      kind: 'folder-invite',
      actorId: ownerId,
      actorName: ownerName,
      folderId,
      folderName: folder.name,
      role,
    });
    this.realtime.emit(inviteeId, 'shares:changed');
    this.realtime.emit(ownerId, 'shares:changed');
    return {
      userId: inviteeId,
      name: invitee.name,
      email: invitee.email,
      role: member.role,
      status: member.status,
      invitedAt: member.updatedAt ?? null,
    };
  }

  /** The owner and everyone invited, for anyone with access to the folder. */
  async members(userId: string, folderId: string): Promise<MemberView[]> {
    const access = await this.access.requireFolder(userId, folderId, 'read');
    // Members see the people of the folder that is shared with them.
    const rootId = access.shareRootId ?? folderId;
    const rows = await this.memberModel
      .find({ folderId: new Types.ObjectId(rootId) })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    // Pending invites are the owner's business.
    const visible =
      access.role === 'owner'
        ? rows
        : rows.filter((row) => row.status === 'accepted');
    const users = await this.userModel
      .find({
        _id: {
          $in: [
            new Types.ObjectId(access.ownerId),
            ...visible.map((row) => row.userId),
          ],
        },
      })
      .select('name email')
      .lean()
      .exec();
    const byId = new Map(
      users.map((u) => [(u._id as Types.ObjectId).toHexString(), u]),
    );
    const owner = byId.get(access.ownerId);
    return [
      {
        userId: access.ownerId,
        name: owner?.name ?? '',
        email: owner?.email ?? '',
        role: 'owner' as const,
        status: 'accepted' as const,
        invitedAt: null,
      },
      ...visible.map((row) => {
        const user = byId.get(String(row.userId));
        return {
          userId: String(row.userId),
          name: user?.name ?? '',
          email: user?.email ?? '',
          role: row.role,
          status: row.status,
          invitedAt: row.createdAt,
        };
      }),
    ];
  }

  async changeRole(
    ownerId: string,
    folderId: string,
    memberId: string,
    role: FolderRole,
  ) {
    const folder = await this.ownFolder(ownerId, folderId);
    const member = await this.requireMember(folder, memberId);
    if (member.role === role) return { role };
    member.role = role;
    await member.save();
    if (member.status === 'accepted') {
      await this.notifications.notify(memberId, {
        kind: 'role-changed',
        actorId: ownerId,
        actorName: await this.nameOf(ownerId),
        folderId,
        folderName: folder.name,
        role,
      });
    }
    this.changed(ownerId, memberId);
    return { role };
  }

  /** Remove a member, or withdraw an invite. */
  async remove(ownerId: string, folderId: string, memberId: string) {
    const folder = await this.ownFolder(ownerId, folderId);
    const member = await this.requireMember(folder, memberId);
    await member.deleteOne();
    if (member.status === 'accepted') {
      await this.notifications.notify(memberId, {
        kind: 'member-removed',
        actorId: ownerId,
        actorName: await this.nameOf(ownerId),
        folderId,
        folderName: folder.name,
      });
    } else {
      await this.notifications.resolveInvite(memberId, folderId);
    }
    this.changed(ownerId, memberId);
    return { removed: true };
  }

  /** Accept or decline an invite. */
  async respond(userId: string, folderId: string, accept: boolean) {
    if (!isValidObjectId(folderId))
      throw new NotFoundException('Invite not found');
    const member = await this.memberModel
      .findOne({
        folderId: new Types.ObjectId(folderId),
        userId: new Types.ObjectId(userId),
        status: 'pending',
      })
      .exec();
    if (!member) {
      throw new NotFoundException(
        'This invite is no longer open: it was withdrawn or already answered.',
      );
    }
    const folder = await this.folderModel
      .findById(member.folderId)
      .select('name')
      .lean()
      .exec();
    if (accept) {
      member.status = 'accepted';
      member.acceptedAt = new Date();
      await member.save();
    } else {
      await member.deleteOne();
    }
    await this.notifications.resolveInvite(userId, folderId);
    const ownerId = String(member.ownerId);
    await this.notifications.notify(ownerId, {
      kind: accept ? 'invite-accepted' : 'invite-declined',
      actorId: userId,
      actorName: await this.nameOf(userId),
      folderId,
      folderName: folder?.name ?? '',
      role: member.role,
    });
    this.changed(ownerId, userId);
    return { accepted: accept };
  }

  /** A member leaves a folder shared with them. */
  async leave(userId: string, folderId: string) {
    if (!isValidObjectId(folderId))
      throw new NotFoundException('Folder not found');
    const member = await this.memberModel
      .findOneAndDelete({
        folderId: new Types.ObjectId(folderId),
        userId: new Types.ObjectId(userId),
      })
      .exec();
    if (!member)
      throw new NotFoundException('You are not a member of this folder.');
    if (member.status === 'accepted') {
      const folder = await this.folderModel
        .findById(member.folderId)
        .select('name')
        .lean()
        .exec();
      await this.notifications.notify(String(member.ownerId), {
        kind: 'member-left',
        actorId: userId,
        actorName: await this.nameOf(userId),
        folderId,
        folderName: folder?.name ?? '',
      });
    }
    this.changed(String(member.ownerId), userId);
    return { left: true };
  }

  /** Invites waiting for the user's answer. */
  async pendingInvites(userId: string): Promise<InviteView[]> {
    const rows = await this.memberModel
      .find({ userId: new Types.ObjectId(userId), status: 'pending' })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    if (!rows.length) return [];
    const [folders, names] = await Promise.all([
      this.folderModel
        .find({ _id: { $in: rows.map((r) => r.folderId) } })
        .select('name')
        .lean()
        .exec(),
      this.access.userNames(rows.map((r) => String(r.ownerId))),
    ]);
    const folderName = new Map(
      folders.map((f) => [(f._id as Types.ObjectId).toHexString(), f.name]),
    );
    return rows
      .filter((r) => folderName.has(String(r.folderId)))
      .map((r) => ({
        folderId: String(r.folderId),
        folderName: folderName.get(String(r.folderId)) ?? '',
        ownerName: names.get(String(r.ownerId)) ?? '',
        role: r.role,
        invitedAt: r.updatedAt,
      }));
  }

  /** People each of the owner's folders is shared with or offered to (folder id -> count). */
  async memberCounts(ownerId: string): Promise<Map<string, number>> {
    const rows = await this.memberModel
      .aggregate<{
        _id: Types.ObjectId;
        count: number;
      }>([
        { $match: { ownerId: new Types.ObjectId(ownerId) } },
        { $group: { _id: '$folderId', count: { $sum: 1 } } },
      ])
      .exec();
    return new Map(rows.map((r) => [String(r._id), r.count]));
  }

  /**
   * A shared folder is being deleted by its owner: its members lose access
   * (the notes move up into the owner's own folders) and are told.
   */
  async folderDeleted(ownerId: string, folder: FolderDocument) {
    const members = await this.memberModel
      .find({ folderId: folder._id })
      .lean()
      .exec();
    if (!members.length) return;
    await this.memberModel.deleteMany({ folderId: folder._id }).exec();
    const ownerName = await this.nameOf(ownerId);
    for (const member of members) {
      const memberId = String(member.userId);
      if (member.status === 'accepted') {
        await this.notifications.notify(memberId, {
          kind: 'folder-deleted',
          actorId: ownerId,
          actorName: ownerName,
          folderId: String(folder._id),
          folderName: folder.name,
        });
      } else {
        await this.notifications.resolveInvite(memberId, String(folder._id));
      }
      this.realtime.emit(memberId, 'shares:changed');
      this.realtime.emit(memberId, 'folders:changed');
    }
  }

  private async ownFolder(ownerId: string, folderId: string) {
    const folder = isValidObjectId(folderId)
      ? await this.folderModel.findById(folderId).exec()
      : null;
    if (!folder) throw new NotFoundException('Folder not found');
    if (String(folder.userId) !== ownerId) {
      // Members can see the folder but only its owner manages who has it.
      const access = await this.access.folderAccess(ownerId, folderId);
      if (!access) throw new NotFoundException('Folder not found');
      throw new ForbiddenException(
        'Only the folder’s owner can manage who it is shared with.',
      );
    }
    return folder;
  }

  private async requireMember(folder: FolderDocument, memberId: string) {
    const member = isValidObjectId(memberId)
      ? await this.memberModel
          .findOne({
            folderId: folder._id,
            userId: new Types.ObjectId(memberId),
          })
          .exec()
      : null;
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }

  private async nameOf(userId: string) {
    return (await this.access.userNames([userId])).get(userId) ?? 'Someone';
  }

  /** Both sides reload folders and shares. */
  private changed(ownerId: string, memberId: string) {
    for (const id of [ownerId, memberId]) {
      this.realtime.emit(id, 'shares:changed');
      this.realtime.emit(id, 'folders:changed');
    }
    this.realtime.emit(memberId, 'notes:refresh');
  }
}
