// Copies attachments saved on disk before the move to GridFS
// (uploads/<userId>/<noteId>/<filename>) into the GridFS "attachments" bucket,
// with the same keys the server uses. Safe to run again: a file already in
// GridFS for that user, note and name is skipped, and so are files of notes
// that no longer exist (the API shares this database). Files on disk are kept.
//
//   npm run migrate:uploads              copy everything
//   npm run migrate:uploads -- --dry-run list what would be copied

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { MongoClient, GridFSBucket, ObjectId } = require("mongodb");

try {
  process.loadEnvFile(path.join(__dirname, "..", ".env"));
} catch {}

const dryRun = process.argv.includes("--dry-run");
const uploadsFolder = path.join(__dirname, "..", "uploads");

async function directories(folder) {
  const entries = await fsp.readdir(folder, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function files(folder) {
  const entries = await fsp.readdir(folder, { withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name);
}

function upload(bucket, filePath, filename, metadata) {
  return new Promise((resolve, reject) => {
    const stream = bucket.openUploadStream(filename, { metadata });
    stream.once("finish", resolve).once("error", reject);
    fs.createReadStream(filePath).once("error", reject).pipe(stream);
  });
}

async function main() {
  if (!fs.existsSync(uploadsFolder)) {
    console.log("No uploads folder: nothing to migrate.");
    return;
  }
  if (!process.env.MONGODB_URI) {
    throw new Error("Missing MONGODB_URI. Set it in apkh-storage/.env.");
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const db = client.db();
    const bucket = new GridFSBucket(db, { bucketName: "attachments" });
    const counts = { copied: 0, skipped: 0, orphaned: 0, failed: 0 };

    async function noteExists(userId, noteId) {
      if (!ObjectId.isValid(noteId) || !ObjectId.isValid(userId)) return false;
      const note = await db
        .collection("notes")
        .findOne({ _id: new ObjectId(noteId), userId: new ObjectId(userId) }, { projection: { _id: 1 } });
      return Boolean(note);
    }

    for (const userId of await directories(uploadsFolder)) {
      for (const noteId of await directories(path.join(uploadsFolder, userId))) {
        const noteFolder = path.join(uploadsFolder, userId, noteId);
        if (!(await noteExists(userId, noteId))) {
          const names = await files(noteFolder);
          console.log(`skipped ${userId}/${noteId}: the note no longer exists (${names.length} files)`);
          counts.orphaned += names.length;
          continue;
        }
        for (const filename of await files(noteFolder)) {
          const label = `${userId}/${noteId}/${filename}`;
          const existing = await bucket
            .find({ "metadata.userId": userId, "metadata.noteId": noteId, filename })
            .limit(1)
            .toArray();
          if (existing.length) {
            counts.skipped++;
            continue;
          }
          if (dryRun) {
            console.log(`would copy ${label}`);
            counts.copied++;
            continue;
          }
          try {
            await upload(bucket, path.join(noteFolder, filename), filename, { userId, noteId });
            console.log(`copied ${label}`);
            counts.copied++;
          } catch (err) {
            console.error(`failed ${label}: ${err.message}`);
            counts.failed++;
          }
        }
      }
    }

    const verb = dryRun ? "to copy" : "copied";
    console.log(
      `\n${counts.copied} ${verb}, ${counts.skipped} already in GridFS, ` +
        `${counts.orphaned} of deleted notes skipped, ${counts.failed} failed.`
    );
    if (counts.failed) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
