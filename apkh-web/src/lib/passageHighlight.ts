// Match on the first characters of a passage; enough to be unique, short enough
// to survive small differences in how the passage was extracted.
const MATCH_CHARS = 80;
const MIN_MATCH_CHARS = 8;
const HIGHLIGHT_NAME = "apkh-source";

/**
 * Finds a search passage in rendered note HTML. Whitespace is ignored on both
 * sides: the indexed text puts paragraphs on separate lines while the DOM has
 * no characters between block elements.
 */
export function findPassage(root: HTMLElement, passage: string): Range | null {
  const wanted = compact(passage);
  const target = wanted.slice(0, MATCH_CHARS);
  if (target.length < MIN_MATCH_CHARS) return null;

  // Each non-space character of the note, with where it lives in the DOM.
  const positions: { node: Text; offset: number }[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    for (let i = 0; i < node.data.length; i++) {
      const char = node.data[i];
      if (/\s/.test(char)) continue;
      text += lowerChar(char);
      positions.push({ node, offset: i });
    }
  }

  const start = text.indexOf(target);
  if (start === -1) return null;
  // Cover the whole passage when the note still contains all of it.
  const end = text.startsWith(wanted, start) ? start + wanted.length : start + target.length;

  const range = document.createRange();
  range.setStart(positions[start].node, positions[start].offset);
  const last = positions[end - 1];
  range.setEnd(last.node, last.offset + 1);
  return range;
}

/** Highlights a range; returns a function that removes the highlight. */
export function highlightRange(range: Range): () => void {
  const registry = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)?.highlights;
  const HighlightType = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (registry && HighlightType) {
    // CSS Custom Highlight API: styles text across element boundaries without touching the DOM
    addHighlightStyle();
    registry.set(HIGHLIGHT_NAME, new HighlightType(range));
    return () => registry.delete(HIGHLIGHT_NAME);
  }
  try {
    // Older browsers: wrap the text, which only works within a single element
    const mark = document.createElement("mark");
    mark.className = HIGHLIGHT_NAME;
    range.surroundContents(mark);
  } catch {
    // The passage spans elements: it is still scrolled into view, just not tinted.
  }
  return () => {};
}

/** The ::highlight() rule lives here rather than in globals.css, whose build step can't parse it yet. */
function addHighlightStyle() {
  const id = `${HIGHLIGHT_NAME}-style`;
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background-color: rgb(250 204 21 / 0.45); }`;
  document.head.appendChild(style);
}

function compact(text: string) {
  return Array.from(text.replace(/\s+/g, ""), lowerChar).join("");
}

/** Lower-cases a character only when that keeps it one character long (keeps indexes aligned). */
function lowerChar(char: string) {
  const lower = char.toLowerCase();
  return lower.length === char.length ? lower : char;
}
