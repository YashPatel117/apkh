"use client";

import { useId, useMemo, useState } from "react";
import { Hash, Plus, Sparkles, X } from "lucide-react";
import { suggestTags } from "@/services/noteService";
import { getErrorMessage } from "@/services/axios";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";

const MAX_TAGS = 12;
const MAX_OPTIONS = 6;

/** Tags as the API stores them: lowercase, hyphenated, no "#". */
export function normalizeTag(value: string) {
  return value
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Tags already in use, offered as you type */
  options: string[];
  /** What the AI reads to suggest tags; null hides the Suggest button */
  suggestFrom: { title: string; category: string; content: string } | null;
}

/** Tags of a note: type and press Enter or comma, pick one in use, or ask the AI. */
export function TagInput({ value, onChange, options, suggestFrom }: TagInputProps) {
  const t = useT();
  const inputId = useId();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const add = (raw: string) => {
    const tag = normalizeTag(raw);
    if (tag && !value.includes(tag) && value.length < MAX_TAGS) onChange([...value, tag]);
    setText("");
  };
  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  const matches = useMemo(() => {
    const typed = normalizeTag(text);
    return options.filter((o) => !value.includes(o) && (!typed || o.includes(typed))).slice(0, MAX_OPTIONS);
  }, [options, value, text]);

  const suggest = async () => {
    if (!suggestFrom) return;
    setSuggesting(true);
    setSuggestError(null);
    try {
      const result = await suggestTags({ ...suggestFrom, tags: value });
      setSuggested(result.tags.filter((tag) => !value.includes(tag)));
      if (result.error) setSuggestError(result.error);
      else if (!result.tags.length) setSuggestError(t("tags.noSuggestions"));
    } catch (error) {
      setSuggestError(getErrorMessage(error, t("tags.suggestFailed")));
    } finally {
      setSuggesting(false);
    }
  };

  const pending = suggested.filter((tag) => !value.includes(tag));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-sm font-medium text-fg">
          {t("tags.label")}
        </label>
        {suggestFrom && (
          <Button size="sm" variant="ghost" onClick={() => void suggest()} loading={suggesting} icon={<Sparkles className="size-3.5" />}>
            {t("tags.suggest")}
          </Button>
        )}
      </div>
      <div className="relative">
        <div
          className={cn(
            "flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border bg-surface px-2.5 py-1.5 transition-colors",
            focused ? "border-accent ring-4 ring-indigo-500/10" : "border-line",
          )}
        >
          <Hash className="size-4 shrink-0 text-fg-subtle" />
          {value.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 rounded-lg bg-accent-soft py-0.5 pr-1 pl-2 text-xs font-medium text-accent-fg">
              {tag}
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={t("tags.remove", { tag })}
                className="cursor-pointer rounded p-0.5 hover:bg-indigo-500/15"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <input
            id={inputId}
            value={text}
            disabled={value.length >= MAX_TAGS}
            placeholder={value.length ? "" : t("tags.placeholder")}
            onChange={(e) => {
              const next = e.target.value;
              // A comma ends a tag, as when typing a list.
              if (next.includes(",")) next.split(",").slice(0, -1).forEach(add);
              setText(next.includes(",") ? (next.split(",").pop() ?? "") : next);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) {
                e.preventDefault();
                add(text);
              } else if (e.key === "Backspace" && !text && value.length) {
                remove(value[value.length - 1]);
              }
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              if (text.trim()) add(text);
            }}
            className="min-w-24 flex-1 bg-transparent py-1 text-sm text-fg outline-none placeholder:text-fg-subtle"
          />
        </div>
        {focused && matches.length > 0 && (
          <div
            className="absolute top-full right-0 left-0 z-20 mt-1 flex flex-wrap gap-1.5 rounded-xl border border-line bg-surface p-2 shadow-lg"
            onMouseDown={(e) => e.preventDefault()}
          >
            {matches.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => add(tag)}
                className="cursor-pointer rounded-lg border border-line px-2 py-0.5 text-xs text-fg-muted transition-colors hover:border-indigo-200 hover:text-fg"
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>
      {pending.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-fg-subtle">{t("tags.suggested")}</span>
          {pending.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => add(tag)}
              className="inline-flex cursor-pointer items-center gap-0.5 rounded-lg border border-dashed border-indigo-300 px-2 py-0.5 text-xs text-accent-fg transition-colors hover:bg-accent-soft dark:border-indigo-400/40"
            >
              <Plus className="size-3" />
              {tag}
            </button>
          ))}
        </div>
      )}
      {suggestError && <p className="text-xs text-fg-subtle">{suggestError}</p>}
    </div>
  );
}

/** A note's tags as small chips; clicking one filters the notes by it. */
export function TagChips({ tags, onPick, className }: { tags?: string[]; onPick?: (tag: string) => void; className?: string }) {
  if (!tags?.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {tags.map((tag) =>
        onPick ? (
          <button
            key={tag}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPick(tag);
            }}
            className="cursor-pointer rounded-md px-1.5 py-0.5 text-xs font-medium text-fg-subtle transition-colors hover:bg-accent-soft hover:text-accent-fg"
          >
            #{tag}
          </button>
        ) : (
          <span key={tag} className="px-1.5 py-0.5 text-xs font-medium text-fg-subtle">
            #{tag}
          </span>
        ),
      )}
    </div>
  );
}
