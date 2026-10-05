"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Coins, FilePlus2, FilePen, MessagesSquare, Search, Table2, Wallet, Zap } from "lucide-react";
import { getUsageDashboard, UsageDashboard, USAGE_KINDS, UsageKind } from "@/services/analyticsService";
import { getErrorMessage } from "@/services/axios";
import { BarChart, BarDatum, BarSeries, Legend } from "@/components/charts/barChart";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";

const RANGES = [7, 30, 90] as const;


const dayShort = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dayLong = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const usd = (value: number) => (value > 0 && value < 0.01 ? "< $0.01" : `$${value.toFixed(2)}`);

function Tile({ Icon, label, value, hint }: { Icon: typeof Coins; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-3xl border border-line bg-surface p-4 sm:p-5">
      <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <Icon className="size-4" />
      </span>
      <p className="mt-3 text-2xl font-bold tracking-tight text-fg">{value}</p>
      <p className="mt-0.5 text-sm text-fg-muted">{label}</p>
      {hint && <p className="mt-1 text-xs text-fg-subtle">{hint}</p>}
    </div>
  );
}

function Card({ title, description, action, children }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** How much AI the user used, on what, and with which models. */
export default function AnalyticsPage() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [data, setData] = useState<UsageDashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [asTable, setAsTable] = useState(false);
  const t = useT();
  // Fixed slot per kind, so a kind keeps its colour whatever the range shows.
  const tokenSeries: BarSeries[] = useMemo(
    () => USAGE_KINDS.map((kind, i) => ({ key: kind, label: t(`usage.kind.${kind}`), color: `var(--series-${i + 1})` })),
    [t],
  );
  const noteSeries: BarSeries[] = useMemo(() => [{ key: "notes", label: t("usage.notesCreated"), color: "var(--series-1)" }], [t]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getUsageDashboard(days)
      .then((dashboard) => !cancelled && setData(dashboard))
      .catch((err) => !cancelled && setError(getErrorMessage(err, t("usage.loadFailed"))))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [days, t]);

  const tokenData: BarDatum[] = useMemo(
    () =>
      (data?.daily ?? []).map((d) => {
        const date = new Date(`${d.date}T00:00:00Z`);
        return { label: dayLong.format(date), shortLabel: dayShort.format(date), values: d.tokens };
      }),
    [data],
  );
  const noteData: BarDatum[] = useMemo(
    () => tokenData.map((d, i) => ({ ...d, values: { notes: data!.daily[i].notesCreated } })),
    [tokenData, data],
  );
  const usedKinds = useMemo(() => tokenSeries.filter((s) => data?.daily.some((d) => d.tokens[s.key as UsageKind] > 0)), [data, tokenSeries]);
  const totals = data?.totals;
  const noUsage = totals && totals.tokens === 0 && totals.requests === 0 && totals.notesCreated === 0 && totals.notesEdited === 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-12 sm:px-6 lg:px-8 lg:pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">{t("usage.title")}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {t("usage.subtitle", { days })}
            {data ? ` · ${data.timeZone}` : ""}
          </p>
        </div>
        <div role="radiogroup" aria-label={t("usage.range")} className="flex rounded-xl border border-line bg-surface p-1">
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              role="radio"
              aria-checked={days === range}
              onClick={() => setDays(range)}
              className={cn(
                "cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                days === range ? "bg-accent-soft text-accent-fg" : "text-fg-muted hover:text-fg",
              )}
            >
              {t("usage.days", { days: range })}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>
      ) : !data || !totals ? (
        <div className="mt-6 grid animate-pulse grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-36 rounded-3xl border border-line bg-surface" />
          ))}
        </div>
      ) : (
        <div className={cn("transition-opacity", loading && "opacity-60")}>
          <section className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-label={t("usage.totals")}>
            <Tile Icon={Zap} label={t("usage.tokens")} value={compact.format(totals.tokens)} hint={t("usage.exactly", { count: totals.tokens })} />
            <Tile Icon={BarChart3} label={t("usage.requests")} value={totals.requests.toLocaleString()} />
            <Tile Icon={Search} label={t("usage.questions")} value={totals.searches.toLocaleString()} />
            <Tile Icon={MessagesSquare} label={t("usage.chatMessages")} value={totals.chatMessages.toLocaleString()} />
            <Tile Icon={FilePlus2} label={t("usage.notesCreated")} value={totals.notesCreated.toLocaleString()} />
            <Tile Icon={FilePen} label={t("usage.notesEdited")} value={totals.notesEdited.toLocaleString()} />
            <Tile Icon={Wallet} label={t("usage.cost")} value={usd(totals.estimatedCostUsd)} hint={t("usage.costHint")} />
            <Tile Icon={Coins} label={t("usage.perRequest")} value={totals.requests ? Math.round(totals.tokens / totals.requests).toLocaleString() : "—"} />
          </section>

          {noUsage ? (
            <p className="mt-6 rounded-3xl border border-dashed border-line px-6 py-12 text-center text-sm text-fg-muted">
              {t("usage.nothing", { days })}
            </p>
          ) : (
            <>
              <div className="mt-6">
                <Card
                  title={t("usage.tokensPerDay")}
                  description={t("usage.tokensPerDayHint")}
                  action={
                    <Button variant="ghost" size="sm" onClick={() => setAsTable((v) => !v)} icon={asTable ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}>
                      {asTable ? t("usage.showChart") : t("usage.showTable")}
                    </Button>
                  }
                >
                  {asTable ? (
                    <div className="max-h-96 overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface text-left text-xs text-fg-subtle">
                          <tr>
                            <th className="py-2 pr-4 font-medium">{t("usage.day")}</th>
                            {tokenSeries.map((s) => (
                              <th key={s.key} className="py-2 pr-4 text-right font-medium">
                                {s.label}
                              </th>
                            ))}
                            <th className="py-2 text-right font-medium">{t("usage.total")}</th>
                          </tr>
                        </thead>
                        <tbody className="tabular-nums">
                          {data.daily.map((d) => (
                            <tr key={d.date} className="border-t border-line">
                              <td className="py-1.5 pr-4 text-fg-muted">{dayShort.format(new Date(`${d.date}T00:00:00Z`))}</td>
                              {USAGE_KINDS.map((kind) => (
                                <td key={kind} className="py-1.5 pr-4 text-right text-fg">
                                  {d.tokens[kind].toLocaleString()}
                                </td>
                              ))}
                              <td className="py-1.5 text-right font-medium text-fg">
                                {USAGE_KINDS.reduce((sum, kind) => sum + d.tokens[kind], 0).toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <>
                      <Legend series={usedKinds.length ? usedKinds : tokenSeries} />
                      <div className="mt-4">
                        <BarChart data={tokenData} series={tokenSeries} label={t("usage.tokensChart")} />
                      </div>
                    </>
                  )}
                </Card>
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <Card title={t("usage.notesPerDay")}>
                  <BarChart data={noteData} series={noteSeries} label={t("usage.notesPerDay")} height={160} integer />
                </Card>

                <Card title={t("usage.mostAsked")} description={t("usage.mostAskedHint")}>
                  {data.topSearches.length === 0 ? (
                    <p className="text-sm text-fg-muted">{t("usage.noQuestions")}</p>
                  ) : (
                    <ol className="space-y-2">
                      {data.topSearches.map((search, i) => (
                        <li key={search.query} className="flex items-start gap-3 text-sm">
                          <span className="w-5 shrink-0 text-right text-xs font-semibold text-fg-subtle tabular-nums">{i + 1}</span>
                          <span className="min-w-0 flex-1 text-fg">{search.query}</span>
                          <span className="shrink-0 text-xs text-fg-muted tabular-nums">×{search.count}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>
              </div>

              <div className="mt-6">
                <Card title={t("usage.byModel")} description={t("usage.byModelHint")}>
                  {data.models.length === 0 ? (
                    <p className="text-sm text-fg-muted">{t("usage.noRequests")}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs text-fg-subtle">
                          <tr>
                            <th className="py-2 pr-4 font-medium">{t("usage.model")}</th>
                            <th className="py-2 pr-4 text-right font-medium">{t("usage.requestsCol")}</th>
                            <th className="py-2 pr-4 text-right font-medium">{t("usage.tokensCol")}</th>
                            <th className="py-2 text-right font-medium">{t("usage.costCol")}</th>
                          </tr>
                        </thead>
                        <tbody className="tabular-nums">
                          {data.models.map((m) => (
                            <tr key={`${m.provider}/${m.model}`} className="border-t border-line">
                              <td className="py-2 pr-4">
                                <span className="font-medium text-fg">{m.model}</span>
                                <span className="ml-2 text-xs text-fg-subtle">{m.provider}</span>
                              </td>
                              <td className="py-2 pr-4 text-right text-fg">{m.requests.toLocaleString()}</td>
                              <td className="py-2 pr-4 text-right text-fg">{m.tokens.toLocaleString()}</td>
                              <td className="py-2 text-right text-fg">{usd(m.estimatedCostUsd)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
