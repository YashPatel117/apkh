#!/usr/bin/env node
// agent-kit hook: appends one line per event to .claude/activity/events.jsonl
// Registered in .claude/settings.json for: SessionStart, UserPromptSubmit, PreToolUse,
// PostToolUse, SubagentStart, SubagentStop, Stop.
// Must never block Claude: always exits 0 and prints nothing.

const fs = require('fs');
const path = require('path');

const MAX = 300; // max chars kept for any detail string

function main(raw) {
  let p;
  try { p = JSON.parse(raw); } catch { return; }

  const root = process.env.CLAUDE_PROJECT_DIR || p.cwd || process.cwd();
  const dir = path.join(root, '.claude', 'activity');
  fs.mkdirSync(dir, { recursive: true });
  const logFile = path.join(dir, 'events.jsonl');
  const stateFile = path.join(dir, 'state.json');

  const state = readJson(stateFile) || { sessions: {}, agents: {} };
  const sid = p.session_id || 'unknown';
  const ev = p.hook_event_name;
  const now = new Date().toISOString();
  let stateChanged = false;

  state.sessions[sid] = state.sessions[sid] || { task: null, n: 0 };
  const sess = state.sessions[sid];

  // ---- new task on each user prompt ----
  if (ev === 'UserPromptSubmit' || !sess.task) {
    sess.n += 1;
    sess.task = `${sid.slice(0, 8)}-${sess.n}-${Date.now().toString(36)}`;
    stateChanged = true;
  }

  // ---- who is acting? ----
  const agentId = p.agent_id || null;
  let agent = p.agent_type || null;
  let task = sess.task;

  if (agentId) {
    const known = state.agents[agentId];
    if (known) {
      agent = agent || known.type;
      task = known.task; // background agents keep their original task
    } else if (ev === 'SubagentStart' || agent) {
      state.agents[agentId] = { type: agent || 'subagent', task: sess.task, start: now };
      stateChanged = true;
    }
  }

  const input = p.tool_input || {};
  const file = rel(root, input.file_path || input.notebook_path || input.path);
  let inferred = false;
  if (!agent && agentId) {
    const guess = inferAgent(root, file);
    if (guess) { agent = guess; inferred = true; }
  }
  agent = agent || (agentId ? 'subagent' : 'main');

  const rec = { ts: now, session: sid, task, event: ev, agent, agentId, inferred: inferred || undefined };

  switch (ev) {
    case 'UserPromptSubmit':
      rec.prompt = trunc(p.prompt, 2000);
      break;
    case 'SessionStart':
      rec.source = p.source;
      break;
    case 'PreToolUse':
    case 'PostToolUse': {
      rec.tool = p.tool_name;
      rec.toolUseId = p.tool_use_id;
      rec.detail = describe(p.tool_name, input, root);
      if (file) rec.file = file;
      if (p.tool_name === 'Agent' || p.tool_name === 'Task') {
        rec.spawn = {
          type: input.subagent_type || 'general-purpose',
          description: trunc(input.description, 200),
          background: !!input.run_in_background,
        };
      }
      if (ev === 'PostToolUse') {
        const r = p.tool_response;
        rec.ok = !(r && typeof r === 'object' && (r.is_error || r.error || r.interrupted));
        if (!rec.ok) rec.error = trunc(typeof r.error === 'string' ? r.error : JSON.stringify(r), MAX);
        if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(p.tool_name) && file) rec.changed = file;
      }
      break;
    }
    case 'SubagentStart':
      rec.agentType = p.agent_type;
      break;
    case 'SubagentStop':
      rec.agentType = p.agent_type || (state.agents[agentId] && state.agents[agentId].type);
      rec.summary = trunc(p.last_assistant_message || p.result, 1500);
      if (agentId && state.agents[agentId]) {
        state.agents[agentId].end = now;
        stateChanged = true;
      }
      break;
    case 'Stop':
      rec.summary = trunc(p.last_assistant_message, 1500);
      break;
  }

  fs.appendFileSync(logFile, JSON.stringify(rec) + '\n');

  if (stateChanged) {
    const cutoff = Date.now() - 86400000; // drop agents finished more than a day ago
    for (const [id, a] of Object.entries(state.agents)) {
      if (a.end && Date.parse(a.end) < cutoff) delete state.agents[id];
    }
    fs.writeFileSync(stateFile, JSON.stringify(state));
  }
}

function describe(tool, i, root) {
  switch (tool) {
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit':
      return rel(root, i.file_path || i.notebook_path);
    case 'Bash': case 'PowerShell':
      return trunc(i.description ? `${i.description} — ${i.command}` : i.command, MAX);
    case 'Grep':
      return trunc(`/${i.pattern}/ ${rel(root, i.path) || ''} ${i.glob || ''}`, MAX);
    case 'Glob':
      return trunc(`${i.pattern} ${rel(root, i.path) || ''}`, MAX);
    case 'Agent': case 'Task':
      return trunc(`${i.subagent_type || 'agent'}: ${i.description || ''}`, MAX);
    case 'WebFetch':
      return trunc(i.url, MAX);
    case 'WebSearch':
      return trunc(i.query, MAX);
    case 'Skill':
      return trunc(`${i.skill} ${i.args || ''}`, MAX);
    default:
      return trunc(JSON.stringify(i), 150);
  }
}

// Fallback when a tool call comes from a subagent whose name the hook didn't receive:
// match the file against .claude/ownership.json (written by /setup-agents).
function inferAgent(root, f) {
  if (!f) return null;
  const cfg = readJson(path.join(root, '.claude', 'ownership.json'));
  if (!cfg || !cfg.agents) return null;
  let best = null, bestLen = -1;
  for (const [name, globs] of Object.entries(cfg.agents)) {
    for (const g of globs || []) {
      if (globToRegex(g).test(f)) {
        const literal = g.split(/[*?[]/)[0].length; // most specific pattern wins
        if (literal > bestLen) { best = name; bestLen = literal; }
      }
    }
  }
  return best;
}

function globToRegex(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { re += g[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += g[i + 2] === '/' ? 2 : 1; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

function rel(root, f) {
  if (!f || typeof f !== 'string') return undefined;
  const r = path.relative(root, f);
  return (r && !r.startsWith('..') && !path.isAbsolute(r) ? r : f).replace(/\\/g, '/');
}

function trunc(s, n) {
  if (s == null) return undefined;
  s = String(s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function readJson(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (buf += c));
process.stdin.on('end', () => {
  try { main(buf); } catch { /* never block Claude */ }
  process.exit(0);
});
