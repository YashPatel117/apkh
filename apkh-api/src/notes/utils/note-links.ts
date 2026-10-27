/**
 * Links between notes are links to a note's page, `/notes/<id>` (what "[["
 * inserts in the editor); absolute links to the app count too.
 */
const NOTE_LINK =
  /href=["'](?:https?:\/\/[^/"']+)?\/notes\/([a-f\d]{24})\/?["']/gi;

/** Ids of the notes an HTML note links to, each once, in order. */
export function linkedNoteIds(html: string | null | undefined): string[] {
  if (!html?.includes('/notes/')) return [];
  const ids = new Set<string>();
  for (const match of html.matchAll(NOTE_LINK)) ids.add(match[1].toLowerCase());
  return [...ids];
}
