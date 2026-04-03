import { useState, useRef, useEffect, useCallback, KeyboardEvent } from "react";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import NotesRoundedIcon from "@mui/icons-material/NotesRounded";
import { INote } from "@/app/common/models/note";
import { useAppSelector } from "@/store/hook";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SelectedNote {
    noteId: string;
    title: string;
}

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
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Finds an active @mention at the cursor position.
 *  Returns { query, atIndex } or null if cursor is not inside a mention. */
function getActiveMention(
    text: string,
    cursorPos: number
): { query: string; atIndex: number } | null {
    const slice = text.slice(0, cursorPos);
    const lastAt = slice.lastIndexOf("@");
    if (lastAt === -1) return null;

    const afterAt = slice.slice(lastAt + 1);
    // Mention is active as long as there's no space after @
    if (afterAt.includes(" ")) return null;

    return { query: afterAt, atIndex: lastAt };
}

// ─── NoteChip ────────────────────────────────────────────────────────────────

function NoteChip({
    note,
    onRemove,
}: {
    note: SelectedNote;
    onRemove: () => void;
}) {
    return (
        <span
            className="
        inline-flex items-center gap-1
        pl-1.5 pr-1 py-0.5
        rounded-lg
        bg-sky-100 text-sky-800
        text-[0.82rem] font-medium
        border border-sky-200
        leading-none
        select-none
        group
        transition-all
      "
        >
            <NotesRoundedIcon
                sx={{ fontSize: 12, color: "rgb(14 116 144)" }}
                className="flex-shrink-0"
            />
            <span className="max-w-[140px] truncate">{note.title}</span>
            <button
                type="button"
                onMouseDown={(e) => {
                    e.preventDefault(); // keep focus on text input
                    onRemove();
                }}
                className="
          flex items-center justify-center
          w-4 h-4 rounded-md
          text-sky-400
          hover:bg-sky-200 hover:text-sky-700
          transition-colors
          flex-shrink-0
        "
                aria-label={`Remove ${note.title}`}
            >
                <CloseRoundedIcon sx={{ fontSize: 11 }} />
            </button>
        </span>
    );
}

// ─── Dropdown ────────────────────────────────────────────────────────────────

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
    if (notes.length === 0) return null;

    return (
        <div
            className="
        absolute z-50 left-0 right-0 top-[calc(100%+6px)]
        bg-white
        rounded-2xl
        border border-sky-100
        shadow-[0_16px_48px_-12px_rgba(14,116,144,0.22),0_4px_16px_-4px_rgba(0,0,0,0.06)]
        overflow-hidden
        py-1.5
      "
            role="listbox"
            aria-label="Notes"
        >
            {/* header */}
            <div className="px-3 pt-1 pb-2">
                <p className="text-[0.7rem] font-semibold uppercase tracking-widest text-slate-400">
                    Notes
                    {query && (
                        <span className="ml-1 normal-case tracking-normal font-normal text-sky-400">
                            matching "{query}"
                        </span>
                    )}
                </p>
            </div>

            <div className="max-h-52 overflow-y-auto">
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
                        className={`
              w-full text-left px-3 py-2.5
              flex items-start gap-2.5
              transition-colors
              ${i === activeIndex
                                ? "bg-sky-50 text-sky-900"
                                : "text-slate-700 hover:bg-slate-50"
                            }
            `}
                    >
                        <span
                            className={`
                mt-0.5 flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-lg
                ${i === activeIndex ? "bg-sky-100 text-sky-600" : "bg-slate-100 text-slate-400"}
              `}
                        >
                            <NotesRoundedIcon sx={{ fontSize: 13 }} />
                        </span>
                        <span className="flex flex-col min-w-0">
                            <span className="text-[0.875rem] font-medium leading-snug truncate">
                                {note.title}
                            </span>
                            <span className="text-[0.72rem] text-slate-400 truncate">
                                {note.category}
                            </span>
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MentionTextField({
    value,
    onChange,
    selectedNotes,
    onSelectedNotesChange,
    onSubmit,
    placeholder = "Ask about a project, meeting, file, or concept...",
    disabled = false,
}: MentionTextFieldProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { notes } = useAppSelector((state) => state.note);
    const [isFocused, setIsFocused] = useState(false);
    const [mentionState, setMentionState] = useState<{
        query: string;
        atIndex: number;
    } | null>(null);
    const [dropdownActiveIndex, setDropdownActiveIndex] = useState(0);

    // ── Filtered notes for dropdown ──────────────────────────────────────────

    const filteredNotes = mentionState
        ? notes.filter(
            (n) =>
                n.title.toLowerCase().includes(mentionState.query.toLowerCase()) &&
                !selectedNotes.some((s) => s.noteId === n.id)
        )
        : [];

    const dropdownOpen = mentionState !== null;

    // Reset active index when dropdown list changes
    useEffect(() => {
        setDropdownActiveIndex(0);
    }, [filteredNotes.length, mentionState?.query]);

    // ── Close dropdown on outside click ──────────────────────────────────────

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (
                containerRef.current &&
                !containerRef.current.contains(e.target as Node)
            ) {
                setMentionState(null);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    // ── Input change handler ──────────────────────────────────────────────────

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const newVal = e.target.value;
            onChange(newVal);

            const cursor = e.target.selectionStart ?? newVal.length;
            const mention = getActiveMention(newVal, cursor);
            setMentionState(mention);
        },
        [onChange]
    );

    // ── Note selection ────────────────────────────────────────────────────────

    const selectNote = useCallback(
        (note: INote) => {
            if (!mentionState) return;

            // Splice out the "@query" from the text
            const before = value.slice(0, mentionState.atIndex);
            const after = value.slice(mentionState.atIndex + 1 + mentionState.query.length);
            onChange(before + after);

            // Add token if not already present
            if (!selectedNotes.some((n) => n.noteId === note.id)) {
                onSelectedNotesChange([
                    ...selectedNotes,
                    { noteId: note.id, title: note.title },
                ]);
            }

            setMentionState(null);

            // Restore focus + place cursor
            requestAnimationFrame(() => {
                inputRef.current?.focus();
                const pos = before.length + after.length;
                inputRef.current?.setSelectionRange(pos, pos);
            });
        },
        [mentionState, value, onChange, selectedNotes, onSelectedNotesChange]
    );

    // ── Remove token ──────────────────────────────────────────────────────────

    const removeNote = useCallback(
        (noteId: string) => {
            onSelectedNotesChange(selectedNotes.filter((n) => n.noteId !== noteId));
            inputRef.current?.focus();
        },
        [selectedNotes, onSelectedNotesChange]
    );

    // ── Keyboard navigation ───────────────────────────────────────────────────

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (dropdownOpen) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setDropdownActiveIndex((i) => (i + 1) % filteredNotes.length);
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                setDropdownActiveIndex((i) =>
                    i === 0 ? filteredNotes.length - 1 : i - 1
                );
                return;
            }
            if (e.key === "Enter") {
                e.preventDefault();
                selectNote(filteredNotes[dropdownActiveIndex]);
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                setMentionState(null);
                return;
            }
        }

        // Backspace on empty input → remove last chip
        if (
            e.key === "Backspace" &&
            value === "" &&
            selectedNotes.length > 0 &&
            !dropdownOpen
        ) {
            removeNote(selectedNotes[selectedNotes.length - 1].noteId);
            return;
        }

        if (e.key === "Enter" && !dropdownOpen) {
            e.preventDefault();
            onSubmit?.();
        }
    };

    // ── Cursor position tracking (handles selection changes without value change) ──

    const handleSelect = (e: React.SyntheticEvent<HTMLInputElement>) => {
        const target = e.currentTarget;
        const cursor = target.selectionStart ?? target.value.length;
        const mention = getActiveMention(target.value, cursor);
        setMentionState(mention);
    };

    return (
        <div ref={containerRef} className="relative w-full">
            {/* ── Input wrapper ── */}
            <div
                className={`
                    flex flex-wrap items-center gap-1.5
                    min-h-[54px]
                    rounded-[18px]
                    bg-white/[.96]
                    px-2 py-2
                    shadow-[0_10px_40px_-26px_rgba(14,116,144,0.55)]
                    transition-all duration-150 ease-out
                    cursor-text
                    border border-[rgba(186,230,253,0.95)] hover:border-sky-300
                    ${disabled ? "opacity-60 pointer-events-none" : ""}
                `}
                onClick={() => inputRef.current?.focus()}
            >
                {/* Search icon */}
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                    <SearchRoundedIcon fontSize="small" />
                </div>

                {/* Mention tokens */}
                {selectedNotes.map((note) => (
                    <NoteChip
                        key={note.noteId}
                        note={note}
                        onRemove={() => removeNote(note.noteId)}
                    />
                ))}

                {/* Text input */}
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    onSelect={handleSelect}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={disabled}
                    placeholder={selectedNotes.length === 0 ? placeholder : ""}
                    className="
                        flex-1 min-w-[140px]
                        bg-transparent outline-none border-none
                        text-[0.95rem] text-slate-900
                        placeholder:text-slate-400
                        py-1
                    "
                    aria-label="Search or mention notes with @"
                    aria-autocomplete="list"
                    aria-expanded={dropdownOpen}
                />

                {/* Clear button — appears when there's content */}
                {(value || selectedNotes.length > 0) && (
                    <button
                        type="button"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            onChange("");
                            onSelectedNotesChange([]);
                            setMentionState(null);
                            inputRef.current?.focus();
                        }}
                        className="
                            flex-shrink-0 mr-1
                            flex h-6 w-6 items-center justify-center rounded-full
                            text-slate-300 hover:text-slate-500 hover:bg-slate-100
                            transition-colors
                        "
                        aria-label="Clear"
                    >
                        <CloseRoundedIcon sx={{ fontSize: 14 }} />
                    </button>
                )}
            </div>

            {/* ── Dropdown ── */}
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
