import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Folder, FolderDocument } from 'src/common/schema/folder';
import { Note, NoteDocument } from 'src/common/schema/note';
import { RealtimeService } from 'src/realtime/realtime.service';

export interface FolderView {
  id: string;
  name: string;
  parentId: string | null;
  /** Notes filed directly in this folder */
  noteCount: number;
}

// Deeper trees are hard to use in a sidebar; also bounds the cycle check.
const MAX_DEPTH = 8;

/** Collections: nested folders that notes are filed in. */
@Injectable()
export class FoldersService {
  constructor(
    @InjectModel(Folder.name) private folderModel: Model<FolderDocument>,
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
    private readonly realtime: RealtimeService,
  ) {}

  async list(userId: string): Promise<FolderView[]> {
    const uid = new Types.ObjectId(userId);
    const [folders, counts] = await Promise.all([
      this.folderModel.find({ userId: uid }).sort({ name: 1 }).lean().exec(),
      this.noteModel
        .aggregate<{ _id: Types.ObjectId | null; count: number }>([
          { $match: { userId: uid } },
          { $group: { _id: '$folderId', count: { $sum: 1 } } },
        ])
        .exec(),
    ]);
    const countBy = new Map(counts.map((c) => [String(c._id), c.count]));
    return folders.map((f) => ({
      id: String(f._id),
      name: f.name,
      parentId: f.parentId ? String(f.parentId) : null,
      noteCount: countBy.get(String(f._id)) ?? 0,
    }));
  }

  async create(userId: string, name: string, parentId: string | null) {
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
    this.realtime.emit(userId, 'folders:changed');
    return { id: String(folder._id), name: folder.name };
  }

  /** Rename and/or move a folder (parentId null: to the top level). */
  async update(
    userId: string,
    id: string,
    changes: { name?: string; parentId?: string | null },
  ) {
    const folder = await this.require(userId, id);
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
    await folder.save();
    this.realtime.emit(userId, 'folders:changed');
    return { id: String(folder._id), name: folder.name };
  }

  /** Delete a folder; its notes and subfolders move up to its parent. */
  async remove(userId: string, id: string) {
    const folder = await this.require(userId, id);
    const uid = new Types.ObjectId(userId);
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
    this.realtime.emit(userId, 'folders:changed');
    this.realtime.emit(userId, 'notes:refresh');
    return { success: true };
  }

  /** The folder, if it is the user's. */
  async require(userId: string, id: string): Promise<FolderDocument> {
    const folder = isValidObjectId(id)
      ? await this.folderModel
          .findOne({ _id: id, userId: new Types.ObjectId(userId) })
          .exec()
      : null;
    if (!folder) throw new NotFoundException('Folder not found');
    return folder;
  }

  /** "Parent / Child" path of every folder, for exports. */
  async paths(userId: string): Promise<Map<string, string>> {
    const folders = await this.list(userId);
    const byId = new Map(folders.map((f) => [f.id, f]));
    const paths = new Map<string, string>();
    for (const folder of folders) {
      const names: string[] = [];
      let current: FolderView | undefined = folder;
      for (let i = 0; current && i <= MAX_DEPTH; i++) {
        names.unshift(current.name);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      paths.set(folder.id, names.join(' / '));
    }
    return paths;
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
