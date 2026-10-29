import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

/**
 * Imported notes arrive as Markdown or as HTML from other apps; both end up
 * as the HTML the editor itself writes (Quill 2), so they edit like any note.
 */

/** Markdown (GitHub flavour, with task lists) as HTML. */
export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false, gfm: true, breaks: false });
}

/**
 * Quill writes every list as one flat <ol>: each <li> says what it is
 * (data-list: bullet, ordered, checked, unchecked) and nested items carry
 * ql-indent-N. Other apps write nested <ul>/<ol> with checkbox inputs, which
 * Quill would flatten or drop; this rewrites them the way Quill stores them.
 */
export function toQuillLists(html: string): string {
  const stack: ('bullet' | 'ordered')[] = [];
  let itemOpen = false;
  let out = '';
  let last = 0;
  const tag = /<(\/?)(ul|ol|li|p)\b[^>]*>/gi;
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    out += html.slice(last, match.index);
    last = tag.lastIndex;
    const closing = match[1] === '/';
    const name = match[2].toLowerCase();

    if (name === 'p') {
      // Paragraphs inside list items ("loose" lists) would split the item.
      if (stack.length) {
        if (closing && itemOpen && /^\s*<p\b/i.test(html.slice(last))) {
          out += '<br>';
        }
        continue;
      }
      out += match[0];
      continue;
    }

    if (name === 'ul' || name === 'ol') {
      if (closing) {
        if (!stack.length) continue;
        if (itemOpen) out += '</li>';
        itemOpen = false;
        stack.pop();
        if (!stack.length) out += '</ol>';
      } else {
        if (!stack.length) out += '<ol>';
        else if (itemOpen) {
          out += '</li>';
          itemOpen = false;
        }
        stack.push(name === 'ul' ? 'bullet' : 'ordered');
      }
      continue;
    }

    // <li> outside any list: keep its text as a paragraph.
    if (!stack.length) {
      out += closing ? '</p>' : '<p>';
      continue;
    }
    if (closing) {
      if (itemOpen) out += '</li>';
      itemOpen = false;
      continue;
    }
    if (itemOpen) out += '</li>';
    let kind: string = stack[stack.length - 1];
    const checkbox =
      /^\s*(?:<p\b[^>]*>\s*)?<input\b[^>]*type=["']?checkbox["']?[^>]*>\s?/i.exec(
        html.slice(last),
      );
    if (checkbox) {
      kind = /\bchecked\b/i.test(checkbox[0]) ? 'checked' : 'unchecked';
      last += checkbox[0].length;
    }
    const depth = stack.length - 1;
    out += `<li data-list="${kind}"${depth ? ` class="ql-indent-${Math.min(depth, 8)}"` : ''}>`;
    itemOpen = true;
  }
  out += html.slice(last);
  // A list left open (malformed HTML) is closed once: nested ones are flat.
  if (stack.length) out += itemOpen ? '</li></ol>' : '</ol>';
  return out;
}

/** Tables have no place in the editor: each row becomes a paragraph, cells split by "|". */
function flattenTables(html: string): string {
  return html
    .replace(/<tr\b[^>]*>/gi, '<p>')
    .replace(/<\/tr>/gi, '</p>')
    .replace(/<\/t[dh]>\s*(?=<t[dh]\b)/gi, ' | ');
}

/** Note HTML from another app, reduced to what the editor itself produces. */
export function sanitizeImportedHtml(html: string): string {
  return (
    sanitizeHtml(toQuillLists(flattenTables(html)), {
      allowedTags: [
        'p',
        'br',
        'h1',
        'h2',
        'h3',
        'strong',
        'em',
        'u',
        's',
        'a',
        'ol',
        'li',
        'blockquote',
        'pre',
        'code',
      ],
      allowedAttributes: {
        a: ['href', 'target', 'rel'],
        li: ['data-list', 'class'],
      },
      allowedClasses: { li: ['ql-indent-*'] },
      allowedSchemes: ['http', 'https', 'mailto'],
      transformTags: {
        a: (tagName, attribs): sanitizeHtml.Tag => {
          const href = attribs.href ?? '';
          // Links between notes stay in the app; the rest open in a new tab.
          if (href.startsWith('/notes/')) return { tagName, attribs: { href } };
          return {
            tagName,
            attribs: { href, target: '_blank', rel: 'noopener noreferrer' },
          };
        },
        b: 'strong',
        i: 'em',
        strike: 's',
        del: 's',
        h4: 'h3',
        h5: 'h3',
        h6: 'h3',
        div: 'p',
        section: 'p',
        article: 'p',
      },
      nonTextTags: ['script', 'style', 'textarea', 'noscript', 'head', 'title'],
    })
      // Line breaks between blocks would become empty lines in the editor.
      .replace(/\s*\n\s*(?=<\/?(?:p|ol|li|h[1-3]|pre|blockquote)\b)/g, '')
      .replace(/(<p>)\s+|\s+(<\/p>)/g, '$1$2')
      .replace(/<p>\s*<\/p>/g, '')
      .trim()
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** An attachment chip, as the editor's file-token blot writes it. */
export function fileTokenHtml(id: string, name: string): string {
  const safe = escapeHtml(name);
  return `<span class="file-token" data-id="${escapeHtml(id)}" data-name="${safe}" contenteditable="false">${safe}</span>`;
}

/** A note link, as "[[" inserts it in the editor. */
export function noteLinkHtml(noteId: string, text: string): string {
  return `<a href="/notes/${noteId}">${escapeHtml(text)}</a>`;
}

/** Text placeholder that survives sanitizing; replaced by a chip afterwards. */
export const filePlaceholder = (n: number) => `@@APKH-FILE-${n}@@`;
const FILE_PLACEHOLDER = /@@APKH-FILE-(\d+)@@/g;

export function fillFilePlaceholders(
  html: string,
  chips: { id: string; name: string }[],
): string {
  return html.replace(FILE_PLACEHOLDER, (match, n: string) => {
    const chip = chips[Number(n)];
    return chip ? fileTokenHtml(chip.id, chip.name) : '';
  });
}

/** Storage rejects slashes and NUL; long names are cut, keeping the extension. */
export function safeAttachmentName(name: string): string {
  const cleaned =
    // eslint-disable-next-line no-control-regex -- control characters aren't valid in file names
    name.replace(/[\\/\u0000-\u001f]/g, ' ').trim() || 'attachment';
  if (cleaned.length <= 120) return cleaned;
  const ext = /\.[^.]{1,10}$/.exec(cleaned)?.[0] ?? '';
  return `${cleaned.slice(0, 120 - ext.length)}${ext}`;
}

export { escapeHtml };
