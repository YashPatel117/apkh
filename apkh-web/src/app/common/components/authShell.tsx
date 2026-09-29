"use client";

import Link from "next/link";
import { FileSearch, MessagesSquare, Sparkles } from "lucide-react";
import { LogoWithText } from "../ui/Logo";
import { ThemeToggle } from "../ui/theme";

const highlights = [
  { Icon: Sparkles, title: "Grounded AI answers", text: "Ask anything and get replies cited back to your own notes." },
  { Icon: FileSearch, title: "Files understood", text: "PDFs, images and docs are read, OCR'd and indexed for you." },
  { Icon: MessagesSquare, title: "Keep the thread", text: "Turn any answer into a conversation that remembers context." },
];

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <main className="relative isolate min-h-dvh overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 -z-20 bg-[url(/assets/light-background.jpg)] bg-cover bg-center dark:bg-[url(/assets/dark-background.jpg)]"
      />
      <div className="absolute inset-0 -z-10 bg-white/20 dark:bg-slate-950/40" aria-hidden />

      <div className="absolute top-4 right-4 z-10 rounded-xl bg-surface/70 backdrop-blur">
        <ThemeToggle />
      </div>

      <div className="mx-auto grid min-h-dvh max-w-6xl items-center gap-12 px-4 py-16 lg:grid-cols-[1.1fr_1fr] lg:px-8">
        <section className="hidden animate-rise lg:block">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/50 px-3 py-1 text-xs font-semibold text-indigo-700 backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-indigo-200">
            <Sparkles className="size-3.5" /> AI-powered personal knowledge
          </p>
          <h2 className="mt-5 max-w-lg text-4xl leading-[1.1] font-bold tracking-tight text-slate-900 xl:text-5xl dark:text-white">
            Your notes, finally{" "}
            <span className="bg-linear-to-r from-blue-600 via-indigo-600 to-violet-600 bg-clip-text text-transparent dark:from-blue-400 dark:via-indigo-300 dark:to-violet-400">
              answering back.
            </span>
          </h2>
          <ul className="mt-10 space-y-5">
            {highlights.map(({ Icon, title, text }) => (
              <li key={title} className="flex max-w-md items-start gap-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-white/70 bg-white/60 text-indigo-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-indigo-300">
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold text-slate-900 dark:text-white">{title}</span>
                  <span className="mt-0.5 block text-sm text-slate-600 dark:text-slate-300">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto w-full max-w-md animate-rise">
          <div className="rounded-3xl border border-white/70 bg-surface/85 p-6 shadow-2xl shadow-indigo-900/10 backdrop-blur-xl sm:p-8 dark:border-white/10">
            <Link href="/" className="inline-flex" aria-label="Knowledge Hub home">
              <LogoWithText className="w-44" />
            </Link>
            <h1 className="mt-6 text-2xl font-bold tracking-tight text-fg">{title}</h1>
            <p className="mt-1.5 text-sm text-fg-muted">{subtitle}</p>
            <div className="mt-7">{children}</div>
          </div>
          <p className="mt-6 text-center text-sm text-slate-700 dark:text-slate-300">{footer}</p>
        </section>
      </div>
    </main>
  );
}

export function FormAlert({ tone = "error", children }: { tone?: "error" | "success" | "info"; children: React.ReactNode }) {
  const styles = {
    error: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
    info: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`animate-fade-in rounded-xl border px-3.5 py-2.5 text-sm ${styles[tone]}`}>
      {children}
    </div>
  );
}
