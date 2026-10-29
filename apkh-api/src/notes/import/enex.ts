import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { Types } from 'mongoose';
import {
  filePlaceholder,
  fillFilePlaceholders,
  safeAttachmentName,
  sanitizeImportedHtml,
} from './import-html';
import type { ImportAttachment, ImportedNote } from './parse-import';

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-m4a': 'm4a',
  'audio/amr': 'amr',
  'text/plain': 'txt',
};

interface EnexResource {
  data?: string | { '#text'?: string };
  mime?: string;
  'resource-attributes'?: { 'file-name'?: string };
}

interface EnexNote {
  title?: string;
  content?: string;
  created?: string;
  updated?: string;
  tag?: (string | number)[];
  resource?: EnexResource[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  // The note body is XHTML inside CDATA; it's parsed separately below.
  stopNodes: ['*.content'],
  isArray: (name) => ['note', 'tag', 'resource'].includes(name),
});

/**
 * An Evernote export (.enex): each note's ENML body becomes note HTML and its
 * resources (images, PDFs, audio) become attachments where they were embedded.
 */
export function parseEnex(xml: string, folder: string[]): ImportedNote[] {
  let doc: { 'en-export'?: { note?: EnexNote[] } };
  try {
    doc = parser.parse(xml) as typeof doc;
  } catch {
    throw new Error("The Evernote file couldn't be read.");
  }
  const notes = doc['en-export']?.note;
  if (!notes) throw new Error('No notes found in the Evernote file.');

  return notes.map((note) => {
    const attachments: ImportAttachment[] = [];
    const byHash = new Map<string, number>();
    for (const resource of note.resource ?? []) {
      const base64 =
        typeof resource.data === 'string'
          ? resource.data
          : (resource.data?.['#text'] ?? '');
      const data = Buffer.from(base64.replace(/\s+/g, ''), 'base64');
      if (!data.length) continue;
      const hash = createHash('md5').update(data).digest('hex');
      const ext = MIME_EXTENSIONS[resource.mime ?? ''] ?? 'bin';
      const name = safeAttachmentName(
        resource['resource-attributes']?.['file-name'] ||
          `attachment-${attachments.length + 1}.${ext}`,
      );
      byHash.set(
        hash,
        attachments.push({
          id: `${Date.now()}-${Math.round(Math.random() * 1e9)}-${name}`,
          name,
          read: () => Promise.resolve(data),
        }) - 1,
      );
    }

    const embedded = new Set<number>();
    const html = enmlToHtml(stripCdata(note.content ?? ''), (hash) => {
      const n = byHash.get(hash.toLowerCase());
      if (n === undefined) return '';
      embedded.add(n);
      return filePlaceholder(n);
    });
    // Resources the body doesn't show (older exports) go at the end.
    const rest = attachments
      .map((_, n) => n)
      .filter((n) => !embedded.has(n))
      .map((n) => filePlaceholder(n))
      .join(' ');

    return {
      id: new Types.ObjectId(),
      title: String(note.title ?? '').trim() || 'Untitled note',
      content: fillFilePlaceholders(
        sanitizeImportedHtml(rest ? `${html}<p>${rest}</p>` : html),
        attachments,
      ),
      tags: (note.tag ?? []).map(String),
      folder,
      createdAt: enexDate(note.created),
      updatedAt: enexDate(note.updated) ?? enexDate(note.created),
      attachments,
    };
  });
}

function stripCdata(content: string): string {
  const match = /<!\[CDATA\[([\s\S]*)\]\]>/.exec(content);
  return match ? match[1] : content;
}

/** ENML is XHTML plus <en-media>, <en-todo> and <en-crypt>. */
function enmlToHtml(enml: string, media: (hash: string) => string): string {
  return enml
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?en-note\b[^>]*>/gi, '')
    .replace(
      /<en-media\b([^>]*?)\/?>(?:\s*<\/en-media>)?/gi,
      (match, attrs: string) => {
        const hash = /\bhash=["']([0-9a-f]+)["']/i.exec(attrs)?.[1];
        return hash ? media(hash) : '';
      },
    )
    .replace(
      /<en-todo\b([^>]*?)\/?>(?:\s*<\/en-todo>)?/gi,
      (match, attrs: string) =>
        /checked=["']true["']/i.test(attrs) ? '☑ ' : '☐ ',
    )
    .replace(
      /<en-crypt\b[\s\S]*?<\/en-crypt>/gi,
      '<p><em>[Encrypted in Evernote]</em></p>',
    );
}

/** "20231005T101010Z" */
function enexDate(value: string | undefined): Date | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(
    value ?? '',
  );
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}
