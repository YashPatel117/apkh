export interface NoteResponse {
  id: string;
  title: string;
  content: string;
  category: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
  files: string[];
}
