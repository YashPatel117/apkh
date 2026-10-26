const express = require("express");
const multer = require("multer");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const archiver = require("archiver");
const cors = require("cors");
const { MongoClient, GridFSBucket } = require("mongodb");
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

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  logger.fatal("Missing MONGODB_URI. Copy .env.example to .env and fill it in.");
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

// Files live in MongoDB GridFS (attachments.files / attachments.chunks), one
// document per file, keyed by metadata.userId + metadata.noteId + filename.
const client = new MongoClient(MONGODB_URI);
let db;
let bucket;

// Uploads land here first and are copied into GridFS once they pass the quota check.
const tmpFolder = path.join(__dirname, ".upload-tmp");
fs.mkdirSync(tmpFolder, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: tmpFolder,
    filename: (req, file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_REQUEST },
});

/** True for a user-supplied id or filename that is safe to store and serve. */
function validSegment(segment) {
  return (
    typeof segment === "string" &&
    !!segment &&
    segment !== "." &&
    segment !== ".." &&
    !/[\\/\0]/.test(segment)
  );
}

/** GridFS file documents of a user, optionally narrowed to a note and filenames. */
function findFiles(userId, noteId, filenames) {
  const query = { "metadata.userId": userId };
  if (noteId) query["metadata.noteId"] = noteId;
  if (filenames) query.filename = { $in: filenames };
  return bucket.find(query).toArray();
}

function deleteFiles(files) {
  return Promise.all(files.map((f) => bucket.delete(f._id)));
}

/** Copies an uploaded temp file into GridFS. */
function writeFile(userId, noteId, file) {
  return new Promise((resolve, reject) => {
    const stream = bucket.openUploadStream(file.originalname, {
      metadata: { userId, noteId },
    });
    stream.once("finish", resolve).once("error", reject);
    fs.createReadStream(file.path).once("error", reject).pipe(stream);
  });
}

/** Bytes stored per user, optionally for one user only. */
async function usageByUser(userId) {
  const match = userId ? [{ $match: { "metadata.userId": userId } }] : [];
  return db
    .collection("attachments.files")
    .aggregate([...match, { $group: { _id: "$metadata.userId", usedBytes: { $sum: "$length" } } }])
    .toArray();
}

async function removeTempFiles(files) {
  await Promise.all((files || []).map((f) => fsp.rm(f.path, { force: true })));
}

// ── Unauthenticated: health checks ─────────────────────────────────────────

/** Liveness: the process is up. */
app.get("/health", (req, res) => res.json({ status: "ok", service: "apkh-storage" }));

/** Readiness: the database answers. */
app.get("/ready", async (req, res) => {
  try {
    await db.command({ ping: 1 });
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
  const [usage] = await usageByUser(req.id);
  res.json({ usedBytes: usage?.usedBytes ?? 0, quotaBytes: USER_QUOTA_BYTES });
});

/** Storage used per user (admin panel; apkh-api signs these tokens). */
app.get("/admin/usage", async (req, res) => {
  if (req.service !== "admin") return res.status(403).send("Forbidden");
  const users = (await usageByUser()).map((u) => ({ userId: u._id, usedBytes: u.usedBytes }));
  res.json({ users, quotaBytes: USER_QUOTA_BYTES });
});

// 📌 Upload files under noteId (a file with the same name is replaced)
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
      const { noteId } = req.params;
      if (!validSegment(noteId)) return res.status(400).send("Invalid noteId");
      if (files.some((f) => !validSegment(f.originalname)))
        return res.status(400).send("Invalid filename");

      // Files replaced by this upload don't count twice.
      const names = files.map((f) => f.originalname);
      const [[usage], previous] = await Promise.all([
        usageByUser(req.id),
        findFiles(req.id, noteId, names),
      ]);
      const used = usage?.usedBytes ?? 0;
      const replaced = previous.reduce((total, f) => total + f.length, 0);
      const incoming = files.reduce((total, f) => total + f.size, 0);
      if (used - replaced + incoming > USER_QUOTA_BYTES) {
        return res
          .status(413)
          .send(
            `Storage full: you can store ${Math.round(USER_QUOTA_BYTES / MB)} MB in total. Delete some attachments and try again.`
          );
      }

      for (const f of files) await writeFile(req.id, noteId, f);
      await deleteFiles(previous);
      res.json(names);
    } catch (err) {
      next(err);
    } finally {
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
    if (!validSegment(noteId)) return res.status(400).send("Invalid noteId");

    const found = await findFiles(req.id, noteId, files.filter(validSegment));
    if (found.length === 0) return res.status(404).send("Note ID not found");

    // Set headers for ZIP download
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=${noteId}_files.zip`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      req.log.error({ err }, "zip failed");
      res.destroy(err);
    });
    archive.pipe(res);
    found.forEach((f) => archive.append(bucket.openDownloadStream(f._id), { name: f.filename }));
    await archive.finalize();
  } catch (err) {
    next(err);
  }
});

// 📌 Get specific file
app.get("/files/:noteId/:filename", async (req, res) => {
  const { noteId, filename } = req.params;
  if (!validSegment(noteId) || !validSegment(filename))
    return res.status(400).send("Invalid path");

  const [file] = await findFiles(req.id, noteId, [filename]);
  if (!file) return res.status(404).send("File not found");

  res.type(path.extname(filename) || "bin");
  res.set("Content-Length", String(file.length));
  bucket
    .openDownloadStream(file._id)
    .on("error", (err) => res.destroy(err))
    .pipe(res);
});

// Deletes succeed even when nothing matches, so notes whose files are already
// gone (e.g. uploaded before the move to GridFS) can still be deleted.

// 📌 Delete all files of a user
app.delete("/files", async (req, res) => {
  await deleteFiles(await findFiles(req.id));
  res.send("All files deleted for user");
});

// 📌 Delete all files of a note
app.delete("/files/:noteId", async (req, res) => {
  const { noteId } = req.params;
  if (!validSegment(noteId)) return res.status(400).send("Invalid noteId");
  await deleteFiles(await findFiles(req.id, noteId));
  res.send("Note folder deleted");
});

// 📌 Delete specific files from a note
app.delete("/files/:noteId/files", async (req, res) => {
  const { noteId } = req.params;
  if (!validSegment(noteId)) return res.status(400).send("Invalid noteId");

  const { filenames } = req.body;
  if (!Array.isArray(filenames)) return res.status(400).send("filenames[] required");

  await deleteFiles(await findFiles(req.id, noteId, filenames));
  res.send("Selected files deleted");
});

// Express 5 forwards rejected async handlers here.
app.use((err, req, res, next) => {
  req.log.error({ err }, "request failed");
  if (res.headersSent) return res.destroy(err);
  res.status(500).send("Storage error");
});

let server;

async function start() {
  await client.connect();
  db = client.db();
  bucket = new GridFSBucket(db, { bucketName: "attachments" });
  await db
    .collection("attachments.files")
    .createIndex({ "metadata.userId": 1, "metadata.noteId": 1, filename: 1 });
  server = app.listen(port, () => logger.info(`Server running at http://localhost:${port}`));
}

// Finish in-flight uploads and downloads before exiting, so no file is left half-written.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  if (!server) process.exit(0);
  server.close(() => {
    logger.info("all connections closed");
    client.close().finally(() => process.exit(0));
  });
  server.closeIdleConnections?.();
  setTimeout(() => {
    logger.warn("forcing exit with requests still open");
    process.exit(1);
  }, SHUTDOWN_GRACE_MS).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((err) => {
  logger.fatal({ err }, "Failed to start storage service");
  process.exit(1);
});
