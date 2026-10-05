import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const MB = 1024 * 1024;

/** Same limits as apkh-storage, so oversized uploads are refused before they're forwarded. */
export const MAX_FILES_PER_UPLOAD = Number(process.env.MAX_FILES_PER_UPLOAD) || 10;
export const UPLOAD_OPTIONS: MulterOptions = {
  limits: {
    fileSize: (Number(process.env.MAX_FILE_MB) || 50) * MB,
    files: MAX_FILES_PER_UPLOAD,
  },
};
