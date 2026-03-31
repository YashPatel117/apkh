import { getFile } from "@/service/noteService";
import Button from "@mui/material/Button";
import React, { useEffect, useRef, useState } from "react";
import CloudDownloadRoundedIcon from "@mui/icons-material/CloudDownloadRounded";
import ZoomInRoundedIcon from "@mui/icons-material/ZoomInRounded";
import ZoomOutRoundedIcon from "@mui/icons-material/ZoomOutRounded";
import FitScreenRoundedIcon from "@mui/icons-material/FitScreenRounded";
import { CircularProgress, useMediaQuery } from "@mui/material";

interface FileDisplayWithAuthProps {
  fileName: string;
  noteId?: string;
  file?: File;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

const FileDisplay: React.FC<FileDisplayWithAuthProps> = ({
  fileName,
  noteId,
  file,
}) => {
  const [fileBlobUrl, setFileBlobUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>("");
  const [zoom, setZoom] = useState(1);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(
    null
  );
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  const previewRef = useRef<HTMLDivElement | null>(null);
  const previousScaleRef = useRef<number | null>(null);

  useEffect(() => {
    let isMounted = true;
    let objectUrl: string | null = null;

    setFileBlobUrl(null);
    setMimeType("");
    setZoom(1);
    setImageSize(null);

    const fetchFile = async () => {
      try {
        if (noteId) {
          const res = await getFile(noteId, fileName);
          if (!res) throw new Error("Failed to fetch file");

          objectUrl = URL.createObjectURL(res.data);
          if (!isMounted) {
            URL.revokeObjectURL(objectUrl);
            return;
          }

          setFileBlobUrl(objectUrl);
          setMimeType(res.headers["content-type"] || "");
          return;
        }

        if (file) {
          objectUrl = URL.createObjectURL(file);
          if (!isMounted) {
            URL.revokeObjectURL(objectUrl);
            return;
          }

          setFileBlobUrl(objectUrl);
          setMimeType(file.type);
        }
      } catch (error) {
        console.error(error);
      }
    };

    void fetchFile();

    return () => {
      isMounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, fileName, noteId]);

  useEffect(() => {
    const element = previewRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const updateViewport = () => {
      setViewportSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };

    updateViewport();

    const observer = new ResizeObserver(() => updateViewport());
    observer.observe(element);

    return () => observer.disconnect();
  }, [fileBlobUrl, mimeType]);

  const isSmall = useMediaQuery("(max-width:768px)");
  const isMedium = useMediaQuery("(max-width:1200px)");
  const width = isSmall ? "90vw" : isMedium ? "70vw" : "60vw";

  const fitScale =
    imageSize && viewportSize.width > 0 && viewportSize.height > 0
      ? Math.min(
          viewportSize.width / imageSize.width,
          viewportSize.height / imageSize.height
        )
      : 1;
  const currentScale = fitScale * zoom;
  const scaledWidth = imageSize ? imageSize.width * currentScale : 0;
  const scaledHeight = imageSize ? imageSize.height * currentScale : 0;
  const canvasWidth = Math.max(viewportSize.width, scaledWidth);
  const canvasHeight = Math.max(viewportSize.height, scaledHeight);
  const imageLeft = Math.max((canvasWidth - scaledWidth) / 2, 0);
  const imageTop = Math.max((canvasHeight - scaledHeight) / 2, 0);

  useEffect(() => {
    const element = previewRef.current;
    if (!element || !imageSize) return;

    const previousScale = previousScaleRef.current;
    previousScaleRef.current = currentScale;

    if (!previousScale || previousScale === currentScale) return;

    const centerX = element.scrollLeft + element.clientWidth / 2;
    const centerY = element.scrollTop + element.clientHeight / 2;
    const scaleRatio = currentScale / previousScale;

    element.scrollLeft = Math.max(0, centerX * scaleRatio - element.clientWidth / 2);
    element.scrollTop = Math.max(0, centerY * scaleRatio - element.clientHeight / 2);
  }, [currentScale, imageSize]);

  if (!fileBlobUrl) {
    return (
      <div className="flex h-[40vh] w-full min-w-[280px] flex-col items-center justify-center gap-3 rounded-[24px] border border-slate-200 bg-slate-50 text-slate-500">
        <CircularProgress size={26} />
        <p className="text-sm font-medium">Loading file preview...</p>
      </div>
    );
  }

  if (mimeType.startsWith("image/")) {
    return (
      <div className="flex flex-col gap-4" style={{ width }}>
        <div className="flex flex-col gap-3 rounded-[24px] border border-slate-200 bg-white/90 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
              Image Preview
            </p>
            <h3 className="mt-2 break-all text-lg font-semibold text-slate-900">
              {fileName}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Fit-to-view starts automatically, then zoom in and scroll to inspect.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-sky-50 px-3 py-1 text-sm font-semibold text-sky-700 ring-1 ring-sky-100">
              Fit {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="outlined"
              size="small"
              onClick={() =>
                setZoom((current) => Math.max(MIN_ZOOM, current - ZOOM_STEP))
              }
              disabled={zoom <= MIN_ZOOM}
              startIcon={<ZoomOutRoundedIcon />}
              sx={{ textTransform: "none", borderRadius: "999px" }}
            >
              Zoom out
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() =>
                setZoom((current) => Math.min(MAX_ZOOM, current + ZOOM_STEP))
              }
              disabled={zoom >= MAX_ZOOM}
              startIcon={<ZoomInRoundedIcon />}
              sx={{ textTransform: "none", borderRadius: "999px" }}
            >
              Zoom in
            </Button>
            <Button
              variant="text"
              size="small"
              onClick={() => {
                setZoom(1);
                const element = previewRef.current;
                if (element) {
                  element.scrollTo({ left: 0, top: 0, behavior: "smooth" });
                }
              }}
              disabled={zoom === 1}
              startIcon={<FitScreenRoundedIcon />}
              sx={{ textTransform: "none", borderRadius: "999px" }}
            >
              Fit view
            </Button>
          </div>
        </div>

        <div
          ref={previewRef}
          className="overflow-auto rounded-[24px] border border-slate-200 bg-slate-950/5 shadow-inner"
          style={{ width, height: "70vh" }}
        >
          <div
            className="relative"
            style={{
              width: canvasWidth || "100%",
              height: canvasHeight || "100%",
              minWidth: "100%",
              minHeight: "100%",
            }}
          >
            <img
              src={fileBlobUrl}
              alt={fileName}
              className="rounded-2xl shadow-2xl"
              onLoad={(event) => {
                const target = event.currentTarget;
                setImageSize({
                  width: target.naturalWidth,
                  height: target.naturalHeight,
                });
              }}
              style={{
                position: "absolute",
                left: imageLeft,
                top: imageTop,
                width: scaledWidth || "auto",
                height: scaledHeight || "auto",
                maxWidth: "none",
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (mimeType.startsWith("video/")) {
    return <video src={fileBlobUrl} controls style={{ width }} />;
  }

  if (mimeType.startsWith("audio/")) {
    return <audio src={fileBlobUrl} controls />;
  }

  if (mimeType === "application/pdf" || mimeType.startsWith("text/")) {
    return <iframe src={fileBlobUrl} style={{ width, height: "70vh" }} />;
  }

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
};

export default FileDisplay;
