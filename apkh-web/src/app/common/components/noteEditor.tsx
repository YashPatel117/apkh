"use client";

import Button from "@mui/material/Button";
import { useState, useRef, useEffect } from "react";
import ReactQuill from "react-quill-new";
import "react-quill-new/dist/quill.snow.css";
import "../service/fileTokenBlot";
import { INote, INoteDto } from "../models/note";
import TextField from "@mui/material/TextField";
import Autocomplete, { createFilterOptions } from "@mui/material/Autocomplete";
import { Box, Modal } from "@mui/material";
import { modalStyle } from "../style/modal";
import FileDisplay from "./fileDisplay";

const filter = createFilterOptions<string>();

export type FileItem = {
  id: string;
  name: string;
  file?: File;
  url?: string;
};

type NoteEditorProps = {
  initialNote?: INote | null;
  categoryOptions?: string[];
  onSave?: (data: INoteDto, id?: string) => void;
};

export default function NoteEditor({
  initialNote = null,
  categoryOptions = [],
  onSave,
}: NoteEditorProps) {
  const [note, setNote] = useState<INoteDto>({
    title: initialNote?.title || "",
    category: initialNote?.category || "",
    content: initialNote?.content || "",
  });
  const [files, setFiles] = useState<FileItem[]>([]);
  const [openFile, setOpenFile] = useState(false);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [fileName, setFileName] = useState("");
  const filesRef = useRef<FileItem[]>(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const quillRef = useRef<ReactQuill | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAttachFile = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const id =
      Date.now() + "-" + Math.round(Math.random() * 1e9) + "-" + file.name;
    const newFile: FileItem = { id, name: file.name, file };
    setFiles((prev) => [...prev, newFile]);

    const quill = quillRef.current?.getEditor();
    if (quill) {
      const range = quill.getSelection(true);
      if (range) {
        quill.insertEmbed(range.index, "fileToken", { id, name: file.name }, "user");
        quill.insertText(range.index + 1, " ");
        quill.setSelection(range.index + 2, 0);
      }
    }

    e.target.value = "";
  };

  const saveClicked = () => {
    const quill = quillRef.current?.getEditor();
    if (!quill) return;

    const fileTokens = Array.from(
      quill.root.querySelectorAll<HTMLElement>(".file-token")
    )
      .map((token) => ({
        id: token.dataset.id ?? "",
        name: token.dataset.name ?? "",
      }))
      .filter((token) => token.id);

    if (onSave) {
      onSave(
        {
          title: note.title,
          category: note.category,
          content: note.content,
          files: files
            .filter((f) => fileTokens.some((ft) => ft.id === f.id))
            .filter((file) => file.file !== null)
            .map(
              (fileitem) =>
                new File([fileitem.file!], fileitem.id, {
                  type: fileitem.file?.type,
                })
            ),
          removedFiles: initialNote?.files
            .filter((f) => !fileTokens.some((ft) => ft.id === f))
            .map((fileitem) => fileitem),
        },
        initialNote?.id
      );
    }
  };

  useEffect(() => {
    const quill = quillRef.current?.getEditor();
    if (!quill) return;

    const button = document.querySelector(".ql-customButton");
    const handleToolbarAttach = () => handleAttachFile();

    if (button instanceof HTMLButtonElement) {
      button.textContent = "Attach";
      button.setAttribute("aria-label", "Attach file");
      button.addEventListener("click", handleToolbarAttach);
    }

    const editorEl = quill.root;
    const handleFileTokenClick = (e: Event) => {
      const custom = e as CustomEvent<{ id: string; name: string }>;
      const file = filesRef.current.find((f) => f.id === custom.detail.id);
      const fileUrl = initialNote?.files.find((f) => f === custom.detail.id);

      if (file?.file) {
        setOpenFile(true);
        setFile(file.file);
      } else if (fileUrl) {
        setOpenFile(true);
        setFileName(fileUrl);
      }
    };

    editorEl.addEventListener("file-token-click", handleFileTokenClick);

    return () => {
      if (button instanceof HTMLButtonElement) {
        button.removeEventListener("click", handleToolbarAttach);
      }
      editorEl.removeEventListener("file-token-click", handleFileTokenClick);
    };
  }, [initialNote?.files]);

  return (
    <div className="note-editor-shell">
      <div className="mb-5 rounded-[28px] border border-sky-100/80 bg-[linear-gradient(145deg,_rgba(240,249,255,0.96),_rgba(255,255,255,0.98)_55%,_rgba(239,246,255,0.94)_100%)] p-4 shadow-[0_20px_55px_-44px_rgba(2,132,199,0.55)] sm:p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
              Rich Note Composer
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
              {initialNote ? "Update note" : "Create a new note"}
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-slate-600">
            Lists, links, formatting, and attached file tokens stay part of the note
            content while you edit.
          </p>
        </div>

        <div className="flex flex-col gap-3 md:flex-row">
          <TextField
            id="title"
            label="Title"
            variant="outlined"
            value={note.title}
            onChange={(e) =>
              setNote((prev) => ({ ...prev, title: e.target.value }))
            }
            className="w-full"
            sx={{
              "& .MuiOutlinedInput-root": {
                borderRadius: "18px",
                backgroundColor: "rgba(255,255,255,0.95)",
              },
            }}
          />
          <Autocomplete
            id="category"
            options={categoryOptions}
            filterOptions={(options, params) => {
              const filtered = filter(options, params);
              const { inputValue } = params;
              const isExisting = options.some((option) => inputValue === option);
              if (inputValue !== "" && !isExisting) filtered.push(inputValue);
              return filtered;
            }}
            getOptionLabel={(option) => option}
            renderOption={(props, option) => {
              const { key, ...optionProps } = props;
              return (
                <li key={key} {...optionProps}>
                  {option}
                </li>
              );
            }}
            value={note.category}
            onChange={(event, newValue) =>
              newValue && setNote((prev) => ({ ...prev, category: newValue }))
            }
            className="w-full"
            renderInput={(params) => (
              <TextField
                {...params}
                label="Category"
                sx={{
                  "& .MuiOutlinedInput-root": {
                    borderRadius: "18px",
                    backgroundColor: "rgba(255,255,255,0.95)",
                  },
                }}
              />
            )}
          />
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </div>
      </div>

      <ReactQuill
        ref={quillRef}
        className="note-editor"
        theme="snow"
        value={note.content}
        onChange={(content) => {
          setNote((prev) => ({ ...prev, content }));
        }}
        placeholder="Write your note here..."
        style={{ marginBottom: "0", width: "100%" }}
        modules={{
          toolbar: [
            ["bold", "italic", "underline", "strike"],
            [{ list: "ordered" }, { list: "bullet" }],
            ["link"],
            ["clean"],
            ["customButton"],
          ],
        }}
      />

      <div className="mt-5 flex justify-end">
        <Button
          onClick={saveClicked}
          variant="contained"
          color="primary"
          sx={{
            minHeight: 48,
            borderRadius: "16px",
            px: 2.5,
            textTransform: "none",
            fontWeight: 700,
            boxShadow: "0 18px 35px -24px rgba(29, 78, 216, 0.85)",
            background: "linear-gradient(135deg, #0284c7 0%, #1d4ed8 100%)",
          }}
        >
          Save Note
        </Button>
      </div>

      <Modal
        open={openFile}
        onClose={() => {
          setOpenFile(false);
          setFile(undefined);
          setFileName("");
        }}
      >
        <Box sx={modalStyle()}>
          <FileDisplay fileName={fileName} noteId={initialNote?.id} file={file} />
        </Box>
      </Modal>
    </div>
  );
}
