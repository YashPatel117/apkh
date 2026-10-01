"use client";

import React, { useEffect, useRef, useState } from "react";
import { Download, FileQuestion, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { getFile } from "@/services/noteService";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import { displayFileName } from "@/lib/fileName";

interface FileDisplayWithAuthProps {
  fileName: string;
  noteId?: string;
  file?: File;
  /** PDF page to open at (e.g. the page a search result came from) */
  page?: number;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

const FileDisplay: React.FC<FileDisplayWithAuthProps> = ({ fileName, noteId, file, page }) => {
  const [fileBlobUrl, setFileBlobUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>("");
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  const previewRef = useRef<HTMLDivElement | null>(null);
  const previousScaleRef = useRef<number | null>(null);
  const displayName = file?.name ?? displayFileName(fileName);

  useEffect(() => {
    let isMounted = true;
    let objectUrl: string | null = null;

    setFileBlobUrl(null);
    setMimeType("");
    setFailed(false);
    setZoom(1);
    setImageSize(null);

    const fetchFile = async () => {
      try {
        if (file) {
          objectUrl = URL.createObjectURL(file);
          if (!isMounted) return URL.revokeObjectURL(objectUrl);
          setFileBlobUrl(objectUrl);
          setMimeType(file.type);
          return;
        }
        if (noteId && fileName) {
          const res = await getFile(noteId, fileName);
          objectUrl = URL.createObjectURL(res.data);
          if (!isMounted) return URL.revokeObjectURL(objectUrl);
          setFileBlobUrl(objectUrl);
          setMimeType(String(res.headers["content-type"] ?? ""));
          return;
        }
        setFailed(true);
      } catch {
        if (isMounted) setFailed(true);
      }
    };

    void fetchFile();

    return () => {
      isMounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, fileName, noteId]);

  // Measured from the layout box (inside the border, including any scrollbar
  // area): unlike clientWidth/Height it doesn't shrink when scrollbars appear,
  // and unlike getBoundingClientRect it ignores the modal's scale-in transform.
  // Only zoomed-in sizes depend on it; at Fit the image is sized by CSS alone.
  useEffect(() => {
    const element = previewRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const width = element.offsetWidth - 2 * element.clientLeft;
      const height = element.offsetHeight - 2 * element.clientTop;
      setViewportSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element, { box: "border-box" });
    return () => observer.disconnect();
  }, [fileBlobUrl, mimeType]);

  const fitScale =
    imageSize && viewportSize.width > 0 && viewportSize.height > 0
      ? Math.min(viewportSize.width / imageSize.width, viewportSize.height / imageSize.height, 1)
      : 1;
  const currentScale = fitScale * zoom;
  const scaledWidth = imageSize ? Math.round(imageSize.width * currentScale) : 0;
  const scaledHeight = imageSize ? Math.round(imageSize.height * currentScale) : 0;
  const zoomed = zoom > MIN_ZOOM && scaledWidth > 0;

  useEffect(() => {
    const element = previewRef.current;
    if (!element || !imageSize) return;
    const previousScale = previousScaleRef.current;
    previousScaleRef.current = currentScale;
    if (!previousScale || previousScale === currentScale) return;
    const centerX = element.scrollLeft + element.clientWidth / 2;
    const centerY = element.scrollTop + element.clientHeight / 2;
    const ratio = currentScale / previousScale;
    element.scrollLeft = Math.max(0, centerX * ratio - element.clientWidth / 2);
    element.scrollTop = Math.max(0, centerY * ratio - element.clientHeight / 2);
  }, [currentScale, imageSize]);

  const downloadLink = fileBlobUrl && (
    <a
      href={fileBlobUrl}
      download={displayName}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-fg transition-colors hover:bg-surface-2"
    >
      <Download className="size-3.5" /> Download
    </a>
  );

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 pt-4 pb-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-fg-subtle">
          <FileQuestion className="size-5" />
        </span>
        <p className="font-semibold text-fg">Couldn&apos;t load this file</p>
        <p className="max-w-sm text-sm text-fg-muted">It may have been removed, or the storage service isn&apos;t reachable.</p>
      </div>
    );
  }

  if (!fileBlobUrl) {
    return (
      <div className="flex h-[50dvh] flex-col items-center justify-center gap-3 text-fg-subtle">
        <Spinner />
        <p className="text-sm">Loading preview…</p>
      </div>
    );
  }

  const body = (() => {
    if (mimeType.startsWith("image/")) {
      return (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))} disabled={zoom <= MIN_ZOOM} icon={<ZoomOut className="size-3.5" />} aria-label="Zoom out" />
            <span className="min-w-14 text-center text-xs font-semibold text-fg-muted tabular-nums">{Math.round(zoom * 100)}%</span>
            <Button size="sm" variant="secondary" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))} disabled={zoom >= MAX_ZOOM} icon={<ZoomIn className="size-3.5" />} aria-label="Zoom in" />
            <Button
              size="sm"
              variant="ghost"
              disabled={zoom === 1}
              onClick={() => {
                setZoom(1);
                previewRef.current?.scrollTo({ left: 0, top: 0, behavior: "smooth" });
              }}
              icon={<Maximize className="size-3.5" />}
            >
              Fit
            </Button>
            <div className="ml-auto">{downloadLink}</div>
          </div>
          {/* Scrolls only when zoomed in: at Fit nothing can overflow, so no scrollbars. */}
          <div
            ref={previewRef}
            className={cn("h-[62dvh] rounded-2xl border border-line bg-surface-2", zoomed ? "overflow-auto" : "overflow-hidden")}
          >
            <div
              className="relative"
              style={
                zoomed
                  ? { width: `max(100%, ${scaledWidth}px)`, height: `max(100%, ${scaledHeight}px)` }
                  : { width: "100%", height: "100%" }
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- blob URL, not optimizable */}
              <img
                src={fileBlobUrl}
                alt={displayName}
                // Centered; at Fit, CSS keeps it inside the box (never enlarged past its natural size)
                className={cn("absolute inset-0 m-auto rounded-lg shadow-lg", zoomed ? "max-w-none" : "max-h-full max-w-full")}
                onLoad={(e) => setImageSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
                style={zoomed ? { width: scaledWidth, height: scaledHeight } : undefined}
              />
            </div>
          </div>
        </>
      );
    }

    if (mimeType.startsWith("video/")) return <video src={fileBlobUrl} controls className="max-h-[70dvh] w-full rounded-2xl bg-black" />;
    if (mimeType.startsWith("audio/")) return <audio src={fileBlobUrl} controls className="w-full" />;
    if (mimeType === "application/pdf" || mimeType.startsWith("text/")) {
      return (
        <>
          <div className="mb-3 flex justify-end">{downloadLink}</div>
          <iframe
            // Browsers' PDF viewers open at #page=N
            src={page && mimeType === "application/pdf" ? `${fileBlobUrl}#page=${page}` : fileBlobUrl}
            title={displayName}
            className="h-[70dvh] w-full rounded-2xl border border-line bg-white"
          />
        </>
      );
    }
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-fg-subtle">
          <FileQuestion className="size-5" />
        </span>
        <p className="text-sm text-fg-muted">No preview available for this file type.</p>
        {downloadLink}
      </div>
    );
  })();

  return <div className="min-h-0 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">{body}</div>;
};

export default FileDisplay;
