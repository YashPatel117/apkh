"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type ReactQuill from "react-quill-new";
import { CalendarDays, Code, Heading1, Heading2, Heading3, List, ListChecks, ListOrdered, Paperclip, Pilcrow, Quote } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";

type Quill = ReturnType<ReactQuill["getEditor"]>;

interface SlashCommand {
  id: string;
  label: string;
  hint: string;
  keywords: string;
  Icon: typeof Heading1;
  /** Runs with the "/query" text already removed; `index` is where it was */
  apply: (quill: Quill, index: number) => void;
}

const line = (format: string, value: unknown) => (quill: Quill, index: number) => {
  // One block format at a time: clear the others first.
  quill.formatLine(index, 1, { header: false, list: false, blockquote: false, "code-block": false }, "user");
  if (value !== false) quill.formatLine(index, 1, format, value, "user");
};

interface State {
  /** Where the "/" is */
  start: number;
  query: string;
  top: number;
  left: number;
}

/**
 * Slash commands for the note editor: "/" at the start of a line (or after a
 * space) opens a menu of block formats; typing filters it, arrows and Enter
 * pick, Escape closes.
 */
export function useSlashCommands(quillRef: React.RefObject<ReactQuill | null>, onAttach: () => void) {
  const [state, setState] = useState<State | null>(null);
  const [active, setActive] = useState(0);
  const t = useT();
  const openedAt = useRef<number | null>(null);

  const commands = useMemo<SlashCommand[]>(
    () => [
      { id: "text", label: t("slash.text"), hint: t("slash.textHint"), keywords: "text paragraph normal body", Icon: Pilcrow, apply: line("header", false) },
      { id: "h1", label: t("slash.h1"), hint: t("slash.h1Hint"), keywords: "heading 1 title h1 #", Icon: Heading1, apply: line("header", 1) },
      { id: "h2", label: t("slash.h2"), hint: t("slash.h2Hint"), keywords: "heading 2 subtitle h2 ##", Icon: Heading2, apply: line("header", 2) },
      { id: "h3", label: t("slash.h3"), hint: t("slash.h3Hint"), keywords: "heading 3 h3 ###", Icon: Heading3, apply: line("header", 3) },
      { id: "bullet", label: t("slash.bullet"), hint: t("slash.bulletHint"), keywords: "bulleted list ul unordered bullets -", Icon: List, apply: line("list", "bullet") },
      { id: "ordered", label: t("slash.ordered"), hint: t("slash.orderedHint"), keywords: "numbered list ol ordered numbers 1.", Icon: ListOrdered, apply: line("list", "ordered") },
      { id: "todo", label: t("slash.todo"), hint: t("slash.todoHint"), keywords: "checklist todo task checkbox action", Icon: ListChecks, apply: line("list", "unchecked") },
      { id: "quote", label: t("slash.quote"), hint: t("slash.quoteHint"), keywords: "quote blockquote citation >", Icon: Quote, apply: line("blockquote", true) },
      { id: "code", label: t("slash.code"), hint: t("slash.codeHint"), keywords: "code block pre snippet ```", Icon: Code, apply: line("code-block", true) },
      {
        id: "date",
        label: t("slash.date"),
        hint: new Date().toLocaleDateString(undefined, { dateStyle: "medium" }),
        keywords: "today now time date",
        Icon: CalendarDays,
        apply: (quill, index) => {
          const text = new Date().toLocaleDateString(undefined, { dateStyle: "long" });
          quill.insertText(index, `${text} `, "user");
          quill.setSelection(index + text.length + 1, 0, "user");
        },
      },
      { id: "attach", label: t("slash.attach"), hint: t("slash.attachHint"), keywords: "attach upload file pdf image", Icon: Paperclip, apply: () => onAttach() },
    ],
    [onAttach, t],
  );

  const results = useMemo(() => {
    const query = state?.query.toLowerCase() ?? "";
    return query ? commands.filter((c) => `${c.label} ${c.keywords}`.toLowerCase().includes(query)) : commands;
  }, [commands, state?.query]);

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
      const match = /(?:^|\s)\/([\p{L}\d-]{0,20})$/u.exec(before);
      const format = quill.getFormat(range.index);
      if (!match || format.code || format["code-block"]) return hide();
      const start = range.index - match[1].length - 1;
      // A new "/" starts at the top of the list; typing more keeps the place.
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

  // The menu is placed where the cursor was; scrolling moves the text, so close it.
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
    (command: SlashCommand | undefined) => {
      const quill = quillRef.current?.getEditor();
      if (!quill || !state || !command) return;
      const length = state.query.length + 1;
      quill.deleteText(state.start, length, "user");
      quill.setSelection(state.start, 0, "user");
      close();
      command.apply(quill, state.start);
    },
    [quillRef, state, close],
  );

  /** Put on an element around the editor as onKeyDownCapture, so the menu gets its keys before Quill. */
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

  const menu =
    state && results.length && typeof document !== "undefined"
      ? createPortal(
          <div
            role="listbox"
            aria-label={t("slash.menu")}
            className="fixed z-[60] max-h-72 w-64 animate-scale-in overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-xl shadow-slate-900/10"
            style={{ top: Math.min(state.top, window.innerHeight - 300), left: Math.min(state.left, window.innerWidth - 272) }}
            // Keep focus (and the selection) in the editor.
            onMouseDown={(e) => e.preventDefault()}
          >
            {results.map((command, i) => (
              <button
                key={command.id}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => pick(command)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-colors",
                  i === active ? "bg-accent-soft" : "hover:bg-surface-2",
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-fg-muted">
                  <command.Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-sm font-medium", i === active ? "text-accent-fg" : "text-fg")}>{command.label}</span>
                  <span className="block truncate text-xs text-fg-subtle">{command.hint}</span>
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  return { menu, onKeyDownCapture, open: Boolean(state && results.length) };
}
