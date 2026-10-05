import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { randomInt } from 'node:crypto';
import { isValidObjectId, Model, Types } from 'mongoose';
import { firstValueFrom } from 'rxjs';
import { fileStorageApi } from 'src/common/constant/endpoint';
import { ChatSession, ChatSessionDocument } from 'src/common/schema/chat-session';
import { IndexJob, IndexJobDocument } from 'src/common/schema/index-job';
import { Note, NoteDocument } from 'src/common/schema/note';
import { UsageEvent, UsageEventDocument } from 'src/common/schema/usage-event';
import { User, UserDocument } from 'src/common/schema/user';
import { Voucher, VoucherDocument } from 'src/common/schema/voucher';
import { correlationHeaders } from 'src/common/request-context';
import { errorMessage } from 'src/common/utils/http-error';
import { planOf, type PlanId } from 'src/users/plans';
import { RealtimeService } from 'src/realtime/realtime.service';

// No look-alikes (0/O, 1/I/L), like scripts/create-vouchers.mjs.
const VOUCHER_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const USERS_PAGE = 25;

/** Operations data and actions for the admin panel. */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
    @InjectModel(ChatSession.name)
    private sessionModel: Model<ChatSessionDocument>,
    @InjectModel(IndexJob.name) private jobModel: Model<IndexJobDocument>,
    @InjectModel(Voucher.name) private voucherModel: Model<VoucherDocument>,
    @InjectModel(UsageEvent.name)
    private usageModel: Model<UsageEventDocument>,
    private readonly http: HttpService,
    private readonly jwt: JwtService,
    private readonly realtime: RealtimeService,
  ) {}

  /** System health: users, content, the indexing queue and recent AI use. */
  async overview() {
    const hourAgo = new Date(Date.now() - 3_600_000);
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [
      plans,
      notes,
      chats,
      queue,
      indexedLastHour,
      indexedLastDay,
      failedLastDay,
      recentErrors,
      oldestQueued,
      usage,
      storage,
    ] = await Promise.all([
      this.userModel
        .aggregate<{ _id: string; count: number }>([
          { $group: { _id: { $toLower: { $ifNull: ['$type', 'free'] } }, count: { $sum: 1 } } },
        ])
        .exec(),
      this.noteModel.estimatedDocumentCount().exec(),
      this.sessionModel.estimatedDocumentCount().exec(),
      this.jobModel
        .aggregate<{ _id: string; count: number }>([
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ])
        .exec(),
      this.jobModel.countDocuments({ indexedAt: { $gte: hourAgo } }).exec(),
      this.jobModel.countDocuments({ indexedAt: { $gte: dayAgo } }).exec(),
      this.jobModel
        .countDocuments({ status: 'failed', updatedAt: { $gte: dayAgo } })
        .exec(),
      this.jobModel
        .find({ status: 'failed', error: { $exists: true } })
        .sort({ updatedAt: -1 })
        .limit(8)
        .select('kind targetId error updatedAt userId')
        .lean()
        .exec(),
      this.jobModel
        .findOne({ status: 'queued' })
        .sort({ runAt: 1 })
        .select('runAt')
        .lean()
        .exec(),
      this.usageModel
        .aggregate<{ _id: string; tokens: number; requests: number }>([
          { $match: { createdAt: { $gte: dayAgo } } },
          {
            $group: {
              _id: '$provider',
              tokens: { $sum: '$tokens' },
              requests: { $sum: 1 },
            },
          },
          { $sort: { tokens: -1 } },
        ])
        .exec(),
      this.storageUsage(),
    ]);

    const byStatus = Object.fromEntries(queue.map((q) => [q._id, q.count]));
    const finishedLastDay = indexedLastDay + failedLastDay;
    return {
      users: {
        total: plans.reduce((sum, p) => sum + p.count, 0),
        byPlan: Object.fromEntries(plans.map((p) => [planOf(p._id), p.count])),
      },
      content: { notes, chats },
      queue: {
        queued: byStatus.queued ?? 0,
        processing: byStatus.processing ?? 0,
        ready: byStatus.ready ?? 0,
        failed: byStatus.failed ?? 0,
        skipped: byStatus.skipped ?? 0,
        oldestQueuedAt: oldestQueued?.runAt ?? null,
        indexedLastHour,
        indexedLastDay,
        errorRateLastDay: finishedLastDay ? failedLastDay / finishedLastDay : 0,
        recentErrors: recentErrors.map((job) => ({
          kind: job.kind,
          targetId: String(job.targetId),
          userId: String(job.userId),
          error: job.error,
          at: job.updatedAt,
        })),
      },
      aiLastDay: usage.map((u) => ({
        provider: u._id,
        tokens: u.tokens,
        requests: u.requests,
      })),
      storage: storage
        ? {
            totalBytes: storage.users.reduce((sum, u) => sum + u.usedBytes, 0),
            quotaBytes: storage.quotaBytes,
          }
        : null,
    };
  }

  /** Users, newest first, optionally matching a name or email. */
  async users(q: string | undefined, page: number) {
    const filter = q?.trim()
      ? {
          $or: [
            { name: new RegExp(escapeRegExp(q.trim()), 'i') },
            { email: new RegExp(escapeRegExp(q.trim()), 'i') },
          ],
        }
      : {};
    const [users, total, storage] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ _id: -1 })
        .skip((page - 1) * USERS_PAGE)
        .limit(USERS_PAGE)
        .select('name email type totalTokensUsed createdAt llmConfigs.isActive')
        .lean()
        .exec(),
      this.userModel.countDocuments(filter).exec(),
      this.storageUsage(),
    ]);
    const ids = users.map((u) => u._id);
    const notes = await this.noteModel
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { userId: { $in: ids } } },
        { $group: { _id: '$userId', count: { $sum: 1 } } },
      ])
      .exec();
    const notesBy = new Map(notes.map((n) => [String(n._id), n.count]));
    const storageBy = new Map(
      storage?.users.map((u) => [u.userId, u.usedBytes]) ?? [],
    );
    return {
      page,
      pageSize: USERS_PAGE,
      total,
      users: users.map((u) => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        plan: planOf(u.type),
        ownKey: Boolean(u.llmConfigs?.some((c) => c.isActive)),
        totalTokensUsed: u.totalTokensUsed ?? 0,
        notes: notesBy.get(String(u._id)) ?? 0,
        storageBytes: storageBy.get(String(u._id)) ?? 0,
        createdAt: (u as { createdAt?: Date }).createdAt ?? null,
      })),
    };
  }

  async setPlan(userId: string, plan: PlanId) {
    if (!isValidObjectId(userId)) throw new NotFoundException('User not found');
    const user = await this.userModel
      .findByIdAndUpdate(userId, { $set: { type: plan } }, { new: true })
      .select('email type')
      .exec();
    if (!user) throw new NotFoundException('User not found');
    this.realtime.emit(userId, 'profile:changed');
    return { id: userId, plan: planOf(user.type) };
  }

  async vouchers(status: 'all' | 'unused' | 'redeemed') {
    const filter =
      status === 'unused'
        ? { redeemed: false }
        : status === 'redeemed'
          ? { redeemed: true }
          : {};
    const vouchers = await this.voucherModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .populate<{ redeemedBy?: { email: string } }>('redeemedBy', 'email')
      .lean()
      .exec();
    return vouchers.map((v) => ({
      code: v.code,
      redeemed: v.redeemed,
      redeemedAt: v.redeemedAt ?? null,
      redeemedBy: v.redeemedBy?.email ?? null,
      createdAt: (v as { createdAt?: Date }).createdAt ?? null,
    }));
  }

  async createVouchers(count: number) {
    const codes: string[] = [];
    while (codes.length < count) {
      const code = `${part()}-${part()}`;
      try {
        await this.voucherModel.create({ code, redeemed: false });
        codes.push(code);
      } catch (error) {
        // A duplicate code: draw another.
        if ((error as { code?: number }).code !== 11000) throw error;
      }
    }
    return { codes };
  }

  /** Revoke an unused code. Redeemed codes stay as a record. */
  async revokeVoucher(code: string) {
    const voucher = await this.voucherModel.findOne({ code }).exec();
    if (!voucher) throw new NotFoundException('Code not found');
    if (voucher.redeemed) {
      throw new BadRequestException('This code was already redeemed.');
    }
    await voucher.deleteOne();
    return { code, revoked: true };
  }

  /** Bytes stored per user, from apkh-storage; null if it can't be reached. */
  private async storageUsage(): Promise<{
    users: { userId: string; usedBytes: number }[];
    quotaBytes: number;
  } | null> {
    const token = this.jwt.sign(
      { _id: 'admin', svc: 'admin' },
      { expiresIn: '1m' },
    );
    try {
      const res = await firstValueFrom(
        this.http.get<{
          users: { userId: string; usedBytes: number }[];
          quotaBytes: number;
        }>(`${fileStorageApi}admin/usage`, {
          headers: { Authorization: `Bearer ${token}`, ...correlationHeaders() },
          timeout: 15_000,
        }),
      );
      return res.data;
    } catch (error) {
      this.logger.warn(`Storage usage unavailable: ${errorMessage(error)}`);
      return null;
    }
  }
}

function part() {
  return Array.from(
    { length: 4 },
    () => VOUCHER_ALPHABET[randomInt(VOUCHER_ALPHABET.length)],
  ).join('');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
