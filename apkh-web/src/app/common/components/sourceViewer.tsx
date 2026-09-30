"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Paperclip, PencilLine, SearchX } from "lucide-react";
import { useAppSelector } from "@/store/hook";
import { findPassage, highlightRange } from "../service/passageHighlight";
import { normalizeNoteLinksInHtml, stripLegacyFileTokenStyles } from "../service/noteLinkUtils";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import FileDisplay from "./fileDisplay";
import { SourceRef, sourceLocation } from "./sources";

const SourceViewerContext = createContext<(source: SourceRef) => void>(() => {});

/** Opens the source viewer: the note with the passage highlighted, or the attachment at its page. */
export const useSourceViewer = () => useContext(SourceViewerContext);

export function SourceViewerProvider({
  children,
  onOpenNote,
}: {
  children: React.ReactNode;
  /** Opens a note for editing */
  onOpenNote: (noteId: string) => void;
}) {
  const [source, setSource] = useState<SourceRef | null>(null);
  const close = useCallback(() => setSource(null), []);

  return (
    <SourceViewerContext.Provider value={setSource}>
      {children}
      <Modal
        open={Boolean(source)}
        onClose={close}
        size={source?.sourceType === "file" ? "xl" : "lg"}
        title={
          <span className="flex items-center gap-2">
            {source?.sourceType === "file" ? <Paperclip className="size-4 text-accent" /> : <FileText className="size-4 text-accent" />}
            {source?.noteTitle || "Untitled note"}
          </span>
        }
        description={source ? sourceLocation(source) : undefined}
      >
        {source && (
          <SourceBody
            source={source}
            onOpenNote={(noteId) => {
              close();
              onOpenNote(noteId);
            }}
          />
        )}
      </Modal>
    </SourceViewerContext.Provider>
  );
}

function SourceBody({ source, onOpenNote }: { source: SourceRef; onOpenNote: (noteId: string) => void }) {
  const note = useAppSelector((state) => state.note.notes.find((n) => n.id === source.noteId));

  if (!note) {
    return (
      <div className="px-5 pb-6 sm:px-6">
        <p className="flex items-center gap-2 text-sm font-medium text-fg">
          <SearchX className="size-4 text-fg-subtle" /> This note no longer exists.
        </p>
        <Passage text={source.excerpt} />
      </div>
    );
  }

  const isFile = source.sourceType === "file" && source.sourceName;
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-5 sm:px-6">
          <Passage text={source.excerpt} />
        </div>
        {isFile ? (
          <FileDisplay fileName={source.sourceName!} noteId={note.id} page={source.sourcePage} />
        ) : (
          <div className="px-5 pb-6 sm:px-6">
            <HighlightedNote html={note.content} passage={source.excerpt} />
          </div>
        )}
      </div>
      <div className="flex shrink-0 justify-end border-t border-line px-5 py-3 sm:px-6">
        <Button size="sm" variant="secondary" onClick={() => onOpenNote(note.id)} icon={<PencilLine className="size-3.5" />}>
          Open note
        </Button>
      </div>
    </>
  );
}

function Passage({ text }: { text: string }) {
  return (
    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-400/20 dark:bg-amber-400/10">
      <p className="text-[0.68rem] font-semibold tracking-wider text-amber-800 uppercase dark:text-amber-300">Matched passage</p>
      <p className="mt-1 line-clamp-6 text-sm leading-relaxed whitespace-pre-line text-fg">{text}</p>
    </div>
  );
}

/** The whole note, scrolled to the passage and with it highlighted. */
function HighlightedNote({ html, passage }: { html: string; passage: string }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [found, setFound] = useState<boolean | null>(null);
  const content = useMemo(() => normalizeNoteLinksInHtml(stripLegacyFileTokenStyles(html)), [html]);
  // A stable object: React re-applies innerHTML whenever this prop is a new object,
  // which would replace the text nodes and drop the highlight on every re-render.
  const innerHtml = useMemo(() => ({ __html: content }), [content]);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const range = findPassage(root, passage);
    setFound(Boolean(range));
    if (!range) return;
    const removeHighlight = highlightRange(range);
    range.startContainer.parentElement?.scrollIntoView({ block: "center" });
    return removeHighlight;
  }, [content, passage]);

  return (
    <>
      {found === false && (
        <p className="mb-3 text-xs text-fg-subtle">
          The passage isn&apos;t in the current text — the note has changed since it was indexed, or the passage comes
          from its link list.
        </p>
      )}
      <div ref={contentRef} className="rich-content text-sm" dangerouslySetInnerHTML={innerHtml} />
    </>
  );
}
