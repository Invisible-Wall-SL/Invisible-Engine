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

A spreadsheet-style table:

- **Rows** = the game's text fields (each has a `key`, a `source` string and one
  translation per target language).
- **Columns** = `Key` · source (your source language) · one column per target
  language.
- **Global settings** panel: set the **source language**, add/remove **target
  languages**, and an optional **context / glossary** (tone, domain, term
  preferences) that guides every translation.

Edit any cell inline. Add or delete rows. Hit **Translate this row** or
**Translate all missing** to fill the empty cells.

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
      "translations": {
        "es": { "text": "Girar", "reviewed": true }
      }
    }
  ],
  "updatedAt": "2026-05-29T…Z"
}
```

No database table — it's R2-only, so there's no migration.

## Claude translation

The `translate` action batches the selected source strings plus the target
language list into **one** Anthropic Messages API call (model
`claude-sonnet-4-6`), asking for strict JSON (`id -> { lang -> text }`). The
fixed instructions and your context/glossary go in a **prompt-cached** system
prompt so repeated translate clicks are cheap. The result is returned to the
browser marked unreviewed for you to review and save — it's never auto-saved.

## Env

- `ANTHROPIC_API_KEY` — the Claude API key. **Secret, no code default.** When
  it's unset the tool still loads and edits/saves work; only the Translate
  buttons return a clear "ANTHROPIC_API_KEY not set" error. Set it on the
  launcher's Railway service to enable translation.
