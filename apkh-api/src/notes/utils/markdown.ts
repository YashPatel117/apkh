import TurndownService from 'turndown';

/** Stored file ids are "<timestamp>-<random>-<original name>"; the original name. */
export function displayFileName(id: string): string {
  const match = id.match(/^\d+-\d+-(.+)$/);
  return match ? match[1] : id;
}

/** A name that is safe as a file or folder name on every OS. */
export function safeFileName(name: string, fallback = 'Untitled note'): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex -- control characters aren't valid in file names
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  return cleaned || fallback;
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});

// Attachment chips become links to the attachment, which exports keep next to the note.
turndown.addRule('fileToken', {
  filter: (node) =>
    node.nodeName === 'SPAN' && node.classList?.contains('file-token'),
  replacement: (_content, node) => {
    const id = node.getAttribute('data-id') ?? '';
    const name = displayFileName(id);
    return `[📎 ${name}](${encodeURI(`attachments/${id}`)})`;
  },
});

// Quill 2 writes every list as <ol>, each item saying what it is (data-list:
// bullet, ordered, checked, unchecked) and how deep (class ql-indent-N).
turndown.addRule('quillListItem', {
  filter: 'li',
  replacement: (content, node) => {
    const item = node;
    const kind =
      item.getAttribute('data-list') ??
      (item.parentNode?.nodeName === 'UL' ? 'bullet' : 'ordered');
    const depth = Number(/ql-indent-(\d+)/.exec(item.className)?.[1] ?? 0);
    let marker = '-';
    if (kind === 'checked') marker = '- [x]';
    else if (kind === 'unchecked') marker = '- [ ]';
    else if (kind === 'ordered') {
      let n = 1;
      for (
        let s = item.previousElementSibling;
        s;
        s = s.previousElementSibling
      ) {
        const sKind = s.getAttribute('data-list') ?? 'ordered';
        const sDepth = Number(/ql-indent-(\d+)/.exec(s.className)?.[1] ?? 0);
        if (sDepth < depth) break;
        if (sDepth === depth && sKind === 'ordered') n++;
      }
      marker = `${n}.`;
    }
    const text = content.trim().replace(/\n/g, '\n    ');
    const next = item.nextSibling ? '\n' : '';
    return `${'    '.repeat(depth)}${marker} ${text}${next}`;
  },
});

export interface ExportableNote {
  title: string;
  category: string;
  content: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  folderPath?: string;
}

/** A note as Markdown, with its metadata as YAML front matter. */
export function noteToMarkdown(note: ExportableNote): string {
  const iso = (value: string | Date) => new Date(value).toISOString();
  const yaml = (value: string) => JSON.stringify(value);
  const front = [
    '---',
    `title: ${yaml(note.title || 'Untitled note')}`,
    `category: ${yaml(note.category || '')}`,
    ...(note.folderPath ? [`folder: ${yaml(note.folderPath)}`] : []),
    `created: ${iso(note.createdAt)}`,
    `updated: ${iso(note.updatedAt)}`,
    '---',
    '',
  ].join('\n');
  const body = turndown.turndown(note.content || '').trim();
  return `${front}# ${note.title || 'Untitled note'}\n\n${body}\n`;
}
