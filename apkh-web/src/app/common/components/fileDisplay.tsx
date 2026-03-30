import { getFile } from "@/service/noteService";
import Button from "@mui/material/Button";
import React, { useEffect, useState } from "react";
import CloudDownloadRoundedIcon from "@mui/icons-material/CloudDownloadRounded";
import { useMediaQuery } from "@mui/material";

interface FileDisplayWithAuthProps {
  fileName: string;
  noteId?: string;
  file?: File;
}

const FileDisplay: React.FC<FileDisplayWithAuthProps> = ({
  fileName,
  noteId,
  file,
}) => {
  const [fileBlobUrl, setFileBlobUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>("");

  useEffect(() => {
    const fetchFile = async () => {
      try {
        if (noteId) {
          const res = await getFile(noteId, fileName);
          if (!res) throw new Error("Failed to fetch file");
          const url = URL.createObjectURL(res.data);
          setFileBlobUrl(url);
          setMimeType(res.headers["content-type"] || "");
        } else if (file) {
          const url = URL.createObjectURL(file);
          setFileBlobUrl(url);
          setMimeType(file.type);
        }
      } catch (err) {
        console.error(err);
      }
    };

    fetchFile();

    return () => {
      if (fileBlobUrl) URL.revokeObjectURL(fileBlobUrl);
    };
  }, [fileName, noteId]);

  const isSmall = useMediaQuery("(max-width:768px)");
  const isMedium = useMediaQuery("(max-width:1200px)");
  const width = isSmall ? "90vw" : isMedium ? "70vw" : "60vw";

  if (!fileBlobUrl) return <p>Loading...</p>;

  if (mimeType.startsWith("image/")) {
    return <img src={fileBlobUrl} />;
  } else if (mimeType.startsWith("video/")) {
    return <video src={fileBlobUrl} controls />;
  } else if (mimeType.startsWith("audio/")) {
    return <audio src={fileBlobUrl} controls />;
  } else if (mimeType === "application/pdf" || mimeType.startsWith("text/")) {
    return <iframe src={fileBlobUrl} style={{ width, height: "70vh" }} />;
  } else {
    return (
      <Button
        variant="contained"
        href={fileBlobUrl}
        download={fileName}
        startIcon={<CloudDownloadRoundedIcon />}
      >
        {fileName}
      </Button>
    );
  }
};

export default FileDisplay;
