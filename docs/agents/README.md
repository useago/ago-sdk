# AGO skills for coding agents

Each file here is a self-contained skill: the full set of instructions a coding
agent (Cursor, Claude Code, GitHub Copilot, Windsurf, ...) needs to integrate AGO
into one framework. Point your agent at the file that matches your stack and ask
it to "add AGO chat". Each file is standalone, so one link is enough.

| Stack | Skill file |
| ----- | ---------- |
| React | [`ago-react.md`](ago-react.md) |
| Vue 3 | [`ago-vue.md`](ago-vue.md) |
| Angular | [`ago-angular.md`](ago-angular.md) |
| Plain JavaScript / TypeScript | [`ago-vanilla.md`](ago-vanilla.md) |
| Embeddable `<script>` widget | [`ago-widget.md`](ago-widget.md) |

## How to link one to your agent

Give your agent the raw URL of the file for your stack. The raw form on GitHub is:

```
https://raw.githubusercontent.com/useago/ago-sdk/main/docs/agents/ago-react.md
```

(swap `ago-react.md` for your stack).

- **Cursor**: paste the raw URL in the chat, or add it under
  Settings > Indexing & Docs so `@AGO` is always available.
- **Claude Code / CLI agents**: paste the raw URL, or save the file into the repo
  (e.g. `AGENTS.md` or `.cursor/rules/`) so it loads every session.
- **Copilot / Windsurf**: drop the file into the repo and reference it in your
  prompt.

Or just copy the file's contents straight into your prompt.

## Notes

- Runnable snippets point at the live demo (`https://playground.api.useago.com`,
  agent `generic-guide`) so they answer with zero setup. Swap in
  `https://YOUR-DOMAIN.api.useago.com` and your own agent slug for your tenant.
- These skills are condensed for an agent. The human-readable guides live in
  [`../frameworks/`](../frameworks/) and [`../general/`](../general/).
