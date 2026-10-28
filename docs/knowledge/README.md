# Knowledge base

The short, committed memory that build agents (`.claude/agents/`) and Director's runtime agents
(`services/director-worker/agents/`) read **before** the long status files. It exists so a session
or a run starts from what earlier sessions learned, instead of re-learning it from 35,000 lines of
`docs/status/` or from someone's personal notes. Decided in
[ADR-0009](../director/DECISIONS/0009-repair-agents-families-knowledge.md).

It does not replace the other surfaces (`docs/status/README.md`): a status file still holds a
tool's full current state and its dated changes. This folder holds the distilled part: what we are
aiming at, what is always true, and what went wrong and how it was fixed.

## Layout

| Path | Holds | Line budget |
|---|---|---|
| [`targets.md`](targets.md) | What the pipeline is for, who it serves, the standing decisions and the non-negotiables | 120 |
| `families/<family>.md` | One per game-type build agent (`lines`, `ways`, `cluster`, `scatter`, `hold-and-win`, `bonus-games`, `match3`, `arcade`, `card`): its invariants, where its code lives, its known failure modes, how to test it | 200 |
| `games/<project>.md` | One per live game: its client, what it must be, its kind and add-ons, its playbook | 80 |
| `lessons/<area>.md` | Lessons for one area, newest first, each **symptom → cause → fix → guard → PR** in 8 lines or fewer | 300 |
| [`owners.json`](owners.json) | Which build agents own each launcher tool and each game kind, and the known gaps | — |

`check:agents-knowledge` (`scripts/check-agents-knowledge.mjs`) holds every file to its budget,
and holds the build agents and `owners.json` to the code. When a file is over budget, fold its
oldest entries into the rule or gate they produced. Never raise the budget.

## Writing a lesson

A pull request that fixes a bug carries a `## Lesson` block in its description:

```
## Lesson
- Area: editor            (the lessons/<area>.md it belongs in)
- Symptom: what a person saw, in their words
- Cause: the real cause, with the file
- Fix: what changed
- Guard: the gate, fixture or rule that now catches it (or "none")
```

After the merge, `docs-keeper` (or `historian` for Director work) folds it into
`lessons/<area>.md`. A lesson whose symptom is already there updates that entry instead of adding
one. Only merged fixes become lessons.

## Who reads what

- **Build agents:** `targets.md` and their own family or area file come first in "Read first", before
  the status file.
- **Runtime agents:** the run's family pack (`services/director-worker/families/<family>.md`), as
  a second cached system block after the agent's definition (ADR-0009 §4). The pack is the one
  home of what runtime agents read about a family; the `families/` files here link to it rather
  than repeat it. `targets.md` does not reach a runtime prompt yet. Text that reaches a runtime
  prompt is a pipeline change and goes through the Agents tab evaluation.
