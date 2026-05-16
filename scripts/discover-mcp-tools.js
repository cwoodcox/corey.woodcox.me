#!/usr/bin/env node
// Discovers MCP tool registrations from GitHub repos tagged `mcp-server`
// under user `cwoodcox`. Writes src/data/mcp-tools.json.
//
// Usage: node scripts/discover-mcp-tools.js
// Requires: gh (authenticated), git
//
// Parses the @modelcontextprotocol/sdk TypeScript/JavaScript patterns:
//   server.tool("name", ...)                           — positional name, no title
//   server.registerTool("name", { title: "..." }, ...) — name + optional title
//
// The `server.` prefix is matched with optional method-chain (so `this.server.tool`
// and `mcp.server.tool` also work). Files under node_modules/dist/build are skipped.

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../src/data/mcp-tools.json');
const OWNER = 'cwoodcox';
const TOPIC = 'mcp-server';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function discoverRepos() {
  const json = sh(`gh repo list ${OWNER} --topic ${TOPIC} --no-archived --limit 100 --json name,pushedAt`);
  return JSON.parse(json)
    .sort((a, b) => (a.pushedAt < b.pushedAt ? 1 : -1))
    .map((r) => r.name);
}

function findMatchingBrace(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractTools(src) {
  const tools = [];
  const registerSpans = [];

  // `server.registerTool("name", { ... title: "..." ... }, handler)`
  const registerRe = /\bserver\s*\.\s*registerTool\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*\{/g;
  let m;
  while ((m = registerRe.exec(src)) !== null) {
    const braceIdx = src.indexOf('{', m.index);
    const closeIdx = findMatchingBrace(src, braceIdx);
    if (closeIdx === -1) continue;
    const body = src.slice(braceIdx + 1, closeIdx);
    const titleMatch = body.match(/\btitle\s*:\s*['"`]([^'"`]+)['"`]/);
    tools.push(titleMatch ? { name: m[1], title: titleMatch[1] } : { name: m[1] });
    registerSpans.push([m.index, closeIdx]);
  }

  // `server.tool("name", ...)` — skip ranges already claimed by registerTool
  const inRegister = (idx) => registerSpans.some(([s, e]) => idx >= s && idx <= e);
  const toolRe = /\bserver\s*\.\s*tool\s*\(\s*['"`]([^'"`]+)['"`]/g;
  while ((m = toolRe.exec(src)) !== null) {
    if (inRegister(m.index)) continue;
    tools.push({ name: m[1] });
  }

  return tools;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', '.turbo']);

function walkSourceFiles(root) {
  const out = [];
  function rec(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP_DIRS.has(ent.name)) continue;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) rec(p);
      else if (/\.(ts|tsx|js|mjs|cjs)$/.test(ent.name)) out.push(p);
    }
  }
  rec(root);
  return out.sort();
}

function processRepo(name) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `mcp-discover-${name}-`));
  try {
    const r = spawnSync(
      'gh',
      ['repo', 'clone', `${OWNER}/${name}`, tmp, '--', '--depth=1', '--quiet'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (r.status !== 0) {
      console.warn(`  clone failed: ${r.stderr.toString().trim() || `exit ${r.status}`}`);
      return null;
    }
    const seen = new Set();
    const tools = [];
    for (const f of walkSourceFiles(tmp)) {
      for (const t of extractTools(fs.readFileSync(f, 'utf8'))) {
        if (seen.has(t.name)) continue;
        seen.add(t.name);
        tools.push(t);
      }
    }
    return tools;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const repos = discoverRepos();
console.log(`Found ${repos.length} repo(s) tagged \`${TOPIC}\` under ${OWNER}`);

const out = {};
for (const name of repos) {
  process.stdout.write(`  ${name}: `);
  const tools = processRepo(name);
  if (tools === null) continue;
  out[name] = tools;
  console.log(`${tools.length} tool${tools.length === 1 ? '' : 's'}`);
}

// Sort keys alphabetically for stable diffs
const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2) + '\n');
console.log(`Wrote ${path.relative(process.cwd(), OUT)}`);
