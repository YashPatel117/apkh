"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, Check, ChevronLeft, ChevronRight, Copy, HardDrive, ListChecks, NotebookText, Plus, RefreshCw, Search, ShieldAlert, Ticket, Users } from "lucide-react";
import { useAppSelector } from "@/store/hook";
import {
  AdminOverview,
  AdminUser,
  AdminVoucher,
  createVouchers,
  getAdminOverview,
  getAdminUsers,
  getVouchers,
  revokeVoucher,
  setUserPlan,
} from "@/services/adminService";
import { getErrorMessage } from "@/services/axios";
import type { PlanId } from "@/models/user";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Input";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";

const PLANS: PlanId[] = ["free", "pro"];
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unit]}`;
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-fg">{title}</h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Figure({ Icon, label, value, detail }: { Icon: typeof Users; label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-3xl border border-line bg-surface p-4 sm:p-5">
      <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <Icon className="size-4" />
      </span>
      <p className="mt-3 text-2xl font-bold tracking-tight text-fg">{value}</p>
      <p className="mt-0.5 text-sm text-fg-muted">{label}</p>
      {detail && <p className="mt-1 text-xs text-fg-subtle">{detail}</p>}
    </div>
  );
}

/** Operators only (the server's ADMIN_EMAILS): system health, users and plans, vouchers. */
export default function AdminPage() {
  const user = useAppSelector((state) => state.auth.user);
  const t = useT();
  if (!user) return null;
  if (!user.isAdmin) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <ShieldAlert className="mx-auto size-8 text-fg-subtle" />
          <h1 className="mt-4 text-lg font-semibold text-fg">{t("admin.only")}</h1>
          <p className="mt-1 text-sm text-fg-muted">{t("admin.onlyText")}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 pt-6 pb-12 sm:px-6 lg:px-8 lg:pt-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">{t("admin.title")}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t("admin.subtitle")}</p>
      </div>
      <Overview />
      <UsersSection />
      <VouchersSection />
    </div>
  );
}

function Overview() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const t = useT();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await getAdminOverview());
    } catch (err) {
      setError(getErrorMessage(err, t("admin.overviewFailed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>;
  if (!data) {
    return (
      <div className="flex justify-center py-10 text-fg-subtle">
        <Spinner />
      </div>
    );
  }
  const { users, content, queue, aiLastDay, storage } = data;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Figure
          Icon={Users}
          label={t("admin.users")}
          value={users.total.toLocaleString()}
          detail={PLANS.map((plan) => `${users.byPlan[plan] ?? 0} ${plan}`).join(" · ")}
        />
        <Figure Icon={NotebookText} label={t("admin.notes")} value={content.notes.toLocaleString()} detail={t("admin.conversations", { count: content.chats })} />
        <Figure
          Icon={ListChecks}
          label={t("admin.indexedDay")}
          value={queue.indexedLastDay.toLocaleString()}
          detail={t("admin.indexedDetail", { hour: queue.indexedLastHour, rate: (queue.errorRateLastDay * 100).toFixed(1) })}
        />
        <Figure
          Icon={HardDrive}
          label={t("admin.storage")}
          value={storage ? bytes(storage.totalBytes) : "—"}
          detail={storage ? t("admin.quota", { size: bytes(storage.quotaBytes) }) : t("admin.storageDown")}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title={t("admin.queue")}
          action={
            <Button variant="ghost" size="sm" onClick={() => void load()} loading={loading} icon={<RefreshCw className="size-3.5" />}>
              {t("admin.refresh")}
            </Button>
          }
        >
          <div className="grid grid-cols-5 gap-2 text-center">
            {(["queued", "processing", "ready", "failed", "skipped"] as const).map((key) => (
              <div key={key} className="rounded-2xl bg-surface-2 px-2 py-2.5">
                <p className={cn("text-lg font-bold tabular-nums", key === "failed" && queue.failed ? "text-rose-600 dark:text-rose-400" : "text-fg")}>
                  {queue[key].toLocaleString()}
                </p>
                <p className="text-xs text-fg-muted">{t(`admin.q.${key}`)}</p>
              </div>
            ))}
          </div>
          {queue.oldestQueuedAt && <p className="mt-3 text-xs text-fg-subtle">{t("admin.oldest", { time: timeFormat.format(new Date(queue.oldestQueuedAt)) })}</p>}
          {queue.recentErrors.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold text-fg">{t("admin.recentFailures")}</h3>
              <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
                {queue.recentErrors.map((e, i) => (
                  <li key={i} className="rounded-xl bg-surface-2 px-3 py-2 text-xs">
                    <p className="flex justify-between gap-2 text-fg-subtle">
                      <span>
                        {e.kind} · {e.targetId}
                      </span>
                      <span className="shrink-0">{timeFormat.format(new Date(e.at))}</span>
                    </p>
                    <p className="mt-1 break-words text-fg-muted">{e.error}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>

        <Section title={t("admin.aiDay")}>
          {aiLastDay.length === 0 ? (
            <p className="text-sm text-fg-muted">{t("admin.noAiDay")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-fg-subtle">
                <tr>
                  <th className="py-2 pr-4 font-medium">{t("admin.provider")}</th>
                  <th className="py-2 pr-4 text-right font-medium">{t("usage.requestsCol")}</th>
                  <th className="py-2 text-right font-medium">{t("usage.tokensCol")}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {aiLastDay.map((row) => (
                  <tr key={row.provider} className="border-t border-line">
                    <td className="py-2 pr-4 font-medium text-fg">{row.provider}</td>
                    <td className="py-2 pr-4 text-right text-fg">{row.requests.toLocaleString()}</td>
                    <td className="py-2 text-right text-fg">{row.tokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </>
  );
}

function UsersSection() {
  const toast = useToast();
  const t = useT();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ total: number; pageSize: number; users: AdminUser[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAdminUsers(search, page)
      .then((data) => !cancelled && setResult(data))
      .catch((err) => !cancelled && toast(getErrorMessage(err, t("admin.usersFailed")), "error"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [search, page, toast, t]);

  const changePlan = async (target: AdminUser, plan: PlanId) => {
    setSaving(target.id);
    try {
      await setUserPlan(target.id, plan);
      setResult((prev) => prev && { ...prev, users: prev.users.map((u) => (u.id === target.id ? { ...u, plan } : u)) });
      toast(t("admin.planChanged", { name: target.name || target.email, plan }), "success");
    } catch (err) {
      toast(getErrorMessage(err, t("admin.planFailed")), "error");
    } finally {
      setSaving(null);
    }
  };

  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <Section
      title={`${t("admin.users")}${result ? ` · ${result.total.toLocaleString()}` : ""}`}
      action={
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("admin.searchUsers")}
            aria-label={t("admin.searchUsers")}
            className={cn(fieldClass, "h-9 pl-9")}
          />
        </div>
      }
    >
      <div className={cn("overflow-x-auto transition-opacity", loading && "opacity-60")}>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-fg-subtle">
            <tr>
              <th className="py-2 pr-4 font-medium">{t("admin.user")}</th>
              <th className="py-2 pr-4 font-medium">{t("admin.plan")}</th>
              <th className="py-2 pr-4 text-right font-medium">{t("admin.notes")}</th>
              <th className="py-2 pr-4 text-right font-medium">{t("admin.files")}</th>
              <th className="py-2 pr-4 text-right font-medium">{t("admin.aiTokens")}</th>
              <th className="py-2 text-right font-medium">{t("admin.joined")}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {result?.users.map((u) => (
              <tr key={u.id} className="border-t border-line">
                <td className="py-2 pr-4">
                  <p className="font-medium text-fg">{u.name || "—"}</p>
                  <p className="text-xs text-fg-subtle">
                    {u.email}
                    {u.ownKey && ` · ${t("admin.ownKey")}`}
                  </p>
                </td>
                <td className="py-2 pr-4">
                  <div className="flex items-center gap-2">
                    <select
                      value={u.plan}
                      disabled={saving === u.id}
                      onChange={(e) => void changePlan(u, e.target.value as PlanId)}
                      aria-label={t("admin.planFor", { email: u.email })}
                      className={cn(fieldClass, "h-8 w-24 cursor-pointer px-2 capitalize")}
                    >
                      {PLANS.map((plan) => (
                        <option key={plan} value={plan}>
                          {plan}
                        </option>
                      ))}
                    </select>
                    {saving === u.id && <Spinner className="size-4" />}
                  </div>
                </td>
                <td className="py-2 pr-4 text-right text-fg">{u.notes.toLocaleString()}</td>
                <td className="py-2 pr-4 text-right text-fg">{bytes(u.storageBytes)}</td>
                <td className="py-2 pr-4 text-right text-fg">{u.totalTokensUsed.toLocaleString()}</td>
                <td className="py-2 text-right text-fg-muted">{u.createdAt ? dateFormat.format(new Date(u.createdAt)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {result && result.users.length === 0 && <p className="py-6 text-center text-sm text-fg-muted">{t("admin.noUsers", { query: search })}</p>}
      </div>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm text-fg-muted">
          <Button variant="ghost" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label={t("admin.prev")}>
            <ChevronLeft className="size-4" />
          </Button>
          {t("admin.pageOf", { page, pages })}
          <Button variant="ghost" size="icon-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label={t("admin.next")}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </Section>
  );
}

function VouchersSection() {
  const toast = useToast();
  const t = useT();
  const [status, setStatus] = useState<"all" | "unused" | "redeemed">("unused");
  const [vouchers, setVouchers] = useState<AdminVoucher[] | null>(null);
  const [count, setCount] = useState(5);
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);

  const load = useCallback(() => {
    getVouchers(status)
      .then(setVouchers)
      .catch((err) => toast(getErrorMessage(err, t("admin.vouchersFailed")), "error"));
  }, [status, toast, t]);

  useEffect(load, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const { codes } = await createVouchers(count);
      setFresh(codes);
      setCopied(false);
      load();
    } catch (err) {
      toast(getErrorMessage(err, t("admin.createFailed")), "error");
    } finally {
      setCreating(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fresh.join("\n"));
      setCopied(true);
    } catch {
      toast(t("admin.copyFailed"), "error");
    }
  };

  const revoke = async () => {
    if (!pendingRevoke) return;
    try {
      await revokeVoucher(pendingRevoke);
      toast(t("admin.revoked"), "success");
      load();
    } catch (err) {
      toast(getErrorMessage(err, t("admin.revokeFailed")), "error");
      throw err;
    }
  };

  return (
    <Section
      title={t("admin.vouchers")}
      action={
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={200}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
            aria-label={t("admin.howMany")}
            className={cn(fieldClass, "h-9 w-20")}
          />
          <Button size="sm" onClick={() => void create()} loading={creating} icon={<Plus className="size-3.5" />}>
            {t("int.create")}
          </Button>
        </div>
      }
    >
      {fresh.length > 0 && (
        <div className="mb-4 rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-500/10">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              {t("admin.newCodes", { count: fresh.length })}
            </p>
            <Button variant="secondary" size="sm" onClick={() => void copy()} icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}>
              {copied ? t("int.copied") : t("admin.copyAll")}
            </Button>
          </div>
          <p className="mt-2 font-mono text-sm break-all text-emerald-900 select-all dark:text-emerald-200">{fresh.join("  ")}</p>
        </div>
      )}

      <div role="radiogroup" aria-label={t("admin.status")} className="flex w-fit rounded-xl border border-line p-1">
        {(["unused", "redeemed", "all"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={status === option}
            onClick={() => setStatus(option)}
            className={cn(
              "cursor-pointer rounded-lg px-3 py-1 text-xs font-medium transition-colors",
              status === option ? "bg-accent-soft text-accent-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            {t(`admin.s.${option}`)}
          </button>
        ))}
      </div>

      {!vouchers ? (
        <div className="flex justify-center py-6 text-fg-subtle">
          <Spinner />
        </div>
      ) : vouchers.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-muted">
          <Ticket className="mx-auto mb-2 size-5 text-fg-subtle" />
          {t("admin.noVouchers")}
        </p>
      ) : (
        <ul className="mt-3 max-h-80 divide-y divide-line overflow-y-auto">
          {vouchers.map((v) => (
            <li key={v.code} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="font-mono text-fg">{v.code}</span>
              <span className="flex items-center gap-3 text-xs text-fg-subtle">
                {v.redeemed ? (
                  <span>
                    {t("admin.redeemedOn", { date: v.redeemedAt ? dateFormat.format(new Date(v.redeemedAt)) : "" })}
                    {v.redeemedBy ? ` ${t("admin.by", { who: v.redeemedBy })}` : ""}
                  </span>
                ) : (
                  <>
                    <span>{t("admin.createdOn", { date: v.createdAt ? dateFormat.format(new Date(v.createdAt)) : "" })}</span>
                    <Button variant="ghost-danger" size="icon-sm" onClick={() => setPendingRevoke(v.code)} aria-label={t("admin.revokeCode", { code: v.code })}>
                      <Ban className="size-3.5" />
                    </Button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(pendingRevoke)}
        title={t("admin.revokeTitle")}
        message={t("admin.revokeText", { code: pendingRevoke ?? "" })}
        confirmLabel={t("int.revoke")}
        onConfirm={revoke}
        onClose={() => setPendingRevoke(null)}
      />
    </Section>
  );
}
