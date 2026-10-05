import { webApi } from "@/services/axios";
import type { PlanId } from "@/models/user";

export interface AdminOverview {
  users: { total: number; byPlan: Partial<Record<PlanId, number>> };
  content: { notes: number; chats: number };
  queue: {
    queued: number;
    processing: number;
    ready: number;
    failed: number;
    skipped: number;
    oldestQueuedAt: string | null;
    indexedLastHour: number;
    indexedLastDay: number;
    errorRateLastDay: number;
    recentErrors: { kind: string; targetId: string; userId: string; error: string; at: string }[];
  };
  aiLastDay: { provider: string; tokens: number; requests: number }[];
  storage: { totalBytes: number; quotaBytes: number } | null;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  plan: PlanId;
  ownKey: boolean;
  totalTokensUsed: number;
  notes: number;
  storageBytes: number;
  createdAt: string | null;
}

export interface AdminVoucher {
  code: string;
  redeemed: boolean;
  redeemedAt: string | null;
  redeemedBy: string | null;
  createdAt: string | null;
}

export async function getAdminOverview() {
  const res = await webApi.get("/admin/overview");
  return res.data.data as AdminOverview;
}

export async function getAdminUsers(q: string, page: number) {
  const res = await webApi.get("/admin/users", { params: { q: q || undefined, page } });
  return res.data.data as { page: number; pageSize: number; total: number; users: AdminUser[] };
}

export async function setUserPlan(userId: string, plan: PlanId) {
  const res = await webApi.patch(`/admin/users/${userId}/plan`, { plan });
  return res.data.data as { id: string; plan: PlanId };
}

export async function getVouchers(status: "all" | "unused" | "redeemed") {
  const res = await webApi.get("/admin/vouchers", { params: { status } });
  return res.data.data as AdminVoucher[];
}

export async function createVouchers(count: number) {
  const res = await webApi.post("/admin/vouchers", { count });
  return res.data.data as { codes: string[] };
}

export async function revokeVoucher(code: string) {
  await webApi.delete(`/admin/vouchers/${encodeURIComponent(code)}`);
}
