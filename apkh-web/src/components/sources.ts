import { AiSearchResponse } from "@/services/noteService";
import { displayFileName } from "@/lib/fileName";
import type { Translate } from "@/i18n";

/** A passage an answer drew on — from AI search or a chat reply. Cited in the answer as [n]. */
export interface SourceRef {
  noteId?: string;
  noteTitle: string;
  sourceType: string;
  sourceName?: string;
  sourcePage?: number;
  excerpt: string;
  cited?: boolean;
}

export function fromAiReference(reference: AiSearchResponse["references"][number]): SourceRef {
  return {
    noteId: reference.note_id || undefined,
    noteTitle: reference.note_title,
    sourceType: reference.source_type,
    sourceName: reference.source_name,
    sourcePage: reference.source_page,
    excerpt: reference.excerpt,
    cited: reference.cited,
  };
}

/** "report.pdf · page 3", or "Note content" (in the app's language when given `t`). */
export function sourceLocation(source: SourceRef, t?: Translate) {
  if (source.sourceType === "file") {
    const page = typeof source.sourcePage === "number" ? ` · ${t ? t("common.page", { page: source.sourcePage }) : `page ${source.sourcePage}`}` : "";
    return `${source.sourceName ? displayFileName(source.sourceName) : t ? t("common.attachment") : "Attachment"}${page}`;
  }
  return t ? t("common.noteContent") : "Note content";
}
