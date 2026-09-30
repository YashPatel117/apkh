"use client";

import { useCallback } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import { createNote } from "@/service/noteService";
import { useAppDispatch } from "@/store/hook";
import { addNote, markNoteIndexing } from "@/store/slices/noteSlice";
import { SourceRef, sourceLocation } from "../components/sources";

const TITLE_CHARS = 72;
/** Category that saved answers are filed under */
export const AI_INSIGHTS_CATEGORY = "AI Insights";

/** Markdown → HTML, rendered off-screen with the same renderer the answers use. */
function markdownToHtml(markdown: string): string {
  const container = document.createElement("div");
  const root = createRoot(container);
  flushSync(() => root.render(<ReactMarkdown>{markdown}</ReactMarkdown>));
  const html = container.innerHTML;
  root.unmount();
  return html;
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A note holding an answer, followed by the numbered sources its [n] citations point to. */
export function answerAsNote(question: string, answer: string, sources: SourceRef[]) {
  const trimmed = question.trim() || "AI answer";
  const title = trimmed.length > TITLE_CHARS ? `${trimmed.slice(0, TITLE_CHARS - 1).trimEnd()}…` : trimmed;
  const sourceList = sources.length
    ? `<p><strong>Sources</strong></p><ol>${sources
        .map((source) => `<li>${escapeHtml(source.noteTitle || "Untitled note")} — ${escapeHtml(sourceLocation(source))}</li>`)
        .join("")}</ol>`
    : "";
  return { title, content: `${markdownToHtml(answer)}${sourceList}` };
}

/**
 * Saves an AI answer as a note (roadmap: "Pinned insights"), so it becomes
 * searchable knowledge itself. Throws if saving fails.
 */
export function useSaveAnswerAsNote() {
  const dispatch = useAppDispatch();
  return useCallback(
    async (question: string, answer: string, sources: SourceRef[]) => {
      const { title, content } = answerAsNote(question, answer, sources);
      const note = await createNote({ title, content, category: AI_INSIGHTS_CATEGORY });
      dispatch(addNote(note));
      dispatch(markNoteIndexing(note.id));
      return note;
    },
    [dispatch],
  );
}
