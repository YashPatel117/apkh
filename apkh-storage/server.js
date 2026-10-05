const express = require("express");
const multer = require("multer");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const archiver = require("archiver");
const cors = require("cors");
const { rateLimit } = require("express-rate-limit");
const pino = require("pino");
const pinoHttp = require("pino-http");

// Load .env if present (Node >= 20.12); real env vars take precedence
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {}

const logger = pino({ level: process.env.LOG_LEVEL || "info", base: { service: "apkh-storage" } });

const JwtSecretKey = process.env.JWT_SECRET;
if (!JwtSecretKey) {
  logger.fatal("Missing JWT_SECRET. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const MB = 1024 * 1024;
// Per uploaded file, and files per request
const MAX_FILE_BYTES = positiveNumber(process.env.MAX_FILE_MB, 50) * MB;
const MAX_FILES_PER_REQUEST = positiveNumber(process.env.MAX_FILES_PER_REQUEST, 10);
// Everything one user may store
const USER_QUOTA_BYTES = positiveNumber(process.env.USER_QUOTA_MB, 1024) * MB;
// Requests per user per minute: uploads, and everything else
const UPLOADS_PER_MINUTE = positiveNumber(process.env.UPLOADS_PER_MINUTE, 30);
const REQUESTS_PER_MINUTE = positiveNumber(process.env.REQUESTS_PER_MINUTE, 600);
// How long a shutdown waits for in-flight requests
const SHUTDOWN_GRACE_MS = 10_000;

const app = express();
const port = process.env.PORT || 3001;

const CORS_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:3002")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// One id per request, passed on from apkh-api (or created here) and echoed back.
app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const id = req.headers["x-request-id"] || crypto.randomUUID();
      res.setHeader("X-Request-Id", id);
      return id;
    },
    customLogLevel: (req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
    autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/ready" },
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  })
);

app.use(
  cors({
    origin: CORS_ORIGINS,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"],
  })
);

const baseFolder = path.join(__dirname, "uploads");
// Uploads land here first and are moved into place once they pass the quota check.
const tmpFolder = path.join(__dirname, ".upload-tmp");
fs.mkdirSync(baseFolder, { recursive: true });
fs.mkdirSync(tmpFolder, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: tmpFolder,
    filename: (req, file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_REQUEST },
});

/**
 * Resolves a path under baseFolder from user-supplied segments (user id, noteId,
 * filename). Returns null if any segment could escape its directory.
 */
function safePath(...segments) {
  for (const segment of segments) {
    if (
      typeof segment !== "string" ||
      !segment ||
      segment === "." ||
      segment === ".." ||
      /[\\/\0]/.test(segment)
    )
      return null;
  }
  const target = path.resolve(baseFolder, ...segments);
  return target.startsWith(baseFolder + path.sep) ? target : null;
}

async function exists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(target) {
  try {
    return (await fsp.stat(target)).size;
  } catch {
    return 0;
  }
}

/** Total bytes under a folder (0 if it doesn't exist). */
async function folderSize(folder) {
  let entries;
  try {
    entries = await fsp.readdir(folder, { withFileTypes: true });
  } catch {
    return 0;
  }
  const sizes = await Promise.all(
    entries.map((entry) => {
      const target = path.join(folder, entry.name);
      return entry.isDirectory() ? folderSize(target) : fileSize(target);
    })
  );
  return sizes.reduce((total, size) => total + size, 0);
}

async function removeTempFiles(files) {
  await Promise.all((files || []).map((f) => fsp.rm(f.path, { force: true })));
}

// ── Unauthenticated: health checks ─────────────────────────────────────────

/** Liveness: the process is up. */
app.get("/health", (req, res) => res.json({ status: "ok", service: "apkh-storage" }));

/** Readiness: uploads can be written. */
app.get("/ready", async (req, res) => {
  try {
    await fsp.access(baseFolder, fs.constants.W_OK);
    res.json({ status: "ready" });
  } catch (err) {
    res.status(503).json({ status: "unavailable", error: err.message });
  }
});

// ── Everything else needs a token ──────────────────────────────────────────

app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer "))
    return res.status(401).send("Unauthorized");
  const token = auth.split(" ")[1];
  try {
    const payload = jwt.verify(token, JwtSecretKey);
    req.id = String(payload._id);
    req.service = payload.svc;
    next();
  } catch (err) {
    return res.status(401).send("Invalid token");
  }
});

// Per user, not per IP: apkh-api and apkh-search call on users' behalf.
const limitOptions = {
  windowMs: 60_000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.id,
  // Background indexing (service tokens) reads many files in a burst.
  skip: (req) => Boolean(req.service),
  message: "Too many requests. Please slow down and try again in a minute.",
};
app.use(rateLimit({ ...limitOptions, limit: REQUESTS_PER_MINUTE }));
const uploadLimiter = rateLimit({ ...limitOptions, limit: UPLOADS_PER_MINUTE });

/** Bytes this user stores, and their quota. */
app.get("/usage", async (req, res) => {
  const userFolder = safePath(req.id);
  if (!userFolder) return res.status(400).send("Invalid user");
  res.json({ usedBytes: await folderSize(userFolder), quotaBytes: USER_QUOTA_BYTES });
});

/** Storage used per user (admin panel; apkh-api signs these tokens). */
app.get("/admin/usage", async (req, res) => {
  if (req.service !== "admin") return res.status(403).send("Forbidden");
  const entries = await fsp.readdir(baseFolder, { withFileTypes: true });
  const users = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => ({ userId: entry.name, usedBytes: await folderSize(path.join(baseFolder, entry.name)) }))
  );
  res.json({ users, quotaBytes: USER_QUOTA_BYTES });
});

// 📌 Upload files under noteId
app.post(
  "/upload/:noteId",
  uploadLimiter,
  (req, res, next) =>
    upload.array("files")(req, res, (err) => {
      if (!err) return next();
      removeTempFiles(req.files).catch(() => {});
      if (err instanceof multer.MulterError) {
        const tooLarge = err.code === "LIMIT_FILE_SIZE" || err.code === "LIMIT_FILE_COUNT";
        const message =
          err.code === "LIMIT_FILE_SIZE"
            ? `Each file must be ${MAX_FILE_BYTES / MB} MB or smaller.`
            : err.code === "LIMIT_FILE_COUNT"
              ? `Upload at most ${MAX_FILES_PER_REQUEST} files at a time.`
              : err.message;
        return res.status(tooLarge ? 413 : 400).send(message);
      }
      next(err);
    }),
  async (req, res, next) => {
    const files = req.files || [];
    try {
      const folderPath = safePath(req.id, req.params.noteId);
      if (!folderPath) return res.status(400).send("Invalid noteId");

      const filePaths = files.map((f) => safePath(req.id, req.params.noteId, f.originalname));
      if (filePaths.some((p) => !p)) return res.status(400).send("Invalid filename");

      // Files replaced by this upload don't count twice.
      const [used, replaced] = await Promise.all([
        folderSize(safePath(req.id)),
        Promise.all(filePaths.map(fileSize)),
      ]);
      const incoming = files.reduce((total, f) => total + f.size, 0);
      const after = used - replaced.reduce((a, b) => a + b, 0) + incoming;
      if (after > USER_QUOTA_BYTES) {
        return res
          .status(413)
          .send(
            `Storage full: you can store ${Math.round(USER_QUOTA_BYTES / MB)} MB in total. Delete some attachments and try again.`
          );
      }

      await fsp.mkdir(folderPath, { recursive: true });
      await Promise.all(files.map((f, i) => fsp.rename(f.path, filePaths[i])));
      res.json(files.map((f) => f.originalname));
    } catch (err) {
      next(err);
    } finally {
      // Anything not moved into place (rejected or failed) is dropped.
      removeTempFiles(files).catch(() => {});
    }
  }
);

app.post("/files", async (req, res, next) => {
  try {
    const { noteId, files } = req.body; // noteId and array of filenames
    if (!noteId || !Array.isArray(files) || files.length === 0) {
      return res.status(400).send("noteId and files array are required");
    }

    const folderPath = safePath(req.id, noteId);
    if (!folderPath) return res.status(400).send("Invalid noteId");
    if (!(await exists(folderPath))) return res.status(404).send("Note ID not found");

    const present = [];
    for (const filename of files) {
      const filePath = safePath(req.id, noteId, filename);
      if (filePath && (await exists(filePath))) present.push({ filePath, filename });
    }

    // Set headers for ZIP download
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=${noteId}_files.zip`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      req.log.error({ err }, "zip failed");
      res.destroy(err);
    });
    archive.pipe(res);
    present.forEach(({ filePath, filename }) => archive.file(filePath, { name: filename }));
    await archive.finalize();
  } catch (err) {
    next(err);
  }
});

// 📌 Get specific file
app.get("/files/:noteId/:filename", async (req, res) => {
  const filePath = safePath(req.id, req.params.noteId, req.params.filename);
  if (!filePath) return res.status(400).send("Invalid path");
  if (!(await exists(filePath))) return res.status(404).send("File not found");
  res.sendFile(filePath);
});

// 📌 Delete all files for user
app.delete("/files", async (req, res) => {
  const userFolder = safePath(req.id);
  if (!userFolder) return res.status(400).send("Invalid user");
  if (!(await exists(userFolder))) return res.status(404).send("ID not found");
  await fsp.rm(userFolder, { recursive: true, force: true });
  res.send("All files deleted for user");
});

// 📌 Delete noteId folder
app.delete("/files/:noteId", async (req, res) => {
  const folderPath = safePath(req.id, req.params.noteId);
  if (!folderPath) return res.status(400).send("Invalid noteId");
  if (!(await exists(folderPath))) return res.status(404).send("Note ID not found");
  await fsp.rm(folderPath, { recursive: true, force: true });
  res.send("Note folder deleted");
});

// 📌 Delete selected files inside noteId
app.delete("/files/:noteId/files", async (req, res) => {
  const folderPath = safePath(req.id, req.params.noteId);
  if (!folderPath) return res.status(400).send("Invalid noteId");
  if (!(await exists(folderPath))) return res.status(404).send("Note ID not found");

  const { filenames } = req.body; // expect array of filenames
  if (!Array.isArray(filenames)) return res.status(400).send("filenames[] required");

  await Promise.all(
    filenames.map((filename) => {
      const filePath = safePath(req.id, req.params.noteId, filename);
      return filePath ? fsp.rm(filePath, { force: true }) : null;
    })
  );

  res.send("Selected files deleted");
});

// Express 5 forwards rejected async handlers here.
app.use((err, req, res, next) => {
  req.log.error({ err }, "request failed");
  if (res.headersSent) return res.destroy(err);
  res.status(500).send("Storage error");
});

const server = app.listen(port, () => logger.info(`Server running at http://localhost:${port}`));

// Finish in-flight uploads and downloads before exiting, so no file is left half-written.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  server.close(() => {
    logger.info("all connections closed");
    process.exit(0);
  });
  server.closeIdleConnections?.();
  setTimeout(() => {
    logger.warn("forcing exit with requests still open");
    process.exit(1);
  }, SHUTDOWN_GRACE_MS).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
