# ADR-0007: Pipeline-change mechanics

- **Status:** proposed
- **Date:** 2026-10-04
- **Author:** coordinator

## Context

Invisible Pipeline Changes (SPEC §2) lists every pipeline change, shows its checks, merges it with
`pipelineMerge`, rolls it back from History, and edits runtime-agent definitions as changes.

The parts it builds on:

- **Merging today.** The repo already works this way: feature branches, PRs, squash-merge with a
  scoped title (`scripts/check-commit-scope.mjs`), and CI in GitHub Actions (Lint, Checks,
  svelte-check, Secrets).
- **Check 2.** `current-games` (ADR-0004, #1041) posts a commit status plus a report artifact, with
  a stable id per changed screen.
- **Launcher GitHub access.** The launcher already talks to GitHub for ComfyUI pod images
  (`apps/launcher-api/src/lib/server/github.ts`).
- **Owner answer (Q9).** A pipeline change is a GitHub branch with a PR, squash merge, and a revert
  PR for rollback.

## Options

1. **GitHub is the record.**
   - The tool is a view and a set of controls over PRs.
   - Merge and revert go through the GitHub API, called by a GitHub App or a fine-grained token
     held server-side.
2. **The launcher keeps its own change records** and mirrors them to git.
   - Two sources of truth, so they can drift.
3. **Merge from inside the launcher with git on the server.**
   - Needs a writable clone on Railway.
   - Bypasses branch protection.

## Recommendation

**Option 1: GitHub is the record. The launcher adds only what GitHub can't hold.**

- **Which PRs are pipeline changes.** Every open PR into `main` except:
  - dependabot PRs, which are shown separately;
  - PRs labelled `director-game`. That label is reserved; Director games never produce PRs.
- **Status of a change:**
  - **Testing:** any required check is pending.
  - **Blocked:** any check failed, there is a merge conflict, or a `current-games` diff has not been
    approved. The reason comes from the failing row.
  - **Ready to merge:** everything is green, and every visible diff is approved.
- **Check 1** groups the existing check runs by workflow (Lint, Checks, svelte-check, Python,
  Secrets) and shows pass counts read from their summaries. **Check 2** renders the `current-games`
  report artifact.
- **Diff approval.**
  - Stored in the launcher table `pipeline_approvals`: diff id, approver, time, note.
  - The id embeds the head SHA, so a new push invalidates every approval on that change.
  - When every diff on the head is approved, the launcher posts a commit status
    `current-games/approved` as success.
  - The required check is "`current-games` green **or** `current-games/approved` green". This is
    two statuses with ruleset logic, or one aggregating status the launcher posts.
  - Approving needs `pipelineMerge`.
- **Merge.**
  - `pipelineMerge` users only.
  - The launcher calls GitHub's merge API with `merge_method: squash`, the PR's scoped title, and
    `sha` pinned to the head the checks ran on.
  - The merging user is recorded in `pipeline_merges`: PR, SHA, merged-by, at, approvals snapshot.
  - Branch protection stays the real gate. The launcher never bypasses it.
- **Rollback.**
  - "Roll back" opens a **revert PR**, which is GitHub's revert of the squash commit. It is a normal
    pipeline change and goes through the same checks.
  - It merges with `pipelineMerge` like any other change.
  - History links each revert to the change it undoes.
- **Agents tab.**
  - Editing a runtime agent creates a branch `agents/<name>-<short>` with one commit changing
    `services/director-worker/agents/<name>.md`, and opens a PR labelled `agent-definition`.
  - Its extra check is an evaluation workflow, `agent-eval.yml`. It runs the edited agent and the
    `main` agent on a fixed reference set (e.g. the mockup breakdown of
    `docs/director/eval/mockups/*`) and reports a before/after score plus a diff of outputs.
  - The eval spends real API money, so it runs only on `agent-definition` PRs, with a hard per-run
    cap.
- **Credentials.**
  - A GitHub App installed on this repo only.
  - Permissions: contents and pull-requests write, statuses write, checks read.
  - Its private key lives as a launcher env var and is never sent to the browser.
  - The App identity opens the agent-edit PRs. Merges are attributed in `pipeline_merges` to the
    launcher user.
- **What the launcher never does:**
  - push to `main`
  - bypass branch protection
  - merge a change whose head moved after its checks ran
  - let an agent (runtime or build) merge

## Consequences

- New launcher tables `pipeline_approvals` and `pipeline_merges`.
- A GitHub App the owner creates and installs, plus 2 env vars (App id and private key).
- A new workflow, `agent-eval.yml`, plus a reference eval set in the repo.
- Branch protection on `main` must require the Lint/Checks set plus the
  `current-games`-or-approved status.

## Needs owner approval

- Option 1.
- Creating the GitHub App.
- How the "green or approved" requirement is expressed (two statuses or one aggregate).
- The eval's per-run cost cap.
