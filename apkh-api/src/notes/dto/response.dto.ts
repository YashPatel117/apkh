export interface NoteResponse {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
  files: string[];
}
