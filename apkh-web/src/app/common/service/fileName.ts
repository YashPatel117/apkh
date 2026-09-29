/** Stored file ids are "<timestamp>-<random>-<original name>"; returns the original name. */
export function displayFileName(id: string) {
  const match = id.match(/^\d+-\d+-(.+)$/);
  return match ? match[1] : id;
}
