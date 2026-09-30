"use client";

import Link from "next/link";
import { Coins, Cpu, FolderOpen, Mail, MessagesSquare, NotebookText, Paperclip, ShieldCheck, TriangleAlert } from "lucide-react";
import { useAppSelector } from "@/store/hook";
import { Avatar } from "@/components/sidebar";
import { supportsSemanticSearch } from "@/models/user";
import LlmSettingsCard from "./LlmSettingsCard";
import SearchIndexCard from "./SearchIndexCard";

function Stat({ Icon, label, value, href }: { Icon: typeof Coins; label: string; value: string | number; href?: string }) {
  const body = (
    <>
      <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <Icon className="size-[1.1rem]" />
      </span>
      <p className="mt-4 text-2xl font-bold tracking-tight text-fg tabular-nums">{value}</p>
      <p className="mt-0.5 text-sm text-fg-muted">{label}</p>
    </>
  );
  const cls = "rounded-3xl border border-line bg-surface p-5 transition-colors";
  return href ? (
    <Link href={href} className={`${cls} hover:border-indigo-200 dark:hover:border-indigo-400/30`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export default function ProfilePage() {
  const { user } = useAppSelector((state) => state.auth);
  const { notes } = useAppSelector((state) => state.note);
  const sessionsCount = useAppSelector((state) => state.chat.sessions.length);

  if (!user) return null; // the (home) layout renders the loading state

  const activeConfig = user.llmConfigs?.find((c) => c.isActive) ?? null;
  const categories = new Set(notes.map((n) => n.category?.trim()).filter(Boolean)).size;
  const attachments = notes.reduce((t, n) => t + n.files.length, 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-12 sm:px-6 lg:px-8 lg:pt-8">
      {/* Identity */}
      <section className="relative overflow-hidden rounded-3xl border border-line bg-surface">
        <div aria-hidden className="h-24 bg-linear-to-r from-blue-500 via-indigo-500 to-violet-500 opacity-90 sm:h-28" />
        <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end sm:px-6">
          <Avatar name={user.name} size="xl" className="relative -mt-10 sm:-mt-12" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold tracking-tight text-fg">{user.name}</h1>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-fg-muted">
              <Mail className="size-3.5 shrink-0" /> {user.email}
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-bold tracking-wider text-accent-fg uppercase">
            <ShieldCheck className="size-3.5" /> {user.type} plan
          </span>
        </div>
      </section>

      {/* Stats */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-label="Workspace stats">
        <Stat Icon={NotebookText} label="Notes" value={notes.length} href="/notes" />
        <Stat Icon={MessagesSquare} label="Conversations" value={sessionsCount} href="/chat" />
        <Stat Icon={Paperclip} label={`Attachments · ${categories} categories`} value={attachments} />
        <Stat Icon={Coins} label="AI tokens used" value={(user.totalTokensUsed ?? 0).toLocaleString()} />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <LlmSettingsCard user={user} />

        <div className="space-y-6">
          <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
            <h2 className="font-semibold text-fg">AI search status</h2>
            {activeConfig && supportsSemanticSearch(activeConfig.llmModel) ? (
              <div className="mt-4 flex items-start gap-3 rounded-2xl bg-emerald-50 p-4 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
                <Cpu className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">Ready for grounded answers</p>
                  <p className="mt-0.5 truncate opacity-90">
                    Using <span className="font-medium">{activeConfig.keyName}</span> · {activeConfig.llmModel}
                  </p>
                </div>
              </div>
            ) : activeConfig ? (
              <div className="mt-4 flex items-start gap-3 rounded-2xl bg-amber-50 p-4 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">Keyword matching only</p>
                  <p className="mt-0.5 opacity-90">
                    {activeConfig.llmModel} can answer and summarize, but Claude has no embedding model, so notes and
                    attachments are found by keywords rather than meaning. Add a Gemini or OpenAI key for semantic search.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex items-start gap-3 rounded-2xl bg-amber-50 p-4 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold">AI answers are off</p>
                  <p className="mt-0.5 opacity-90">Add an API key and test the connection to enable Ask AI, summaries and chat.</p>
                </div>
              </div>
            )}
            <div className="mt-4 flex items-center gap-2 text-xs text-fg-subtle">
              <FolderOpen className="size-3.5" /> {notes.length} notes available as source material
            </div>
          </section>
          <SearchIndexCard />
        </div>
      </div>
    </div>
  );
}
