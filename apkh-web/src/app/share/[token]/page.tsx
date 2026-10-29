"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { Clock, Download, Eye, Link2Off, Paperclip } from "lucide-react";
import { getSharedNote, sharedFileUrl, SharedNote } from "@/services/shareService";
import { stripLegacyFileTokenStyles } from "@/lib/noteLinkUtils";
import { displayFileName } from "@/lib/fileName";
import { LogoWithText } from "@/components/ui/Logo";
import { Spinner } from "@/components/ui/Spinner";
import { TagChips } from "@/components/tagInput";
import { useI18n } from "@/i18n";

/** A note someone shared: read-only, for anyone with the link, no sign-in. */
export default function SharedNotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { t, language } = useI18n();
  const [note, setNote] = useState<SharedNote | null>(null);
  const [error, setError] = useState<"expired" | "missing" | "failed" | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSharedNote(token)
      .then((shared) => {
        if (cancelled) return;
        setNote(shared);
        document.title = `${shared.title || t("ai.untitled")} · Knowledge Hub`;
      })
      .catch((err) => {
        if (cancelled) return;
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        setError(status === 410 ? "expired" : status === 404 ? "missing" : "failed");
      });
    return () => {
      cancelled = true;
    };
  }, [token, t]);

  const html = useMemo(() => ({ __html: note ? stripLegacyFileTokenStyles(note.content) : "" }), [note]);
  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: "medium" });

  // Attachment chips in the text open the file.
  const onContentClick = (e: React.MouseEvent) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>(".file-token");
    if (chip?.dataset.id && note?.files.includes(chip.dataset.id)) {
      window.open(sharedFileUrl(token, chip.dataset.id), "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" aria-label="Knowledge Hub">
            <LogoWithText />
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-fg-muted">
            <Eye className="size-3.5" />
            {t("shared.readOnly")}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        {error ? (
          <div className="mx-auto max-w-sm py-16 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-fg-subtle">
              <Link2Off className="size-5" />
            </span>
            <h1 className="mt-4 text-lg font-semibold text-fg">
              {error === "expired" ? t("shared.expired") : error === "missing" ? t("shared.missing") : t("shared.failed")}
            </h1>
            <p className="mt-1 text-sm text-fg-muted">{error === "failed" ? t("shared.failedHint") : t("shared.missingHint")}</p>
          </div>
        ) : !note ? (
          <div className="flex justify-center py-24">
            <Spinner className="size-6 text-accent" />
          </div>
        ) : (
          <article className="rounded-3xl border border-line bg-surface p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {note.category && <span className="rounded-md bg-accent-soft px-2 py-0.5 font-semibold text-accent-fg">{note.category}</span>}
              <span className="inline-flex items-center gap-1 text-fg-subtle">
                <Clock className="size-3" />
                {t("notePage.updated", { date: dateFormat.format(new Date(note.updatedAt)) })}
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight break-words text-fg sm:text-3xl">{note.title || t("ai.untitled")}</h1>
            <TagChips tags={note.tags} className="mt-2 -ml-1.5" />

            <div className="rich-content mt-5 text-[0.98rem]" onClick={onContentClick} dangerouslySetInnerHTML={html} />

            {note.files.length > 0 && (
              <div className="mt-6 border-t border-line pt-4">
                <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
                  <Paperclip className="size-3.5" />
                  {t("notePage.attachments")}
                </h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  {note.files.map((file) => (
                    <a
                      key={file}
                      href={sharedFileUrl(token, file)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex max-w-full items-center gap-1.5 truncate rounded-xl border border-line px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-indigo-200 hover:text-fg"
                    >
                      <Download className="size-3.5 shrink-0" />
                      <span className="truncate">{displayFileName(file)}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </article>
        )}

        <p className="mt-8 text-center text-xs text-fg-subtle">
          {t("shared.footer")}{" "}
          <Link href="/register" className="font-medium text-accent hover:underline">
            {t("shared.cta")}
          </Link>
        </p>
      </main>
    </div>
  );
}
