import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { ApkhClient, ApiResult } from '../client.js';
import {
  formatNote,
  formatSearch,
  type CreatedNote,
  type NoteResponse,
  type SearchResponse,
} from '../format.js';

const objectId = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, 'A note id is 24 hex characters, as returned by search_notes');

const text = (value: string): CallToolResult => ({
  content: [{ type: 'text', text: value }],
});

const failure = (error: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: error }],
});

function respond<T>(
  result: ApiResult<unknown>,
  format: (data: T) => string,
): CallToolResult {
  return result.ok ? text(format(result.data as T)) : failure(result.error);
}

/** search_notes, get_note, create_note: the Knowledge Hub's notes. */
export function registerNoteTools(server: McpServer, api: ApkhClient) {
  server.registerTool(
    'search_notes',
    {
      title: 'Search notes',
      description:
        "Search the user's personal Knowledge Hub: their notes and the text of attached files (PDFs, documents, images). " +
        'Hybrid search: by meaning and by exact keywords. Use it whenever the user asks about their notes, ' +
        'past decisions, meetings, plans, saved articles or documents, or says "my notes". ' +
        'Returns ranked passages with their note_id; call get_note for a whole note. ' +
        'If nothing matches, try again with different words.',
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(4000)
          .describe('What to look for: a question or keywords'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe('How many passages to return (default 8)'),
        note_ids: z
          .array(objectId)
          .max(50)
          .optional()
          .describe('Only search inside these notes'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, limit, note_ids }) =>
      respond<SearchResponse>(
        await api.post('/integrations/mcp/search', {
          query,
          limit,
          noteIds: note_ids,
        }),
        formatSearch,
      ),
  );

  server.registerTool(
    'get_note',
    {
      title: 'Get note',
      description:
        'Read one note from the Knowledge Hub in full, as Markdown, by the note_id that search_notes returned. ' +
        'Very long notes are cut at 40,000 characters.',
      inputSchema: {
        note_id: objectId.describe('The note_id from search_notes'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ note_id }) =>
      respond<NoteResponse>(
        await api.get(`/integrations/mcp/notes/${note_id}`),
        formatNote,
      ),
  );

  server.registerTool(
    'create_note',
    {
      title: 'Create note',
      description:
        "Save a new note to the user's Knowledge Hub. Only use it when the user asks to save, note down or remember something. " +
        'Content is Markdown. A missing title or category is filled in by the Knowledge Hub. ' +
        'The note is indexed in the background and becomes searchable within seconds.',
      inputSchema: {
        content: z.string().min(1).max(2_000_000).describe('The note, in Markdown'),
        title: z.string().max(300).optional().describe('Title (optional)'),
        category: z
          .string()
          .max(100)
          .optional()
          .describe('Category, e.g. "AI Insights" or "Meetings" (optional)'),
        url: z
          .url({ protocol: /^https?$/ })
          .max(2000)
          .optional()
          .describe('Source web page, added as a source line (optional)'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ content, title, category, url }) =>
      respond<CreatedNote>(
        await api.post('/integrations/notes', {
          content,
          format: 'markdown',
          title,
          category,
          url,
        }),
        (note) => `Saved the note "${note.title}" (note_id: ${note.id}).`,
      ),
  );
}
