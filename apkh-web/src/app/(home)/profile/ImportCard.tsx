"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FolderOpen, Upload } from "lucide-react";
import { importNotes, ImportResult, ImportSource } from "@/services/noteService";
import { getErrorMessage } from "@/services/axios";
import { useNotes } from "@/context/notesContext";
import { useAppDispatch } from "@/store/hook";
import { refreshLibraryMeta } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/authShell";
import { cn } from "@/lib/cn";
import { MessageKey, useT } from "@/i18n";

const SOURCES: { id: ImportSource; label: string; hint: MessageKey }[] = [
  { id: "obsidian", label: "Obsidian", hint: "import.hint.obsidian" },
  { id: "notion", label: "Notion", hint: "import.hint.notion" },
  { id: "evernote", label: "Evernote", hint: "import.hint.evernote" },
  { id: "notebooklm", label: "NotebookLM", hint: "import.hint.notebooklm" },
  { id: "markdown", label: "Markdown", hint: "import.hint.markdown" },
];

const ACCEPT = ".zip,.enex,.md,.markdown,.txt,.html,.htm";

/** Bring notes in from other apps' exports, keeping folders, tags, links and attachments. */
export default function ImportCard() {
  const t = useT();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { setActiveFolder } = useNotes();
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<ImportSource>("obsidian");
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null;

  const run = async (file: File) => {
    setError(null);
    setResult(null);
    setProgress(0);
    try {
      const imported = await importNotes(file, setProgress);
      setResult(imported);
      refreshLibraryMeta(dispatch).catch(() => {});
    } catch (err) {
      setError(getErrorMessage(err, t("import.failed")));
    } finally {
      setProgress(null);
    }
  };

  const openFolder = () => {
    if (!result?.folderId) return;
    setActiveFolder(result.folderId);
    router.push("/notes");
  };

  const hint = SOURCES.find((s) => s.id === source)!.hint;

  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Upload className="size-[1.1rem]" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-fg">{t("import.title")}</h2>
          <p className="mt-0.5 text-sm text-fg-muted">{t("import.text")}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5" role="tablist" aria-label={t("import.from")}>
        {SOURCES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={source === s.id}
            onClick={() => setSource(s.id)}
            className={cn(
              "cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
              source === s.id ? "bg-accent-soft text-accent-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="mt-2 rounded-xl bg-surface-2 p-3 text-xs leading-relaxed text-fg-muted">{t(hint)}</p>

      {error && (
        <div className="mt-3">
          <FormAlert>{error}</FormAlert>
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-100">
          <p className="flex items-start gap-2 font-medium">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            {result.folderName
              ? t("import.doneInFolder", { count: result.notes, folder: result.folderName })
              : t("import.done", { count: result.notes })}
          </p>
          <p className="mt-1 pl-6 text-xs opacity-80">
            {t("import.details", { folders: result.folders, attachments: result.attachments })}
            {" "}
            {t("import.indexing")}
          </p>
          {result.skippedCount > 0 && (
            <details className="mt-2 pl-6 text-xs">
              <summary className="cursor-pointer font-medium">{t("import.skipped", { count: result.skippedCount })}</summary>
              <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
                {result.skipped.map((item, i) => (
                  <li key={i} className="break-words">
                    <span className="font-medium">{item.name}</span>: {item.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {result.folderId && (
            <Button variant="secondary" size="sm" className="mt-3 ml-6" onClick={openFolder} icon={<FolderOpen className="size-3.5" />}>
              {t("import.openFolder")}
            </Button>
          )}
        </div>
      )}

      {busy && (
        <div className="mt-4" aria-live="polite">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-fg-muted">{progress !== null && progress < 1 ? t("import.uploading", { percent: Math.round(progress * 100) }) : t("import.processing")}</p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void run(file);
        }}
      />
      <Button variant="secondary" className="mt-4 w-full" onClick={() => inputRef.current?.click()} loading={busy} icon={<Upload className="size-4" />}>
        {busy ? t("import.working") : t("import.choose")}
      </Button>
    </section>
  );
}
