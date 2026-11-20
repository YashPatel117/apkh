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
  /** Whose note it is (in a shared folder, possibly someone else's) */
  ownerId?: string;
  /** Who saved it last, when known */
  lastEditedBy?: { id: string; name: string } | null;
}
