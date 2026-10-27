"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type ReactQuill from "react-quill-new";
import { FileText } from "lucide-react";
import type { INote } from "@/models/note";
import { getNotesPage } from "@/services/noteService";
import { noteHref } from "@/lib/noteLinks";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";

const MAX_RESULTS = 8;
const SEARCH_DELAY_MS = 150;

interface State {
  /** Where the "[[" is */
  start: number;
  query: string;
  top: number;
  left: number;
}

/**
 * "[[" in the note editor opens a list of notes; typing searches them by
 * title and text, arrows and Enter (or Tab) pick, Escape closes. The picked
 * note is inserted as a link to its page, which also makes it a backlink.
 */
export function useNoteLinkPicker(quillRef: React.RefObject<ReactQuill | null>, currentNoteId?: string) {
  const [state, setState] = useState<State | null>(null);
  const [results, setResults] = useState<INote[]>([]);
  const [active, setActive] = useState(0);
  const t = useT();
  const openedAt = useRef<number | null>(null);

  const close = useCallback(() => {
    openedAt.current = null;
    setState(null);
  }, []);

  // Watch what's typed just before the cursor.
  useEffect(() => {
    const quill = quillRef.current?.getEditor();
    if (!quill) return;
    const update = () => {
      const range = quill.getSelection();
      const hide = () => {
        openedAt.current = null;
        setState(null);
      };
      if (!range || range.length) return hide();
      const [, offset] = quill.getLine(range.index);
      const before = quill.getText(range.index - offset, offset);
      const match = /\[\[([^\[\]\n]{0,60})$/.exec(before);
      const format = quill.getFormat(range.index);
      if (!match || format.code || format["code-block"]) return hide();
      const start = range.index - match[1].length - 2;
      if (openedAt.current !== start) {
        openedAt.current = start;
        setActive(0);
      }
      const bounds = quill.getBounds(range.index);
      const box = quill.container.getBoundingClientRect();
      setState({ start, query: match[1], top: box.top + (bounds?.bottom ?? 0) + 6, left: box.left + (bounds?.left ?? 0) });
    };
    quill.on("editor-change", update);
    return () => {
      quill.off("editor-change", update);
    };
  }, [quillRef]);

  // Search as the query changes (all notes, not just the ones loaded).
  const query = state?.query;
  useEffect(() => {
    if (query === undefined) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getNotesPage({ q: query.trim() || undefined }, null, MAX_RESULTS + 1, controller.signal)
        .then((page) => setResults(page.notes.filter((n) => n.id !== currentNoteId).slice(0, MAX_RESULTS)))
        .catch(() => {});
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, currentNoteId]);

  // The list is placed where the cursor was; scrolling moves the text, so close it.
  useEffect(() => {
    if (!state) return;
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [state, close]);

  const pick = useCallback(
    (note: INote | undefined) => {
      const quill = quillRef.current?.getEditor();
      if (!quill || !state || !note) return;
      const title = note.title || t("ai.untitled");
      quill.deleteText(state.start, state.query.length + 2, "user");
      quill.insertText(state.start, title, { link: noteHref(note.id) }, "user");
      // The space after the link isn't part of it, so typing goes on as plain text.
      quill.insertText(state.start + title.length, " ", { link: false }, "user");
      quill.setSelection(state.start + title.length + 1, 0, "user");
      close();
    },
    [quillRef, state, close, t],
  );

  /** Put on an element around the editor as onKeyDownCapture, so the list gets its keys before Quill. */
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    if (!state || !results.length) return;
    const handled = ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key);
    if (!handled || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "ArrowDown") setActive((i) => (i + 1) % results.length);
    else if (e.key === "ArrowUp") setActive((i) => (i - 1 + results.length) % results.length);
    else if (e.key === "Escape") close();
    else pick(results[Math.min(active, results.length - 1)]);
  };

  const open = Boolean(state && results.length);
  const menu =
    state && results.length && typeof document !== "undefined"
      ? createPortal(
          <div
            role="listbox"
            aria-label={t("links.pickerLabel")}
            className="fixed z-[60] max-h-72 w-72 animate-scale-in overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-xl shadow-slate-900/10"
            style={{ top: Math.min(state.top, window.innerHeight - 300), left: Math.min(state.left, window.innerWidth - 296) }}
            // Keep focus (and the selection) in the editor.
            onMouseDown={(e) => e.preventDefault()}
          >
            <p className="px-2.5 pt-1 pb-1.5 text-[0.7rem] font-semibold tracking-wide text-fg-subtle uppercase">{t("links.pickerTitle")}</p>
            {results.map((note, i) => (
              <button
                key={note.id}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => pick(note)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition-colors",
                  i === active ? "bg-accent-soft" : "hover:bg-surface-2",
                )}
              >
                <FileText className={cn("size-4 shrink-0", i === active ? "text-accent" : "text-fg-subtle")} />
                <span className="min-w-0">
                  <span className={cn("block truncate text-sm font-medium", i === active ? "text-accent-fg" : "text-fg")}>
                    {note.title || t("ai.untitled")}
                  </span>
                  {note.category && <span className="block truncate text-xs text-fg-subtle">{note.category}</span>}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  return { menu, onKeyDownCapture, open };
}
