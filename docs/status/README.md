# Per-tool status — the model

Each pipeline tool / area has ONE status file here: `docs/status/<slug>.md`. It is the
**living current state** of that tool — what works, what's broken, what's next — and it is
the file you update when you finish work on that tool.

This directory exists because `docs/STATUS.md` kept re-growing into a giant chronological
changelog: with no per-tool home for "current state", every change got appended to one
global file and the state of any single tool became impossible to find. The split fixes
that at the root.

## The four surfaces per tool — one fact, one home (no repetition)

| Surface | Owns (single source of truth) | Changes |
|---|---|---|
| `docs/design/<tool>.md` | The **plan** — architecture, build-plan steps, the "why". | Rarely |
| `docs/tools/<tool>.md` | The **user guide** — how to operate the tool's UI (CLAUDE.md rule 9). | On UI change |
| `docs/status/<tool>.md` | The **current state** — done / broken / next, + a short recent-changes list. | Often |
| `.claude/agents/<tool>.md` | **Pointers only** — "read design + status; here's the code map + house rules." | Rarely |

Plus two shared files:
- `docs/STATUS.md` — a **slim global index**: cross-cutting/roadmap state + a table linking
  every tool to its three docs. It never restates a tool's per-file facts.
- `docs/history.md` — the **append-only done-work log** (verbose, newest-first). When a
  status file's "Recent changes" list gets long, the old detail moves here.

**The rule that prevents drift:** a fact lives in exactly one surface. The agent prompt and
the global STATUS.md **link**, they never copy. Progress detail belongs in the status file
(or history), NOT restated in the design doc — the design doc keeps the plan, the status
file keeps how far the plan got.

## Status-file template

```markdown
# <Tool name> — status

> Design: [docs/design/<tool>.md](../design/<tool>.md) · Guide: [docs/tools/<tool>.md](../tools/<tool>.md) · Agent: `.claude/agents/<agent>.md`

**One-line state:** <shipped / in-progress / blocked — the single most important fact>

## Current state
<What actually works today on `main`. Bullet the shipped capabilities. Note the ⏳
live-verify caveats that are still open. Link the design-doc phase when useful.>

## Open items / next
1. <Prioritized, genuinely-unbuilt next steps. Keep the top item actionable.>

## Blocked (owner / external)
- <Anything waiting on the owner or an external dependency, if any.>

## Recent changes
- YYYY-MM-DD — <one-line summary> ([detail in history](../history.md))
```

Keep "Recent changes" to a handful of the latest, one line each. Push older verbose entries
to `docs/history.md`.
