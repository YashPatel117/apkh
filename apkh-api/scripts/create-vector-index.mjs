// Creates the Atlas Vector Search index the API uses when ATLAS_VECTOR_INDEX is
// set, so similarity search runs in the database instead of the API.
// Usage (from apkh-api/): npm run search:vector-index
import 'dotenv/config';
import mongoose from 'mongoose';

const INDEX = process.env.ATLAS_VECTOR_INDEX?.trim() || 'chunk_vectors';
// Must match the dimensions in src/search-api/embedding-space.ts
const DIMENSIONS = 1536;

const definition = {
  fields: [
    { type: 'vector', path: 'vector', numDimensions: DIMENSIONS, similarity: 'cosine' },
    // Fields retrieval filters on
    { type: 'filter', path: 'userId' },
    { type: 'filter', path: 'embeddingModel' },
    { type: 'filter', path: 'sourceType' },
    { type: 'filter', path: 'noteId' },
    { type: 'filter', path: 'sessionId' },
  ],
};

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set (see .env).');
  process.exit(1);
}

await mongoose.connect(uri);
try {
  const chunks = mongoose.connection.collection('knowledgechunks');
  const [existing] = await chunks.listSearchIndexes(INDEX).toArray();
  if (existing) {
    console.log(`Index "${INDEX}" already exists (status: ${existing.status}).`);
  } else {
    await chunks.createSearchIndex({ name: INDEX, type: 'vectorSearch', definition });
    console.log(
      `Created "${INDEX}". Atlas builds it in the background: once its status is READY, ` +
        `set ATLAS_VECTOR_INDEX=${INDEX} in .env and restart the API.`,
    );
  }
} catch (error) {
  console.error(`Could not create the index: ${error.message}`);
  console.error('Atlas Vector Search needs a MongoDB Atlas cluster.');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
