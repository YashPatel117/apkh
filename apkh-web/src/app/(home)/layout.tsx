"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { CloudOff, Menu as MenuIcon, RefreshCw, Sparkles, WifiOff } from "lucide-react";
import { useAppSelector } from "@/store/hook";
import { useAuth } from "@/hooks/useAuth";
import { useAiSearch } from "@/hooks/useAiSearch";
import { useNotesFilter } from "@/hooks/useNotesFilter";
import { useNoteEditor } from "@/hooks/useNoteEditor";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useRealtime } from "@/hooks/useRealtime";
import { useIndexStatusSync } from "@/hooks/useIndexStatusSync";
import { activeAi } from "@/models/user";
import { NotesContext, SelectedNote } from "@/context/notesContext";
import MentionTextField from "@/components/mentionTextField";
import { AiAnswerPanel } from "@/components/aiAnswerPanel";
import { SourceViewerProvider } from "@/components/sourceViewer";
import { Sidebar } from "@/components/sidebar";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { ThemeToggle } from "@/components/ui/theme";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/i18n";
import { ErrorBoundary } from "@/components/errorBoundary";
import { CommandPalette, CommandPaletteActions } from "@/components/commandPalette";
import { ShortcutsDialog } from "@/components/shortcutsDialog";
import HomeLoading from "./loading";

const NoteEditor = dynamic(() => import("@/components/noteEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-96 items-center justify-center text-fg-subtle">
      <Spinner />
    </div>
  ),
});

const MIN_AI_QUERY = 4;

/** Keys typed into a field belong to the field, not to the app's shortcuts. */
function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loadError, notesLoaded, loadData, signOut } = useAuth();
  const { categories, totalNotes } = useAppSelector((state) => state.note);
  const sessionsCount = useAppSelector((state) => state.chat.sessions.length);
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const t = useT();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedNotes, setSelectedNotes] = useState<SelectedNote[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const aiSearch = useAiSearch();
  const filter = useNotesFilter(search, aiSearch.answer, aiSearch.failed);
  const editor = useNoteEditor();

  const ready = Boolean(user) && notesLoaded;
  const { online, pending: pendingSaves } = useOfflineSync(ready, (count) => toast(t("offline.synced", { count }), "success"));
  const { connected } = useRealtime(ready);
  useIndexStatusSync(ready, connected);

  const ai = activeAi(user);
  const indexCounts = useAppSelector((state) => state.note.indexStatus?.counts);
  const pendingIndex = indexCounts ? indexCounts.queued + indexCounts.processing : 0;

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, []);


  useEffect(() => setDrawerOpen(false), [pathname]);

  // ── Search / AI ──────────────────────────────────────────────────────────
  const handleSearchChange = (value: string) => {
    // Results live on the notes page — take the user there as soon as they start typing.
    if (!search.trim() && value.trim() && !value.trim().startsWith("@") && pathname !== "/notes") {
      router.push("/notes");
    }
    setSearch(value);
    // A new question invalidates the previous answer (but not while it's loading).
    aiSearch.resetAnswer();
  };

  const { clear: clearAnswer } = aiSearch;
  const clearSearch = useCallback(() => {
    setSearch("");
    clearAnswer();
  }, [clearAnswer]);

  const trimmedSearch = search.trim();
  const canAsk = trimmedSearch.length >= MIN_AI_QUERY && !aiSearch.isSearching;

  function handleAiSearch() {
    if (!ai) {
      toast(t("ai.off"), "info");
      return;
    }
    if (!online) {
      toast(t("ai.needsConnection"), "info");
      return;
    }
    if (trimmedSearch.length < MIN_AI_QUERY) {
      toast(t("ai.tooShort", { count: MIN_AI_QUERY }), "info");
      return;
    }
    void aiSearch.ask(trimmedSearch, selectedNotes.map((n) => n.noteId));
  }

  const handleContinueConversation = async () => {
    if (await aiSearch.continueConversation()) clearSearch();
  };

  const toggleSelect = useCallback((noteId: string, title: string) => {
    setSelectedNotes((prev) =>
      prev.some((n) => n.noteId === noteId) ? prev.filter((n) => n.noteId !== noteId) : [...prev, { noteId, title }],
    );
  }, []);

  // ── Note editor ──────────────────────────────────────────────────────────
  const { openNote: openEditor, newNote: newEditorNote } = editor;
  const openNote = useCallback((noteId: string) => void openEditor(noteId), [openEditor]);
  // A note created while a folder is open is filed in it.
  const { activeFolder, setActiveFolder } = filter;
  // A folder that's gone (deleted here or elsewhere) stops being the filter.
  const folders = useAppSelector((state) => state.note.folders);
  useEffect(() => {
    if (activeFolder && activeFolder !== "root" && notesLoaded && !folders.some((f) => f.id === activeFolder)) setActiveFolder(null);
  }, [activeFolder, folders, notesLoaded, setActiveFolder]);
  const newNote = useCallback(
    () => newEditorNote(activeFolder && activeFolder !== "root" ? activeFolder : null),
    [newEditorNote, activeFolder],
  );

  // ── Keyboard shortcuts (see ShortcutsDialog) ─────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && !e.shiftKey && !e.altKey && key === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (mod && e.shiftKey && key === "f") {
        e.preventDefault();
        focusSearch();
        return;
      }
      // Alt+N everywhere (e.code: on a Mac, Option+N types "˜"). Ctrl/⌘+N only reaches
      // the page in the installed app; in a browser tab it opens a window.
      if ((e.altKey && !mod && e.code === "KeyN") || (mod && !e.shiftKey && !e.altKey && key === "n")) {
        e.preventDefault();
        newNote();
        return;
      }
      if (mod || e.altKey || isTyping(e.target) || document.querySelector("[data-modal-root]")) return;
      if (e.key === "/") {
        e.preventDefault();
        focusSearch();
      } else if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusSearch, newNote]);

  const { ask: askAi, resetAnswer } = aiSearch;
  const paletteActions = useMemo<CommandPaletteActions>(
    () => ({
      newNote,
      openNote,
      search: (text) => {
        setSearch(text);
        resetAnswer();
        if (pathname !== "/notes") router.push("/notes");
      },
      ask: (text) => {
        setSearch(text);
        void askAi(text, selectedNotes.map((n) => n.noteId));
      },
      openFolder: (folder) => {
        setActiveFolder(folder);
        if (pathname !== "/notes") router.push("/notes");
      },
      showShortcuts: () => setShortcutsOpen(true),
      signOut,
      canAsk: Boolean(ai) && online,
    }),
    [newNote, openNote, resetAnswer, askAi, selectedNotes, setActiveFolder, pathname, router, signOut, ai, online],
  );

  // ── Render ───────────────────────────────────────────────────────────────
  if (loadError && !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
            <WifiOff className="size-6" />
          </span>
          <h1 className="mt-5 text-lg font-semibold text-fg">{t("shell.unavailable")}</h1>
          <p className="mt-1.5 text-sm text-fg-muted">{loadError}</p>
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="secondary" onClick={signOut}>
              {t("shell.signOut")}
            </Button>
            <Button onClick={() => void loadData()} icon={<RefreshCw className="size-4" />}>
              {t("shell.retry")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return <HomeLoading />;

  const sidebar = (onNavigate?: () => void) => (
    <Sidebar
      user={user}
      categories={categories}
      totalNotes={totalNotes}
      sessionsCount={sessionsCount}
      activeCategory={filter.activeCategory}
      onCategory={filter.setActiveCategory}
      activeFolder={filter.activeFolder}
      onFolder={filter.setActiveFolder}
      onNewNote={newNote}
      onNavigate={onNavigate}
      onLogout={signOut}
    />
  );

  return (
    <NotesContext.Provider
      value={{
        filteredNotes: filter.filteredNotes,
        filteredTotal: filter.total,
        notesLoaded,
        resultsLoading: filter.loading,
        hasMore: filter.hasMore,
        loadMore: filter.loadMore,
        loadingMore: filter.loadingMore,
        query: filter.textQuery,
        activeCategory: filter.activeCategory,
        setActiveCategory: filter.setActiveCategory,
        activeFolder: filter.activeFolder,
        setActiveFolder: filter.setActiveFolder,
        openNote,
        newNote,
        aiAnswer: aiSearch.answer,
        aiFailed: aiSearch.failed,
        isAiSearching: aiSearch.isSearching,
        openAnswer: () => aiSearch.setAnswerOpen(true),
        clearSearch,
        selectedNotes,
        toggleSelect,
        focusSearch,
      }}
    >
      <SourceViewerProvider onOpenNote={openNote}>
        <div className="relative flex h-dvh overflow-hidden">
          {/* Themed backdrop: soft orbs in light mode, neural network in dark */}
          <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
            <div className="absolute inset-0 bg-[url(/assets/light-background.jpg)] bg-cover bg-center opacity-75 dark:bg-[url(/assets/dark-background.jpg)] dark:opacity-50" />
            {/* Light veil keeps text readable without washing the artwork out */}
            <div className="absolute inset-0 bg-linear-to-b from-canvas/10 via-canvas/30 to-canvas/55 dark:from-canvas/20 dark:via-canvas/40 dark:to-canvas/65" />
          </div>

          {/* Desktop sidebar */}
          <aside className="hidden w-64 shrink-0 border-r border-line bg-surface/80 backdrop-blur-xl lg:block">{sidebar()}</aside>

          {/* Mobile drawer */}
          <Modal open={drawerOpen} onClose={() => setDrawerOpen(false)} placement="left" hideClose title={undefined}>
            {sidebar(() => setDrawerOpen(false))}
          </Modal>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Top bar */}
            <header className="z-20 flex shrink-0 items-center gap-2 border-b border-line bg-surface/75 px-3 py-2.5 backdrop-blur-xl sm:gap-3 sm:px-5">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg lg:hidden"
                aria-label={t("shell.openNav")}
              >
                <MenuIcon className="size-5" />
              </button>

              <div className="flex min-w-0 flex-1 items-center gap-2 lg:max-w-3xl">
                <MentionTextField
                  inputRef={searchRef}
                  value={search}
                  onChange={handleSearchChange}
                  selectedNotes={selectedNotes}
                  onSelectedNotesChange={setSelectedNotes}
                  onSubmit={handleAiSearch}
                  placeholder={t("shell.searchPlaceholder")}
                />
                <Tooltip
                  label={
                    !ai
                      ? t("ai.tooltipSetup")
                      : !online
                        ? t("ai.tooltipOffline")
                        : !canAsk && !aiSearch.isSearching
                          ? t("ai.tooltipShort", { count: MIN_AI_QUERY })
                          : undefined
                  }
                  side="bottom"
                >
                  <Button
                    onClick={handleAiSearch}
                    disabled={!ai || !online || !canAsk}
                    loading={aiSearch.isSearching}
                    icon={!aiSearch.isSearching && <Sparkles className="size-4" />}
                    size="toolbar"
                    aria-label={t("ai.ask")}
                  >
                    <span className="hidden sm:inline">{aiSearch.isSearching ? t("ai.thinking") : t("ai.ask")}</span>
                  </Button>
                </Tooltip>
              </div>

              {/* The one appearance control in the app (light / dark / system). */}
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {pendingIndex > 0 && (
                  <Tooltip label={t("shell.indexingHint")} side="bottom">
                    <span className="hidden items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-fg-muted md:inline-flex">
                      <Spinner className="size-3.5" />
                      {t("shell.indexing", { count: pendingIndex })}
                    </span>
                  </Tooltip>
                )}
                <ThemeToggle />
              </div>
            </header>

            {(!online || pendingSaves > 0) && (
              <div
                role="status"
                className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800 sm:px-5 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
              >
                {online ? <Spinner className="size-3.5" /> : <CloudOff className="size-4 shrink-0" />}
                <span className="min-w-0">
                  {online
                    ? t("offline.syncing", { count: pendingSaves })
                    : pendingSaves
                      ? t("offline.bannerPending", { count: pendingSaves })
                      : t("offline.banner")}
                </span>
              </div>
            )}

            <main id="main" className="min-h-0 flex-1 overflow-y-auto">
              {children}
            </main>
          </div>
        </div>

        {/* AI answer sheet */}
        <Modal
          open={aiSearch.answerOpen}
          onClose={() => aiSearch.setAnswerOpen(false)}
          placement="right"
          title={
            <span className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-xl bg-linear-to-br from-blue-500 via-indigo-500 to-violet-500 text-white">
                <Sparkles className="size-4" />
              </span>
              {t("ai.answerTitle")}
            </span>
          }
          description={ai ? `${ai.name} · ${ai.model}` : undefined}
        >
          <ErrorBoundary area="answer" resetKeys={[aiSearch.query, aiSearch.isSearching]}>
            <AiAnswerPanel
              query={aiSearch.query}
              answer={aiSearch.answer}
              isSearching={aiSearch.isSearching}
              errorMessage={aiSearch.errorMessage}
              onContinue={() => void handleContinueConversation()}
              continuing={aiSearch.continuing}
            />
          </ErrorBoundary>
        </Modal>

        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />
        <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

        {/* Note editor */}
        <Modal
          open={editor.editorOpen}
          onClose={editor.closeEditor}
          locked={editor.saving}
          title={editor.editNote ? t("editor.titleEdit") : t("editor.titleNew")}
          description={editor.editNote ? undefined : t("editor.newHint")}
          size="lg"
        >
          <ErrorBoundary area="editor" resetKeys={[editor.editNote?.id, editor.editorOpen]}>
            <NoteEditor
              key={editor.editNote?.id ?? "new-note"}
              initialNote={editor.editNote}
              saving={editor.saving}
              onSave={editor.saveNote}
              onCancel={editor.closeEditor}
              categoryOptions={categories.map((c) => c.name)}
            />
          </ErrorBoundary>
        </Modal>
      </SourceViewerProvider>
    </NotesContext.Provider>
  );
}
