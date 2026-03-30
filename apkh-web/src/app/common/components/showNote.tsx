import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import React, { useEffect, useRef, useState } from "react";
import { INote } from "../models/note";
import CardActions from "@mui/material/CardActions";
import Button from "@mui/material/Button";
import Modal from "@mui/material/Modal";
import FileDisplay from "./fileDisplay";
import Box from "@mui/material/Box";
import { modalStyle } from "../style/modal";
import { IconButton } from "@mui/material";
import EditNoteRoundedIcon from "@mui/icons-material/EditNoteRounded";
import DeleteForeverRoundedIcon from "@mui/icons-material/DeleteForeverRounded";

interface NoteProps {
  note: INote;
  lineLength?: number;
  onEdit?: () => void;
  onDelete?: () => void;
}

export const ShowNote: React.FC<NoteProps> = ({
  note,
  lineLength = 3,
  onEdit,
  onDelete,
}) => {
  const [showLinesNumber, setShowLinesNumber] = useState<number | null>(
    lineLength
  );
  const [isTruncated, setIsTruncated] = useState(false);
  const [openFile, setOpenFile] = useState(false);
  const [fileName, setFileName] = useState("");

  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      requestAnimationFrame(() => {
        const el = contentRef.current!;
        setIsTruncated(el.scrollHeight > el.clientHeight);
      });
    }
  }, [note.content, lineLength]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const token = target.closest(".file-token") as HTMLElement | null;
      if (token && token.dataset.id) {
        setOpenFile(true);
        setFileName(token.dataset.id);
      }
    };

    const current = contentRef.current;
    current?.addEventListener("click", handleClick);

    return () => {
      current?.removeEventListener("click", handleClick);
    };
  }, []);

  return (
    <>
      <style>{`
        .truncated-multi {
          display: -webkit-box;
          ${showLinesNumber ? `-webkit-line-clamp: ${showLinesNumber};` : ""}
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>

      <Card className="border ps-3 py-2 rounded-md mb-4 break-inside-avoid">
        <CardContent className="p-0!">
          <h2 className="font-semibold mb-2 flex items-center justify-between gap-1.5">
            <span>{note.title}</span>
            <div className=" flex gap-1 items-center">
              <IconButton onClick={onEdit} className="p-1!">
                <EditNoteRoundedIcon />
              </IconButton>
              <IconButton onClick={onDelete} className="p-1!">
                <DeleteForeverRoundedIcon />
              </IconButton>
            </div>
          </h2>
          <div
            ref={contentRef}
            className={`text-gray-600 ${
              showLinesNumber ? "truncated-multi" : ""
            }`}
            dangerouslySetInnerHTML={{ __html: note.content }}
          />
        </CardContent>

        {lineLength && isTruncated && (
          <CardActions>
            <Button
              onClick={() =>
                setShowLinesNumber(
                  showLinesNumber === lineLength ? null : lineLength
                )
              }
            >
              {showLinesNumber === lineLength ? "See More" : "See Less"}
            </Button>
          </CardActions>
        )}
      </Card>
      <Modal open={openFile} onClose={() => setOpenFile(false)}>
        <Box sx={modalStyle()}>
          <FileDisplay fileName={fileName} noteId={note.id} />
        </Box>
      </Modal>
    </>
  );
};
