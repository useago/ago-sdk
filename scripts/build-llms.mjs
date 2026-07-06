// Build a single, skill-oriented doc for coding agents: llms-full.txt.
// Goal: an agent (Cursor, Claude Code, Copilot, ...) reads ONE link and knows
// what to do (the per-stack skills) plus enough concept doc to understand AGO.
// Published in the npm package, so the link is public:
//   https://unpkg.com/@useago/sdk/llms-full.txt
// Run with `npm run build:llms` (also runs as part of `npm run build`).
//
// Deliberately NOT a dump of every markdown file. README, docs/frameworks/* and
// several docs/general/* pages restate the same install/provider/hooks content
// the skills already carry, so including them would duplicate everything 3-5x.
// We keep: the self-contained skills + the cross-cutting concept guides they
// reference but do not fully inline.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'llms-full.txt');

// The "what to do" layer: one self-contained skill per stack.
const skills = [
  'docs/agents/ago-widget.md',
  'docs/agents/ago-vanilla.md',
  'docs/agents/ago-react.md',
  'docs/agents/ago-vue.md',
  'docs/agents/ago-angular.md',
];

// The "understand it" layer: cross-cutting concepts the skills reference but
// keep terse. Stack-agnostic, so they don't duplicate the per-stack skills.
const concepts = [
  'docs/general/functions-and-context.md',
  'docs/general/events-and-streaming.md',
  'docs/general/configuration.md',
];

const header = `# AGO SDK (@useago/sdk) — coding-agent guide

Single-file guide for a coding agent (Cursor, Claude Code, Copilot, Windsurf, ...)
integrating AGO chat into an app. It has two parts:

1. SKILLS — one self-contained section per stack. Jump to the one that matches
   the project, follow it exactly. Each is everything you need to wire AGO in.
2. CONCEPTS — cross-cutting reference (functions/context, events/streaming,
   configuration) to understand what the skills do.

Pick your stack:
- Embeddable <script> widget, no build step -> "AGO SDK skill: Widget"
- Plain JavaScript / TypeScript          -> "AGO SDK skill: Vanilla"
- React                                   -> "AGO SDK skill: React"
- Vue 3                                   -> "AGO SDK skill: Vue"
- Angular                                 -> "AGO SDK skill: Angular"

Runnable snippets hit the live demo (baseUrl https://playground.api.useago.com,
agent generic-guide) so they work with zero setup. For a real tenant, swap in
https://YOUR-DOMAIN.api.useago.com and your own agent slug, and read baseUrl from
an env var (never hardcode a tenant URL).

Source: https://github.com/useago/ago-sdk
`;

function section(rel) {
  const body = readFileSync(join(root, rel), 'utf8').trim();
  return `<!-- source: ${rel} -->\n\n${body}`;
}

const parts = [
  header.trim(),
  '# SKILLS',
  ...skills.map(section),
  '# CONCEPTS',
  ...concepts.map(section),
];

writeFileSync(out, `${parts.join('\n\n---\n\n')}\n`);
console.log(`Wrote llms-full.txt (${skills.length} skills + ${concepts.length} concepts)`);
