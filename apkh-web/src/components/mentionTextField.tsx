"use client";

import { useState, useRef, useEffect, useCallback, KeyboardEvent } from "react";
import { FileText, Search, X } from "lucide-react";
import { INote } from "@/models/note";
import { useAppSelector } from "@/store/hook";
import { SelectedNote } from "@/context/notesContext";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";

interface MentionTextFieldProps {
  /** The plain-text portion of the search query (without @mentions) */
  value: string;
  onChange: (value: string) => void;

  /** Notes currently pinned as mention tokens */
  selectedNotes: SelectedNote[];
  onSelectedNotesChange: (notes: SelectedNote[]) => void;

  /** Called when Enter is pressed */
  onSubmit?: () => void;

  placeholder?: string;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

/** Finds an active @mention at the cursor. Only triggers when "@" starts a word,
 *  so typing an email address doesn't pop the note picker. */
function getActiveMention(text: string, cursorPos: number): { query: string; atIndex: number } | null {
  const slice = text.slice(0, cursorPos);
  const lastAt = slice.lastIndexOf("@");
  if (lastAt === -1) return null;
  if (lastAt > 0 && !/\s/.test(slice[lastAt - 1])) return null;

  const afterAt = slice.slice(lastAt + 1);
  if (/\s/.test(afterAt)) return null;

  return { query: afterAt, atIndex: lastAt };
}

function NoteChip({ note, onRemove }: { note: SelectedNote; onRemove: () => void }) {
  const t = useT();
  return (
    <span className="inline-flex max-w-44 shrink-0 items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 py-0.5 pr-0.5 pl-1.5 text-xs font-medium text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-200">
      <FileText className="size-3 shrink-0" />
      <span className="truncate">{note.title}</span>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault(); // keep focus on text input
          onRemove();
        }}
        className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-indigo-400 transition-colors hover:bg-indigo-200 hover:text-indigo-700 dark:hover:bg-indigo-400/20 dark:hover:text-indigo-100"
        aria-label={t("mention.remove", { title: note.title })}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

function MentionDropdown({
  notes,
  query,
  activeIndex,
  onSelect,
  onHover,
}: {
  notes: INote[];
  query: string;
  activeIndex: number;
  onSelect: (note: INote) => void;
  onHover: (index: number) => void;
}) {
  const t = useT();
  return (
    <div
      className="absolute top-[calc(100%+6px)] right-0 left-0 z-50 animate-scale-in overflow-hidden rounded-2xl border border-line bg-surface py-1.5 shadow-xl shadow-slate-900/10"
      id="mention-listbox"
      role="listbox"
      aria-label={t("mention.notes")}
    >
      <p className="px-3 pt-1 pb-2 text-[0.68rem] font-semibold tracking-wider text-fg-subtle uppercase">
        {t("mention.reference")}
        {query && <span className="ml-1 font-normal tracking-normal text-accent normal-case">{t("mention.matching", { query })}</span>}
      </p>

      {notes.length === 0 ? (
        <p className="px-3 pb-2 text-sm text-fg-muted">{t("mention.none")}</p>
      ) : (
        <div className="max-h-60 overflow-y-auto">
          {notes.map((note, i) => (
            <button
              key={note.id}
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(note);
              }}
              onMouseEnter={() => onHover(i)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left transition-colors",
                i === activeIndex ? "bg-accent-soft" : "hover:bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-lg",
                  i === activeIndex ? "bg-indigo-100 text-accent dark:bg-indigo-400/20" : "bg-surface-2 text-fg-subtle",
                )}
              >
                <FileText className="size-3.5" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-fg">{note.title || t("ai.untitled")}</span>
                {note.category && <span className="truncate text-xs text-fg-subtle">{note.category}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MentionTextField({
  value,
  onChange,
  selectedNotes,
  onSelectedNotesChange,
  onSubmit,
  placeholder,
  disabled = false,
  inputRef: externalRef,
}: MentionTextFieldProps) {
  const localRef = useRef<HTMLInputElement>(null);
  const t = useT();
  const inputRef = externalRef ?? localRef;
  const containerRef = useRef<HTMLDivElement>(null);
  const { notes } = useAppSelector((state) => state.note);
  const [mentionState, setMentionState] = useState<{ query: string; atIndex: number } | null>(null);
  const [dropdownActiveIndex, setDropdownActiveIndex] = useState(0);

  const filteredNotes = mentionState
    ? notes
        .filter(
          (n) =>
            n.title.toLowerCase().includes(mentionState.query.toLowerCase()) &&
            !selectedNotes.some((s) => s.noteId === n.id),
        )
        .slice(0, 30)
    : [];

  const dropdownOpen = mentionState !== null;

  useEffect(() => {
    setDropdownActiveIndex(0);
  }, [filteredNotes.length, mentionState?.query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMentionState(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVal = e.target.value;
      onChange(newVal);
      const cursor = e.target.selectionStart ?? newVal.length;
      setMentionState(getActiveMention(newVal, cursor));
    },
    [onChange],
  );

  const selectNote = useCallback(
    (note: INote | undefined) => {
      if (!mentionState || !note) return;

      const before = value.slice(0, mentionState.atIndex);
      const after = value.slice(mentionState.atIndex + 1 + mentionState.query.length);
      onChange(before + after);

      if (!selectedNotes.some((n) => n.noteId === note.id)) {
        onSelectedNotesChange([...selectedNotes, { noteId: note.id, title: note.title }]);
      }

      setMentionState(null);

      requestAnimationFrame(() => {
        inputRef.current?.focus();
        const pos = before.length;
        inputRef.current?.setSelectionRange(pos, pos);
      });
    },
    [mentionState, value, onChange, selectedNotes, onSelectedNotesChange, inputRef],
  );

  const removeNote = useCallback(
    (noteId: string) => {
      onSelectedNotesChange(selectedNotes.filter((n) => n.noteId !== noteId));
      inputRef.current?.focus();
    },
    [selectedNotes, onSelectedNotesChange, inputRef],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (dropdownOpen) {
      if (e.key === "ArrowDown" && filteredNotes.length) {
        e.preventDefault();
        setDropdownActiveIndex((i) => (i + 1) % filteredNotes.length);
        return;
      }
      if (e.key === "ArrowUp" && filteredNotes.length) {
        e.preventDefault();
        setDropdownActiveIndex((i) => (i === 0 ? filteredNotes.length - 1 : i - 1));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (filteredNotes.length) {
          e.preventDefault();
          selectNote(filteredNotes[dropdownActiveIndex]);
        } else if (e.key === "Enter") {
          e.preventDefault();
          setMentionState(null);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionState(null);
        return;
      }
    }

    if (e.key === "Escape" && value) {
      e.preventDefault();
      onChange("");
      return;
    }

    if (e.key === "Backspace" && value === "" && selectedNotes.length > 0 && !dropdownOpen) {
      removeNote(selectedNotes[selectedNotes.length - 1].noteId);
      return;
    }

    if (e.key === "Enter" && !dropdownOpen) {
      e.preventDefault();
      onSubmit?.();
    }
  };

  const handleSelect = (e: React.SyntheticEvent<HTMLInputElement>) => {
    const target = e.currentTarget;
    const cursor = target.selectionStart ?? target.value.length;
    setMentionState(getActiveMention(target.value, cursor));
  };

  const hasContent = Boolean(value || selectedNotes.length > 0);

  return (
    <div ref={containerRef} className="relative w-full min-w-0">
      <div
        className={cn(
          "flex min-h-11 w-full cursor-text items-center gap-1.5 rounded-xl border border-line bg-surface-2/70 py-1.5 pr-1.5 pl-3 transition-all duration-150 hover:border-indigo-300 focus-within:border-accent focus-within:bg-surface focus-within:ring-4 focus-within:ring-indigo-500/15 dark:hover:border-indigo-400/50",
          disabled && "pointer-events-none opacity-60",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        <Search className="size-4 shrink-0 text-fg-subtle" />

        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {selectedNotes.map((note) => (
            <NoteChip key={note.noteId} note={note} onRemove={() => removeNote(note.noteId)} />
          ))}

          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onSelect={handleSelect}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            placeholder={selectedNotes.length === 0 ? (placeholder ?? t("shell.searchPlaceholder")) : t("mention.askThese")}
            className="h-7 min-w-32 flex-1 border-none bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-none"
            aria-label={t("mention.inputLabel")}
            role="combobox"
            aria-controls="mention-listbox"
            aria-autocomplete="list"
            aria-expanded={dropdownOpen}
          />
        </div>

        {hasContent ? (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onChange("");
              onSelectedNotesChange([]);
              setMentionState(null);
              inputRef.current?.focus();
            }}
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
            aria-label={t("notes.clearSearch")}
          >
            <X className="size-4" />
          </button>
        ) : (
          <span className="hidden shrink-0 items-center gap-1 pr-1.5 text-[0.7rem] text-fg-subtle sm:flex">
            <kbd className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono">@</kbd> {t("mention.mention")}
            <kbd className="ml-1 rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono" title={t("mention.slashHint")}>/</kbd>
          </span>
        )}
      </div>

      {dropdownOpen && (
        <MentionDropdown
          notes={filteredNotes}
          query={mentionState!.query}
          activeIndex={dropdownActiveIndex}
          onSelect={selectNote}
          onHover={setDropdownActiveIndex}
        />
      )}
    </div>
  );
}
