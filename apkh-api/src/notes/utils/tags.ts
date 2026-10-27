/** Most tags one note keeps; extra ones are dropped. */
export const MAX_TAGS_PER_NOTE = 12;
const MAX_TAG_LENGTH = 32;

/**
 * Tags as stored: lowercase, words joined by hyphens, no "#", no duplicates.
 * Accepts a list, a JSON list (multipart forms send strings) or "a, b, c".
 */
export function normalizeTags(input: unknown): string[] {
  let raw: unknown = input;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text.startsWith('[')) {
      try {
        raw = JSON.parse(text);
      } catch {
        raw = text.slice(1, -1).split(',');
      }
    } else {
      raw = text ? text.split(',') : [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const tags: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const tag = value
      .trim()
      .replace(/^#+/, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_TAG_LENGTH);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length === MAX_TAGS_PER_NOTE) break;
  }
  return tags;
}
