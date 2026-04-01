export interface NoteSummaryResponse {
  noteId: string;
  summary: string;
  cached: boolean;
  model: string | null;
  generatedAt: Date | null;
}
