import type { NoteActions, SummaryMode } from 'src/common/schema/summary';

export interface NoteSummaryResponse {
  noteId: string;
  mode: SummaryMode;
  summary: string;
  /** mode "actions": tasks, decisions, deadlines and people */
  actions: NoteActions | null;
  cached: boolean;
  model: string | null;
  generatedAt: Date | null;
}
