import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Note, NoteDocument } from 'src/common/schema/note';
import {
  USAGE_KINDS,
  UsageEvent,
  UsageEventDocument,
  type UsageKind,
} from 'src/common/schema/usage-event';
import { estimateCostUsd } from './pricing';

export interface UsageDashboard {
  days: number;
  timeZone: string;
  totals: {
    tokens: number;
    requests: number;
    searches: number;
    chatMessages: number;
    notesCreated: number;
    notesEdited: number;
    estimatedCostUsd: number;
  };
  /** One row per day of the range, oldest first, gaps filled with zeros */
  daily: {
    date: string;
    tokens: Record<UsageKind, number>;
    notesCreated: number;
  }[];
  models: {
    provider: string;
    model: string;
    tokens: number;
    requests: number;
    estimatedCostUsd: number;
  }[];
  topSearches: { query: string; count: number; lastAskedAt: Date }[];
}

const TOP_SEARCHES = 10;

/** The usage dashboard: tokens over time, notes written, top questions, cost. */
@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(UsageEvent.name)
    private readonly usageModel: Model<UsageEventDocument>,
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
  ) {}

  async dashboard(
    userId: string,
    days: number,
    timeZone: string,
  ): Promise<UsageDashboard> {
    const uid = new Types.ObjectId(userId);
    const since = startOfRange(days, timeZone);
    const day = (field: string) => ({
      $dateToString: { format: '%Y-%m-%d', date: field, timezone: timeZone },
    });
    const dates = rangeDates(days, timeZone);
    // A coarse match uses the index; the date in the user's zone makes it exact.
    const inRange = (field: string, extra: Record<string, unknown> = {}) => [
      { $match: { userId: uid, [field]: { $gte: since }, ...extra } },
      { $addFields: { day: day(`$${field}`) } },
      { $match: { day: { $gte: dates[0] } } },
    ];

    const [tokensByDay, notesByDay, models, searches, notesEdited] =
      await Promise.all([
        this.usageModel
          .aggregate<{
            _id: { date: string; kind: UsageKind };
            tokens: number;
            requests: number;
          }>([
            ...inRange('createdAt'),
            {
              $group: {
                _id: { date: '$day', kind: '$kind' },
                tokens: { $sum: '$tokens' },
                requests: { $sum: 1 },
              },
            },
          ])
          .exec(),
        this.noteModel
          .aggregate<{ _id: string; count: number }>([
            ...inRange('createdAt'),
            { $group: { _id: '$day', count: { $sum: 1 } } },
          ])
          .exec(),
        this.usageModel
          .aggregate<{
            _id: { provider: string; model: string };
            tokens: number;
            requests: number;
          }>([
            ...inRange('createdAt'),
            {
              $group: {
                _id: { provider: '$provider', model: '$model' },
                tokens: { $sum: '$tokens' },
                requests: { $sum: 1 },
              },
            },
            { $sort: { tokens: -1 } },
          ])
          .exec(),
        this.usageModel
          .aggregate<{ _id: string; count: number; lastAskedAt: Date }>([
            ...inRange('createdAt', {
              kind: 'search',
              query: { $exists: true, $ne: '' },
            }),
            {
              $group: {
                _id: { $toLower: { $trim: { input: '$query' } } },
                count: { $sum: 1 },
                lastAskedAt: { $max: '$createdAt' },
              },
            },
            { $sort: { count: -1, lastAskedAt: -1 } },
            { $limit: TOP_SEARCHES },
          ])
          .exec(),
        this.noteModel
          .aggregate<{ count: number }>([
            ...inRange('updatedAt', {
              $expr: { $gt: ['$updatedAt', '$createdAt'] },
            }),
            { $count: 'count' },
          ])
          .exec()
          .then((rows) => rows[0]?.count ?? 0),
      ]);

    const emptyKinds = () =>
      Object.fromEntries(USAGE_KINDS.map((k) => [k, 0])) as Record<
        UsageKind,
        number
      >;
    const daily = dates.map((date) => ({
      date,
      tokens: emptyKinds(),
      notesCreated: 0,
    }));
    const byDate = new Map(daily.map((d) => [d.date, d]));
    let requests = 0;
    let searchCount = 0;
    let chatCount = 0;
    for (const row of tokensByDay) {
      const entry = byDate.get(row._id.date);
      if (entry) entry.tokens[row._id.kind] += row.tokens;
      requests += row.requests;
      if (row._id.kind === 'search') searchCount += row.requests;
      if (row._id.kind === 'chat') chatCount += row.requests;
    }
    let notesCreated = 0;
    for (const row of notesByDay) {
      const entry = byDate.get(row._id);
      if (entry) entry.notesCreated = row.count;
      notesCreated += row.count;
    }

    const modelRows = models.map((row) => ({
      provider: row._id.provider,
      model: row._id.model,
      tokens: row.tokens,
      requests: row.requests,
      estimatedCostUsd: estimateCostUsd(
        row._id.provider,
        row._id.model,
        row.tokens,
      ),
    }));

    return {
      days,
      timeZone,
      totals: {
        tokens: modelRows.reduce((sum, m) => sum + m.tokens, 0),
        requests,
        searches: searchCount,
        chatMessages: chatCount,
        notesCreated,
        notesEdited,
        estimatedCostUsd: modelRows.reduce(
          (sum, m) => sum + m.estimatedCostUsd,
          0,
        ),
      },
      daily,
      models: modelRows,
      topSearches: searches.map((s) => ({
        query: s._id,
        count: s.count,
        lastAskedAt: s.lastAskedAt,
      })),
    };
  }
}

/** "YYYY-MM-DD" of a moment in a time zone. */
function dateIn(moment: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(moment);
}

/** The last `days` dates (today included) in a time zone, oldest first. */
function rangeDates(days: number, timeZone: string): string[] {
  const dates: string[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    dates.push(dateIn(new Date(now - i * 86_400_000), timeZone));
  }
  return [...new Set(dates)];
}

/** Early enough to include the whole first day of the range in any zone. */
function startOfRange(days: number, _timeZone: string): Date {
  return new Date(Date.now() - (days * 86_400_000 + 14 * 3_600_000));
}
