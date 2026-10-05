"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import ReactQuill from "react-quill-new";
import "react-quill-new/dist/quill.snow.css";
import "@/lib/fileTokenBlot";
import { Paperclip, Type } from "lucide-react";
import { INote, INoteDto } from "@/models/note";
import FileDisplay from "@/components/fileDisplay";
import { CategoryInput } from "@/components/categoryInput";
import { normalizeNoteLinksInHtml, stripLegacyFileTokenStyles } from "@/lib/noteLinkUtils";
import { displayFileName } from "@/lib/fileName";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { FormAlert } from "@/components/authShell";
import { useSlashCommands } from "@/components/slashCommands";
import { useT } from "@/i18n";
import { errorText } from "@/lib/localizedError";

export type FileItem = {
  id: string;
  name: string;
  file?: File;
  url?: string;
};

type NoteEditorProps = {
  initialNote?: INote | null;
  categoryOptions?: string[];
  saving?: boolean;
  onSave: (data: INoteDto, id?: string) => Promise<void>;
  onCancel: () => void;
};

const TOOLBAR = [
  [{ header: [1, 2, 3, false] }],
  ["bold", "italic", "underline", "strike"],
  [{ list: "ordered" }, { list: "bullet" }],
  ["blockquote", "link"],
  ["clean"],
];

export default function NoteEditor({ initialNote = null, categoryOptions = [], saving = false, onSave, onCancel }: NoteEditorProps) {
  const [note, setNote] = useState<INoteDto>({
    title: initialNote?.title || "",
    category: initialNote?.category || "",
    // Cleaned on load, so the next save persists chip HTML without the legacy styles.
    content: stripLegacyFileTokenStyles(initialNote?.content || ""),
  });
  const [files, setFiles] = useState<FileItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ file?: File; fileName: string } | null>(null);
  const t = useT();
  const filesRef = useRef<FileItem[]>(files);
  const quillRef = useRef<ReactQuill | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Stable reference — a new object each render makes Quill re-initialise.
  const modules = useMemo(() => ({ toolbar: TOOLBAR }), []);

  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);
  const slash = useSlashCommands(quillRef, openFilePicker);

  const plainText = note.content.replace(/<[^>]+>/g, "").trim();
  const hasTokens = note.content.includes("file-token");
  const isEmpty = !note.title.trim() && !plainText && !hasTokens;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!picked.length) return;

    const quill = quillRef.current?.getEditor();
    if (!quill) return;
    const range = quill.getSelection(true) ?? { index: quill.getLength(), length: 0 };
    let index = range.index;

    const added: FileItem[] = picked.map((file) => {
      const id = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.name}`;
      quill.insertEmbed(index, "fileToken", { id, name: file.name }, "user");
      quill.insertText(index + 1, " ", "user");
      index += 2;
      return { id, name: file.name, file };
    });
    quill.setSelection(index, 0);
    setFiles((prev) => [...prev, ...added]);
  };

  const save = async () => {
    const quill = quillRef.current?.getEditor();
    if (!quill || saving || isEmpty) return;
    setError(null);

    const fileTokens = Array.from(quill.root.querySelectorAll<HTMLElement>(".file-token"))
      .map((token) => token.dataset.id ?? "")
      .filter(Boolean);

    try {
      await onSave(
        {
          title: note.title.trim(),
          category: note.category.trim(),
          content: normalizeNoteLinksInHtml(note.content),
          files: files
            .filter((f) => f.file && fileTokens.includes(f.id))
            .map((item) => new File([item.file!], item.id, { type: item.file!.type })),
          removedFiles: initialNote?.files.filter((f) => !fileTokens.includes(f)),
        },
        initialNote?.id,
      );
    } catch (err) {
      setError(errorText(t, err, "editor.saveFailed"));
    }
  };

  // File-chip clicks inside the editor open a preview.
  useEffect(() => {
    const quill = quillRef.current?.getEditor();
    if (!quill) return;
    const editorEl = quill.root;
    const onTokenClick = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string; name: string }>).detail;
      const local = filesRef.current.find((f) => f.id === id);
      if (local?.file) setPreview({ file: local.file, fileName: local.name });
      else if (initialNote?.files.includes(id)) setPreview({ fileName: id });
    };
    editorEl.addEventListener("file-token-click", onTokenClick);
    return () => editorEl.removeEventListener("file-token-click", onTokenClick);
  }, [initialNote?.files]);

  return (
    <>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-5 pb-2 sm:px-6"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && (e.key === "Enter" || e.key.toLowerCase() === "s")) {
            e.preventDefault();
            void save();
          }
        }}
      >
        {error && (
          <div className="mb-4">
            <FormAlert>{error}</FormAlert>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr]">
          <Input
            label={t("editor.title")}
            icon={<Type />}
            value={note.title}
            placeholder={t("editor.titlePlaceholder")}
            onChange={(e) => setNote((prev) => ({ ...prev, title: e.target.value }))}
            data-autofocus
          />
          <CategoryInput
            value={note.category}
            onChange={(category) => setNote((prev) => ({ ...prev, category }))}
            options={categoryOptions}
            placeholder={t("editor.categoryPlaceholder")}
          />
        </div>

        <div className="mt-4" onKeyDownCapture={slash.onKeyDownCapture}>
          <ReactQuill
            ref={quillRef}
            className="note-editor"
            theme="snow"
            value={note.content}
            onChange={(content) => setNote((prev) => ({ ...prev, content }))}
            placeholder={t("editor.placeholder")}
            modules={modules}
          />
          {slash.menu}
        </div>
        <input type="file" multiple ref={fileInputRef} className="hidden" onChange={handleFileChange} />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-5 py-4 sm:px-6">
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()} icon={<Paperclip className="size-4" />} disabled={saving}>
          {t("editor.attach")}
        </Button>
        <span className="hidden text-xs text-fg-subtle md:inline">
          <kbd className="rounded border border-line px-1 font-mono">Ctrl</kbd> + <kbd className="rounded border border-line px-1 font-mono">Enter</kbd> {t("editor.toSave")}
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={isEmpty}>
            {saving ? t("editor.saving") : initialNote ? t("editor.saveChanges") : t("editor.create")}
          </Button>
        </div>
      </div>

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.file?.name ?? (preview ? displayFileName(preview.fileName) : "")} size="xl">
        {preview && <FileDisplay fileName={preview.fileName} noteId={preview.file ? undefined : initialNote?.id} file={preview.file} />}
      </Modal>
    </>
  );
}
