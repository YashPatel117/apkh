import { Injectable, NotFoundException, GoneException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import { isValidObjectId, Model, Types } from 'mongoose';
import sanitizeHtml from 'sanitize-html';
import type { Readable } from 'node:stream';
import { Note, NoteDocument } from 'src/common/schema/note';
import { NoteShare, NoteShareDocument } from 'src/common/schema/note-share';
import { FileService } from 'src/file/file.service';
import { ServiceTokenService } from 'src/indexing/service-token.service';

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{20,64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
// Types a browser may show in the page; anything else is downloaded.
const INLINE_TYPES =
  /^(image\/(png|jpe?g|gif|webp|bmp|avif)|audio\/|video\/|application\/pdf$)/i;

export interface ShareView {
  noteId: string;
  noteTitle?: string;
  token: string;
  expiresAt: Date | null;
  createdAt: Date;
  views: number;
  lastViewedAt: Date | null;
}

/** A shared note as the public page shows it. */
export interface SharedNoteView {
  title: string;
  category: string;
  tags: string[];
  /** Note HTML without links to the owner's other notes */
  content: string;
  files: string[];
  createdAt: string;
  updatedAt: string;
  expiresAt: Date | null;
}

/** Read-only links to single notes, for people without an account. */
@Injectable()
export class ShareService {
  constructor(
    @InjectModel(NoteShare.name) private shareModel: Model<NoteShareDocument>,
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
    private readonly fileService: FileService,
    private readonly serviceTokens: ServiceTokenService,
  ) {}

  /** The note's link, if it has one that still works. */
  async get(userId: string, noteId: string): Promise<ShareView | null> {
    await this.requireNote(userId, noteId);
    const share = await this.shareModel
      .findOne({ noteId: new Types.ObjectId(noteId) })
      .lean()
      .exec();
    return share && !expired(share) ? toView(share) : null;
  }

  /** A new link for the note (the old one stops working). */
  async create(
    userId: string,
    noteId: string,
    expiresInDays: number | null,
  ): Promise<ShareView> {
    const note = await this.requireNote(userId, noteId);
    const share = await this.shareModel
      .findOneAndUpdate(
        { noteId: note._id },
        {
          $set: {
            userId: new Types.ObjectId(userId),
            token: randomBytes(24).toString('base64url'),
            expiresAt: expiresInDays
              ? new Date(Date.now() + expiresInDays * DAY_MS)
              : null,
            views: 0,
            lastViewedAt: null,
            createdAt: new Date(),
          },
        },
        { upsert: true, new: true, timestamps: false },
      )
      .lean()
      .exec();
    return toView(share);
  }

  async revoke(userId: string, noteId: string) {
    await this.requireNote(userId, noteId);
    const { deletedCount } = await this.shareModel.deleteOne({
      noteId: new Types.ObjectId(noteId),
      userId: new Types.ObjectId(userId),
    });
    return { revoked: deletedCount > 0 };
  }

  /** Every link the user has made that still works, newest first. */
  async list(userId: string): Promise<ShareView[]> {
    const shares = await this.shareModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    const live = shares.filter((share) => !expired(share));
    const titles = new Map(
      (
        await this.noteModel
          .find({ _id: { $in: live.map((s) => s.noteId) } })
          .select('title')
          .lean()
          .exec()
      ).map((n) => [(n._id as Types.ObjectId).toHexString(), n.title]),
    );
    // Notes in the trash keep their link, but it doesn't open until they're restored.
    return live
      .filter((share) => titles.has(String(share.noteId)))
      .map((share) => ({
        ...toView(share),
        noteTitle: titles.get(String(share.noteId)),
      }));
  }

  /** The note behind a link, for anyone who has it. */
  async open(token: string): Promise<SharedNoteView> {
    const { share, note } = await this.resolve(token);
    await this.shareModel.updateOne(
      { _id: share._id },
      { $inc: { views: 1 }, $set: { lastViewedAt: new Date() } },
      { timestamps: false },
    );
    const files = await this.fileService.getNoteFiles(
      (note._id as Types.ObjectId).toHexString(),
    );
    return {
      title: note.title,
      category: note.category,
      tags: note.tags ?? [],
      content: publicNoteHtml(note.content),
      files: files?.files ?? [],
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      expiresAt: share.expiresAt,
    };
  }

  /** One attachment of a shared note, streamed from storage. */
  async file(token: string, fileName: string) {
    const { note } = await this.resolve(token);
    const noteId = (note._id as Types.ObjectId).toHexString();
    const files = await this.fileService.getNoteFiles(noteId);
    if (!files?.files.includes(fileName)) {
      throw new NotFoundException('This file is not part of the shared note.');
    }
    const response = await this.fileService.getFile(
      this.serviceTokens.forUser(String(note.userId)),
      noteId,
      fileName,
    );
    const type = String(
      response.headers['content-type'] ?? 'application/octet-stream',
    );
    return {
      stream: response.data as Readable,
      type,
      length: response.headers['content-length'] as string | undefined,
      inline: INLINE_TYPES.test(type),
    };
  }

  /** A note deleted for good takes its link with it. */
  async removeForNote(noteId: Types.ObjectId) {
    await this.shareModel.deleteMany({ noteId });
  }

  private async resolve(token: string) {
    const share = TOKEN_FORMAT.test(token)
      ? await this.shareModel.findOne({ token }).lean().exec()
      : null;
    if (!share) {
      throw new NotFoundException("This link doesn't work anymore.");
    }
    if (expired(share)) throw new GoneException('This link has expired.');
    const note = await this.noteModel.findById(share.noteId).lean().exec();
    if (!note) {
      throw new NotFoundException("This link doesn't work anymore.");
    }
    return { share, note };
  }

  private async requireNote(userId: string, noteId: string) {
    const note = isValidObjectId(noteId)
      ? await this.noteModel
          .findOne({ _id: noteId, userId: new Types.ObjectId(userId) })
          .select('_id')
          .lean()
          .exec()
      : null;
    if (!note) throw new NotFoundException('Note not found');
    return note;
  }
}

function expired(share: { expiresAt?: Date | null }): boolean {
  return Boolean(share.expiresAt && share.expiresAt.getTime() <= Date.now());
}

function toView(share: NoteShare): ShareView {
  return {
    noteId: String(share.noteId),
    token: share.token,
    expiresAt: share.expiresAt ?? null,
    createdAt: share.createdAt,
    views: share.views ?? 0,
    lastViewedAt: share.lastViewedAt ?? null,
  };
}

/**
 * Note HTML for strangers: the editor's formatting and attachment chips,
 * nothing that runs, and links to the owner's other notes turned into text
 * (the reader couldn't open them).
 */
export function publicNoteHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'h1',
      'h2',
      'h3',
      'strong',
      'em',
      'u',
      's',
      'a',
      'ol',
      'ul',
      'li',
      'blockquote',
      'pre',
      'code',
      'span',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      li: ['data-list', 'class'],
      pre: ['data-language', 'class'],
      span: ['class', 'data-id', 'data-name'],
      p: ['class'],
    },
    allowedClasses: {
      li: ['ql-indent-*'],
      p: ['ql-align-*', 'ql-indent-*'],
      pre: ['ql-syntax'],
      span: ['file-token'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    exclusiveFilter: (frame) =>
      frame.tag === 'span' &&
      !frame.attribs.class?.includes('file-token') &&
      !frame.text.trim(),
    transformTags: {
      a: (tagName, attribs): sanitizeHtml.Tag => {
        const href = attribs.href ?? '';
        if (/^(?:https?:\/\/[^/]+)?\/notes\/[a-f\d]{24}\/?$/i.test(href)) {
          return { tagName: 'span', attribs: { class: 'shared-note-link' } };
        }
        return {
          tagName,
          attribs: {
            href,
            target: '_blank',
            rel: 'noopener noreferrer nofollow',
          },
        };
      },
    },
    nonTextTags: ['script', 'style', 'textarea', 'noscript', 'head', 'title'],
  });
}
