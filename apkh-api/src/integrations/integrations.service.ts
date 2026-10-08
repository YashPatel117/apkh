import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'node:crypto';
import { isValidObjectId, Model, Types } from 'mongoose';
import {
  DEFAULT_TOKEN_SCOPES,
  IntegrationToken,
  IntegrationTokenDocument,
  TokenScope,
} from 'src/common/schema/integration-token';
import { ServiceTokenService } from 'src/indexing/service-token.service';
import { NotesService } from 'src/notes/notes.service';
import { displayFileName } from 'src/notes/utils/markdown';
import { SearchService } from 'src/search/search.service';
import {
  ExternalFormat,
  sourceLine,
  textToHtml,
  toNoteHtml,
} from './external-content';

const TOKEN_PREFIX = 'apkh_';
const MAX_TOKENS = 20;
// Requests per token per minute, so a looping script or agent can't hammer the
// API (and the user's embedding provider). Counted per API process.
const TOKEN_RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
// A note sent to an AI assistant is cut here, so one huge note can't flood its
// context window.
const NOTE_MARKDOWN_MAX_CHARS = 40_000;

const hash = (secret: string) =>
  createHash('sha256').update(secret).digest('hex');

const scopesOf = (token: { scopes?: TokenScope[] }) =>
  token.scopes?.length ? token.scopes : DEFAULT_TOKEN_SCOPES;

const MISSING_SCOPE: Record<TokenScope, string> = {
  'notes:write': "This token can't add notes.",
  'notes:read':
    "This token can't read notes. Create one with “Can read and search notes” in Profile → Integrations.",
};

export interface ExternalNote {
  title?: string;
  content: string;
  format: ExternalFormat;
  category?: string;
  /** Where it came from (a clipped page); added as a source line */
  url?: string;
}

/** A passage found by MCP search (POST /integrations/mcp/search). */
export interface McpPassage {
  noteId: string;
  noteTitle: string;
  source: 'note' | 'file';
  fileName?: string;
  page?: number;
  match: 'semantic' | 'keyword' | 'both';
  /** Cosine similarity, for semantic matches */
  similarity: number | null;
  text: string;
}

/** Ways in from outside the app: adding notes, and (MCP) reading and searching them. */
@Injectable()
export class IntegrationsService {
  /** Request times in the last minute, per token hash */
  private readonly recentRequests = new Map<string, number[]>();

  constructor(
    @InjectModel(IntegrationToken.name)
    private tokenModel: Model<IntegrationTokenDocument>,
    private readonly notes: NotesService,
    private readonly search: SearchService,
    private readonly serviceTokens: ServiceTokenService,
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
          id: (t._id as Types.ObjectId).toHexString(),
          name: t.name,
          prefix: t.prefix,
          scopes: scopesOf(t),
          createdAt: t.createdAt,
          lastUsedAt: t.lastUsedAt ?? null,
        })),
      inbox: inbox?.inboxKey ? this.inboxView(inbox.inboxKey) : null,
      inboundDomain: process.env.INBOUND_EMAIL_DOMAIN?.trim() || null,
    };
  }

  /** A new token; the secret is returned now and never again. */
  async createToken(
    userId: string,
    name: string,
    scopes: TokenScope[] = DEFAULT_TOKEN_SCOPES,
  ) {
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
      scopes: [...new Set(scopes)],
    });
    return {
      id: String(doc._id),
      name: doc.name,
      scopes: scopesOf(doc),
      token: secret,
    };
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

  /**
   * The user a token belongs to (and marks it used). Throws 401 for an unknown
   * or revoked token, 403 when it lacks `scope`, 429 over the rate limit.
   */
  async userForToken(
    secret: string | undefined,
    scope: TokenScope,
  ): Promise<string> {
    if (!secret?.startsWith(TOKEN_PREFIX)) {
      throw new UnauthorizedException('A valid integration token is required.');
    }
    const secretHash = hash(secret);
    this.checkRateLimit(secretHash);
    const token = await this.tokenModel
      .findOneAndUpdate(
        { secretHash, kind: 'token' },
        { $set: { lastUsedAt: new Date() } },
      )
      .lean()
      .exec();
    if (!token) throw new UnauthorizedException('Unknown or revoked token.');
    if (!scopesOf(token).includes(scope)) {
      throw new ForbiddenException(MISSING_SCOPE[scope]);
    }
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
    return this.notes.create(
      '',
      userId,
      {
        title: note.title?.trim().slice(0, 300),
        category: note.category?.trim().slice(0, 100),
        content,
      },
      [],
    );
  }

  // ── MCP: reading and searching (tokens with notes:read) ────────────────

  /** Ranked passages for a query from the user's notes and attachments. */
  async searchPassages(
    userId: string,
    query: string,
    limit: number,
    noteIds?: string[],
  ) {
    const result = await this.search.searchPassages(
      this.serviceTokens.forUser(userId),
      userId,
      query,
      { limit, noteIds },
    );
    return {
      query,
      mode: result.semantic ? ('hybrid' as const) : ('keyword' as const),
      pendingNotes: result.pendingNotes,
      ...(result.notice ? { notice: result.notice } : {}),
      results: result.chunks.map(
        (chunk): McpPassage => ({
          noteId: chunk.noteId ?? '',
          noteTitle: chunk.noteTitle,
          source: chunk.sourceType === 'file' ? 'file' : 'note',
          ...(chunk.sourceName
            ? { fileName: displayFileName(chunk.sourceName) }
            : {}),
          ...(chunk.sourcePage ? { page: chunk.sourcePage } : {}),
          match:
            chunk.similarity !== null && chunk.keywordMatch
              ? 'both'
              : chunk.keywordMatch
                ? 'keyword'
                : 'semantic',
          similarity:
            chunk.similarity === null
              ? null
              : Math.round(chunk.similarity * 1000) / 1000,
          text: chunk.text,
        }),
      ),
    };
  }

  /** One note as Markdown (with front matter), cut at NOTE_MARKDOWN_MAX_CHARS. */
  async getNote(userId: string, id: string) {
    const { note, folderPath, files, markdown } = await this.notes
      .noteMarkdown(userId, id)
      .catch(() => {
        throw new NotFoundException('Note not found.');
      });
    const truncated = markdown.length > NOTE_MARKDOWN_MAX_CHARS;
    return {
      id: String(note._id),
      title: note.title,
      category: note.category ?? '',
      folder: folderPath ?? null,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      attachments: files.map(displayFileName),
      markdown: truncated
        ? markdown.slice(0, NOTE_MARKDOWN_MAX_CHARS)
        : markdown,
      truncated,
      length: markdown.length,
    };
  }

  private checkRateLimit(secretHash: string) {
    const now = Date.now();
    const recent = (this.recentRequests.get(secretHash) ?? []).filter(
      (at) => now - at < RATE_WINDOW_MS,
    );
    if (recent.length >= TOKEN_RATE_LIMIT) {
      this.recentRequests.set(secretHash, recent);
      throw new HttpException(
        `Too many requests: at most ${TOKEN_RATE_LIMIT} a minute per token. Try again shortly.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.recentRequests.set(secretHash, recent);
    // Forget tokens that have gone quiet, so the map can't grow without bound.
    if (this.recentRequests.size > 1000) {
      for (const [key, times] of this.recentRequests) {
        if (!times.some((at) => now - at < RATE_WINDOW_MS)) {
          this.recentRequests.delete(key);
        }
      }
    }
  }

  private inboxView(key: string) {
    const domain = process.env.INBOUND_EMAIL_DOMAIN?.trim();
    const apiUrl = (
      process.env.PUBLIC_API_URL ?? 'http://localhost:3000'
    ).replace(/\/$/, '');
    return {
      address: domain ? `${key}@${domain}` : null,
      // Point the email provider's inbound webhook here.
      webhookUrl: `${apiUrl}/integrations/email/${key}`,
    };
  }
}
