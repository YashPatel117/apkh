const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const archiver = require("archiver");
const cors = require("cors");

// Load .env if present (Node >= 20.12); real env vars take precedence
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {}

const JwtSecretKey = process.env.JWT_SECRET;
if (!JwtSecretKey) {
  console.error("Missing JWT_SECRET. Copy .env.example to .env and fill it in.");
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

const baseFolder = path.join(__dirname, "uploads");
if (!fs.existsSync(baseFolder)) fs.mkdirSync(baseFolder, { recursive: true });

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

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

// 📌 Upload files under noteId
app.post("/upload/:noteId", upload.array("files"), (req, res) => {
  const folderPath = safePath(req.id, req.params.noteId);
  if (!folderPath) return res.status(400).send("Invalid noteId");

  const files = req.files || [];
  const filePaths = files.map((f) => safePath(req.id, req.params.noteId, f.originalname));
  if (filePaths.some((p) => !p)) return res.status(400).send("Invalid filename");

  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
  files.forEach((f, i) => fs.writeFileSync(filePaths[i], f.buffer));
  res.json(files.map((f) => f.originalname));
});

app.post("/files", (req, res) => {
  const { noteId, files } = req.body; // noteId and array of filenames
  if (!noteId || !Array.isArray(files) || files.length === 0) {
    return res.status(400).send("noteId and files array are required");
  }

  const folderPath = safePath(req.id, noteId);
  if (!folderPath) return res.status(400).send("Invalid noteId");
  if (!fs.existsSync(folderPath))
    return res.status(404).send("Note ID not found");

  // Set headers for ZIP download
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=${noteId}_files.zip`
  );

  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.on("error", (err) => res.status(500).send({ error: err.message }));

  archive.pipe(res);

  files.forEach((filename) => {
    const filePath = safePath(req.id, noteId, filename);
    if (filePath && fs.existsSync(filePath)) {
      archive.file(filePath, { name: filename });
    }
  });

  archive.finalize();
});

// 📌 Get specific file
app.get("/files/:noteId/:filename", (req, res) => {
  const filePath = safePath(req.id, req.params.noteId, req.params.filename);
  if (!filePath) return res.status(400).send("Invalid path");
  if (!fs.existsSync(filePath)) return res.status(404).send("File not found");
  res.sendFile(filePath);
});

// 📌 Delete all files for user
app.delete("/files", (req, res) => {
  const userFolder = safePath(req.id);
  if (!userFolder) return res.status(400).send("Invalid user");
  if (!fs.existsSync(userFolder)) return res.status(404).send("ID not found");
  fs.rmSync(userFolder, { recursive: true, force: true });
  res.send("All files deleted for user");
});

// 📌 Delete noteId folder
app.delete("/files/:noteId", (req, res) => {
  const folderPath = safePath(req.id, req.params.noteId);
  if (!folderPath) return res.status(400).send("Invalid noteId");
  if (!fs.existsSync(folderPath))
    return res.status(404).send("Note ID not found");
  fs.rmSync(folderPath, { recursive: true, force: true });
  res.send("Note folder deleted");
});

// 📌 Delete selected files inside noteId
app.delete("/files/:noteId/files", (req, res) => {
  const folderPath = safePath(req.id, req.params.noteId);
  if (!folderPath) return res.status(400).send("Invalid noteId");
  if (!fs.existsSync(folderPath))
    return res.status(404).send("Note ID not found");

  const { filenames } = req.body; // expect array of filenames
  if (!Array.isArray(filenames))
    return res.status(400).send("filenames[] required");

  filenames.forEach((filename) => {
    const filePath = safePath(req.id, req.params.noteId, filename);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  res.send("Selected files deleted");
});

app.listen(port, () =>
  console.log(`Server running at http://localhost:${port}`)
);
