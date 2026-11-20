import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Folder, FolderDocument } from 'src/common/schema/folder';
import {
  FolderMember,
  FolderMemberDocument,
  FolderRole,
} from 'src/common/schema/folder-member';
import { Note, NoteDocument } from 'src/common/schema/note';
import { User, UserDocument } from 'src/common/schema/user';

export type AccessRole = 'owner' | FolderRole;
export type AccessNeed = 'read' | 'write';

export interface FolderAccess {
  ownerId: string;
  role: AccessRole;
  /** The shared folder the role comes from; null for the owner */
  shareRootId: string | null;
}

export interface NoteAccess extends FolderAccess {
  noteId: string;
  folderId: string | null;
}

/** What is shared with a user: one entry per shared folder they accepted. */
export interface SharedScope {
  ownerId: string;
  rootId: string;
  role: FolderRole;
  /** The shared folder and every folder below it */
  folderIds: string[];
}

// Folder trees are at most 8 deep (FoldersService); one more for safety.
const MAX_CHAIN = 10;
// Notes of shared folders that AI search can consider for one user.
const MAX_SHARED_NOTES = 10_000;
const MEMBER_TOKEN_TTL = '15m';

const RANK: Record<AccessRole, number> = { viewer: 1, editor: 2, owner: 3 };

export function canWrite(role: AccessRole) {
  return role === 'owner' || role === 'editor';
}

/**
 * Who may do what with folders and notes. Everything in a shared folder stays
 * its owner's (notes, subfolders, files, index): a member's access comes from
 * an accepted FolderMember row on the folder or one of its parents, and the
 * services then act as the owner. Every check answers "not found" for things
 * the user can't see, so ids of other people's notes reveal nothing.
 */
@Injectable()
export class AccessService {
  constructor(
    @InjectModel(Folder.name)
    private readonly folderModel: Model<FolderDocument>,
    @InjectModel(FolderMember.name)
    private readonly memberModel: Model<FolderMemberDocument>,
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly jwtService: JwtService,
  ) {}

  // ── Folders ──────────────────────────────────────────────────────────────

  /** The user's access to a folder, or null when they have none. */
  async folderAccess(
    userId: string,
    folderId: string,
  ): Promise<FolderAccess | null> {
    if (!isValidObjectId(folderId)) return null;
    const chain = await this.chain(folderId);
    if (!chain.length) return null;
    const ownerId = chain[0].ownerId;
    if (ownerId === userId) {
      return { ownerId, role: 'owner', shareRootId: null };
    }
    const memberships = await this.memberModel
      .find({
        userId: new Types.ObjectId(userId),
        status: 'accepted',
        folderId: { $in: chain.map((f) => new Types.ObjectId(f.id)) },
      })
      .select('folderId role')
      .lean()
      .exec();
    if (!memberships.length) return null;
    // A subfolder can be shared again with a stronger role.
    const best = memberships.reduce((a, b) =>
      RANK[b.role] > RANK[a.role] ? b : a,
    );
    return { ownerId, role: best.role, shareRootId: String(best.folderId) };
  }

  /** folderAccess, or 404 (none) / 403 (read-only when writing). */
  async requireFolder(
    userId: string,
    folderId: string,
    need: AccessNeed,
  ): Promise<FolderAccess> {
    const access = await this.folderAccess(userId, folderId);
    if (!access) throw new NotFoundException('Folder not found');
    if (need === 'write' && !canWrite(access.role)) {
      throw new ForbiddenException(
        'You can view this shared folder but not change it.',
      );
    }
    return access;
  }

  /**
   * Whether `folderId` is `ancestorId` or lies below it (same owner). Used to
   * keep a member's moves inside the folder that is shared with them.
   */
  async isWithin(folderId: string, ancestorId: string): Promise<boolean> {
    const chain = await this.chain(folderId);
    return chain.some((f) => f.id === ancestorId);
  }

  // ── Notes ────────────────────────────────────────────────────────────────

  async noteAccess(userId: string, noteId: string): Promise<NoteAccess | null> {
    if (!isValidObjectId(noteId)) return null;
    const note = await this.noteModel
      .findById(noteId)
      .select('userId folderId')
      .lean()
      .exec();
    if (!note) return null;
    const ownerId = String(note.userId);
    const folderId = note.folderId ? String(note.folderId) : null;
    if (ownerId === userId) {
      return { ownerId, role: 'owner', shareRootId: null, noteId, folderId };
    }
    if (!folderId) return null;
    const access = await this.folderAccess(userId, folderId);
    return access ? { ...access, noteId, folderId } : null;
  }

  /** noteAccess, or "Note not found" (400, like NotesService) / 403. */
  async requireNote(
    userId: string,
    noteId: string,
    need: AccessNeed,
  ): Promise<NoteAccess> {
    const access = await this.noteAccess(userId, noteId);
    if (!access) {
      throw new HttpException('Note not found', HttpStatus.BAD_REQUEST);
    }
    if (need === 'write' && !canWrite(access.role)) {
      throw new ForbiddenException(
        'You can view this shared note but not change it.',
      );
    }
    return access;
  }

  /** The ids among `noteIds` the user can read (own or shared with them). */
  async readableNoteIds(userId: string, noteIds: string[]): Promise<string[]> {
    const ids = [...new Set(noteIds.filter((id) => isValidObjectId(id)))];
    if (!ids.length) return [];
    const notes = await this.noteModel
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
      .select('userId folderId')
      .lean()
      .exec();
    const scopes = await this.sharedScopes(userId);
    const shared = new Set(scopes.flatMap((s) => s.folderIds));
    const readable = new Set(
      notes
        .filter(
          (n) =>
            String(n.userId) === userId ||
            (n.folderId && shared.has(String(n.folderId))),
        )
        .map((n) => (n._id as Types.ObjectId).toHexString()),
    );
    // Keep the caller's order.
    return ids.filter((id) => readable.has(id));
  }

  // ── What is shared with a user ───────────────────────────────────────────

  /** Every folder shared with the user (accepted), with all its subfolders. */
  async sharedScopes(userId: string): Promise<SharedScope[]> {
    const memberships = await this.memberModel
      .find({ userId: new Types.ObjectId(userId), status: 'accepted' })
      .select('folderId ownerId role')
      .lean()
      .exec();
    if (!memberships.length) return [];
    const owners = [...new Set(memberships.map((m) => String(m.ownerId)))];
    const folders = await this.folderModel
      .find({ userId: { $in: owners.map((id) => new Types.ObjectId(id)) } })
      .select('userId parentId')
      .lean()
      .exec();
    const children = new Map<string, string[]>();
    for (const f of folders) {
      if (!f.parentId) continue;
      const key = String(f.parentId);
      children.set(key, [
        ...(children.get(key) ?? []),
        (f._id as Types.ObjectId).toHexString(),
      ]);
    }
    const exists = new Set(
      folders.map((f) => (f._id as Types.ObjectId).toHexString()),
    );
    return memberships
      .filter((m) => exists.has(String(m.folderId)))
      .map((m) => {
        const rootId = String(m.folderId);
        const folderIds: string[] = [];
        const queue = [rootId];
        while (queue.length && folderIds.length < 5_000) {
          const id = queue.shift()!;
          folderIds.push(id);
          queue.push(...(children.get(id) ?? []));
        }
        return {
          ownerId: String(m.ownerId),
          rootId,
          role: m.role,
          folderIds,
        };
      });
  }

  /**
   * The notes shared with a user, per owner, for search: retrieval runs over
   * the user's own chunks plus one partition per owner limited to these notes.
   */
  async sharedNotePartitions(
    userId: string,
  ): Promise<{ ownerId: string; noteIds: string[] }[]> {
    const scopes = await this.sharedScopes(userId);
    if (!scopes.length) return [];
    const byOwner = new Map<string, Set<string>>();
    for (const scope of scopes) {
      const set = byOwner.get(scope.ownerId) ?? new Set<string>();
      scope.folderIds.forEach((id) => set.add(id));
      byOwner.set(scope.ownerId, set);
    }
    const partitions: { ownerId: string; noteIds: string[] }[] = [];
    let budget = MAX_SHARED_NOTES;
    for (const [ownerId, folderIds] of byOwner) {
      if (budget <= 0) break;
      const notes = await this.noteModel
        .find({
          userId: new Types.ObjectId(ownerId),
          folderId: { $in: [...folderIds].map((id) => new Types.ObjectId(id)) },
        })
        .select('_id')
        .sort({ updatedAt: -1 })
        .limit(budget)
        .lean()
        .exec();
      if (!notes.length) continue;
      budget -= notes.length;
      partitions.push({
        ownerId,
        noteIds: notes.map((n) => (n._id as Types.ObjectId).toHexString()),
      });
    }
    return partitions;
  }

  // ── Who to tell ──────────────────────────────────────────────────────────

  /**
   * Who sees a change to something in `folderId` of `ownerId`: the owner plus
   * the accepted members of the folder and of every folder above it.
   */
  async audience(ownerId: string, folderId: string | null): Promise<string[]> {
    if (!folderId) return [ownerId];
    const chain = await this.chain(folderId);
    if (!chain.length) return [ownerId];
    const members = await this.memberModel
      .find({
        status: 'accepted',
        folderId: { $in: chain.map((f) => new Types.ObjectId(f.id)) },
      })
      .select('userId')
      .lean()
      .exec();
    return [...new Set([ownerId, ...members.map((m) => String(m.userId))])];
  }

  /** Everyone who shares any folder with the owner, or the owner shares with. */
  async membersOfOwner(ownerId: string): Promise<string[]> {
    const members = await this.memberModel
      .find({ ownerId: new Types.ObjectId(ownerId), status: 'accepted' })
      .select('userId')
      .lean()
      .exec();
    return [...new Set(members.map((m) => String(m.userId)))];
  }

  // ── Acting as the owner ──────────────────────────────────────────────────

  /**
   * The bearer token for storage and apkh-search: the user's own for their
   * notes, else a short-lived token for the owner (files of a shared note
   * live in the owner's storage). Only issued after an access check.
   */
  tokenFor(access: FolderAccess, userToken: string): string {
    if (access.role === 'owner') return userToken;
    const token = this.jwtService.sign(
      { _id: access.ownerId, svc: 'member' },
      { expiresIn: MEMBER_TOKEN_TTL },
    );
    return `Bearer ${token}`;
  }

  async userNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id) => isValidObjectId(id)))];
    if (!unique.length) return new Map();
    const users = await this.userModel
      .find({ _id: { $in: unique.map((id) => new Types.ObjectId(id)) } })
      .select('name')
      .lean()
      .exec();
    return new Map(
      users.map((u) => [(u._id as Types.ObjectId).toHexString(), u.name]),
    );
  }

  /** The folder and its parents, nearest first, all of one owner. */
  private async chain(
    folderId: string,
  ): Promise<{ id: string; ownerId: string }[]> {
    const chain: { id: string; ownerId: string }[] = [];
    let current: string | null = folderId;
    let ownerId: string | null = null;
    while (current && chain.length < MAX_CHAIN) {
      const folder = await this.folderModel
        .findById(current)
        .select('userId parentId')
        .lean()
        .exec();
      if (!folder) break;
      const owner = String(folder.userId);
      if (ownerId && owner !== ownerId) break;
      ownerId = owner;
      chain.push({
        id: (folder._id as Types.ObjectId).toHexString(),
        ownerId: owner,
      });
      current = folder.parentId ? String(folder.parentId) : null;
    }
    return chain;
  }
}
