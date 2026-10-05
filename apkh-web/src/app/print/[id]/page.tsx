"use client";

import { use, useEffect, useMemo, useState } from "react";
import { Paperclip, Printer } from "lucide-react";
import { INote } from "@/models/note";
import { getNoteById } from "@/services/noteService";
import { getErrorMessage } from "@/services/axios";
import { getValidToken } from "@/services/session";
import { normalizeNoteLinksInHtml, stripLegacyFileTokenStyles } from "@/lib/noteLinkUtils";
import { displayFileName } from "@/lib/fileName";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/i18n";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short" });

/** A note laid out for paper: the browser's print dialog also saves it as a PDF. */
export default function PrintNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [note, setNote] = useState<INote | null>(null);
  const [error, setError] = useState("");
  const t = useT();

  // Printed pages are always light, whatever the app's theme.
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => {
      if (wasDark) root.classList.add("dark");
    };
  }, []);

  useEffect(() => {
    if (!getValidToken()) {
      window.location.replace("/login");
      return;
    }
    getNoteById(id)
      .then((res) => setNote(res.data as INote))
      .catch((err) => setError(getErrorMessage(err, t("print.loadFailed"))));
  }, [id, t]);

  useEffect(() => {
    if (!note) return;
    document.title = note.title || t("ai.untitled");
    // Let the content lay out (and fonts load) before the dialog opens.
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, [note, t]);

  const html = useMemo(() => (note ? { __html: normalizeNoteLinksInHtml(stripLegacyFileTokenStyles(note.content)) } : null), [note]);

  if (error) return <p className="p-10 text-center text-sm text-rose-600">{error}</p>;
  if (!note || !html) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-fg-subtle">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white">
      <div className="sticky top-0 flex justify-end gap-2 border-b border-line bg-white/90 px-6 py-3 backdrop-blur print:hidden">
        <Button variant="secondary" size="sm" onClick={() => window.close()}>
          {t("common.close")}
        </Button>
        <Button size="sm" onClick={() => window.print()} icon={<Printer className="size-3.5" />}>
          {t("print.button")}
        </Button>
      </div>
      <article className="mx-auto max-w-3xl px-8 py-10 text-slate-900 print:max-w-none print:p-0">
        <p className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{note.category?.trim() || t("card.uncategorized")}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{note.title || t("ai.untitled")}</h1>
        <p className="mt-2 text-xs text-slate-500">
          {t("print.dates", { created: dateFormat.format(new Date(note.createdAt)), updated: dateFormat.format(new Date(note.updatedAt)) })}
        </p>
        <hr className="my-6 border-slate-200" />
        <div className="rich-content text-[0.95rem] text-slate-900" dangerouslySetInnerHTML={html} />
        {note.files.length > 0 && (
          <section className="mt-8 border-t border-slate-200 pt-4">
            <h2 className="text-sm font-semibold">{t("print.attachments")}</h2>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {note.files.map((file) => (
                <li key={file} className="flex items-center gap-2">
                  <Paperclip className="size-3.5 shrink-0" />
                  {displayFileName(file)}
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </div>
  );
}
