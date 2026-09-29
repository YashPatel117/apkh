import striptags from 'striptags';

// Closing tags of block elements Quill (and pasted HTML) produce; each ends a line.
const BLOCK_END_TAG =
  /<\/(address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|td|th|tr|ul)>/gi;

/** Decodes the handful of entities Quill emits. `&amp;` goes last so "&amp;lt;" stays "&lt;". */
export function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}

/**
 * Note HTML → plain text with one line per block. Stripping tags alone would
 * glue paragraphs together ("<p>a</p><p>b</p>" → "ab"), which breaks both
 * keyword search and title generation.
 */
export function htmlToPlainText(html?: string | null): string {
  if (!html) {
    return '';
  }

  const withLineBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(BLOCK_END_TAG, '\n');

  return decodeBasicEntities(striptags(withLineBreaks))
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}
