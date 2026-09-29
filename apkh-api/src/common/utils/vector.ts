import { mongo } from 'mongoose';

/**
 * Fast cosine similarity between two numeric vectors.
 * Returns 0 for vectors of different dimensions (e.g. embeddings from
 * different providers), which can't be meaningfully compared.
 */
export function cosineSimilarity(
  vecA: ArrayLike<number> | null | undefined,
  vecB: ArrayLike<number> | null | undefined,
): number {
  if (!vecA?.length || !vecB?.length || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * A vector as stored in MongoDB: a BSON binary vector of float32 — about 6 KB
 * for 1536 dimensions, versus ~21 KB as an array of doubles (each element also
 * carries its index as a key). Atlas Vector Search indexes this format too.
 */
export function toStoredVector(values: ArrayLike<number>): mongo.Binary {
  const floats =
    values instanceof Float32Array ? values : Float32Array.from(values);
  return mongo.Binary.fromFloat32Array(floats);
}

/** A stored vector as float32: a BSON binary vector, or a legacy array of numbers. */
export function fromStoredVector(stored: unknown): Float32Array | null {
  if (Array.isArray(stored)) {
    return Float32Array.from(stored as number[]);
  }
  const binary = stored as Partial<mongo.Binary> | null | undefined;
  if (
    binary?.sub_type === mongo.Binary.SUBTYPE_VECTOR &&
    typeof binary.toFloat32Array === 'function'
  ) {
    return binary.toFloat32Array();
  }
  return null;
}

/** Decodes a vector sent by apkh-search: base64 of little-endian float32. */
export function decodeVector(base64: string): Float32Array {
  const bytes = Buffer.from(base64, 'base64');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vector = new Float32Array(bytes.byteLength / 4);
  for (let i = 0; i < vector.length; i++) {
    vector[i] = view.getFloat32(i * 4, true);
  }
  return vector;
}
