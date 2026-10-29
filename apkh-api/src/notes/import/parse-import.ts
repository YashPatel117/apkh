import JSZip from 'jszip';
import { Types } from 'mongoose';
import { textToHtml } from 'src/integrations/external-content';
import { parseEnex } from './enex';
import {
  escapeHtml,
  filePlaceholder,
  fillFilePlaceholders,
  markdownToHtml,
  noteLinkHtml,
  safeAttachmentName,
  sanitizeImportedHtml,
} from './import-html';

const MB = 1024 * 1024;
/** Notes one import may create; the rest are listed as skipped. */
export const MAX_IMPORT_NOTES = Number(process.env.IMPORT_MAX_NOTES) || 2000;
/** Same per-file limit as storage, so oversized attachments are skipped up front. */
const MAX_ATTACHMENT_BYTES = (Number(process.env.MAX_FILE_MB) || 50) * MB;
/** Everything inside the archive, unpacked: guards against ZIP bombs. */
const MAX_UNPACKED_BYTES =
  (Number(process.env.IMPORT_MAX_UNPACKED_MB) || 2048) * MB;

const NOTE_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.html', '.htm']);
// Files with no use as a note or an attachment (app settings, exports' metadata).
const IGNORED_EXTENSIONS = new Set([
  '.json',
  '.css',
  '.js',
  '.map',
  '.ds_store',
]);
const IGNORED_NAMES = new Set(['thumbs.db', 'desktop.ini', '__macosx']);
// Notion appends the page id to every exported file and folder name.
const NOTION_ID = /\s+[0-9a-f]{32}(?=(\.[^./]+)?$)/i;

export type ImportSource =
  | 'obsidian'
  | 'notion'
  | 'evernote'
  | 'notebooklm'
  | 'markdown';

export interface ImportAttachment {
  /** Stored file id: "<timestamp>-<random>-<name>", like the editor's */
  id: string;
  name: string;
  read: () => Promise<Buffer>;
}

export interface ImportedNote {
  id: Types.ObjectId;
  title: string;
  /** Note HTML with its links and attachment chips in place */
  content: string;
  tags: string[];
  category?: string;
  /** Folder names from the top of the import down */
  folder: string[];
  createdAt?: Date;
  updatedAt?: Date;
  attachments: ImportAttachment[];
}

export interface ImportSkip {
  name: string;
  reason: string;
}

export interface ParsedImport {
  source: ImportSource;
  /** Name of the folder everything is imported into */
  rootName: string;
  notes: ImportedNote[];
  skipped: ImportSkip[];
}

export class ImportError extends Error {}

/** Reads an uploaded export (ZIP, .enex, or one Markdown / HTML / text file). */
export async function parseImport(
  buffer: Buffer,
  fileName: string,
): Promise<ParsedImport> {
  const ext = extensionOf(fileName);
  const baseName = cleanName(stripExtension(baseNameOf(fileName))) || 'Import';
  if (ext === '.enex') {
    const notes = parseEnex(decodeText(buffer), []);
    return limitNotes({
      source: 'evernote',
      rootName: baseName,
      notes,
      skipped: [],
    });
  }
  if (NOTE_EXTENSIONS.has(ext)) {
    const vault = new Vault([
      {
        path: baseNameOf(fileName),
        segments: [baseNameOf(fileName)],
        date: new Date(),
        size: buffer.length,
        read: () => Promise.resolve(buffer),
      },
    ]);
    return limitNotes({
      source: 'markdown',
      // One note needs no folder of its own.
      rootName: '',
      ...(await vault.parse()),
    });
  }
  if (ext !== '.zip') {
    throw new ImportError(
      'Upload a ZIP export, an Evernote .enex file, or a Markdown, HTML or text file.',
    );
  }

  let entries = await zipEntries(buffer);
  // Notion wraps big exports as a ZIP of ZIPs ("Part-1.zip", "Part-2.zip").
  const kept = entries.filter((e) => !ignored(e.segments));
  if (kept.length && kept.every((e) => extensionOf(e.path) === '.zip')) {
    const inner: ZipEntry[] = [];
    for (const zip of kept) inner.push(...(await zipEntries(await zip.read())));
    entries = inner;
  }

  const source = detectSource(entries);
  entries = entries.filter((e) => !ignored(e.segments));
  if (!entries.length) throw new ImportError('The ZIP has no notes in it.');

  // A ZIP of one folder (a zipped vault, "Takeout/") imports that folder.
  let rootName = baseName;
  for (let pass = 0; pass < 2; pass++) {
    const top = entries[0].segments[0];
    if (!entries.every((e) => e.segments.length > 1 && e.segments[0] === top))
      break;
    entries = entries.map((e) => ({
      ...e,
      segments: e.segments.slice(1),
      path: e.segments.slice(1).join('/'),
    }));
    if (top.toLowerCase() !== 'takeout') {
      rootName = cleanName(top) || rootName;
      break;
    }
  }
  if (
    source === 'notebooklm' &&
    entries.every(
      (e) =>
        e.segments[0]?.toLowerCase() === 'notebooklm' && e.segments.length > 1,
    )
  ) {
    entries = entries.map((e) => ({
      ...e,
      segments: e.segments.slice(1),
      path: e.segments.slice(1).join('/'),
    }));
    rootName = 'NotebookLM';
  }

  const parsed = await new Vault(entries).parse();
  return limitNotes({ source, rootName, ...parsed });
}

function limitNotes(parsed: ParsedImport): ParsedImport {
  if (parsed.notes.length <= MAX_IMPORT_NOTES) return parsed;
  const over = parsed.notes.slice(MAX_IMPORT_NOTES);
  return {
    ...parsed,
    notes: parsed.notes.slice(0, MAX_IMPORT_NOTES),
    skipped: [
      ...parsed.skipped,
      ...over.map((n) => ({
        name: n.title,
        reason: `One import adds at most ${MAX_IMPORT_NOTES} notes.`,
      })),
    ],
  };
}

// ── ZIP entries ──────────────────────────────────────────────────────────────

interface ZipEntry {
  path: string;
  segments: string[];
  date: Date;
  size: number;
  read: () => Promise<Buffer>;
}

async function zipEntries(buffer: Buffer): Promise<ZipEntry[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new ImportError("The file isn't a ZIP that can be read.");
  }
  const entries: ZipEntry[] = [];
  let unpacked = 0;
  zip.forEach((path, file) => {
    if (file.dir) return;
    // JSZip keeps the size from the ZIP's directory; reading a file checks it.
    const size =
      (file as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize ?? 0;
    unpacked += size;
    const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);
    entries.push({
      path: segments.join('/'),
      segments,
      date: file.date,
      size,
      read: () => file.async('nodebuffer'),
    });
  });
  if (unpacked > MAX_UNPACKED_BYTES) {
    throw new ImportError(
      `The ZIP unpacks to more than ${Math.round(MAX_UNPACKED_BYTES / MB)} MB. Split the export and import it in parts.`,
    );
  }
  return entries;
}

function ignored(segments: string[]): boolean {
  return (
    segments.some(
      (s) => s.startsWith('.') || IGNORED_NAMES.has(s.toLowerCase()),
    ) ||
    IGNORED_EXTENSIONS.has(extensionOf(segments[segments.length - 1] ?? ''))
  );
}

function detectSource(entries: ZipEntry[]): ImportSource {
  if (entries.some((e) => e.segments.includes('.obsidian'))) return 'obsidian';
  if (
    entries.some((e) =>
      e.segments.some((s) => s.toLowerCase() === 'notebooklm'),
    )
  ) {
    return 'notebooklm';
  }
  if (entries.some((e) => e.segments.some((s) => NOTION_ID.test(s))))
    return 'notion';
  if (entries.some((e) => extensionOf(e.path) === '.enex')) return 'evernote';
  return 'markdown';
}

// ── A folder of notes and files ────────────────────────────────────────────

interface NoteEntry {
  entry: ZipEntry;
  id: Types.ObjectId;
  title: string;
}

/**
 * Notes (Markdown, HTML, text, .enex) and the files around them. Links between
 * notes become links to the new notes; files a note links to or embeds become
 * its attachments; files nothing links to become notes of their own.
 */
class Vault {
  private readonly notes: NoteEntry[] = [];
  private readonly files: ZipEntry[] = [];
  private readonly notesByPath = new Map<string, NoteEntry>();
  private readonly notesByName = new Map<string, NoteEntry>();
  private readonly filesByPath = new Map<string, ZipEntry>();
  private readonly filesByName = new Map<string, ZipEntry>();
  private readonly usedFiles = new Set<string>();
  private readonly skipped: ImportSkip[] = [];

  constructor(private readonly entries: ZipEntry[]) {
    for (const entry of entries) {
      const ext = extensionOf(entry.path);
      const key = entry.path.toLowerCase();
      if (NOTE_EXTENSIONS.has(ext)) {
        const note: NoteEntry = {
          entry,
          id: new Types.ObjectId(),
          title:
            cleanName(stripExtension(baseNameOf(entry.path))) ||
            'Untitled note',
        };
        this.notes.push(note);
        this.notesByPath.set(key, note);
        this.notesByPath.set(stripExtension(key), note);
        for (const name of nameKeys(entry.path)) {
          if (!this.notesByName.has(name)) this.notesByName.set(name, note);
        }
      } else if (ext !== '.enex') {
        this.files.push(entry);
        this.filesByPath.set(key, entry);
        for (const name of nameKeys(entry.path, true)) {
          if (!this.filesByName.has(name)) this.filesByName.set(name, entry);
        }
      }
    }
  }

  async parse(): Promise<{ notes: ImportedNote[]; skipped: ImportSkip[] }> {
    const notes: ImportedNote[] = [];
    for (const note of this.notes) {
      try {
        notes.push(await this.parseNote(note));
      } catch (error) {
        this.skipped.push({
          name: note.entry.path,
          reason: error instanceof Error ? error.message : "Couldn't be read.",
        });
      }
    }

    // Evernote exports inside the ZIP: a folder per notebook.
    for (const entry of this.entries.filter(
      (e) => extensionOf(e.path) === '.enex',
    )) {
      try {
        const folder = [
          ...entry.segments.slice(0, -1).map(cleanName),
          cleanName(stripExtension(baseNameOf(entry.path))),
        ];
        notes.push(...parseEnex(decodeText(await entry.read()), folder));
      } catch (error) {
        this.skipped.push({
          name: entry.path,
          reason: error instanceof Error ? error.message : "Couldn't be read.",
        });
      }
    }

    // Files no note links to (NotebookLM sources, loose PDFs) become notes.
    for (const file of this.files) {
      if (this.usedFiles.has(file.path)) continue;
      if (file.size > MAX_ATTACHMENT_BYTES) {
        this.skipped.push({ name: file.path, reason: tooLarge() });
        continue;
      }
      const attachment = toAttachment(file);
      notes.push({
        id: new Types.ObjectId(),
        title: cleanName(stripExtension(attachment.name)) || attachment.name,
        content: `<p>${fillFilePlaceholders(filePlaceholder(0), [attachment])}</p>`,
        tags: [],
        folder: file.segments.slice(0, -1).map(cleanName),
        createdAt: file.date,
        updatedAt: file.date,
        attachments: [attachment],
      });
    }
    return { notes, skipped: this.skipped };
  }

  private async parseNote(note: NoteEntry): Promise<ImportedNote> {
    const { entry } = note;
    const ext = extensionOf(entry.path);
    const dir = entry.segments.slice(0, -1);
    const text = decodeText(await entry.read());
    const attachments: ImportAttachment[] = [];
    const attached = new Map<string, number>();
    const tags: string[] = [];
    let title = note.title;
    let category: string | undefined;
    let createdAt: Date | undefined;
    let updatedAt: Date | undefined = entry.date;

    /** Placeholder for a file attached to this note (each file once). */
    const attach = (file: ZipEntry): string | null => {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        this.skipped.push({ name: file.path, reason: tooLarge() });
        return null;
      }
      this.usedFiles.add(file.path);
      let n = attached.get(file.path);
      if (n === undefined) {
        n = attachments.push(toAttachment(file)) - 1;
        attached.set(file.path, n);
      }
      return filePlaceholder(n);
    };
    const attachData = (data: Buffer, name: string): string => {
      const n = attachments.push(toAttachment({ name, data })) - 1;
      return filePlaceholder(n);
    };

    let html: string;
    if (ext === '.md' || ext === '.markdown') {
      const { meta, body } = splitFrontMatter(text);
      title = firstString(meta.title) ?? title;
      category = firstString(meta.category);
      tags.push(...listOf(meta.tags), ...listOf(meta.tag));
      createdAt = dateOf(meta.created ?? meta.date ?? meta['date created']);
      updatedAt =
        dateOf(meta.updated ?? meta.modified ?? meta['date modified']) ??
        updatedAt;
      const markdown = this.obsidianSyntax(body, dir, attach, tags);
      html = markdownToHtml(markdown);
    } else if (ext === '.txt') {
      html = textToHtml(text);
    } else {
      const head = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1];
      if (head?.trim()) title = decodeEntities(head.trim());
      html = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(text)?.[1] ?? text;
    }

    html = this.resolveHtmlLinks(html, dir, attach, attachData);
    html = removeTitleHeading(html, title);
    const content = fillFilePlaceholders(
      sanitizeImportedHtml(html),
      attachments,
    );
    return {
      id: note.id,
      title: title.trim() || 'Untitled note',
      content,
      tags,
      category,
      folder: dir.map(cleanName),
      createdAt: createdAt ?? entry.date,
      updatedAt,
      attachments,
    };
  }

  /** Obsidian's wiki links, embeds, comments and #tags, as plain Markdown. */
  private obsidianSyntax(
    markdown: string,
    dir: string[],
    attach: (file: ZipEntry) => string | null,
    tags: string[],
  ): string {
    // Code blocks are left exactly as written.
    return markdown
      .split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$)/m)
      .map((part, i) => {
        if (i % 2 === 1) return part;
        let text = part.replace(/%%[\s\S]*?%%/g, '');
        text = text.replace(
          /!\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g,
          (match, target: string, alias?: string) => {
            const found = this.resolve(dir, target.trim());
            if (found?.kind === 'file')
              return attach(found.file) ?? alias ?? target;
            if (found?.kind === 'note')
              return mdLink(found.note, alias || found.note.title);
            return alias || target;
          },
        );
        text = text.replace(
          /\[\[([^\]|#^]+)([#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g,
          (match, target: string, anchor?: string, alias?: string) => {
            const label =
              alias ||
              `${target.trim()}${anchor && anchor.startsWith('#') ? ` › ${anchor.slice(1)}` : ''}`;
            const found = this.resolve(dir, target.trim());
            if (found?.kind === 'note') return mdLink(found.note, label);
            if (found?.kind === 'file') return attach(found.file) ?? label;
            return label;
          },
        );
        for (const match of text.matchAll(
          /(?:^|[\s(])#([\p{L}_][\p{L}\p{N}_/-]*)/gu,
        )) {
          tags.push(match[1].replace(/\//g, '-'));
        }
        return text;
      })
      .join('');
  }

  /** Relative links and images in HTML: to the new notes, or attached files. */
  private resolveHtmlLinks(
    html: string,
    dir: string[],
    attach: (file: ZipEntry) => string | null,
    attachData: (data: Buffer, name: string) => string,
  ): string {
    let images = 0;
    const withImages = html.replace(
      /<img\b([^>]*)>/gi,
      (match, attrs: string) => {
        const src = decodeEntities(attr(attrs, 'src') ?? '');
        const alt = decodeEntities(attr(attrs, 'alt') ?? '').trim();
        const data = /^data:([\w/+.-]+);base64,(.+)$/i.exec(src);
        if (data) {
          const ext =
            data[1]
              .split('/')[1]
              ?.replace('jpeg', 'jpg')
              .replace(/\+.*$/, '') || 'bin';
          return attachData(
            Buffer.from(data[2], 'base64'),
            `image-${++images}.${ext}`,
          );
        }
        if (/^https?:/i.test(src)) {
          return `<a href="${escapeHtml(src)}">${escapeHtml(alt || 'Image')}</a>`;
        }
        const found = src ? this.resolve(dir, src) : null;
        if (found?.kind === 'file')
          return attach(found.file) ?? escapeHtml(alt);
        return escapeHtml(alt);
      },
    );

    return withImages.replace(
      /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
      (match, attrs: string, inner: string) => {
        const href = decodeEntities(attr(attrs, 'href') ?? '');
        if (!href || href.startsWith('#')) return inner;
        if (href.startsWith('/notes/') || /^[a-z][\w+.-]*:/i.test(href))
          return match;
        const found = this.resolve(dir, href);
        if (found?.kind === 'note')
          return noteLinkHtml(
            found.note.id.toHexString(),
            stripTags(inner) || found.note.title,
          );
        if (found?.kind === 'file') return attach(found.file) ?? inner;
        return inner;
      },
    );
  }

  /** A link target: a path relative to the note, from the top, or (Obsidian) just a name. */
  private resolve(
    dir: string[],
    target: string,
  ):
    | { kind: 'note'; note: NoteEntry }
    | { kind: 'file'; file: ZipEntry }
    | null {
    let path = target.split(/[?#]/)[0].trim();
    try {
      path = decodeURIComponent(path);
    } catch {
      // Not URL-encoded
    }
    if (!path) return null;
    const candidates = [joinPath(dir, path), joinPath([], path)].filter(
      (p): p is string => Boolean(p),
    );
    for (const candidate of candidates) {
      const key = candidate.toLowerCase();
      const note =
        this.notesByPath.get(key) ?? this.notesByPath.get(`${key}.md`);
      if (note) return { kind: 'note', note };
      const file = this.filesByPath.get(key);
      if (file) return { kind: 'file', file };
    }
    const name = baseNameOf(path).toLowerCase();
    const file = this.filesByName.get(name);
    if (file && extensionOf(name)) return { kind: 'file', file };
    const note =
      this.notesByName.get(stripExtension(name)) ?? this.notesByName.get(name);
    if (note) return { kind: 'note', note };
    return null;
  }
}

function mdLink(note: NoteEntry, text: string): string {
  return `[${text.replace(/[[\]]/g, '')}](/notes/${note.id.toHexString()})`;
}

function toAttachment(
  file: ZipEntry | { name: string; data: Buffer },
): ImportAttachment {
  const name =
    'data' in file
      ? safeAttachmentName(file.name)
      : safeAttachmentName(cleanName(baseNameOf(file.path)));
  return {
    id: `${Date.now()}-${Math.round(Math.random() * 1e9)}-${name}`,
    name,
    read: 'data' in file ? () => Promise.resolve(file.data) : file.read,
  };
}

const tooLarge = () =>
  `Larger than ${Math.round(MAX_ATTACHMENT_BYTES / MB)} MB, the most one attachment can be.`;

// ── Small helpers ────────────────────────────────────────────────────────────

/** YAML front matter: `key: value`, `key: [a, b]` and `key:` + `- item` lists. */
export function splitFrontMatter(text: string): {
  meta: Record<string, string | string[]>;
  body: string;
} {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(
    text,
  );
  if (!match) return { meta: {}, body: text };
  const meta: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    const item =
      /^\s+-\s+(.*)$/.exec(line) ?? (listKey ? /^-\s+(.*)$/.exec(line) : null);
    if (item && listKey) {
      const list = meta[listKey];
      (Array.isArray(list) ? list : (meta[listKey] = [])).push(
        unquote(item[1]),
      );
      continue;
    }
    const pair = /^([\w][\w -]*?)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    const key = pair[1].toLowerCase();
    const value = pair[2].trim();
    listKey = value ? null : key;
    if (!value) meta[key] = [];
    else if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value.slice(1, -1).split(',').map(unquote).filter(Boolean);
    } else meta[key] = unquote(value);
  }
  return { meta, body: text.slice(match[0].length) };
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.startsWith('"') && v.endsWith('"')) {
    try {
      return String(JSON.parse(v));
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.startsWith("'") && v.endsWith("'"))
    return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

function firstString(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v?.trim() || undefined;
}

function listOf(value: string | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return value.split(/[,\s]+/).filter(Boolean);
}

function dateOf(value: string | string[] | undefined): Date | undefined {
  const text = firstString(value);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** The note's own title repeated as its first heading (Notion, our export). */
function removeTitleHeading(html: string, title: string): string {
  const first = /^\s*<h1\b[^>]*>([\s\S]*?)<\/h1>\s*/i.exec(html);
  if (!first) return html;
  const heading = decodeEntities(stripTags(first[1])).trim().toLowerCase();
  return heading === title.trim().toLowerCase()
    ? html.slice(first[0].length)
    : html;
}

function attr(attrs: string, name: string): string | undefined {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  ).exec(attrs);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function decodeText(buffer: Buffer): string {
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

function baseNameOf(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path;
}

function extensionOf(path: string): string {
  const name = baseNameOf(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** A file or folder name without Notion's page id. */
export function cleanName(name: string): string {
  return name.replace(NOTION_ID, '').replace(/\s+/g, ' ').trim();
}

/** Lookup keys for a name: as written and without Notion's id. */
function nameKeys(path: string, keepExtension = false): string[] {
  const base = baseNameOf(path).toLowerCase();
  const name = keepExtension ? base : stripExtension(base);
  return [...new Set([name, cleanName(name)])];
}

/** `target` relative to `dir`, normalised; null when it leaves the archive. */
function joinPath(dir: string[], target: string): string | null {
  const parts = target.startsWith('/') ? [] : [...dir];
  for (const part of target.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}
