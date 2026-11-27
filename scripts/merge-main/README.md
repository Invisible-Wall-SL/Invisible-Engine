# scripts/merge-main — Resolve conflict's job code

The code of a Resolve conflict run (ADR-0015 §2–§4, §10; card 15B1). `merge-main.yml` (card 15B2)
calls it and stays thin. Built-ins only; every entry point runs from the pristine copy of `main`
(`$RUNNER_TEMP/main`), never from the branch or the model's workspace. The headers of `merge.mjs` and
`collect.mjs` are the reference; this page is the wiring.

| File                     | What                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `merge.mjs`              | Job `merge`: the merge path by path, the §3 rules, the §4 refusals the job checks, the `merge` record                                               |
| `collect.mjs`            | Job `propose`: `stage` before the model, `prepare` (the CLI's conf), `result` after it (§10's body, POSTed with OIDC)                               |
| `merge-main.fixture.mjs` | `pnpm check:merge-main`: every rule and refusal on scratch repos, collect's guards, the §10 shape, both steps end to end                            |
| `coordinator.md`         | The model's prompt (card 15B2), rendered by `prepare`                                                                                               |
| `workflow.fixture.mjs`   | `pnpm check:merge-main-workflow`: `.github/workflows/merge-main.yml`'s rules, its sandbox steps held to `bug-fix.yml`'s, the prompt against collect |

## The dispatch inputs (§10)

`merge_run` (10 hex), `pr`, `head_sha`, `main_sha` (40 hex) and `budget_usd` (a decimal of at most
two places, `0` when the month's budget is spent). Pass them to every step below as `MERGE_RUN`,
`HEAD_SHA`, `MAIN_SHA` and `BUDGET_USD`; `pr` is the run's name only. `BUDGET_USD` also goes to the
CLI's `--max-budget-usd`.

## Job `merge` (`contents: read`, no `id-token`, no secrets, Linux, no branch code)

It never installs, builds or runs a ratchet: a branch's build could poison the Actions cache that
`main`'s own workflows restore (owner's decision, 2026-11-27). The three build rules (runtime-bytes,
vendored-bundle, ratchet) take `main`'s file and mark it `pending`, naming the command; the proposal
says what follows Accept: runtime-bytes, "CI's runtime-bytes check fails; click **Re-record runtime
bytes** on the change"; a vendored bundle, "rebuild with `pnpm --filter launcher-api build:<name>` in
the change's session"; a ratchet, "lower the baseline in the change's session if `check:svelte` or
lint fails". docs-append is text only and stays.

1. Check out the change at `head_sha` with `fetch-depth: 0` and `persist-credentials: false`, and
   fetch `main_sha`, so the merge base is in reach. Check out `main` at `main_sha` into
   `$RUNNER_TEMP/main`. Set up node with `package-manager-cache: false` (setup-node caches by
   itself when the workspace's `package.json`, the branch's here, names npm), and no pnpm: nothing
   is installed, and `merge.mjs` runs git and nothing else.
2. `node "$RUNNER_TEMP/main/scripts/merge-main/merge.mjs" --repo "$GITHUB_WORKSPACE" --head "$HEAD_SHA" --main "$MAIN_SHA" --out "$RUNNER_TEMP/merge"`.
   It exits 0 for every outcome (a refusal is in the record) and 1 only when the job broke.
3. Upload `$RUNNER_TEMP/merge` as the artifact `merge`.

## Job `propose` (the `bug-fix` environment, `id-token: write`)

1. Check out `main` at `main_sha` (`fetch-depth: 0`, `persist-credentials: false`), then
   `git fetch --no-tags origin "$HEAD_SHA"`. Check the head is `main_sha` and the tree clean, then
   `cp -a "$GITHUB_WORKSPACE" "$RUNNER_TEMP/main"`: collect reads that copy's git, never the
   workspace's.
2. Install dependencies from MAIN's lockfile (`pnpm install --frozen-lockfile`, `bug-fix.yml`'s own
   step), while the workspace is still main's checkout: before the record is downloaded and the
   merged tree laid out. pnpm reads the workspace's `.npmrc` (and expands environment variables in
   it, the OIDC request pair included), `packageManager` (which picks the pnpm binary that runs) and
   pnpmfile, so installing the merged tree would let the branch run code outside the sandbox. The
   model's gates run on main's dependencies; CI on the pushed head is the gate.
3. Download the artifact `merge` to `$RUNNER_TEMP/merge`.
4. `node "$RUNNER_TEMP/main/scripts/merge-main/collect.mjs" stage` (also `GITHUB_OUTPUT`). It redoes
   the merge from main's git and refuses a record that differs. It turns the workspace into the
   merged tree, each conflict left for the model with its markers, and writes
   `$RUNNER_TEMP/conflicts/conflicts.json` (below). Its output `model=true|false` says whether the
   model step runs: `false` when nothing is left for the model, when the merge is refused, or when
   `BUDGET_USD` is `0`.
5. When `model` is `true`: lock `$RUNNER_TEMP/merge` and `$RUNNER_TEMP/conflicts` as `bug-fix.yml`
   locks its own folders (the model must not be able to write the record), then the sandbox steps
   copied from `bug-fix.yml`. Their `prepare` is
   `node "$RUNNER_TEMP/main/scripts/merge-main/collect.mjs" prepare`, which renders the CLI's conf
   into `$RUNNER_TEMP/claude/conf` (`settings.json` from `scripts/bug-fix/settings.json` with `BUG`
   set to the conflicts folder, readable and never writable; `prompt.md` from `coordinator.md`;
   `agents.json`) and swaps in the tsx shim. Their lock takes `$RUNNER_TEMP/main`, and the model
   step writes its output to `$RUNNER_TEMP/claude/stream.jsonl` and may write only the workspace
   and `$RUNNER_TEMP/out/`.
6. `node "$RUNNER_TEMP/main/scripts/merge-main/collect.mjs" result`, `if: always()`, from the
   pristine copy (`LAUNCHER_URL`, and the OIDC request pair the job's `id-token: write` gives it).
   It POSTs to `/api/pipeline/merge-runs/<merge_run>/result` with audience
   `invisible-launcher-merge-main` and prints one fenced line.

## What the model reads and writes

`conflicts.json`: `{ mergeRun, headSha, mainSha, baseSha, files: [{ path, kind, markerSize,
hunks: [{ index, lines }], met: [{ pr, title }] }], pending: [{ path, rule, command }],
byRule: [{ path, rule }], result }`. `files` is what it resolves. Markers are labelled
`this change`, `base` and `main`, `markerSize` long. `kind` is `content`, or `modify/delete` (one
hunk: keep the file or delete it). A `pending` file holds main's and is not the model's: the `command` is what a
person or CI runs after Accept, and the run must not change the file. `byRule` is done too.

`$RUNNER_TEMP/out/result.json`: the shape in `collect.mjs`'s header. Every hunk of every file
needs an entry, and every file edited outside its hunks needs an `outside` line, with `checks` and
`risks`. Missing or empty is `no_proposal`. `{ "outcome": "needs_person", "reason": "…" }` hands
the merge to a person. The run must not change any other file, create one, or leave a marker.
