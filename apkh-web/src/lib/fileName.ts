/** Stored file ids are "<timestamp>-<random>-<original name>"; returns the original name. */
export function displayFileName(id: string) {
  const match = id.match(/^\d+-\d+-(.+)$/);
  return match ? match[1] : id;
}

/** A name that is safe as a file name on every OS. */
export function safeFileName(name: string, fallback = "untitled") {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, "");
  return cleaned || fallback;
}
