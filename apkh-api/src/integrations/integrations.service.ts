import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'node:crypto';
import { isValidObjectId, Model, Types } from 'mongoose';
import {
  IntegrationToken,
  IntegrationTokenDocument,
} from 'src/common/schema/integration-token';
import { NotesService } from 'src/notes/notes.service';
import {
  ExternalFormat,
  sourceLine,
  textToHtml,
  toNoteHtml,
} from './external-content';

const TOKEN_PREFIX = 'apkh_';
const MAX_TOKENS = 20;

const hash = (secret: string) =>
  createHash('sha256').update(secret).digest('hex');

export interface ExternalNote {
  title?: string;
  content: string;
  format: ExternalFormat;
  category?: string;
  /** Where it came from (a clipped page); added as a source line */
  url?: string;
}

/** Ways to add notes from outside the app. */
@Injectable()
export class IntegrationsService {
  constructor(
    @InjectModel(IntegrationToken.name)
    private tokenModel: Model<IntegrationTokenDocument>,
    private readonly notes: NotesService,
  ) {}

  async list(userId: string) {
    const tokens = await this.tokenModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    const inbox = tokens.find((t) => t.kind === 'inbox');
    return {
      tokens: tokens
        .filter((t) => t.kind === 'token')
        .map((t) => ({
          id: String(t._id),
          name: t.name,
          prefix: t.prefix,
          createdAt: t.createdAt,
          lastUsedAt: t.lastUsedAt ?? null,
        })),
      inbox: inbox?.inboxKey ? this.inboxView(inbox.inboxKey) : null,
      inboundDomain: process.env.INBOUND_EMAIL_DOMAIN?.trim() || null,
    };
  }

  /** A new token; the secret is returned now and never again. */
  async createToken(userId: string, name: string) {
    const count = await this.tokenModel.countDocuments({
      userId: new Types.ObjectId(userId),
      kind: 'token',
    });
    if (count >= MAX_TOKENS) {
      throw new UnauthorizedException(
        `You can have at most ${MAX_TOKENS} tokens. Revoke one first.`,
      );
    }
    const secret = TOKEN_PREFIX + randomBytes(24).toString('base64url');
    const doc = await this.tokenModel.create({
      userId: new Types.ObjectId(userId),
      name: name.trim(),
      kind: 'token',
      secretHash: hash(secret),
      prefix: secret.slice(0, TOKEN_PREFIX.length + 6),
    });
    return { id: String(doc._id), name: doc.name, token: secret };
  }

  async revokeToken(userId: string, id: string) {
    const deleted = isValidObjectId(id)
      ? await this.tokenModel.findOneAndDelete({
          _id: id,
          userId: new Types.ObjectId(userId),
          kind: 'token',
        })
      : null;
    if (!deleted) throw new NotFoundException('Token not found');
    return { revoked: true };
  }

  /** Create (or replace, which retires the old address) the email inbox. */
  async rotateInbox(userId: string) {
    const uid = new Types.ObjectId(userId);
    await this.tokenModel.deleteMany({ userId: uid, kind: 'inbox' });
    const key = randomBytes(12).toString('hex');
    await this.tokenModel.create({
      userId: uid,
      name: 'Email inbox',
      kind: 'inbox',
      secretHash: hash(`inbox:${key}`),
      prefix: key.slice(0, 6),
      inboxKey: key,
    });
    return this.inboxView(key);
  }

  async removeInbox(userId: string) {
    await this.tokenModel.deleteMany({
      userId: new Types.ObjectId(userId),
      kind: 'inbox',
    });
    return { removed: true };
  }

  /** The user a token belongs to (and marks it used), or throws 401. */
  async userForToken(secret: string | undefined): Promise<string> {
    if (!secret?.startsWith(TOKEN_PREFIX)) {
      throw new UnauthorizedException('A valid integration token is required.');
    }
    const token = await this.tokenModel
      .findOneAndUpdate(
        { secretHash: hash(secret), kind: 'token' },
        { $set: { lastUsedAt: new Date() } },
      )
      .lean()
      .exec();
    if (!token) throw new UnauthorizedException('Unknown or revoked token.');
    return String(token.userId);
  }

  async userForInbox(key: string): Promise<string> {
    const inbox = await this.tokenModel
      .findOneAndUpdate(
        { secretHash: hash(`inbox:${key}`), kind: 'inbox' },
        { $set: { lastUsedAt: new Date() } },
      )
      .lean()
      .exec();
    if (!inbox) throw new NotFoundException('Unknown inbox');
    return String(inbox.userId);
  }

  /** Add a note from outside; title and category are filled in if missing. */
  async addNote(userId: string, note: ExternalNote) {
    let content = toNoteHtml(note.content, note.format);
    if (note.url) content += sourceLine(note.url);
    if (!content.trim()) content = textToHtml(note.title || 'Empty note');
    return this.notes.create('', userId, {
      title: note.title?.trim().slice(0, 300),
      category: note.category?.trim().slice(0, 100),
      content,
    }, []);
  }

  private inboxView(key: string) {
    const domain = process.env.INBOUND_EMAIL_DOMAIN?.trim();
    const apiUrl = (process.env.PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    return {
      address: domain ? `${key}@${domain}` : null,
      // Point the email provider's inbound webhook here.
      webhookUrl: `${apiUrl}/integrations/email/${key}`,
    };
  }
}
