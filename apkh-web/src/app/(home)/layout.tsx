"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { Menu as MenuIcon, RefreshCw, Sparkles, WifiOff } from "lucide-react";
import { profile } from "@/services/authService";
import { getValidToken, clearToken } from "@/services/session";
import { getErrorMessage } from "@/services/axios";
import { useAppDispatch, useAppSelector } from "@/store/hook";
import { logout, setToken, setUser } from "@/store/slices/authSlice";
import { addNote, markNoteIndexing, setNotes } from "@/store/slices/noteSlice";
import { useIndexStatusSync } from "@/hooks/useIndexStatusSync";
import { addSession, setActiveSession, setSessions } from "@/store/slices/chatSlice";
import {
  aiSearchNotes,
  AiSearchResponse,
  createNote,
  getAllNotes,
  getNoteLastUpdatedTime,
  updateNote,
} from "@/services/noteService";
import { createChatSession, getChatSessions } from "@/services/chatService";
import { INote, INoteDto } from "@/models/note";
import { activeAi } from "@/models/user";
import { NotesContext, SelectedNote } from "@/context/notesContext";
import { cleanAiErrorMessage, htmlToText, isAiErrorResponse } from "@/lib/aiResponse";
import MentionTextField from "@/components/mentionTextField";
import { AiAnswerPanel } from "@/components/aiAnswerPanel";
import { SourceViewerProvider } from "@/components/sourceViewer";
import { fromAiReference } from "@/components/sources";
import { Sidebar } from "@/components/sidebar";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { ThemeToggle } from "@/components/ui/theme";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/Spinner";
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

// Module-level so a remount (route change) doesn't refire the same request.
let profileRequest: Promise<unknown> | null = null;
let notesRequest: Promise<unknown> | null = null;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAppSelector((state) => state.auth);
  const { notes, latestUpdatedAt } = useAppSelector((state) => state.note);
  const sessionsCount = useAppSelector((state) => state.chat.sessions.length);
  const dispatch = useAppDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();

  const [loadError, setLoadError] = useState<string | null>(null);
  const [notesLoaded, setNotesLoaded] = useState(notes.length > 0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedNotes, setSelectedNotes] = useState<SelectedNote[]>([]);

  const [aiAnswer, setAiAnswer] = useState<AiSearchResponse | null>(null);
  const [aiQuery, setAiQuery] = useState("");
  const [isAiSearching, setIsAiSearching] = useState(false);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const aiRequestId = useRef(0);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editNote, setEditNote] = useState<INote | null>(null);
  const [saving, setSaving] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const ai = activeAi(user);
  const indexCounts = useAppSelector((state) => state.note.indexStatus?.counts);
  const pendingIndex = indexCounts ? indexCounts.queued + indexCounts.processing : 0;

  useIndexStatusSync(Boolean(user) && notesLoaded);

  // ── Auth + initial data ──────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoadError(null);
    try {
      if (!user) {
        profileRequest ??= profile().finally(() => (profileRequest = null));
        dispatch(setUser((await profileRequest) as never));
      }
      notesRequest ??= (async () => {
        const lastUpdated = await getNoteLastUpdatedTime();
        if (!lastUpdated || !latestUpdatedAt || lastUpdated > latestUpdatedAt) {
          dispatch(setNotes(await getAllNotes()));
        }
      })().finally(() => (notesRequest = null));
      await notesRequest;
      setNotesLoaded(true);
      // Sidebar/profile show conversation counts on every page; failures here are non-fatal.
      getChatSessions()
        .then((sessions) => dispatch(setSessions(sessions)))
        .catch(() => {});
    } catch (error) {
      // 401s are handled globally by the axios interceptor (redirect to login).
      setLoadError(getErrorMessage(error, "We couldn't load your workspace."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  useEffect(() => {
    const token = getValidToken();
    if (!token) {
      dispatch(logout());
      router.replace("/login");
      return;
    }
    dispatch(setToken(token));
    void loadData();
  }, [dispatch, router, loadData]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        focusSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusSearch]);

  useEffect(() => setDrawerOpen(false), [pathname]);

  // ── Filtering ────────────────────────────────────────────────────────────
  const searchableText = useMemo(
    () => new Map(notes.map((n) => [n.id, `${n.title} ${n.category} ${htmlToText(n.content)}`.toLowerCase()])),
    [notes],
  );

  // An in-progress "@mention" is a note picker, not search text.
  const textQuery = search.replace(/(^|\s)@\S*/g, " ").replace(/\s+/g, " ").trim();
  const aiFailed = isAiErrorResponse(aiAnswer);
  const aiErrorMessage = aiFailed && aiAnswer?.answer ? cleanAiErrorMessage(aiAnswer.answer) : null;

  const filteredNotes = useMemo(() => {
    let list = notes;
    if (aiAnswer && !aiFailed && aiAnswer.references.length) {
      const ids = new Set(aiAnswer.references.map((r) => r.note_id));
      return list.filter((n) => ids.has(n.id));
    }
    if (activeCategory) list = list.filter((n) => n.category?.trim() === activeCategory);
    const q = textQuery.toLowerCase();
    if (q) list = list.filter((n) => searchableText.get(n.id)?.includes(q));
    return list;
  }, [notes, aiAnswer, aiFailed, activeCategory, textQuery, searchableText]);

  // ── Search / AI ──────────────────────────────────────────────────────────
  const handleSearchChange = (value: string) => {
    // Results live on the notes page — take the user there as soon as they start typing.
    if (!search.trim() && value.trim() && !value.trim().startsWith("@") && pathname !== "/notes") {
      router.push("/notes");
    }
    setSearch(value);
    // A new question invalidates the previous answer (but not while it's loading).
    if (aiAnswer) setAiAnswer(null);
  };

  const clearSearch = useCallback(() => {
    aiRequestId.current += 1;
    setSearch("");
    setAiAnswer(null);
    setIsAiSearching(false);
    setAnswerOpen(false);
  }, []);

  const trimmedSearch = search.trim();
  const canAsk = trimmedSearch.length >= MIN_AI_QUERY && !isAiSearching;

  async function handleAiSearch() {
    if (!ai) {
      toast("Add and activate an AI key in Profile to enable answers.", "info");
      router.push("/profile");
      return;
    }
    if (trimmedSearch.length < MIN_AI_QUERY) {
      toast(`Type at least ${MIN_AI_QUERY} characters to ask AI.`, "info");
      return;
    }

    const requestId = ++aiRequestId.current;
    setAiQuery(trimmedSearch);
    setAiAnswer(null);
    setIsAiSearching(true);
    setAnswerOpen(true);
    try {
      const res = await aiSearchNotes(trimmedSearch, selectedNotes.map((n) => n.noteId));
      if (requestId !== aiRequestId.current) return;
      setAiAnswer(res);
      if (!isAiErrorResponse(res)) {
        profile()
          .then((updatedUser) => dispatch(setUser(updatedUser)))
          .catch(() => {});
      }
    } catch (error) {
      if (requestId !== aiRequestId.current) return;
      setAiAnswer({
        query: trimmedSearch,
        answer: getErrorMessage(error, "AI search failed. Please try again."),
        confidence: "not_found",
        isError: true,
        references: [],
      });
    } finally {
      if (requestId === aiRequestId.current) setIsAiSearching(false);
    }
  }

  const handleContinueConversation = async () => {
    if (!aiAnswer) return;
    setContinuing(true);
    try {
      // The answer's sources carry over, so its [n] citations keep working in the chat.
      const session = await createChatSession(aiAnswer.query || aiQuery, aiAnswer.answer, aiAnswer.references.map(fromAiReference));
      dispatch(addSession(session));
      dispatch(setActiveSession(session.id));
      setAnswerOpen(false);
      clearSearch();
      router.push(`/chat?session=${session.id}`);
    } catch (error) {
      toast(getErrorMessage(error, "Couldn't start the conversation."), "error");
    } finally {
      setContinuing(false);
    }
  };

  const toggleSelect = useCallback((noteId: string, title: string) => {
    setSelectedNotes((prev) =>
      prev.some((n) => n.noteId === noteId) ? prev.filter((n) => n.noteId !== noteId) : [...prev, { noteId, title }],
    );
  }, []);

  // ── Note editor ──────────────────────────────────────────────────────────
  const openNote = useCallback(
    (noteId: string) => {
      const note = notes.find((n) => n.id === noteId);
      if (!note) {
        toast("That note no longer exists.", "error");
        return;
      }
      setEditNote(note);
      setEditorOpen(true);
    },
    [notes, toast],
  );

  const newNote = useCallback(() => {
    setEditNote(null);
    setEditorOpen(true);
  }, []);

  const saveNote = async (data: INoteDto, id?: string) => {
    setSaving(true);
    try {
      const res = id ? await updateNote(id, data) : await createNote(data);
      if (res) {
        dispatch(addNote(res));
        dispatch(markNoteIndexing(res.id));
      }
      setEditorOpen(false);
      toast(id ? "Note updated." : "Note created. Indexing for AI search…", "success");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    clearToken();
    dispatch(logout());
    router.replace("/login");
  };

  // ── Render ───────────────────────────────────────────────────────────────
  if (loadError && !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
            <WifiOff className="size-6" />
          </span>
          <h1 className="mt-5 text-lg font-semibold text-fg">Workspace unavailable</h1>
          <p className="mt-1.5 text-sm text-fg-muted">{loadError}</p>
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="secondary" onClick={handleLogout}>
              Sign out
            </Button>
            <Button onClick={() => void loadData()} icon={<RefreshCw className="size-4" />}>
              Retry
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
      notes={notes}
      sessionsCount={sessionsCount}
      activeCategory={activeCategory}
      onCategory={setActiveCategory}
      onNewNote={newNote}
      onNavigate={onNavigate}
      onLogout={handleLogout}
    />
  );

  return (
    <NotesContext.Provider
      value={{
        filteredNotes,
        notesLoaded,
        query: textQuery,
        activeCategory,
        setActiveCategory,
        openNote,
        newNote,
        aiAnswer,
        aiFailed,
        isAiSearching,
        openAnswer: () => setAnswerOpen(true),
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
                aria-label="Open navigation"
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
                  onSubmit={() => void handleAiSearch()}
                  placeholder="Search notes or ask AI…"
                />
                <Tooltip
                  label={
                    !ai
                      ? "Set up an AI key in Profile first"
                      : !canAsk && !isAiSearching
                        ? `Type at least ${MIN_AI_QUERY} characters`
                        : undefined
                  }
                  side="bottom"
                >
                  <Button
                    onClick={() => void handleAiSearch()}
                    disabled={Boolean(ai) && !canAsk}
                    loading={isAiSearching}
                    icon={!isAiSearching && <Sparkles className="size-4" />}
                    size="toolbar"
                    aria-label="Ask AI"
                  >
                    <span className="hidden sm:inline">{isAiSearching ? "Thinking…" : "Ask AI"}</span>
                  </Button>
                </Tooltip>
              </div>

              {/* The one appearance control in the app (light / dark / system). */}
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {pendingIndex > 0 && (
                  <Tooltip label="New and edited notes become searchable by AI once indexed" side="bottom">
                    <span className="hidden items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-fg-muted md:inline-flex">
                      <Spinner className="size-3.5" />
                      Indexing {pendingIndex} note{pendingIndex === 1 ? "" : "s"}
                    </span>
                  </Tooltip>
                )}
                <ThemeToggle />
              </div>
            </header>

            <main id="main" className="min-h-0 flex-1 overflow-y-auto">
              {children}
            </main>
          </div>
        </div>

        {/* AI answer sheet */}
        <Modal
          open={answerOpen}
          onClose={() => setAnswerOpen(false)}
          placement="right"
          title={
            <span className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-xl bg-linear-to-br from-blue-500 via-indigo-500 to-violet-500 text-white">
                <Sparkles className="size-4" />
              </span>
              AI answer
            </span>
          }
          description={ai ? `${ai.name} · ${ai.model}` : undefined}
        >
          <AiAnswerPanel
            query={aiQuery}
            answer={aiAnswer}
            isSearching={isAiSearching}
            errorMessage={aiErrorMessage}
            onContinue={() => void handleContinueConversation()}
            continuing={continuing}
          />
        </Modal>

        {/* Note editor */}
        <Modal
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          locked={saving}
          title={editNote ? "Edit note" : "New note"}
          description={editNote ? undefined : "Leave the title or category blank and they'll be filled in from your note."}
          size="lg"
        >
          <NoteEditor
            key={editNote?.id ?? "new-note"}
            initialNote={editNote}
            saving={saving}
            onSave={saveNote}
            onCancel={() => setEditorOpen(false)}
            categoryOptions={Array.from(new Set(notes.map((n) => n.category?.trim()).filter(Boolean)))}
          />
        </Modal>
      </SourceViewerProvider>
    </NotesContext.Provider>
  );
}
