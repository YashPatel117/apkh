import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Folder, FolderDocument } from 'src/common/schema/folder';
import { Note, NoteDocument } from 'src/common/schema/note';
import { RealtimeService } from 'src/realtime/realtime.service';
import { AccessService, type AccessRole } from 'src/collab/access.service';
import { CollabService } from 'src/collab/collab.service';

export interface FolderView {
  id: string;
  name: string;
  parentId: string | null;
  /** Notes filed directly in this folder */
  noteCount: number;
  /** What the user may do: their own folder, or one shared with them */
  role: AccessRole;
  /** Own folders: how many people it is shared with (or offered to) */
  sharedWith?: number;
  /** Shared with the user: whose it is */
  ownerId?: string;
  ownerName?: string;
  /** Shared with the user: the folder that was shared (shown at the top level) */
  shareRoot?: boolean;
}

type OwnFolderView = Omit<FolderView, 'role'>;

// Deeper trees are hard to use in a sidebar; also bounds the cycle check.
const MAX_DEPTH = 8;

/**
 * Collections: nested folders that notes are filed in. A folder can be shared
 * (see CollabService); inside it, editors create, rename, move and delete
 * subfolders, which stay the owner's. Only the owner changes the shared
 * folder itself.
 */
@Injectable()
export class FoldersService {
  constructor(
    @InjectModel(Folder.name) private folderModel: Model<FolderDocument>,
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
    private readonly realtime: RealtimeService,
    private readonly access: AccessService,
    private readonly collab: CollabService,
  ) {}

  /** The user's folders, then the folders shared with them. */
  async list(userId: string): Promise<FolderView[]> {
    const [own, sharedWith, shared] = await Promise.all([
      this.ownFolders(userId),
      this.collab.memberCounts(userId),
      this.sharedFolders(userId),
    ]);
    return [
      ...own.map((f) => {
        const people = sharedWith.get(f.id);
        return {
          ...f,
          role: 'owner' as const,
          ...(people ? { sharedWith: people } : {}),
        };
      }),
      ...shared,
    ];
  }

  /** A new folder; inside a shared folder (editors) it is the owner's. */
  async create(actorId: string, name: string, parentId: string | null) {
    const userId = parentId
      ? (await this.access.requireFolder(actorId, parentId, 'write')).ownerId
      : actorId;
    const parent = parentId ? await this.require(userId, parentId) : null;
    if (parent && (await this.depthOf(userId, parent)) >= MAX_DEPTH) {
      throw new BadRequestException(
        `Folders can be nested at most ${MAX_DEPTH} levels deep.`,
      );
    }
    const folder = await this.folderModel.create({
      userId: new Types.ObjectId(userId),
      name: name.trim(),
      parentId: parent?._id ?? null,
    });
    this.realtime.emitMany(
      await this.access.audience(userId, String(folder._id)),
      'folders:changed',
    );
    return { id: String(folder._id), name: folder.name };
  }

  /** Rename and/or move a folder (parentId null: to the top level). */
  async update(
    actorId: string,
    id: string,
    changes: { name?: string; parentId?: string | null },
  ) {
    const access = await this.access.requireFolder(actorId, id, 'write');
    const userId = access.ownerId;
    if (access.role !== 'owner') {
      // Editors work inside the folder shared with them, not on it.
      if (id === access.shareRootId) {
        throw new ForbiddenException(
          'Only the owner can rename or move the shared folder itself.',
        );
      }
      const leaves =
        changes.parentId === null ||
        (changes.parentId !== undefined &&
          !(await this.access.isWithin(changes.parentId, access.shareRootId!)));
      if (leaves) {
        throw new ForbiddenException(
          'A folder can only be moved within the folder shared with you.',
        );
      }
    }
    const folder = await this.require(userId, id);
    const before = folder.parentId ? String(folder.parentId) : null;
    if (changes.name !== undefined) folder.name = changes.name.trim();
    if (changes.parentId !== undefined) {
      if (changes.parentId === null) {
        folder.parentId = null;
      } else {
        const parent = await this.require(userId, changes.parentId);
        // A folder can't move into itself or one of its own subfolders.
        if (await this.isWithin(userId, parent, String(folder._id))) {
          throw new BadRequestException(
            "A folder can't be moved into one of its own subfolders.",
          );
        }
        folder.parentId = parent._id as Types.ObjectId;
      }
    }
    // A move can change who sees the folder: tell both groups.
    const audienceBefore = await this.access.audience(userId, id);
    await folder.save();
    const audience = [
      ...audienceBefore,
      ...(await this.access.audience(userId, id)),
    ];
    this.realtime.emitMany(audience, 'folders:changed');
    if (before !== (folder.parentId ? String(folder.parentId) : null)) {
      this.realtime.emitMany(audience, 'notes:refresh');
    }
    return { id: String(folder._id), name: folder.name };
  }

  /** Delete a folder; its notes and subfolders move up to its parent. */
  async remove(actorId: string, id: string) {
    const access = await this.access.requireFolder(actorId, id, 'write');
    if (access.role !== 'owner' && id === access.shareRootId) {
      throw new ForbiddenException(
        'Only the owner can delete the shared folder itself. You can leave it instead.',
      );
    }
    const userId = access.ownerId;
    const folder = await this.require(userId, id);
    const uid = new Types.ObjectId(userId);
    const audience = await this.access.audience(userId, id);
    await Promise.all([
      this.noteModel.updateMany(
        { userId: uid, folderId: folder._id },
        { $set: { folderId: folder.parentId } },
        { timestamps: false },
      ),
      this.folderModel.updateMany(
        { userId: uid, parentId: folder._id },
        { $set: { parentId: folder.parentId } },
      ),
    ]);
    await folder.deleteOne();
    // Its members lose access (the notes are the owner's, now one level up).
    await this.collab.folderDeleted(userId, folder);
    this.realtime.emitMany(audience, 'folders:changed');
    this.realtime.emitMany(audience, 'notes:refresh');
    return { success: true };
  }

  /** The folder, if it is the user's own. */
  async require(userId: string, id: string): Promise<FolderDocument> {
    const folder = isValidObjectId(id)
      ? await this.folderModel
          .findOne({ _id: id, userId: new Types.ObjectId(userId) })
          .exec()
      : null;
    if (!folder) throw new NotFoundException('Folder not found');
    return folder;
  }

  /** "Parent / Child" path of every own folder, for exports. */
  async paths(userId: string): Promise<Map<string, string>> {
    const folders = await this.ownFolders(userId);
    const byId = new Map(folders.map((f) => [f.id, f]));
    const paths = new Map<string, string>();
    for (const folder of folders) {
      const names: string[] = [];
      let current: OwnFolderView | undefined = folder;
      for (let i = 0; current && i <= MAX_DEPTH; i++) {
        names.unshift(current.name);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      paths.set(folder.id, names.join(' / '));
    }
    return paths;
  }

  private async ownFolders(userId: string): Promise<OwnFolderView[]> {
    const uid = new Types.ObjectId(userId);
    const [folders, counts] = await Promise.all([
      this.folderModel.find({ userId: uid }).sort({ name: 1 }).lean().exec(),
      this.noteModel
        .aggregate<{
          _id: Types.ObjectId | null;
          count: number;
        }>([
          { $match: { userId: uid } },
          { $group: { _id: '$folderId', count: { $sum: 1 } } },
        ])
        .exec(),
    ]);
    const countBy = new Map(counts.map((c) => [String(c._id), c.count]));
    return folders.map((f) => ({
      id: (f._id as Types.ObjectId).toHexString(),
      name: f.name,
      parentId: f.parentId ? String(f.parentId) : null,
      noteCount: countBy.get((f._id as Types.ObjectId).toHexString()) ?? 0,
    }));
  }

  /** Folders shared with the user (accepted), each with its subfolders. */
  private async sharedFolders(userId: string): Promise<FolderView[]> {
    const scopes = await this.access.sharedScopes(userId);
    if (!scopes.length) return [];
    const ids = [...new Set(scopes.flatMap((s) => s.folderIds))];
    const oids = ids.map((id) => new Types.ObjectId(id));
    const [folders, counts, names] = await Promise.all([
      this.folderModel
        .find({ _id: { $in: oids } })
        .sort({ name: 1 })
        .lean()
        .exec(),
      this.noteModel
        .aggregate<{
          _id: Types.ObjectId;
          count: number;
        }>([
          { $match: { folderId: { $in: oids } } },
          { $group: { _id: '$folderId', count: { $sum: 1 } } },
        ])
        .exec(),
      this.access.userNames(scopes.map((s) => s.ownerId)),
    ]);
    const countBy = new Map(counts.map((c) => [String(c._id), c.count]));
    // A folder inside two shares (a subfolder shared again) gets the stronger role.
    const rank = { viewer: 1, editor: 2 } as const;
    const roleOf = new Map<string, 'viewer' | 'editor'>();
    for (const scope of scopes) {
      for (const id of scope.folderIds) {
        const current = roleOf.get(id);
        if (!current || rank[scope.role] > rank[current]) {
          roleOf.set(id, scope.role);
        }
      }
    }
    const roots = new Set(scopes.map((s) => s.rootId));
    const inShare = new Set(ids);
    return folders.map((f) => {
      const id = (f._id as Types.ObjectId).toHexString();
      const parentId = f.parentId ? String(f.parentId) : null;
      // The shared folder sits at the top level: its parent is the owner's own.
      const isRoot = roots.has(id) && !(parentId && inShare.has(parentId));
      return {
        id,
        name: f.name,
        parentId: isRoot ? null : parentId,
        noteCount: countBy.get(id) ?? 0,
        role: roleOf.get(id) ?? 'viewer',
        ownerId: String(f.userId),
        ownerName: names.get(String(f.userId)) ?? '',
        shareRoot: isRoot,
      };
    });
  }

  private async depthOf(userId: string, folder: FolderDocument) {
    let depth = 1;
    let parentId = folder.parentId;
    while (parentId && depth <= MAX_DEPTH) {
      const parent = await this.folderModel
        .findOne({ _id: parentId, userId: new Types.ObjectId(userId) })
        .select('parentId')
        .lean()
        .exec();
      parentId = parent?.parentId ?? null;
      depth++;
    }
    return depth;
  }

  /** Whether `folder` is `ancestorId` or lies inside it. */
  private async isWithin(
    userId: string,
    folder: FolderDocument,
    ancestorId: string,
  ) {
    let current: { _id: unknown; parentId: Types.ObjectId | null } | null =
      folder;
    for (let i = 0; current && i <= MAX_DEPTH + 1; i++) {
      if (String(current._id) === ancestorId) return true;
      if (!current.parentId) return false;
      current = await this.folderModel
        .findOne({
          _id: current.parentId,
          userId: new Types.ObjectId(userId),
        })
        .select('parentId')
        .lean()
        .exec();
    }
    return false;
  }
}
