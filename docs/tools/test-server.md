# Invisible Test Server

A local RGS lookup / test server for running games offline.

## What it is

A **local** tool that stands in for the Remote Game Server (RGS) so you can run
a game without the real backend — it serves the pre-determined outcome "books"
(the JSON the game replays to drive its animations) and acts as a lookup/test
endpoint during development. Listed in the launcher as a local tool for the
**admin** and **developer** roles.

- **Registry entry:** `apps/launcher-api/src/lib/roles.ts` →
  `testServer` (`kind: 'local'`, `install.package: 'test-server'`,
  description: *"Local RGS lookup/test server for running games offline."*).
- **Where it runs:** **local** — on your own machine, not in the cloud.

## How to access / launch it

It's a local tool, so you install it on your machine (the launcher lists it
under **Local tools** for entitled roles). The launcher does not open it in the
browser — you run it locally and point your game's RGS transport at it.

> **TODO: confirm** — the install/download mechanics and the per-user install
> path are not yet wired up (backlog B5 covers download links + persisted
> install paths for local tools, including the Test Server).

## Typical workflow (high level)

1. Install + start the Test Server locally.
2. Run a game (e.g. an app under `apps/`) configured to use a local RGS
   transport instead of the live RGS.
3. The game requests outcome books from the Test Server and plays them back.

For comparison, the engine already ships a local **mock RGS** path used by
`apps/lines` via `PUBLIC_RGS_TRANSPORT=play4fun` (the Play4Fun translator +
facade — see root `CLAUDE.md`). The Invisible Test Server is the
general-purpose local lookup/test server counterpart.

## Prerequisites

- TODO: confirm — runtime (Node? Python?), port, and exact CLI/launch command.

## Known limitations / TODOs

The Test Server is currently a **manifest stub**: it appears in the launcher's
tool registry, but its actual implementation does not live in this repo, so the
details below could not be verified from the code and are marked TODO:

- **TODO: confirm** the runtime, default port, and launch command.
- **TODO: confirm** the source/download location (no `test-server` source found
  in this repo).
- **TODO: confirm** how a game is configured to talk to it (env var / transport).
- Download links + install-path persistence are pending (backlog B5).

Update this page once the Test Server implementation/source is available.
