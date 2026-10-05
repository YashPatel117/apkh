import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

/**
 * Notes are shown as HTML, so anything arriving from outside (emails, web
 * pages, webhooks) is reduced to the formatting the editor itself produces.
 */
export function sanitizeNoteHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'h1', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's',
      'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    ],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        target: '_blank',
        rel: 'noopener noreferrer',
      }),
      b: 'strong',
      i: 'em',
    },
    // Script and style contents are dropped, not shown as text.
    nonTextTags: ['script', 'style', 'textarea', 'noscript', 'head', 'title'],
  }).trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Plain text as paragraphs, one per blank-line-separated block. */
export function textToHtml(text: string): string {
  return text
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export type ExternalFormat = 'html' | 'markdown' | 'text';

/** External content of any supported format as safe note HTML. */
export function toNoteHtml(content: string, format: ExternalFormat): string {
  if (format === 'text') return textToHtml(content);
  const html =
    format === 'markdown'
      ? (marked.parse(content, { async: false }) as string)
      : content;
  return sanitizeNoteHtml(html);
}

/** "Clipped from <url>" line appended to clipped pages. */
export function sourceLine(url: string): string {
  const safe = escapeHtml(url);
  return `<p><em>Source: <a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a></em></p>`;
}
