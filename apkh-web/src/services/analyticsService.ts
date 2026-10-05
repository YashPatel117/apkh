import { webApi } from "@/services/axios";

export const USAGE_KINDS = ["search", "chat", "summary", "rewrite", "index"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

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
  daily: { date: string; tokens: Record<UsageKind, number>; notesCreated: number }[];
  models: { provider: string; model: string; tokens: number; requests: number; estimatedCostUsd: number }[];
  topSearches: { query: string; count: number; lastAskedAt: string }[];
}

export async function getUsageDashboard(days: number) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const res = await webApi.get("/analytics", { params: { days, tz } });
  return res.data.data as UsageDashboard;
}
