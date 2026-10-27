/**
 * Links between notes are ordinary links to a note's page, `/notes/<id>`;
 * "[[" in the editor inserts them, and the API finds backlinks by that href.
 */
export const noteHref = (noteId: string) => `/notes/${noteId}`;

const NOTE_HREF = /^(?:https?:\/\/[^/]+)?\/notes\/([a-f\d]{24})\/?$/i;

/** The note id a link points to, when it is a link to a note of this app. */
export function noteIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const match = NOTE_HREF.exec(href.trim());
  if (!match) return null;
  // An absolute link only counts when it is this app's own address.
  if (/^https?:/i.test(href) && typeof window !== "undefined" && !href.startsWith(window.location.origin)) return null;
  return match[1];
}

/** Ids of the notes a note's HTML links to, each once. */
export function linkedNoteIds(html: string | undefined): string[] {
  if (!html?.includes("/notes/")) return [];
  const ids = new Set<string>();
  for (const match of html.matchAll(/href=["'](?:https?:\/\/[^/"']+)?\/notes\/([a-f\d]{24})\/?["']/gi)) ids.add(match[1]);
  return [...ids];
}

/**
 * A click on a note link inside rendered note HTML: its note id, or null.
 * Modified clicks (new tab, etc.) are left to the browser.
 */
export function noteLinkClick(e: React.MouseEvent): string | null {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return null;
  const anchor = (e.target as HTMLElement).closest("a");
  return noteIdFromHref(anchor?.getAttribute("href"));
}
