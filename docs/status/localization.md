# Invisible Localization — status

> Guide: [docs/tools/localization.md](../tools/localization.md) · Agent: none yet (launcher tool — closest owner `.claude/agents/launcher-studio.md`)

**One-line state:** shipped — in-launcher, project-scoped string table with Claude batch translate → unreviewed → human-review → save to R2; needs `ANTHROPIC_API_KEY` set for translation.

## Current state

Live in the launcher at `/localization` (granted to `developer` + `artist`; `admin` always), scoped to the **active project**. A single Claude call + R2 storage — no external service, no DB table.

- **Table** — a spreadsheet-style view of the game's text. **Auto-collected sections** harvest every localizable string, source read-only (the owning tool edits it): **per-screen** from the Scene Editor (text nodes, component `text`/`label` params, and text authored inside custom components); a **Win text** section from Invisible Win Text's templates (incl. the built-in info-bar toast defaults); and a **Symbol names** section from the Invisible Symbols State Machine's display names (`H1` → "Banana"/"Bananas"). Each string's translation key **is the source text**, so identical strings share one translation. A **manual** section holds hand-authored rows (editable `key` + `source`). A **No longer in scenes** section surfaces removed-but-translated rows.
	- Symbol-name rows key on the **trimmed** name (unlike scene/win text, keyed on the exact literal): `resolveSymbolName` trims before it calls the resolver, so a padded key would never match. Only *authored* names harvest — an unnamed symbol resolves to its bare id and must never become a row; numeric-only names ("7") are skipped.
- **Global settings** — source language, target languages, and an optional context/glossary that guides every translation.
- **Claude batch translate** — "Translate this row" / "Translate all missing" batches the selected strings + target langs into **one** Anthropic Messages call (`claude-sonnet-4-6`) with a **prompt-cached** system prompt (fixed instructions + your glossary), returning strict JSON. Results land **unreviewed** (amber dot) — never auto-saved.
- **Review + save** — editing a cell (or clicking its dot) marks it reviewed (green); nothing persists until **Save**. On save, auto-collected rows with no translation are **not** stored (re-derived from `editor/<projectKey>/scenes.json` each load, so the table self-heals); translated rows are kept.
- **Storage** — one JSON doc per project in R2: `localization/<projectKey>/strings.json` (`sourceLang`, `targetLangs`, `context`, `entries[]` with `origin: editor|winText|symbols|manual`; anything not `manual` is an auto origin — re-derived each load, untranslated ones not persisted). R2-only, no migration.
- **Engine consumption** — the engine's text resolver swaps translations in-game by source-text key (reviewed-only).

## Open items / next
1. **Runtime-mode merge (Game Maker path)** — i18n initialises at module-eval, before the live bundle fetch, so the runtime merge of project strings is not yet wired (shared gap with Game Maker).
2. Potential `<DataTable>` extraction (shared with admin) per the reuse-check backlog — infra done, extraction pending.

## Blocked (owner / external)
- **`ANTHROPIC_API_KEY` on the launcher's Railway service.** Secret, no code default. Until set, the tool loads and edit/save work, but Translate returns a clear "ANTHROPIC_API_KEY not set" error. Also: pick default target languages per project.

## Recent changes
- 2026-07-27 — harvest **Symbol names** (`SymbolsDoc.names`, new `origin: symbols`) so display names are translatable — closes the "translated line still says …4 Bananas in English" gap (the template translated, the interpolated name didn't). Also: the built-in **win-text info-bar toast defaults** now harvest even when never retyped (`collectWinTextTemplates` sources toasts via `resolveWinText`).
- 2026-05-30 — tool live (built into the launcher, project-scoped, role-gated); fixes: target-lang input splits on commas, "+ Add row" no longer needs `crypto.randomUUID`, fixed a mutate-during-render black screen ([detail in history](../history.md))
