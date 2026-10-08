// End-to-end check over real MCP (stdio), as Claude Code would talk to it:
//   APKH_TOKEN=apkh_… npm run smoke -- "a query" [--create]
// Lists the tools, runs search_notes, opens the top result with get_note and,
// with --create, saves a test note.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const create = args.includes('--create');
const query = args.find((a) => !a.startsWith('--')) ?? 'meeting';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))],
  env: { ...process.env },
  stderr: 'inherit',
});
const client = new Client({ name: 'apkh-smoke', version: '0.0.0' });
await client.connect(transport);

const show = (label, result) => {
  console.log(`\n── ${label}${result.isError ? ' (isError)' : ''} ──`);
  for (const block of result.content) if (block.type === 'text') console.log(block.text);
};

const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));

const search = await client.callTool({ name: 'search_notes', arguments: { query, limit: 3 } });
show(`search_notes "${query}"`, search);

const id = search.content[0]?.text?.match(/note_id: ([a-f0-9]{24})/)?.[1];
if (id) {
  const note = await client.callTool({ name: 'get_note', arguments: { note_id: id } });
  const text = note.content[0]?.text ?? '';
  show('get_note', { ...note, content: [{ type: 'text', text: text.length > 1200 ? `${text.slice(0, 1200)}\n…` : text }] });
}

const bad = await client.callTool({ name: 'get_note', arguments: { note_id: 'f'.repeat(24) } });
show('get_note (unknown id)', bad);

if (create) {
  const created = await client.callTool({
    name: 'create_note',
    arguments: {
      title: 'MCP smoke test',
      category: 'AI Insights',
      content: '# MCP smoke test\n\nSaved by `apkh-mcp` over **MCP**. Safe to delete.',
    },
  });
  show('create_note', created);
}

await client.close();
