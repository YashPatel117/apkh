#!/usr/bin/env node
/**
 * apkh-mcp: the Knowledge Hub as MCP tools, over stdio.
 *
 * stdout carries the protocol, so nothing else may be written to it: log with
 * console.error only.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApkhClient, configFromEnv } from './client.js';
import { registerNoteTools } from './tools/notes.js';

const VERSION = '0.1.0';

const config = configFromEnv();
const api = new ApkhClient(config);

const server = new McpServer(
  { name: 'apkh', title: 'Personal Knowledge Hub', version: VERSION },
  {
    instructions:
      "Tools for the user's personal Knowledge Hub (notes and their attachments). " +
      'Use search_notes to find information in their notes before answering questions about their own work, ' +
      'meetings, plans or saved documents, and cite the note titles you used. ' +
      'Use get_note to read a whole note, and create_note only when the user asks to save something.',
  },
);

registerNoteTools(server, api);

await server.connect(new StdioServerTransport());
console.error(
  `apkh-mcp ${VERSION} ready · API ${config.baseUrl}` +
    (config.token ? '' : ' · APKH_TOKEN is not set: every tool will ask for it'),
);
