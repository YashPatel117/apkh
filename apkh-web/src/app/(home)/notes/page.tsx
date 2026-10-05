"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ChevronRight, Folder, FolderOpen, MousePointerClick, Plus, SearchX, Sparkles, X } from "lucide-react";
import { ShowNote } from "@/components/showNote";
import { useNotes } from "@/context/notesContext";
import { useAppDispatch, useAppSelector } from "@/store/hook";
import { deleteNote as deleteNoteAction, markNoteIndexing } from "@/store/slices/noteSlice";
import { deleteNote, reindexNote } from "@/services/noteService";
import { getErrorMessage } from "@/services/axios";
import { INote } from "@/models/note";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { folderPath } from "@/lib/folders";
import { useT } from "@/i18n";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

function NotesSkeleton() {
  return (
    <div className="columns-1 gap-4 md:columns-2 xl:columns-3">
      {[180, 240, 200, 160, 220, 190].map((h, i) => (
        <div key={i} className="mb-4 animate-pulse rounded-3xl border border-line bg-surface" style={{ height: h }} />
      ))}
    </div>
  );
}

export default function NotesPage() {
  const {
    filteredNotes,
    filteredTotal,
    notesLoaded,
    resultsLoading,
    hasMore,
    loadMore,
    loadingMore,
    query,
    activeCategory,
    setActiveCategory,
    activeFolder,
    setActiveFolder,
    openNote,
    newNote,
    aiAnswer,
    aiFailed,
    openAnswer,
    clearSearch,
    selectedNotes,
    toggleSelect,
  } = useNotes();
  const totalNotes = useAppSelector((state) => state.note.totalNotes);
  const folders = useAppSelector((state) => state.note.folders);
  const breadcrumbs = useMemo(() => (activeFolder && activeFolder !== "root" ? folderPath(folders, activeFolder) : []), [folders, activeFolder]);
  const subfolders = useMemo(
    () =>
      activeFolder && activeFolder !== "root"
        ? folders.filter((f) => f.parentId === activeFolder).sort((a, b) => a.name.localeCompare(b.name))
        : [],
    [folders, activeFolder],
  );
  const t = useT();
  const folderName = activeFolder === "root" ? t("folders.unfiled") : breadcrumbs.at(-1)?.name;
  const indexStatus = useAppSelector((state) => state.note.indexStatus);
  const indexByNote = useMemo(() => new Map(indexStatus?.notes.map((n) => [n.noteId, n])), [indexStatus]);
  const dispatch = useAppDispatch();
  const toast = useToast();
  const [pendingDelete, setPendingDelete] = useState<INote | null>(null);

  // Infinite scroll: the next page loads as the end of the list comes into view.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && void loadMore(), { rootMargin: "600px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, filteredNotes.length]);

  // Arrow keys (or J/K) move between note cards. Cards flow down each column,
  // so up/down follow the page order and left/right jump to the nearest card
  // in the next column.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector("[data-modal-root]")) return;
      const target = e.target as HTMLElement;
      if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const step = key === "ArrowDown" || key === "j" ? 1 : key === "ArrowUp" || key === "k" ? -1 : 0;
      const side = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
      if (!step && !side) return;
      const cards = [...document.querySelectorAll<HTMLElement>("[data-note-card]")];
      if (!cards.length) return;
      const current = target.closest<HTMLElement>("[data-note-card]");
      // Only take over the arrows when a card has focus (or nothing does).
      if (!current && target !== document.body) return;
      e.preventDefault();
      let next: HTMLElement | undefined;
      if (!current) next = cards[0];
      else if (step) next = cards[cards.indexOf(current) + step];
      else {
        const from = current.getBoundingClientRect();
        next = cards
          .map((card) => ({ card, rect: card.getBoundingClientRect() }))
          .filter(({ rect }) => (side > 0 ? rect.left > from.left + 8 : rect.left < from.left - 8))
          .sort((a, b) => Math.abs(a.rect.left - from.left) - Math.abs(b.rect.left - from.left) || Math.abs(a.rect.top - from.top) - Math.abs(b.rect.top - from.top))[0]?.card;
      }
      if (next) {
        next.focus({ preventScroll: true });
        next.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const aiLinked = Boolean(aiAnswer && !aiFailed && aiAnswer.references.length);
  const filtering = Boolean(query.trim() || activeCategory || activeFolder || aiLinked);
  const attachmentCount = filteredNotes.reduce((total, note) => total + note.files.length, 0);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteNote(pendingDelete.id);
      dispatch(deleteNoteAction(pendingDelete.id));
      if (selectedNotes.some((n) => n.noteId === pendingDelete.id)) toggleSelect(pendingDelete.id, pendingDelete.title);
      toast(t("notes.deleted"), "success");
    } catch (error) {
      toast(getErrorMessage(error, t("notes.deleteFailed")), "error");
      throw error;
    }
  };

  const retryIndexing = async (note: INote) => {
    try {
      await reindexNote(note.id);
      dispatch(markNoteIndexing(note.id));
      toast(t("notes.reindexing"), "info");
    } catch (error) {
      toast(getErrorMessage(error, t("notes.reindexFailed")), "error");
    }
  };

  const emptyFolder = Boolean(activeFolder && !query.trim() && !activeCategory);
  const heading = aiLinked
    ? t("notes.referenced")
    : activeCategory
      ? activeCategory
      : query.trim()
        ? t("notes.searchResults")
        : (folderName ?? t("notes.myNotes"));

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-12">
      {/* Folder breadcrumbs */}
      {!aiLinked && activeFolder && (
        <nav aria-label={t("folders.title")} className="mb-2 flex flex-wrap items-center gap-1 text-sm text-fg-muted">
          <button type="button" onClick={() => setActiveFolder(null)} className="cursor-pointer rounded-md px-1 hover:text-fg">
            {t("notes.allNotes")}
          </button>
          {(activeFolder === "root" ? [{ id: "root", name: t("folders.unfiled") }] : breadcrumbs).map((folder, i, path) => (
            <span key={folder.id} className="flex items-center gap-1">
              <ChevronRight className="size-3.5 text-fg-subtle" />
              {i === path.length - 1 ? (
                <span className="px-1 font-medium text-fg" aria-current="page">
                  {folder.name}
                </span>
              ) : (
                <button type="button" onClick={() => setActiveFolder(folder.id)} className="cursor-pointer rounded-md px-1 hover:text-fg">
                  {folder.name}
                </button>
              )}
            </span>
          ))}
        </nav>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight text-fg sm:text-3xl">{heading}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {notesLoaded ? (
              <>
                {filtering ? t("notes.countOf", { count: filteredTotal, total: totalNotes }) : t("notes.count", { count: filteredTotal })}
                {!hasMore && attachmentCount > 0 && ` · ${t("notes.attachments", { count: attachmentCount })}`}
              </>
            ) : (
              t("notes.loading")
            )}
          </p>
        </div>
        <div className="hidden sm:block">
          <Button onClick={newNote} icon={<Plus className="size-4" />}>
            {t("notes.newNote")}
          </Button>
        </div>
      </div>

      {/* Folders inside the open one */}
      {!aiLinked && subfolders.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {subfolders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => setActiveFolder(folder.id)}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium text-fg transition-colors hover:border-indigo-200 dark:hover:border-indigo-400/30"
            >
              <Folder className="size-4 text-accent" />
              {folder.name}
              {folder.noteCount > 0 && <span className="text-xs text-fg-subtle tabular-nums">{folder.noteCount}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Active filters */}
      {(aiLinked || activeCategory || query.trim()) && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {aiLinked && (
            <div className="flex w-full flex-wrap items-center gap-3 rounded-2xl border border-indigo-200 bg-linear-to-r from-blue-50 via-indigo-50 to-violet-50 px-4 py-3 dark:border-indigo-400/20 dark:from-blue-500/10 dark:via-indigo-500/10 dark:to-violet-500/10">
              <Sparkles className="size-4 shrink-0 text-accent" />
              <p className="min-w-0 flex-1 text-sm text-fg">
                {t("notes.aiUsed", { query: aiAnswer!.query })}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="soft" onClick={openAnswer}>
                  {t("notes.viewAnswer")}
                </Button>
                <Button size="sm" variant="ghost" onClick={clearSearch} icon={<X className="size-3.5" />}>
                  {t("notes.clear")}
                </Button>
              </div>
            </div>
          )}
          {!aiLinked && activeCategory && (
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface py-1 pr-2 pl-3 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
            >
              <FolderOpen className="size-3.5" />
              <span>{activeCategory}</span>
              <X className="size-3.5" />
              <span className="sr-only">{t("notes.removeCategory")}</span>
            </button>
          )}
          {!aiLinked && query.trim() && (
            <button
              type="button"
              onClick={clearSearch}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface py-1 pr-2 pl-3 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
            >
              “{query.trim()}”
              <X className="size-3.5" />
              <span className="sr-only">{t("notes.clearSearch")}</span>
            </button>
          )}
        </div>
      )}

      {/* Selected-for-AI hint */}
      {selectedNotes.length > 0 && !aiLinked && (
        <p className="mt-4 inline-flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-xs font-medium text-accent-fg">
          <MousePointerClick className="size-3.5" />
          {t("notes.pinned", { count: selectedNotes.length })}
        </p>
      )}

      <div className="mt-6">
        {!notesLoaded || resultsLoading ? (
          <NotesSkeleton />
        ) : totalNotes === 0 ? (
          <div className="mx-auto flex max-w-md animate-rise flex-col items-center py-10 text-center">
            <Image
              src="/assets/empty-state.jpg"
              alt=""
              width={512}
              height={512}
              priority
              className="size-56 rounded-[2.5rem] object-cover shadow-xl shadow-indigo-500/10 sm:size-64"
            />
            <h2 className="mt-8 text-xl font-bold tracking-tight text-fg">{t("notes.emptyTitle")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">{t("notes.emptyText")}</p>
            <Button onClick={newNote} size="lg" className="mt-6" icon={<Plus className="size-4" />}>
              {t("notes.createFirst")}
            </Button>
          </div>
        ) : filteredNotes.length === 0 ? (
          <div className="flex flex-col items-center rounded-3xl border border-dashed border-line px-6 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-fg-subtle">
              {emptyFolder ? <FolderOpen className="size-5" /> : <SearchX className="size-5" />}
            </span>
            <h2 className="mt-4 font-semibold text-fg">{emptyFolder ? t("notes.emptyFolder") : t("notes.noMatches")}</h2>
            <p className="mt-1 max-w-sm text-sm text-fg-muted">{emptyFolder ? t("notes.emptyFolderText") : t("notes.noMatchesText")}</p>
            <Button
              variant="secondary"
              className="mt-5"
              onClick={() => {
                clearSearch();
                setActiveCategory(null);
                setActiveFolder(null);
              }}
            >
              {t("notes.clearFilters")}
            </Button>
          </div>
        ) : (
          <div className="columns-1 gap-4 md:columns-2 xl:columns-3">
            {filteredNotes.map((note, i) => (
              <ShowNote
                key={note.id}
                note={note}
                index={i}
                selected={selectedNotes.some((s) => s.noteId === note.id)}
                indexState={indexByNote.get(note.id)}
                onReindex={() => void retryIndexing(note)}
                onEdit={() => openNote(note.id)}
                onToggleSelect={() => toggleSelect(note.id, note.title)}
                onDelete={() => setPendingDelete(note)}
              />
            ))}
          </div>
        )}
        {hasMore && (
          <div ref={sentinelRef} className="flex justify-center py-6">
            {loadingMore ? (
              <Spinner />
            ) : (
              <Button variant="secondary" size="sm" onClick={() => void loadMore()}>
                {t("notes.loadMore")}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Mobile create button — sits above content, page has bottom padding to clear it */}
      <div className="fixed right-5 bottom-5 z-30 sm:hidden">
        <Button onClick={newNote} size="fab" aria-label={t("notes.newNote")}>
          <Plus className="size-6" />
        </Button>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={t("notes.deleteTitle")}
        message={t("notes.deleteMessage", { title: pendingDelete?.title || t("ai.untitled") })}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
