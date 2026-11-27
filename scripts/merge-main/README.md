# scripts/merge-main — Resolve conflict's job code

The code of a Resolve conflict run (ADR-0015 §2–§4, §10; card 15B1). `merge-main.yml` (card 15B2)
calls it and stays thin. Built-ins only; every entry point runs from the pristine copy of `main`
(`$RUNNER_TEMP/main`), never from the branch or the model's workspace. The headers of `merge.mjs` and
`collect.mjs` are the reference; this page is the wiring.

| File                     | What                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `merge.mjs`              | Job `merge`: the merge path by path, the §3 rules, the §4 refusals the job checks, the `merge` record                    |
| `collect.mjs`            | Job `propose`: `stage` before the model, `result` after it (§10's body, POSTed with OIDC)                                |
| `merge-main.fixture.mjs` | `pnpm check:merge-main`: every rule and refusal on scratch repos, collect's guards, the §10 shape, both steps end to end |

`coordinator.md` (the model's prompt) is 15B2's.

## The dispatch inputs (§10)

`merge_run` (10 hex), `pr`, `head_sha`, `main_sha` (40 hex) and `budget_usd` (a decimal of at most
two places, `0` when the month's budget is spent). Pass them to every step below as `MERGE_RUN`,
`HEAD_SHA`, `MAIN_SHA` and `BUDGET_USD`; `pr` is the run's name only. `BUDGET_USD` also goes to the
CLI's `--max-budget-usd`.

## Job `merge` (`contents: read`, no `id-token`, no secrets, Linux)

1. Check out the change at `head_sha` with `fetch-depth: 0` and `persist-credentials: false`, and
   fetch `main_sha`, so the merge base is in reach. Check out `main` at `main_sha` into
   `$RUNNER_TEMP/main`. Set up node and pnpm, but do not install: the rules install the merged tree
   themselves, and only when one of them builds.
2. `node "$RUNNER_TEMP/main/scripts/merge-main/merge.mjs" --repo "$GITHUB_WORKSPACE" --head "$HEAD_SHA" --main "$MAIN_SHA" --out "$RUNNER_TEMP/merge"`.
   It exits 0 for every outcome (a refusal is in the record) and 1 only when the job broke. The
   runtime manifests it records are Linux's, as CI's are.
3. Upload `$RUNNER_TEMP/merge` as the artifact `merge`.

## Job `propose` (the `bug-fix` environment, `id-token: write`)

1. Check out `main` at `main_sha` (`fetch-depth: 0`, `persist-credentials: false`), then
   `git fetch --no-tags origin "$HEAD_SHA"`. Check the head is `main_sha` and the tree clean, then
   `cp -a "$GITHUB_WORKSPACE" "$RUNNER_TEMP/main"`: collect reads that copy's git, never the
   workspace's.
2. Download the artifact `merge` to `$RUNNER_TEMP/merge`.
3. `node "$RUNNER_TEMP/main/scripts/merge-main/collect.mjs" stage` (also `GITHUB_OUTPUT`). It redoes
   the merge from main's git and refuses a record that differs. It turns the workspace into the
   merged tree, each conflict left for the model with its markers, and writes
   `$RUNNER_TEMP/conflicts/conflicts.json` (below). Its output `model=true|false` says whether the
   model step runs: `false` when nothing is left for the model, when the merge is refused, or when
   `BUDGET_USD` is `0`.
4. Install dependencies with install scripts off, after `stage`, so it is the merged lockfile.
5. Lock `$RUNNER_TEMP/main`, `$RUNNER_TEMP/merge` and `$RUNNER_TEMP/conflicts` as `bug-fix.yml`
   locks its own folders. The record is where the builds' output comes from, so the model must not be
   able to write it.
6. The model step, only `if: steps.stage.outputs.model == 'true'`, with the sandbox steps copied
   from `bug-fix.yml`. Its output goes to `$RUNNER_TEMP/claude/stream.jsonl`, and it may write only
   the workspace and `$RUNNER_TEMP/out/`.
7. `node "$RUNNER_TEMP/main/scripts/merge-main/collect.mjs" result`, `if: always()`, from the
   pristine copy (`LAUNCHER_URL`, and the OIDC request pair the job's `id-token: write` gives it).
   It POSTs to `/api/pipeline/merge-runs/<merge_run>/result` with audience
   `invisible-launcher-merge-main` and prints one fenced line.

## What the model reads and writes

`conflicts.json`: `{ mergeRun, headSha, mainSha, baseSha, files: [{ path, kind, markerSize,
hunks: [{ index, lines }], met: [{ pr, title }] }], pending: [{ path, rule, command }],
byRule: [{ path, rule }], result }`. `files` is what it resolves. Markers are labelled
`this change`, `base` and `main`, `markerSize` long. `kind` is `content`, or `modify/delete` (one
hunk: keep the file or delete it). A `pending` file holds main's: the run may run its `command` once
the conflicts are resolved, and may change only that file. `byRule` is done: not the model's.

`$RUNNER_TEMP/out/result.json`: the shape in `collect.mjs`'s header. Every hunk of every file
needs an entry, and every file edited outside its hunks needs an `outside` line, with `checks` and
`risks`. Missing or empty is `no_proposal`. `{ "outcome": "needs_person", "reason": "…" }` hands
the merge to a person. The run must not change any other file, create one, or leave a marker.
