# Bonus games (Hold and Win as its own game, coin overlay as an option) — status + session hub

> Design: [docs/design/bonus-games.md](../design/bonus-games.md) · Builds on:
> [status/hold-and-win](hold-and-win.md), [status/pots-overlay](pots-overlay.md) · Guide: _per phase_
> · Agents: per phase — see the design's build plan.

**One-line state:** Phase 0 (plan + hub) in review. Nothing is built yet. Next: Phase 1, the config
split + migration.

## How sessions use this file (the hub)

**This file is the shared memory**, and the committed file wins over any message. The coordinating
("hub") session is the Claude Code session titled **"Hold and Wins as standalone project"**. It
starts the phase sessions, reviews their PRs and merges them.

- **Starting a phase:** read the design's §3 and this file, and claim your row in the Phase board.
- **Finishing (or stopping):** update your Phase board row and add a dated entry under "Recent
  changes" (what landed, the PR, what's left, any surprise). Then message the hub session
  (`SendMessage` / `send_message` to "Hold and Wins as standalone project").
- **Found something that changes the plan?** Add it to "Decisions & findings" and tell the hub.
- **Parity is the gate:**
  - `check:holdandwin` and `check:pots-overlay` digests don't move;
  - `check:all` is green;
  - the three Hold and Win samples and `borut-pots-sample` play unchanged.
- **Don't merge your own PR.** The hub reviews and merges.

## Phase board

| # | Phase | State | Owner session | PR |
|---|---|---|---|---|
| 0 | Plan + hub | in review | Hold and Wins as standalone project | — |
| 1 | Contract: config split + migration | in progress | Bonus games Phase 1 — config split + migration | — |
| 2 | Mock: per-mode engines | not started (needs 1) | — | — |
| 3 | Facade + wire + event types | not started (needs 1) | — | — |
| 4 | Engine runtime: active-mode rules | not started (needs 3) | — | — |
| 5a | `/config` Bonus modes + Coin overlay | not started (needs 1) | — | — |
| 5b | Scene Editor + capabilities + `/symbols` | not started (needs 1) | — | — |
| 5c | Flow v2 vocabulary by board | not started (needs 1, 4) | — | — |
| 5d | Win Text + Localization per mode | not started (needs 1, 4) | — | — |
| 6 | Game Maker: template + Add a bonus mode… | not started (needs 2–5) | — | — |
| 7 | Migrate and prove (samples, current-games) | not started (needs 6) | — | — |

## Decisions & findings

- 2026-10-08 — **The owner's model** (hub session): the coin overlay (classic / 3 Pots / Collector)
  is an option a base game turns on, and it only triggers. The bonus stage is a game of its own,
  and a project can have several bonus modes. A Hold and Win project is editable, duplicable and
  reskinnable, and any project can add it as a bonus mode. The owner confirmed design §6 4–6:
  the `coinOverlay` rename, retiring the `holdAndWin` kind (it stays as a template), and overlay +
  buy triggers only (no scatter → Hold and Win).
- 2026-10-08 — **Seams measured** against `main` 72f7a0c. The single-Hold-and-Win assumptions are
  listed in design "What is wrong today".

## Recent changes

- 2026-10-08 — Phase 0: design + hub written (hub session).
