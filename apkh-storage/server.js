const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const archiver = require("archiver");
const cors = require("cors");

const app = express();
const port = 3001;

const FRONTEND_URL = "http://localhost:3002";
const LAN_URL = "http://192.168.3.172:3002";

app.use(
  cors({
    origin: [FRONTEND_URL, LAN_URL],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

const baseFolder = path.join(__dirname, "uploads");
if (!fs.existsSync(baseFolder)) fs.mkdirSync(baseFolder, { recursive: true });

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const JwtSecretKey =
  "0ef16fe111b8e19e2d58fa0a17c5f214c6742616163eec3db89013dec3eb282bfa88294224d42317aab605fb224b494b26f575f665a28c9f65332f14c1a22210";

app.use(express.json());

app.use((req, res, next) => {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer "))
    return res.status(401).send("Unauthorized");
  const token = auth.split(" ")[1];
  try {
    const payload = jwt.verify(token, JwtSecretKey);
    req.id = payload._id;
    next();
  } catch (err) {
    return res.status(401).send("Invalid token");
  }
});

// 📌 Upload files under noteId
app.post("/upload/:noteId", upload.array("files"), (req, res) => {
  const folderPath = path.join(baseFolder, req.id, req.params.noteId);
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

  const urls = [];
  req.files.forEach((f) => {
    const filename = f.originalname;
    const filePath = path.join(folderPath, filename);
    fs.writeFileSync(filePath, f.buffer);
    urls.push(filename);
  });
  res.json(urls);
});

app.post("/files", (req, res) => {
  const { noteId, files } = req.body; // noteId and array of filenames
  if (!noteId || !Array.isArray(files) || files.length === 0) {
    return res.status(400).send("noteId and files array are required");
  }

  const folderPath = path.join(baseFolder, req.id, noteId);
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
    const filePath = path.join(folderPath, filename);
    if (fs.existsSync(filePath)) {
      archive.file(filePath, { name: filename });
    }
  });

  archive.finalize();
});

// 📌 Get specific file
app.get("/files/:noteId/:filename", (req, res) => {
  const filePath = path.join(
    baseFolder,
    req.id,
    req.params.noteId,
    req.params.filename
  );
  if (!fs.existsSync(filePath)) return res.status(404).send("File not found");
  res.sendFile(filePath);
});

// 📌 Delete all files for user
app.delete("/files", (req, res) => {
  const userFolder = path.join(baseFolder, req.id);
  if (!fs.existsSync(userFolder)) return res.status(404).send("ID not found");
  fs.rmSync(userFolder, { recursive: true, force: true });
  res.send("All files deleted for user");
});

// 📌 Delete noteId folder
app.delete("/files/:noteId", (req, res) => {
  const folderPath = path.join(baseFolder, req.id, req.params.noteId);
  if (!fs.existsSync(folderPath))
    return res.status(404).send("Note ID not found");
  fs.rmSync(folderPath, { recursive: true, force: true });
  res.send("Note folder deleted");
});

// 📌 Delete selected files inside noteId
app.delete("/files/:noteId/files", (req, res) => {
  const folderPath = path.join(baseFolder, req.id, req.params.noteId);
  if (!fs.existsSync(folderPath))
    return res.status(404).send("Note ID not found");

  const { filenames } = req.body; // expect array of filenames
  if (!Array.isArray(filenames))
    return res.status(400).send("filenames[] required");

  filenames.forEach((filename) => {
    const filePath = path.join(folderPath, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  res.send("Selected files deleted");
});

app.listen(port, () =>
  console.log(`Server running at http://localhost:${port}`)
);
