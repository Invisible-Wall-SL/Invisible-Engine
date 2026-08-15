# Invisible Localization

Write a game's text once, then auto-translate it into many languages with Claude
and review every line before it ships. Built **inside the launcher** — it's a
light UI + a single Claude call + R2 storage, so it's a real full-page route, not
an external service.

- **Where it runs:** Cloud (the launcher itself, Railway).
- **Access:** sign in at `app.invisiblewall.org`, then open `/localization`
  (granted to `developer` and `artist` by default; `admin` always).
- **Scope:** per **active project** (use the project selector on the launcher
  home). Each project has its own string table.

## What it does

A spreadsheet-style table of the game's text, in two kinds of section:

- **Per-screen sections (auto-collected from the Scene Editor).** Every
  localizable string placed in the project's Scene Editor — `text` nodes, a
  component instance's `text`/`label` (caption) params, AND the text authored
  _inside_ custom components (button labels, counters, intro text, …) — is pulled
  in automatically and grouped under the **screen (scene)** it lives on, so
  the list reads in the same order you authored it. The **source text is
  read-only here** (the Scene Editor owns it — edit it there); you only fill in /
  translate the languages. New text boxes appear on their own the next time you
  open the tool. Each string's translation **key is the source text itself**, so
  identical strings (even across screens) share one translation and the engine's
  text resolver swaps them in-game with no re-keying.
  - A **No longer in scenes** section appears for text that was removed from the
    editor but still has saved translations — keep or delete each row.
- **Manual strings.** A hand-authored section (with an editable `key` + `source`)
  for text that isn't an editor component. Use **+ Add row** here.

**Columns** = source (your source language) · one column per target language
(manual rows also show an editable `Key`). **Global settings** panel: set the
**source language**, add/remove **target languages**, and an optional **context /
glossary** (tone, domain, term preferences) that guides every translation.

Edit any translation cell inline. Hit **Translate this row** or **Translate all
missing** to fill the empty cells.

## Review flow

Machine translations land **unreviewed** — the cell is highlighted and shows an
amber dot. Editing the cell (or clicking the dot) marks it **reviewed** (green
dot). Nothing is saved until you click **Save**, so you always review machine
output before it's persisted.

## Storage

The whole table is a single JSON document in R2 (bucket `invisibleassets`) at:

```
localization/<projectKey>/strings.json
```

Shape:

```jsonc
{
	"sourceLang": "en",
	"targetLangs": ["es", "fr", "de"],
	"context": "Casino slot game. Keep it punchy.",
	"entries": [
		{
			"id": "…",
			"key": "ui.spin",
			"source": "Spin",
			"origin": "manual",
			"translations": {
				"es": { "text": "Girar", "reviewed": true },
			},
		},
	],
	"updatedAt": "2026-05-29T…Z",
}
```

`origin` is `"editor"` for rows auto-collected from the Scene Editor, `"manual"`
otherwise (absent ⇒ manual). On **Save**, auto-collected rows with **no**
translation are _not_ persisted — they're re-derived from the editor doc
(`editor/<projectKey>/scenes.json`) on every load, so the table self-heals when
text is added or removed in the editor; once a row has a translation it's stored
so the work survives. No database table — it's R2-only, so there's no migration.

## Machine translation

The `translate` action batches the selected source strings plus the target
language list into **one** API call, asking for strict JSON
(`id -> { lang -> text }`). The result is returned to the browser marked
unreviewed for you to review and save — it's never auto-saved.

Two providers are supported, same prompt and same strict-JSON contract either
way. **Anthropic** is the default and additionally **prompt-caches** the system
prompt (fixed instructions + your glossary) so repeated translate clicks are
cheap. Any **OpenAI-compatible** `/chat/completions` endpoint works as an
alternative — an Anthropic API key is a separate paid account from a Claude
subscription, so this lets you run the tool on a provider's free tier
(e.g. Google AI Studio) meanwhile.

## Env

Set **one** of the two providers. If both are configured the OpenAI-compatible
one wins. With neither set the tool still loads and edits/saves work; only the
Translate buttons return a clear "No translation provider configured" error.

- `ANTHROPIC_API_KEY` — a Claude **API** key (not a Claude subscription).
  **Secret, no code default.** Uses `claude-sonnet-4-6`.
- `LOCALIZATION_LLM_BASE_URL` + `LOCALIZATION_LLM_API_KEY` — an
  OpenAI-compatible endpoint and its key. **Both** are required; setting only
  one falls back to Anthropic. For Google AI Studio the base URL is
  `https://generativelanguage.googleapis.com/v1beta/openai`.
- `LOCALIZATION_LLM_MODEL` — model id for that endpoint. Defaults to
  `gemini-2.5-flash`; **must** be set for any non-Gemini provider.

Set these on the launcher's Railway service.
