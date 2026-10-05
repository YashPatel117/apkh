"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";

export interface BarSeries {
  key: string;
  label: string;
  /** A CSS colour, e.g. "var(--series-1)" — slots are assigned in fixed order, never by rank */
  color: string;
}

export interface BarDatum {
  /** Shown in the tooltip */
  label: string;
  /** Shown under the axis (only some ticks are labelled) */
  shortLabel: string;
  values: Record<string, number>;
}

/** 1, 2, 2.5 or 5 × a power of ten, at least `value`. */
function niceCeil(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * power >= value) ?? 10;
  return step * power;
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

interface BarChartProps {
  data: BarDatum[];
  series: BarSeries[];
  /** Accessible name; the visible title is outside the chart */
  label: string;
  format?: (value: number) => string;
  height?: number;
  /** Whole-number values (counts): the axis ticks stay whole numbers too */
  integer?: boolean;
}

/**
 * Vertical bars over time, stacked when there is more than one series.
 * Thin bars with a 2px gap between segments, the top segment rounded,
 * hairline grid, and a tooltip with every series' value on hover or focus.
 */
export function BarChart({ data, series, label, format = (v) => v.toLocaleString(), height = 220, integer = false }: BarChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = useMemo(() => data.map((d) => series.reduce((sum, s) => sum + (d.values[s.key] ?? 0), 0)), [data, series]);
  const highest = Math.max(0, ...totals);
  // Four even steps: for counts, a multiple of 4 so every tick is a whole number.
  const max = integer ? Math.max(4, Math.ceil(highest / 4) * 4) : niceCeil(highest);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  // Label about six days under the axis, whatever the range.
  const every = Math.max(1, Math.ceil(data.length / 6));
  const stacked = series.length > 1;

  return (
    <div className="relative" role="group" aria-label={label}>
      <div className="flex" style={{ height }}>
        {/* Y axis */}
        <div className="relative w-10 shrink-0 text-right text-[0.68rem] text-fg-subtle tabular-nums" aria-hidden>
          {ticks.map((tick) => (
            <span key={tick} className="absolute right-2" style={{ bottom: `${(tick / max) * 100}%`, transform: "translateY(50%)" }}>
              {compact.format(tick)}
            </span>
          ))}
        </div>

        {/* Plot */}
        <div className="relative min-w-0 flex-1">
          {ticks.map((tick) => (
            <div
              key={tick}
              aria-hidden
              className={cn("absolute inset-x-0 border-t", tick === 0 ? "border-line" : "border-[var(--chart-grid)]")}
              style={{ bottom: `${(tick / max) * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {data.map((d, i) => {
              const parts = series.map((s) => ({ ...s, value: d.values[s.key] ?? 0 })).filter((p) => p.value > 0);
              return (
                <button
                  key={i}
                  type="button"
                  // The hit target is the whole column, not just the bar.
                  className="group relative flex h-full min-w-0 flex-1 cursor-default flex-col justify-end outline-none"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover((h) => (h === i ? null : h))}
                  aria-label={`${d.label}: ${format(totals[i])}${stacked ? ` (${parts.map((p) => `${p.label} ${format(p.value)}`).join(", ")})` : ""}`}
                >
                  <span
                    aria-hidden
                    className={cn("absolute inset-0 rounded-md transition-colors", hover === i && "bg-surface-2")}
                  />
                  <span className="relative mx-auto flex w-full max-w-6 flex-col-reverse gap-[2px]" style={{ height: `${(totals[i] / max) * 100}%` }}>
                    {parts.map((p, j) => (
                      <span
                        key={p.key}
                        className={cn("w-full", j === parts.length - 1 && "rounded-t-[4px]")}
                        style={{ flexGrow: p.value, flexBasis: 0, minHeight: 1, background: p.color }}
                      />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Tooltip */}
          {hover !== null && data[hover] && (
            <div
              role="status"
              className="pointer-events-none absolute top-0 z-10 w-max min-w-40 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg"
              style={
                hover < data.length / 2
                  ? { left: `calc(${((hover + 1) / data.length) * 100}% + 8px)` }
                  : { right: `calc(${((data.length - hover) / data.length) * 100}% + 8px)` }
              }
            >
              <p className="font-semibold text-fg">{data[hover].label}</p>
              {stacked &&
                series.map((s) => (
                  <p key={s.key} className="mt-1 flex items-center gap-2 text-fg-muted">
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                    <span className="flex-1">{s.label}</span>
                    <span className="font-medium text-fg tabular-nums">{format(data[hover].values[s.key] ?? 0)}</span>
                  </p>
                ))}
              <p className={cn("flex justify-between gap-4 text-fg-muted", stacked && "mt-1.5 border-t border-line pt-1.5")}>
                <span>{stacked ? "Total" : series[0]?.label}</span>
                <span className="font-semibold text-fg tabular-nums">{format(totals[hover])}</span>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* X axis */}
      <div className="ml-10 flex gap-[2px] pt-1.5 text-[0.68rem] text-fg-subtle" aria-hidden>
        {data.map((d, i) => (
          <span key={i} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">
            {i % every === 0 ? d.shortLabel : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Series key for a chart with more than one series (always shown, so identity isn't colour alone). */
export function Legend({ series }: { series: BarSeries[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-muted">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}
