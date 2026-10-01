const express = require("express");
const multer = require("multer");
const path = require("path");
const jwt = require("jsonwebtoken");
const archiver = require("archiver");
const cors = require("cors");
const { MongoClient, GridFSBucket } = require("mongodb");

// Load .env if present (Node >= 20.12); real env vars take precedence
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {}

const JwtSecretKey = process.env.JWT_SECRET;
if (!JwtSecretKey) {
  console.error("Missing JWT_SECRET. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 3001;

const CORS_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:3002")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: CORS_ORIGINS,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Files live in MongoDB GridFS (attachments.files / attachments.chunks), one
// document per file, keyed by metadata.userId + metadata.noteId + filename.
const client = new MongoClient(MONGODB_URI);
let bucket;

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

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

function writeFile(userId, noteId, file) {
  return new Promise((resolve, reject) => {
    const stream = bucket.openUploadStream(file.originalname, {
      metadata: { userId, noteId },
    });
    stream.once("finish", resolve).once("error", reject);
    stream.end(file.buffer);
  });
}

app.use(express.json());

app.use((req, res, next) => {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer "))
    return res.status(401).send("Unauthorized");
  const token = auth.split(" ")[1];
  try {
    const payload = jwt.verify(token, JwtSecretKey);
    req.id = String(payload._id);
    next();
  } catch (err) {
    return res.status(401).send("Invalid token");
  }
});

// 📌 Upload files under noteId (a file with the same name is replaced)
app.post("/upload/:noteId", upload.array("files"), async (req, res) => {
  const { noteId } = req.params;
  if (!validSegment(noteId)) return res.status(400).send("Invalid noteId");

  const files = req.files || [];
  if (files.some((f) => !validSegment(f.originalname)))
    return res.status(400).send("Invalid filename");

  const names = files.map((f) => f.originalname);
  const previous = await findFiles(req.id, noteId, names);
  for (const f of files) await writeFile(req.id, noteId, f);
  await deleteFiles(previous);
  res.json(names);
});

app.post("/files", async (req, res) => {
  const { noteId, files } = req.body; // noteId and array of filenames
  if (!noteId || !Array.isArray(files) || files.length === 0) {
    return res.status(400).send("noteId and files array are required");
  }
  if (!validSegment(noteId)) return res.status(400).send("Invalid noteId");

  const found = await findFiles(req.id, noteId, files.filter(validSegment));
  if (found.length === 0) return res.status(404).send("Note ID not found");

  // Set headers for ZIP download
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=${noteId}_files.zip`
  );

  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.on("error", (err) => res.status(500).send({ error: err.message }));

  archive.pipe(res);

  found.forEach((f) => {
    archive.append(bucket.openDownloadStream(f._id), { name: f.filename });
  });

  archive.finalize();
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
    .on("error", () => res.destroy())
    .pipe(res);
});

// Deletes succeed even when nothing matches, so notes whose files are already
// gone (e.g. uploaded before the move to GridFS) can still be deleted.

// 📌 Delete all files for user
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

// 📌 Delete selected files inside noteId
app.delete("/files/:noteId/files", async (req, res) => {
  const { noteId } = req.params;
  if (!validSegment(noteId)) return res.status(400).send("Invalid noteId");

  const { filenames } = req.body; // expect array of filenames
  if (!Array.isArray(filenames))
    return res.status(400).send("filenames[] required");

  await deleteFiles(await findFiles(req.id, noteId, filenames));
  res.send("Selected files deleted");
});

async function start() {
  await client.connect();
  const db = client.db();
  bucket = new GridFSBucket(db, { bucketName: "attachments" });
  await db
    .collection("attachments.files")
    .createIndex({ "metadata.userId": 1, "metadata.noteId": 1, filename: 1 });
  app.listen(port, () =>
    console.log(`Server running at http://localhost:${port}`)
  );
}

start().catch((err) => {
  console.error("Failed to start storage service:", err);
  process.exit(1);
});
