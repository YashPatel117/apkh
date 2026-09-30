"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { CalendarClock, Gavel, ListChecks, RefreshCw, Sparkles, Square, SquareCheck, Users } from "lucide-react";
import { NoteSummaryResponse, SummaryMode, summarizeNote } from "@/service/noteService";
import { getErrorMessage } from "@/service/axios/axios";
import { cn } from "../ui/cn";

const MODES: { id: SummaryMode; label: string }[] = [
  { id: "brief", label: "Brief" },
  { id: "actions", label: "Action items" },
];

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

interface ModeState {
  loading: boolean;
  error: string;
  data: NoteSummaryResponse | null;
}

const idle: ModeState = { loading: false, error: "", data: null };

/** AI summary of a note, as a brief summary or as action items (tasks, decisions, deadlines, people). */
export function NoteSummaryPanel({ noteId, updatedAt }: { noteId: string; updatedAt: string }) {
  const [mode, setMode] = useState<SummaryMode>("brief");
  const [states, setStates] = useState<Record<SummaryMode, ModeState>>({ brief: idle, actions: idle });
  const inFlight = useRef<Record<SummaryMode, boolean>>({ brief: false, actions: false });
  // Bumped when the note changes, so answers about the old version are dropped.
  const generation = useRef(0);
  const summarizedVersion = useRef(`${noteId}:${updatedAt}`);

  // An edited note has new summaries (the server cleared its cache).
  useEffect(() => {
    // Only on a real change: Strict Mode re-runs effects on mount, and clearing
    // inFlight then would request the same summary twice.
    const version = `${noteId}:${updatedAt}`;
    if (summarizedVersion.current === version) return;
    summarizedVersion.current = version;
    generation.current += 1;
    inFlight.current = { brief: false, actions: false };
    setStates({ brief: idle, actions: idle });
  }, [noteId, updatedAt]);

  const load = useCallback(
    async (target: SummaryMode) => {
      if (inFlight.current[target]) return;
      inFlight.current[target] = true;
      const requestGeneration = generation.current;
      const settle = (next: ModeState) => {
        if (generation.current !== requestGeneration) return;
        inFlight.current[target] = false;
        setStates((prev) => ({ ...prev, [target]: next }));
      };
      setStates((prev) => ({ ...prev, [target]: { loading: true, error: "", data: null } }));
      try {
        settle({ loading: false, error: "", data: await summarizeNote(noteId, target) });
      } catch (error) {
        settle({ loading: false, error: getErrorMessage(error, "Couldn't generate the summary right now."), data: null });
      }
    },
    [noteId],
  );

  const current = states[mode];
  useEffect(() => {
    if (!current.loading && !current.data && !current.error) void load(mode);
  }, [mode, current, load]);

  return (
    <section
      onClick={(e) => e.stopPropagation()}
      className="mt-4 animate-fade-in cursor-default rounded-2xl border border-indigo-100 bg-linear-to-br from-blue-50/80 via-indigo-50/80 to-violet-50/80 p-4 dark:border-indigo-400/20 dark:from-blue-500/10 dark:via-indigo-500/10 dark:to-violet-500/10"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-fg">
          <Sparkles className="size-3.5" /> AI summary
        </span>
        <div className="flex items-center gap-1">
          <div role="tablist" aria-label="Summary type" className="flex rounded-lg bg-surface/70 p-0.5">
            {MODES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={mode === option.id}
                onClick={() => setMode(option.id)}
                className={cn(
                  "cursor-pointer rounded-md px-2 py-0.5 text-[0.7rem] font-semibold transition-colors",
                  mode === option.id ? "bg-surface text-fg shadow-xs" : "text-fg-subtle hover:text-fg",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          {(current.data || current.error) && !current.loading && (
            <button
              type="button"
              onClick={() => void load(mode)}
              className="flex size-6 cursor-pointer items-center justify-center rounded-md text-fg-subtle hover:bg-surface/70 hover:text-fg"
              aria-label="Refresh summary"
            >
              <RefreshCw className="size-3" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 text-sm leading-relaxed">
        {current.loading && (
          <div className="space-y-2" aria-live="polite" aria-label="Generating summary">
            {[100, 90, 70].map((w) => (
              <div key={w} className="h-3 animate-pulse rounded-full bg-indigo-200/50 dark:bg-indigo-400/15" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
        {!current.loading && current.error && <p className="text-rose-600 dark:text-rose-400">{current.error}</p>}
        {!current.loading && current.data && (
          mode === "actions" && current.data.actions ? (
            <ActionItems summary={current.data.summary} actions={current.data.actions} />
          ) : (
            <div className="rich-content text-sm text-fg">
              <ReactMarkdown>{current.data.summary}</ReactMarkdown>
            </div>
          )
        )}
      </div>

      {current.data && !current.loading && current.data.model && (
        <p className="mt-3 text-[0.7rem] text-fg-subtle">
          {current.data.cached ? "Cached" : "Fresh"}
          {` · ${current.data.model}`}
          {current.data.generatedAt ? ` · ${dateFormat.format(new Date(current.data.generatedAt))}` : ""}
        </p>
      )}
    </section>
  );
}

function ActionItems({ summary, actions }: { summary: string; actions: NonNullable<NoteSummaryResponse["actions"]> }) {
  const empty = !actions.tasks.length && !actions.decisions.length && !actions.deadlines.length && !actions.people.length;
  return (
    <div className="space-y-3">
      {summary && <p className="text-fg">{summary}</p>}
      {empty && <p className="text-fg-muted">No tasks, decisions or deadlines in this note.</p>}

      {actions.tasks.length > 0 && (
        <Group icon={<ListChecks />} title="Tasks">
          {actions.tasks.map((task, i) => (
            <li key={i} className="flex items-start gap-2">
              {task.done ? (
                <SquareCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Square className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
              )}
              <span className={cn("min-w-0 flex-1 text-fg", task.done && "text-fg-subtle line-through")}>
                {task.task}
                {task.owner && <Chip>{task.owner}</Chip>}
                {task.due && <Chip tone="due">{task.due}</Chip>}
              </span>
            </li>
          ))}
        </Group>
      )}

      {actions.decisions.length > 0 && (
        <Group icon={<Gavel />} title="Decisions">
          {actions.decisions.map((decision, i) => (
            <li key={i} className="text-fg">
              {decision}
            </li>
          ))}
        </Group>
      )}

      {actions.deadlines.length > 0 && (
        <Group icon={<CalendarClock />} title="Deadlines">
          {actions.deadlines.map((deadline, i) => (
            <li key={i} className="text-fg">
              <span className="font-medium">{deadline.when}</span> — {deadline.what}
            </li>
          ))}
        </Group>
      )}

      {actions.people.length > 0 && (
        <Group icon={<Users />} title="People">
          {actions.people.map((person, i) => (
            <li key={i} className="text-fg">
              <span className="font-medium">{person.name}</span>
              {person.role && <span className="text-fg-muted"> — {person.role}</span>}
            </li>
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[0.7rem] font-semibold tracking-wider text-fg-subtle uppercase [&>svg]:size-3.5">
        {icon}
        {title}
      </p>
      <ul className="mt-1.5 space-y-1">{children}</ul>
    </div>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: "due" }) {
  return (
    <span
      className={cn(
        "ml-1.5 inline-flex rounded-md px-1.5 py-px align-middle text-[0.68rem] font-medium",
        tone === "due"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
          : "bg-surface text-fg-muted ring-1 ring-line",
      )}
    >
      {children}
    </span>
  );
}
