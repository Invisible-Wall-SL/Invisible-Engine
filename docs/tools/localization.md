# Invisible Localization

Write a game's text once, then auto-translate it into many languages with Claude
and review every line before it ships. Built **inside the launcher** — it's a
light UI + a single Claude call + R2 storage, so it's a real full-page route, not
an external service.

- **Where it runs:** Cloud (the launcher itself, Railway).
- **Access:** sign in at `app.invisiblewall.org`, then open `/localization`
  (granted to `developer`, `artist`, `pipelineTester` and `localizationReviewer` by
  default; `admin` always).
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
- **Other auto-collected sections.** Text a game shows that does _not_ live on a
  screen is collected the same way — read-only here, owned by the tool named:
  - **Win text** — Invisible Win Text's templates (`{count} OF A KIND`, the
    info-bar toasts). Translate the template; the engine interpolates the numbers
    back in afterwards.
  - **Symbol names** — the Invisible Symbols State Machine's display names
    (`H1` → "Banana"/"Bananas"), so a translated win line doesn't end in an
    English symbol name.
  - **Flow messages** — the text on Invisible Flow's Text Message nodes.
  - **Bet modes** — Invisible Game Config's bet-mode copy: each buy-feature
    card's title, description and button, the confirm dialog's body, and the
    bet-mode badge the HUD shows while that mode is the active stake. This copy
    lives in `/config`, not on a screen, which is why it needs its own section.
  - **Game UI** — the engine's own built-in chrome: HUD captions (`BALANCE`,
    `WIN`, `BET`), the menu and info-page entries, the bet menu, the settings and
    autoplay modals, and the info page's rules copy. The same rows for every
    project (the shared runtime bundle owns them); each project translates them
    for itself.
- **Manual strings.** A hand-authored section (with an editable `key` + `source`)
  for text that isn't an editor component. Use **+ Add row** here.

**Columns** = source (your source language) · one column per target language
(manual rows also show an editable `Key`). **Global settings** panel: set the
**source language**, add/remove **target languages**, an optional **context /
glossary** (tone, domain, term preferences) that guides every translation, and a
**Never translate** list.

### Never translate

A comma-separated list of words that must stay exactly as written in every
language — the game's name, brand terms, mechanic names your operator insists on
keeping in English (`Free Spins, Megaways, Book of Borut`).

These words never reach the translator: each one is swapped for a placeholder
before the request and put back where the translation places it. So with
`Free Spins` listed, "Free Spins over, you won:" comes back in French as
"Free Spins terminé, vous avez gagné :" — the sentence around the term is
translated and inflected normally, the term itself is untouched.

Matching ignores case and takes whole words only (`Wild` does not fire inside
"Wilderness"), and the term comes back spelled the way the **source** spelled it
— a source shouting `FREE SPINS` stays `FREE SPINS`. Longer entries win, so
listing both `Free Spins` and `Free` still protects the pair. The list applies to
the whole project, on every translate. It does not touch text already
translated — retranslate a row to apply it.

Edit any translation cell inline. Hit **Translate this row** or **Translate all
missing** to fill the empty cells.

## Review flow

Machine translations land **unreviewed** — the cell is highlighted and shows an
amber dot. Editing the cell (or clicking the dot) marks it **reviewed** (green
dot). Nothing is saved until you click **Save**, so you always review machine
output before it's persisted.

For a whole batch, the **Mark reviewed** control beside _Translate all missing_
approves every filled cell in the chosen scope (one language, or all of them).
It skips empty cells, asks for confirmation, and still needs **Save** — the
intended flow being: translate → Save → open the game from the launcher (an
authoring boot shows unreviewed text, see below) → read it in context → approve.

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

The response format is negotiated per request, strongest first, stepping down
only on a 400: a **strict per-batch JSON schema** (OpenAI — one property per
requested id, one per requested language, `additionalProperties: false`, so the
model physically cannot return a partial row, an invented id, or a language you
didn't ask for), then plain JSON mode (Google and most others), then nothing.
Batches over 100 rows skip the schema rung, since providers cap schema size.

Two providers are supported, same prompt and same strict-JSON contract either
way. **Anthropic** is the default and additionally **prompt-caches** the system
prompt (fixed instructions + your glossary) so repeated translate clicks are
cheap. Any **OpenAI-compatible** `/chat/completions` endpoint works as an
alternative — an Anthropic API key is a separate paid account from a Claude
subscription, so this lets you run the tool on a provider's free tier
(e.g. Google AI Studio) meanwhile.

## Selecting the language in the game

The game reads the locale from the **URL**: `…/index.html?lang=de`. No
parameter ⇒ `en`; `br` is aliased to `pt`. On boot `LoadI18n.svelte` loads that
locale's catalogue and activates it, falling back to `en` if the locale has no
catalogue — so an unknown `?lang=` never breaks the game, it just stays English.

There is deliberately **no in-game language picker**: the operator's lobby opens
the game with `?lang=` already set.

Which locales are allowed is `locales` in
[packages/config-lingui/index.ts](../../packages/config-lingui/index.ts) — the
single source of truth for both the runtime `Language` type and the Game Spec's
`LocaleSchema` (which imports it rather than re-declaring it). The list is
deliberately broader than any one title: declaring a locale costs nothing, and
each game translates only the subset it sells into.

> ⚠️ **Declared ≠ shippable.** Before selling a title in a locale, check the
> game's fonts carry that script's glyphs — a missing glyph can black the
> screen — and note that Arabic, Hebrew and Persian additionally need RTL
> layout, which the HUD does not do automatically.

**Reviewed vs unreviewed — where each shows up.** Saving is enough to _test_ a
translation; reviewing is what lets it _ship_:

| Boot                                    | Carries                   | Why                                                                  |
| --------------------------------------- | ------------------------- | -------------------------------------------------------------------- |
| Launcher link / Play (`ie_authoring=1`) | reviewed **+ unreviewed** | so you can read machine output in the running game before vetting it |
| Published player URL                    | reviewed only             | unvetted text must never reach a player                              |
| Build-time bake (`bake-editor-doc.mjs`) | reviewed only             | the final build never embeds unreviewed strings                      |

The authoring boot asks for the extra strings explicitly (`&authoring=1` on
`/api/editor/runtime`, sent only when `ie_authoring=1` is in the game URL), and
the two variants are cached separately, so a player can never be served the
authoring set. So the loop is: translate → **Save** → open from the launcher and
read it in context → review what's good → publish.

## Env

Set **one** of the two providers. If both are configured the OpenAI-compatible
one wins. With neither set the tool still loads and edits/saves work; only the
Translate buttons return a clear "No translation provider configured" error.

- `ANTHROPIC_API_KEY` — a Claude **API** key (not a Claude subscription).
  **Secret, no code default.** Uses `claude-sonnet-4-6`.
- `LOCALIZATION_LLM_BASE_URL` + `LOCALIZATION_LLM_API_KEY` — an
  OpenAI-compatible endpoint and its key. **Both** are required; setting only
  one falls back to Anthropic. Base URLs: OpenAI `https://api.openai.com/v1`,
  Google AI Studio `https://generativelanguage.googleapis.com/v1beta/openai`.
- `LOCALIZATION_LLM_MODEL` — model id for that endpoint. **Required** with the
  OpenAI-compatible path, with no code default on purpose: providers retire
  model ids, so any baked-in default eventually 404s. List what your account can
  actually use and pick a current one — for Google:
  `curl "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY"`

Set these on the launcher's Railway service.
