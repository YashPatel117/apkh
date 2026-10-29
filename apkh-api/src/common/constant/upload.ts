import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const MB = 1024 * 1024;

/** Same limits as apkh-storage, so oversized uploads are refused before they're forwarded. */
export const MAX_FILES_PER_UPLOAD =
  Number(process.env.MAX_FILES_PER_UPLOAD) || 10;
/** One export file (ZIP or .enex) to import; larger than an attachment may be. */
export const IMPORT_MAX_MB = Number(process.env.IMPORT_MAX_MB) || 300;
export const IMPORT_UPLOAD_OPTIONS: MulterOptions = {
  limits: { fileSize: IMPORT_MAX_MB * MB, files: 1 },
};

/** One recording to transcribe (POST /notes/transcribe). */
export const TRANSCRIBE_UPLOAD_OPTIONS: MulterOptions = {
  limits: { fileSize: 25 * MB, files: 1 },
};

export const UPLOAD_OPTIONS: MulterOptions = {
  limits: {
    fileSize: (Number(process.env.MAX_FILE_MB) || 50) * MB,
    files: MAX_FILES_PER_UPLOAD,
  },
};
