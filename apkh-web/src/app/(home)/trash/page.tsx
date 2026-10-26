"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, Paperclip, RotateCcw, Trash2 } from "lucide-react";
import { deleteNoteForever, emptyTrash, getTrash, ITrashedNote, restoreNote } from "@/services/noteService";
import { getErrorMessage } from "@/services/axios";
import { useAppDispatch } from "@/store/hook";
import { addNote } from "@/store/slices/noteSlice";
import { refreshLibraryMeta } from "@/hooks/useAuth";
import { TRASH_CHANGED_EVENT } from "@/hooks/useRealtime";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/i18n";

const DAY_MS = 24 * 3_600_000;

/** Deleted notes: restore them, delete them for good, or empty the trash. */
export default function TrashPage() {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const { t, language } = useI18n();
  const [notes, setNotes] = useState<ITrashedNote[] | null>(null);
  const [retentionDays, setRetentionDays] = useState(30);
  const [failed, setFailed] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ITrashedNote | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const load = useCallback(async () => {
    try {
      const trash = await getTrash();
      setNotes(trash.notes);
      setRetentionDays(trash.retentionDays);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const reload = () => void load();
    window.addEventListener(TRASH_CHANGED_EVENT, reload);
    return () => window.removeEventListener(TRASH_CHANGED_EVENT, reload);
  }, [load]);

  const remove = (id: string) => setNotes((current) => current?.filter((n) => n.id !== id) ?? null);

  async function handleRestore(note: ITrashedNote) {
    setRestoring(note.id);
    try {
      const restored = await restoreNote(note.id);
      dispatch(addNote(restored));
      remove(note.id);
      void refreshLibraryMeta(dispatch);
      toast(t("trash.restored", { title: note.title || t("ai.untitled") }), "success");
    } catch (err) {
      toast(getErrorMessage(err, t("trash.restoreFailed")), "error");
    } finally {
      setRestoring(null);
    }
  }

  async function handleDeleteForever() {
    if (!pendingDelete) return;
    try {
      await deleteNoteForever(pendingDelete.id);
      remove(pendingDelete.id);
      toast(t("trash.deleted"), "success");
    } catch (err) {
      toast(getErrorMessage(err, t("trash.deleteFailed")), "error");
      throw err;
    }
  }

  async function handleEmpty() {
    try {
      await emptyTrash();
      setNotes([]);
      toast(t("trash.emptied"), "success");
    } catch (err) {
      toast(getErrorMessage(err, t("trash.deleteFailed")), "error");
      throw err;
    }
  }

  const dateFormat = new Intl.DateTimeFormat(language, { month: "short", day: "numeric", year: "numeric" });
  const daysLeft = (note: ITrashedNote) => Math.ceil((new Date(note.purgeAt).getTime() - Date.now()) / DAY_MS);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 pt-6 pb-12 sm:px-6 lg:px-8 lg:pt-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">{t("trash.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">{t("trash.subtitle", { days: retentionDays })}</p>
        </div>
        {notes && notes.length > 0 && (
          <Button variant="ghost-danger" size="sm" onClick={() => setConfirmEmpty(true)} icon={<Trash2 className="size-4" />}>
            {t("trash.emptyAll")}
          </Button>
        )}
      </div>

      {failed ? (
        <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" role="alert">
          {t("trash.loadFailed")}
        </p>
      ) : notes === null ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-6 text-accent" />
        </div>
      ) : notes.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line px-6 py-16 text-center">
          <Trash2 className="mx-auto size-8 text-fg-subtle" />
          <p className="mt-4 font-semibold text-fg">{t("trash.empty")}</p>
          <p className="mt-1 text-sm text-fg-muted">{t("trash.emptyHint")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => {
            const left = daysLeft(note);
            return (
              <li key={note.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-semibold text-fg">{note.title || t("ai.untitled")}</p>
                    {note.category && (
                      <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[0.65rem] font-semibold text-fg-muted">{note.category}</span>
                    )}
                  </div>
                  {note.snippet && <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{note.snippet}</p>}
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3" />
                      {t("trash.deletedOn", { date: dateFormat.format(new Date(note.deletedAt)) })} ·{" "}
                      {left > 1 ? t("trash.purgeIn", { days: left }) : t("trash.purgeSoon")}
                    </span>
                    {note.files.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Paperclip className="size-3" />
                        {t("trash.files", { count: note.files.length })}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleRestore(note)}
                    loading={restoring === note.id}
                    icon={<RotateCcw className="size-3.5" />}
                  >
                    {t("trash.restore")}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost-danger"
                    onClick={() => setPendingDelete(note)}
                    aria-label={t("trash.deleteForever")}
                    title={t("trash.deleteForever")}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={t("trash.deleteTitle")}
        message={t("trash.deleteMessage", { title: pendingDelete?.title || t("ai.untitled") })}
        confirmLabel={t("trash.deleteForever")}
        onConfirm={handleDeleteForever}
        onClose={() => setPendingDelete(null)}
      />
      <ConfirmDialog
        open={confirmEmpty}
        title={t("trash.emptyTitle")}
        message={t("trash.emptyMessage", { count: notes?.length ?? 0 })}
        confirmLabel={t("trash.emptyConfirm")}
        onConfirm={handleEmpty}
        onClose={() => setConfirmEmpty(false)}
      />
    </div>
  );
}
