// e.g. STORAGE_API_URL=https://apkh-storage.onrender.com/
export const fileStorageApi =
  process.env.STORAGE_API_URL ?? 'http://localhost:3001/';

export const SEARCH_API = process.env.SEARCH_API_URL ?? 'http://localhost:8000';
