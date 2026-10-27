"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Clock,
  FileArchive,
  FileDown,
  Folder,
  FolderInput,
  History,
  Layers,
  Link2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Printer,
  Sparkles,
  Trash2,
} from "lucide-react";
import { INote } from "@/models/note";
import { activeAi } from "@/models/user";
import { deleteNote, exportNote, getBacklinks, getNoteById, IBacklink } from "@/services/noteService";
import { getErrorMessage } from "@/services/axios";
import { useAppDispatch, useAppSelector } from "@/store/hook";
import { cacheNotes, deleteNote as deleteNoteAction } from "@/store/slices/noteSlice";
import { useNotes } from "@/context/notesContext";
import { normalizeNoteLinksInHtml, stripLegacyFileTokenStyles } from "@/lib/noteLinkUtils";
import { noteHref, noteLinkClick } from "@/lib/noteLinks";
import { displayFileName } from "@/lib/fileName";
import { isOfflineId } from "@/lib/offlineQueue";
import { NoteSummaryPanel } from "@/components/noteSummaryPanel";
import { TagChips } from "@/components/tagInput";
import { SimilarNotesModal } from "@/components/similarNotes";
import { NoteHistoryModal } from "@/components/noteHistory";
import { MoveNoteModal } from "@/components/moveNoteModal";
import FileDisplay from "@/components/fileDisplay";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/i18n";

/** One note on its own page: read it, follow its links, see what links to it. */
export default function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const dispatch = useAppDispatch();
  const toast = useToast();
  const { t, language } = useI18n();
  const { openNote, setActiveTag } = useNotes();
  const note = useAppSelector((state) => state.note.byId[id]) as INote | undefined;
  const folders = useAppSelector((state) => state.note.folders);
  const aiOn = useAppSelector((state) => Boolean(activeAi(state.auth.user)));
  const [missing, setMissing] = useState(false);
  const [backlinks, setBacklinks] = useState<IBacklink[] | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [similarOpen, setSimilarOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Notes not loaded yet (a link from elsewhere) are fetched on their own.
  const loaded = Boolean(note);
  useEffect(() => {
    if (loaded || isOfflineId(id)) return;
    let cancelled = false;
    getNoteById(id)
      .then((res) => {
        if (!cancelled) dispatch(cacheNotes([res.data as INote]));
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, loaded, dispatch]);

  // Backlinks are loaded when the page opens and again when this note changes.
  const updatedAt = note?.updatedAt;
  useEffect(() => {
    if (!updatedAt || isOfflineId(id)) return;
    let cancelled = false;
    getBacklinks(id)
      .then((links) => {
        if (!cancelled) setBacklinks(links);
      })
      .catch(() => {
        if (!cancelled) setBacklinks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [id, updatedAt]);

  const html = useMemo(
    () => ({ __html: note ? normalizeNoteLinksInHtml(stripLegacyFileTokenStyles(note.content)) : "" }),
    [note],
  );
  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  const folder = note?.folderId ? folders.find((f) => f.id === note.folderId) : undefined;

  const onContentClick = (e: React.MouseEvent) => {
    const linked = noteLinkClick(e);
    if (linked) {
      e.preventDefault();
      router.push(noteHref(linked));
      return;
    }
    const token = (e.target as HTMLElement).closest<HTMLElement>(".file-token");
    if (token?.dataset.id) setPreviewFile(token.dataset.id);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${noteHref(id)}`);
      toast(t("links.copied"), "success");
    } catch {
      toast(t("links.copyFailed"), "error");
    }
  };

  const download = async (format: "md" | "zip") => {
    try {
      await exportNote(id, format);
    } catch (error) {
      toast(getErrorMessage(error, t("card.exportFailed")), "error");
    }
  };

  const remove = async () => {
    try {
      await deleteNote(id);
      dispatch(deleteNoteAction(id));
      toast(t("notes.deleted"), "success");
      router.push("/notes");
    } catch (error) {
      toast(getErrorMessage(error, t("notes.deleteFailed")), "error");
      throw error;
    }
  };

  if (!note) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        {missing ? (
          <div className="max-w-sm">
            <h1 className="text-lg font-semibold text-fg">{t("notePage.missing")}</h1>
            <p className="mt-1 text-sm text-fg-muted">{t("notePage.missingHint")}</p>
            <div className="mt-5 flex justify-center gap-2">
              <Button variant="secondary" onClick={() => router.push("/trash")} icon={<Trash2 className="size-4" />}>
                {t("nav.trash")}
              </Button>
              <Button onClick={() => router.push("/notes")}>{t("nav.notes")}</Button>
            </div>
          </div>
        ) : (
          <Spinner className="size-6 text-accent" />
        )}
      </div>
    );
  }

  const synced = !isOfflineId(note.id);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-16 sm:px-6 lg:pt-8">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.back()} icon={<ArrowLeft className="size-4" />}>
          {t("notePage.back")}
        </Button>
        <div className="flex items-center gap-1.5">
          <Button size="sm" onClick={() => openNote(note.id)} icon={<Pencil className="size-3.5" />}>
            {t("notePage.edit")}
          </Button>
          {synced && (
            <Menu
              trigger={({ toggle, open }) => (
                <Button size="icon-sm" variant={open ? "soft" : "ghost"} onClick={toggle} aria-label={t("card.more")}>
                  <MoreHorizontal className="size-4" />
                </Button>
              )}
            >
              {(close) => {
                const then = (action: () => void) => () => {
                  close();
                  action();
                };
                return (
                  <>
                    <MenuItem icon={<Link2 />} onClick={then(() => void copyLink())}>
                      {t("links.copy")}
                    </MenuItem>
                    <MenuItem icon={<Layers />} onClick={then(() => setSimilarOpen(true))}>
                      {t("card.similar")}
                    </MenuItem>
                    <MenuItem icon={<FolderInput />} onClick={then(() => setMoveOpen(true))}>
                      {t("card.move")}
                    </MenuItem>
                    <MenuItem icon={<History />} onClick={then(() => setHistoryOpen(true))}>
                      {t("card.history")}
                    </MenuItem>
                    <div className="my-1 h-px bg-line" />
                    <MenuItem icon={<FileDown />} onClick={then(() => void download("md"))}>
                      {t("card.exportMd")}
                    </MenuItem>
                    {note.files.length > 0 && (
                      <MenuItem icon={<FileArchive />} onClick={then(() => void download("zip"))}>
                        {t("card.exportZip")}
                      </MenuItem>
                    )}
                    <MenuItem icon={<Printer />} onClick={then(() => window.open(`/print/${note.id}`, "_blank", "noopener"))}>
                      {t("card.print")}
                    </MenuItem>
                    <div className="my-1 h-px bg-line" />
                    <MenuItem icon={<Trash2 />} onClick={then(() => setConfirmDelete(true))}>
                      {t("card.delete")}
                    </MenuItem>
                  </>
                );
              }}
            </Menu>
          )}
        </div>
      </div>

      <article className="mt-5 rounded-3xl border border-line bg-surface p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded-md bg-accent-soft px-2 py-0.5 font-semibold text-accent-fg">{note.category || t("card.uncategorized")}</span>
          {folder && (
            <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 font-medium text-fg-muted">
              <Folder className="size-3" />
              {folder.name}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-fg-subtle">
            <Clock className="size-3" />
            {t("notePage.updated", { date: dateFormat.format(new Date(note.updatedAt)) })}
          </span>
        </div>

        <h1 className="mt-3 text-2xl font-bold tracking-tight break-words text-fg sm:text-3xl">{note.title || t("ai.untitled")}</h1>
        <TagChips
          tags={note.tags}
          onPick={(tag) => {
            setActiveTag(tag);
            router.push("/notes");
          }}
          className="mt-2 -ml-1.5"
        />

        <div className="rich-content mt-5 text-[0.98rem]" onClick={onContentClick} dangerouslySetInnerHTML={html} />

        {note.files.length > 0 && (
          <div className="mt-6 border-t border-line pt-4">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              <Paperclip className="size-3.5" />
              {t("notePage.attachments")}
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {note.files.map((file) => (
                <button
                  key={file}
                  type="button"
                  onClick={() => setPreviewFile(file)}
                  className="max-w-full cursor-pointer truncate rounded-xl border border-line px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-indigo-200 hover:text-fg"
                >
                  {displayFileName(file)}
                </button>
              ))}
            </div>
          </div>
        )}

        {aiOn && synced && (
          <div className="mt-6 border-t border-line pt-4">
            {summaryOpen ? (
              <NoteSummaryPanel noteId={note.id} noteTitle={note.title} updatedAt={note.updatedAt} />
            ) : (
              <Button variant="soft" size="sm" onClick={() => setSummaryOpen(true)} icon={<Sparkles className="size-3.5" />}>
                {t("card.summary")}
              </Button>
            )}
          </div>
        )}
      </article>

      {synced && (
        <section className="mt-6" aria-labelledby="backlinks-title">
          <h2 id="backlinks-title" className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Link2 className="size-4 text-fg-subtle" />
            {t("links.backlinks")}
            {backlinks && backlinks.length > 0 && <span className="text-fg-subtle tabular-nums">{backlinks.length}</span>}
          </h2>
          {backlinks === null ? (
            <Spinner className="mt-3 size-4 text-accent" />
          ) : backlinks.length === 0 ? (
            <p className="mt-2 text-sm text-fg-subtle">{t("links.noBacklinks")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {backlinks.map((link) => (
                <li key={link.id}>
                  <Link
                    href={noteHref(link.id)}
                    className="block rounded-2xl border border-line bg-surface p-3.5 transition-colors hover:border-indigo-200 dark:hover:border-indigo-400/30"
                  >
                    <span className="block truncate text-sm font-semibold text-fg">{link.title || t("ai.untitled")}</span>
                    {link.snippet && <span className="mt-0.5 line-clamp-2 block text-sm text-fg-muted">{link.snippet}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {historyOpen && <NoteHistoryModal note={note} open onClose={() => setHistoryOpen(false)} />}
      {moveOpen && <MoveNoteModal note={note} open onClose={() => setMoveOpen(false)} />}
      <SimilarNotesModal
        noteId={note.id}
        noteTitle={note.title}
        open={similarOpen}
        onClose={() => setSimilarOpen(false)}
        onOpenNote={(noteId) => router.push(noteHref(noteId))}
      />
      <Modal open={Boolean(previewFile)} onClose={() => setPreviewFile(null)} title={previewFile ? displayFileName(previewFile) : ""} size="xl">
        {previewFile && <FileDisplay fileName={previewFile} noteId={note.id} />}
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        title={t("notes.deleteTitle")}
        message={t("notes.deleteMessage", { title: note.title || t("ai.untitled") })}
        confirmLabel={t("notes.deleteConfirm")}
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
