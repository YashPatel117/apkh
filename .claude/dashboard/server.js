#!/usr/bin/env node
// Agent activity dashboard server. No dependencies.
//   node .claude/dashboard/server.js           → http://localhost:4317
//   node .claude/dashboard/server.js --open    → also opens the browser
//   DASH_PORT=5000 node .claude/dashboard/server.js
// Reads .claude/activity/events.jsonl (written by .claude/hooks/log-activity.js).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = Number(process.env.DASH_PORT) || 4317;
const OPEN = process.argv.includes('--open');
const root = path.resolve(__dirname, '..', '..');
const logFile = path.join(root, '.claude', 'activity', 'events.jsonl');
const ownershipFile = path.join(root, '.claude', 'ownership.json');
const page = path.join(__dirname, 'index.html');
const url = `http://localhost:${PORT}`;

function openBrowser() {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function readFrom(offset) {
  let size = 0;
  try { size = fs.statSync(logFile).size; } catch { return { offset: 0, events: [], reset: offset > 0 }; }
  if (offset > size) offset = 0; // file was cleared → start over
  const reset = offset === 0;
  if (offset === size) return { offset, events: [], reset: false };

  const fd = fs.openSync(logFile, 'r');
  const buf = Buffer.alloc(size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);

  const lastNl = buf.lastIndexOf(0x0a);
  if (lastNl < 0) return { offset, events: [], reset: false }; // partial line, wait
  const text = buf.subarray(0, lastNl + 1).toString('utf8');
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* skip bad line */ }
  }
  return { offset: offset + lastNl + 1, events, reset };
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, url);
  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    fs.createReadStream(page).pipe(res);
    return;
  }
  if (u.pathname === '/api/events') {
    const from = Number(u.searchParams.get('from')) || 0;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(readFrom(from)));
    return;
  }
  if (u.pathname === '/api/config') {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(ownershipFile, 'utf8')); } catch { /* not configured yet */ }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(cfg));
    return;
  }
  res.writeHead(404); res.end('not found');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Dashboard already running at ${url}`);
    if (OPEN) openBrowser();
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Agent dashboard: ${url}`);
  console.log(`Reading: ${logFile}`);
  if (OPEN) openBrowser();
});
