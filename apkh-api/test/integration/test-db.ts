import { randomBytes } from 'crypto';
import { mongo } from 'mongoose';

/**
 * Integration tests need a MongoDB: set MONGODB_TEST_URI (e.g.
 * mongodb://localhost:27017). Each run works in its own database named
 * apkh-test-<random> and drops only that one, so no existing data is touched.
 * Without the variable the suites are skipped.
 */
export const TEST_MONGODB_URI = process.env.MONGODB_TEST_URI;

export const describeWithDb = TEST_MONGODB_URI ? describe : describe.skip;

// A test database has no Atlas Vector Search: similarity is computed in the
// API unless a test opts in.
process.env.ATLAS_VECTOR_INDEX ??= 'off';

/** A URI for a fresh, uniquely named test database. */
export function freshDatabaseUri(label: string): string {
  if (!TEST_MONGODB_URI) {
    // Jest still runs the body of a skipped describe block
    return `mongodb://skipped/apkh-test-${label}`;
  }
  const url = new URL(TEST_MONGODB_URI);
  url.pathname = `/apkh-test-${label}-${randomBytes(4).toString('hex')}`;
  return url.toString();
}

export async function dropDatabase(uri: string): Promise<void> {
  const name = new URL(uri).pathname.slice(1);
  if (!name.startsWith('apkh-test-')) {
    throw new Error(`Refusing to drop ${name}: not a test database`);
  }
  const client = new mongo.MongoClient(uri);
  try {
    await client.connect();
    await client.db(name).dropDatabase();
  } finally {
    await client.close();
  }
}
