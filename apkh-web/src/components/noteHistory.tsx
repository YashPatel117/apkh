"use client";

import { useEffect, useMemo, useState } from "react";
import { diffWords } from "diff";
import { History, RotateCcw } from "lucide-react";
import { INote, INoteVersion } from "@/models/note";
import { getNoteVersion, getNoteVersions, restoreNoteVersion } from "@/services/noteService";
import { getErrorMessage } from "@/services/axios";
import { useAppDispatch } from "@/store/hook";
import { addNote, markNoteIndexing } from "@/store/slices/noteSlice";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { displayFileName } from "@/lib/fileName";
import { useT } from "@/i18n";

const timeFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Note HTML as plain text, one line per paragraph / list item / heading, for comparing. */
function htmlToLines(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr)>/gi, "\n")
    // Attachment chips: their file name
    .replace(/<span[^>]*\bfile-token\b[^>]*>.*?<\/span>/gi, (chip) => `[📎 ${displayFileName(/data-id="([^"]*)"/.exec(chip)?.[1] ?? "attachment")}]`)
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Earlier versions of a note: compare one with the current text, and bring it back. */
export function NoteHistoryModal({ note, open, onClose }: { note: INote; open: boolean; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const t = useT();
  const [versions, setVersions] = useState<INoteVersion[] | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<INoteVersion | null>(null);
  const [loadingVersion, setLoadingVersion] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setVersions(null);
    setError("");
    setSelectedId(null);
    setSelected(null);
    getNoteVersions(note.id)
      .then((list) => {
        if (cancelled) return;
        setVersions(list);
        setSelectedId(list[0]?.id ?? null);
      })
      .catch((err) => !cancelled && setError(getErrorMessage(err, t("history.loadFailed"))));
    return () => {
      cancelled = true;
    };
    // Reload when the note changes (e.g. after a restore).
  }, [open, note.id, note.updatedAt, t]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setLoadingVersion(true);
    getNoteVersion(note.id, selectedId)
      .then((version) => !cancelled && setSelected(version))
      .catch((err) => !cancelled && toast(getErrorMessage(err, t("history.versionFailed")), "error"))
      .finally(() => !cancelled && setLoadingVersion(false));
    return () => {
      cancelled = true;
    };
  }, [note.id, selectedId, toast, t]);

  const changes = useMemo(
    () => (selected?.content !== undefined ? diffWords(htmlToLines(selected.content), htmlToLines(note.content)) : null),
    [selected, note.content],
  );
  const titleChanged = selected && selected.title !== note.title;

  const restore = async () => {
    if (!selected) return;
    setRestoring(true);
    try {
      const restored = await restoreNoteVersion(note.id, selected.id);
      dispatch(addNote(restored));
      dispatch(markNoteIndexing(restored.id));
      toast(t("history.restored"), "success");
      onClose();
    } catch (err) {
      toast(getErrorMessage(err, t("history.restoreFailed")), "error");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} locked={restoring} size="xl" title={t("history.title")} description={note.title || t("ai.untitled")}>
      <div className="flex min-h-0 flex-1 flex-col border-t border-line md:flex-row">
        {/* Versions */}
        <div className="max-h-48 shrink-0 overflow-y-auto border-b border-line p-2 md:max-h-none md:w-64 md:border-r md:border-b-0">
          {error ? (
            <p className="p-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>
          ) : !versions ? (
            <div className="flex justify-center p-6 text-fg-subtle">
              <Spinner />
            </div>
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center p-6 text-center text-sm text-fg-muted">
              <History className="size-5 text-fg-subtle" />
              <p className="mt-2">{t("history.none")}</p>
            </div>
          ) : (
            <ul className="space-y-0.5">
              {versions.map((version) => (
                <li key={version.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(version.id)}
                    aria-current={version.id === selectedId ? "true" : undefined}
                    className={cn(
                      "w-full cursor-pointer rounded-xl px-3 py-2 text-left transition-colors",
                      version.id === selectedId ? "bg-accent-soft" : "hover:bg-surface-2",
                    )}
                  >
                    <span className={cn("block text-sm font-medium", version.id === selectedId ? "text-accent-fg" : "text-fg")}>
                      {timeFormat.format(new Date(version.savedAt))}
                    </span>
                    <span className="block truncate text-xs text-fg-subtle">{version.title || t("ai.untitled")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Comparison */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-64 flex-1 overflow-y-auto p-5">
            {loadingVersion && !selected ? (
              <div className="flex justify-center p-6 text-fg-subtle">
                <Spinner />
              </div>
            ) : selected && changes ? (
              <>
                <p className="text-xs text-fg-subtle">
                  {t("history.changes")}{" "}
                  <span className="rounded bg-rose-100 px-1 text-rose-800 line-through dark:bg-rose-500/20 dark:text-rose-300">{t("history.removed")}</span>{" "}
                  <span className="rounded bg-emerald-100 px-1 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">{t("history.added")}</span>
                </p>
                {titleChanged && (
                  <p className="mt-3 text-sm">
                    <span className="font-semibold text-fg">{t("history.titleLabel")} </span>
                    <span className="rounded bg-rose-100 px-1 text-rose-800 line-through dark:bg-rose-500/20 dark:text-rose-300">{selected.title || t("ai.untitled")}</span>{" "}
                    <span className="rounded bg-emerald-100 px-1 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">{note.title || t("ai.untitled")}</span>
                  </p>
                )}
                <div className={cn("mt-3 text-sm leading-relaxed whitespace-pre-wrap text-fg", loadingVersion && "opacity-60")}>
                  {changes.every((part) => !part.added && !part.removed) ? (
                    <p className="text-fg-muted">{titleChanged ? t("history.sameTitleChanged") : t("history.same")}</p>
                  ) : (
                    changes.map((part, i) => (
                      <span
                        key={i}
                        className={cn(
                          part.added && "rounded bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200",
                          part.removed && "rounded bg-rose-100 text-rose-900 line-through dark:bg-rose-500/20 dark:text-rose-200",
                        )}
                      >
                        {part.value}
                      </span>
                    ))
                  )}
                </div>
              </>
            ) : null}
          </div>
          {selected && (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-4">
              <Button variant="secondary" onClick={onClose} disabled={restoring}>
                {t("common.close")}
              </Button>
              <Button onClick={() => void restore()} loading={restoring} icon={<RotateCcw className="size-4" />}>
                {t("history.restore")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
