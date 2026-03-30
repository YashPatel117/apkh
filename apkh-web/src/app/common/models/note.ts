export interface INote {
  id: string;
  title: string;
  content: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  files: string[];
}

export interface INoteDto {
  title: string;
  content: string;
  category: string;
  files?: File[];
  removedFiles?: string[];
}
