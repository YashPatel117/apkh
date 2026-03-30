"use client";
import Button from "@mui/material/Button";
import { useState, useRef, useEffect } from "react";
import ReactQuill, { Quill } from "react-quill-new";
import "react-quill-new/dist/quill.snow.css";
import "../service/fileTokenBlot";
import { INote, INoteDto } from "../models/note";
import TextField from "@mui/material/TextField";
import Autocomplete, { createFilterOptions } from "@mui/material/Autocomplete";
const Embed = Quill.import("blots/embed") as any;
import { Box, Modal, useMediaQuery } from "@mui/material";
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
        quill.insertEmbed(
          range.index,
          "fileToken",
          { id, name: file.name },
          "user"
        );
        quill.insertText(range.index + 1, " ");
        quill.setSelection(range.index + 2, 0);
      }
    }
  };

  const saveClicked = () => {
    const quill = quillRef.current?.getEditor();
    if (!quill) return;

    const fileTokens = quill.scroll
      .descendants(Embed)
      .filter((b) => (b.constructor as any).blotName === "fileToken")
      .map((b) => (b.constructor as any).value(b.domNode));

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
    if (button) {
      button.innerHTML = "📎";
      button.addEventListener("click", () => {
        handleAttachFile();
      });
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
    return () =>
      editorEl.removeEventListener("file-token-click", handleFileTokenClick);
  }, []);

  const isSmall = useMediaQuery("(max-width:768px)");
  const isMedium = useMediaQuery("(max-width:1200px)");
  const width = isSmall ? "90vw" : isMedium ? "70vw" : "60vw";

  return (
    <div>
      <div
        style={{ marginBottom: "10px" }}
        className="flex justify-between gap-1"
      >
        <TextField
          id="title"
          label="Title"
          variant="outlined"
          value={note.title}
          onChange={(e) =>
            setNote((prev) => ({ ...prev, title: e.target.value }))
          }
          className="w-[60%]"
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
          className="w-[40%]"
          renderInput={(params) => <TextField {...params} label="Category" />}
        />
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
      </div>

      <ReactQuill
        ref={quillRef}
        theme="snow"
        value={note.content}
        onChange={(content) => {
          setNote((prev) => ({ ...prev, content }));
        }}
        placeholder="Write your note here..."
        style={{ height: "40vh", marginBottom: "50px", width }}
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

      <div style={{ marginTop: "20px" }} className="flex justify-end">
        <Button
          onClick={saveClicked}
          style={{ padding: "5px 10px" }}
          variant="contained"
          color="primary"
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
          <FileDisplay
            fileName={fileName}
            noteId={initialNote?.id}
            file={file}
          />
        </Box>
      </Modal>
    </div>
  );
}
