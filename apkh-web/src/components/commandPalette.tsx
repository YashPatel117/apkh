"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  CircleUserRound,
  CornerDownLeft,
  Download,
  FileText,
  Folder,
  Keyboard,
  Languages,
  LogOut,
  MessageSquarePlus,
  MessagesSquare,
  Monitor,
  Moon,
  NotebookText,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
} from "lucide-react";
import { INote } from "@/models/note";
import { getNotesPage, exportAllNotes } from "@/services/noteService";
import { getErrorMessage } from "@/services/axios";
import { useAppSelector } from "@/store/hook";
import { useTheme } from "@/components/ui/theme";
import { useToast } from "@/components/ui/Toast";
import { LANGUAGES, useI18n } from "@/i18n";
import { flattenTree, folderTree } from "@/lib/folders";
import type { FolderFilter } from "@/hooks/useNotesFilter";
import { cn } from "@/lib/cn";

interface Command {
  id: string;
  label: string;
  group: string;
  Icon: typeof Plus;
  /** Extra words that find it */
  keywords?: string;
  hint?: string;
  run: () => void;
}

export interface CommandPaletteActions {
  newNote: () => void;
  openNote: (id: string) => void;
  /** Puts the text in the search bar (on the notes page) */
  search: (text: string) => void;
  ask: (text: string) => void;
  openFolder: (folder: FolderFilter) => void;
  showShortcuts: () => void;
  signOut: () => void;
  canAsk: boolean;
}

const MAX_NOTES = 6;

/** Ctrl/⌘+K: jump to a note, folder or page, or run an action, from the keyboard. */
export function CommandPalette({ open, onClose, actions }: { open: boolean; onClose: () => void; actions: CommandPaletteActions }) {
  const router = useRouter();
  const { t, language, setLanguage } = useI18n();
  const { setPreference } = useTheme();
  const toast = useToast();
  const user = useAppSelector((state) => state.auth.user);
  const folders = useAppSelector((state) => state.note.folders);
  const recent = useAppSelector((state) => state.note.notes);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<INote[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setFound(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Notes matching the typed words, from the server (all pages, not just loaded ones).
  const text = query.trim();
  useEffect(() => {
    if (!open || text.length < 2) {
      setFound(null);
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => {
      getNotesPage({ q: text }, null, MAX_NOTES, abort.signal)
        .then((page) => setFound(page.notes))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [open, text]);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => router.push(href);
    const groups = { notes: t("palette.groupNotes"), actions: t("palette.groupActions"), go: t("palette.groupGo"), folders: t("folders.title"), prefs: t("palette.groupPrefs") };
    const list: Command[] = [];

    const notes = text.length >= 2 ? (found ?? []) : recent.slice(0, MAX_NOTES);
    for (const note of notes) {
      list.push({
        id: `note:${note.id}`,
        label: note.title || t("ai.untitled"),
        group: text.length >= 2 ? groups.notes : t("palette.groupRecent"),
        Icon: FileText,
        keywords: note.category,
        hint: note.category,
        run: () => actions.openNote(note.id),
      });
    }

    if (text) {
      list.push({ id: "search", label: t("palette.searchFor", { text }), group: groups.actions, Icon: Search, run: () => actions.search(text) });
      if (actions.canAsk && text.length >= 4) {
        list.push({ id: "ask", label: t("palette.askAbout", { text }), group: groups.actions, Icon: Sparkles, run: () => actions.ask(text) });
      }
    }

    list.push(
      { id: "new-note", label: t("nav.newNote"), group: groups.actions, Icon: Plus, hint: "Alt+N", run: actions.newNote },
      { id: "new-chat", label: t("chat.new"), group: groups.actions, Icon: MessageSquarePlus, run: go("/chat?new=1") },
      { id: "export", label: t("palette.exportAll"), group: groups.actions, Icon: Download, keywords: "zip backup download", run: () => void exportAllNotes().catch((e) => toast(getErrorMessage(e, t("card.exportFailed")), "error")) },
      { id: "go-notes", label: t("nav.notes"), group: groups.go, Icon: NotebookText, run: () => actions.openFolder(null) },
      { id: "go-chat", label: t("nav.chats"), group: groups.go, Icon: MessagesSquare, run: go("/chat") },
      { id: "go-usage", label: t("nav.usage"), group: groups.go, Icon: BarChart3, keywords: "analytics tokens cost", run: go("/analytics") },
      { id: "go-profile", label: t("nav.profile"), group: groups.go, Icon: CircleUserRound, keywords: "settings key integrations", run: go("/profile") },
    );
    if (user?.isAdmin) list.push({ id: "go-admin", label: t("nav.admin"), group: groups.go, Icon: ShieldCheck, run: go("/admin") });

    for (const folder of flattenTree(folderTree(folders))) {
      list.push({ id: `folder:${folder.id}`, label: folder.name, group: groups.folders, Icon: Folder, run: () => actions.openFolder(folder.id) });
    }

    list.push(
      { id: "theme-light", label: t("palette.themeLight"), group: groups.prefs, Icon: Sun, keywords: "theme appearance", run: () => setPreference("light") },
      { id: "theme-dark", label: t("palette.themeDark"), group: groups.prefs, Icon: Moon, keywords: "theme appearance", run: () => setPreference("dark") },
      { id: "theme-system", label: t("palette.themeSystem"), group: groups.prefs, Icon: Monitor, keywords: "theme appearance", run: () => setPreference("system") },
      ...LANGUAGES.filter((l) => l.id !== language).map((l) => ({
        id: `lang:${l.id}`,
        label: `${t("language.title")}: ${l.label}`,
        group: groups.prefs,
        Icon: Languages,
        keywords: "language idioma भाषा",
        run: () => setLanguage(l.id),
      })),
      { id: "shortcuts", label: t("palette.shortcuts"), group: groups.prefs, Icon: Keyboard, hint: "?", run: actions.showShortcuts },
      { id: "sign-out", label: t("shell.signOut"), group: groups.prefs, Icon: LogOut, run: actions.signOut },
    );
    return list;
  }, [text, found, recent, folders, user, actions, router, t, language, setLanguage, setPreference, toast]);

  // Notes found by the server already match; everything else is matched by its words.
  const results = useMemo(() => {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return commands;
    return commands.filter((c) => {
      if (c.id.startsWith("note:") || c.id === "search" || c.id === "ask") return true;
      const haystack = `${c.label} ${c.keywords ?? ""} ${c.group}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [commands, text]);

  useEffect(() => setActive(0), [text, found]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!open || typeof document === "undefined") return null;

  let lastGroup = "";
  return createPortal(
    <div data-modal-root className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="fixed inset-0 animate-fade-in bg-slate-950/45 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.title")}
        className="relative flex max-h-[70vh] w-full max-w-xl animate-scale-in flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl shadow-slate-900/20"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 shrink-0 text-fg-subtle" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("palette.placeholder")}
            role="combobox"
            aria-expanded
            aria-controls="command-results"
            aria-activedescendant={results[active] ? `command-${results[active].id}` : undefined}
            className="h-14 min-w-0 flex-1 bg-transparent text-[0.95rem] text-fg outline-none placeholder:text-fg-subtle"
          />
          <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 font-mono text-[0.68rem] text-fg-subtle sm:block">Esc</kbd>
        </div>
        <ul ref={listRef} id="command-results" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-8 text-center text-sm text-fg-muted">{t("palette.nothing")}</li>}
          {results.map((command, i) => {
            const header = command.group !== lastGroup ? command.group : null;
            lastGroup = command.group;
            return (
              <li key={command.id} role="presentation">
                {header && <p className="px-3 pt-2.5 pb-1 text-[0.68rem] font-semibold tracking-wider text-fg-subtle uppercase">{header}</p>}
                <button
                  type="button"
                  id={`command-${command.id}`}
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => run(command)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                    i === active ? "bg-accent-soft text-accent-fg" : "text-fg",
                  )}
                >
                  <command.Icon className={cn("size-4 shrink-0", i === active ? "text-accent" : "text-fg-subtle")} />
                  <span className="min-w-0 flex-1 truncate">{command.label}</span>
                  {command.hint && <span className="shrink-0 truncate text-xs text-fg-subtle">{command.hint}</span>}
                  {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-accent" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
