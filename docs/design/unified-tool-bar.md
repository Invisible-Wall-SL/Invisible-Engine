# Unified Tool Bar

> A single, consistent top bar across **every** tool: the Invisible emblem, the
> current tool's name, and a horizontal switcher listing every other online tool
> the signed-in user is entitled to. One look, one nav model, everywhere.

Status: **Phase 1 in progress** (launcher Svelte tools). Owner-agreed 2026-06-12.

## Why

Each tool grew its own bespoke header (`<a class="brand" href="/">…`), and
cross-tool navigation was a single B24 "sibling" link (Atlas↔Sheet only). There
was no consistent way to jump between tools, and no shared brand chrome. This
unifies the chrome and replaces the single-sibling link with a full, role-aware
switcher.

## The A/B constraint (two implementations, kept identical)

Tools render in **two stacks** that cannot share a component (the reuse-inventory
A/B line):

| Domain | Stack | Bar implementation |
|---|---|---|
| **A — launcher** | `apps/launcher-api`, Svelte 5 | `$lib/ToolTopBar.svelte` (canonical) |
| **B — Python tools** | `services/atlas-tool`, `services/sheet-tool`, server-rendered HTML | an HTML/CSS twin fed by the launcher |

So the bar is **two implementations kept visually identical** — the same pact as
the B18 item-toolbar between the Scene Editor and Sheet Maker. `ToolTopBar.svelte`
is the source of truth for the look; the Python twin mirrors it.

It lives in `apps/launcher-api/src/lib/` (not `packages/components-*`) because
every Domain-A consumer is inside launcher-api — same as `$lib/Emblem.svelte`.

## Anatomy (left → right)

```
[◆ Emblem]  TOOL NAME   │   [▣ Sheet] [▤ Atlas] [◈ Component] …
   ↑ launcher home         ↑ current      ↑ every OTHER online tool the user can see
```

- **Emblem** → launcher home (`ENV.ORIGIN` / `/`), always.
- **Tool name** → static label of the current tool.
- **Switcher** → every **online** tool in the user's role manifest **except the
  current one**, icon + text. **Icon-only when the row gets tight** (label hidden,
  `title=` tooltip). Local-install tools (Spine Editor, Invisible Launcher) and
  the admin panel never appear.

## Decisions (owner, 2026-06-12)

- **Online tools only** in the switcher — local installs are excluded (they have
  no in-browser URL); they stay discoverable on the launcher home + onboarding.
- **Emblem → launcher home**, always.
- **Menu-only navigation** — every redundant cross-tool affordance is removed:
  the B24 single-sibling buttons in the Python tools, **and** the Component
  Editor's `← Editor` link. The switcher is the one way between tools.
- **Admin stays launcher-only** — it's a capability, not a tool, so it is already
  absent from every tool manifest. No change needed; do not add it to the bar.
- **Overflow:** icon-only when tight (labels drop before anything collapses).

## Switcher order

Fixed, online-only, declared once as `TOOL_BAR_ORDER` in `roles.ts`:

```
editor → sheetMaker → atlasTool → componentEditor → storybook
  → spineViewer → fontMaker → localization → ftpBrowser
```

The bar renders this order, filtered to the tools the user actually has, with the
current tool removed. (`spineViewer` is the online viewer; the local Spine Editor
is excluded.) The launcher home grid keeps its own ordering — this constant only
drives the bar.

## Data flow for the Python tools

The launcher is the single source of truth for the role-gated tool list. It bakes
the list into the redirect (extending B24's `home`/`sibling` params):

- `home=<ENV.ORIGIN>` — emblem target (already present).
- `tools=<url-encoded JSON>` — `[{ id, name, url }]` for every online tool the
  user has, in `TOOL_BAR_ORDER`. Python siblings carry their own baked
  `?k=`+client+project; launcher tools are `ENV.ORIGIN + /editor` etc.
- **No icons in the URL** (the SVGs are bulky). The Python tool keeps a mirrored
  copy of `TOOL_ICONS`, keyed by tool `id` — same pattern as the emblem mirrored
  to `static/brand/iw-emblem.svg`.

Security: identical to B24 — the launcher only lists tools the user actually has,
and each launcher tool re-checks the role on arrival, so a forged `tools=` can't
bypass a gate.

## Full-page rule (reaffirmed)

Every tool is full-page (no iframes) — already enforced (atlas/spine redirect).
**New tools must render `<ToolTopBar>` as their header and be designed full-page
from the start.** Captured in `apps/launcher-api/CLAUDE.md`.

> Note: some launcher landing shells (storybook/files/localization) are still
> `max-width`-centered rather than full-bleed. Making those full-bleed is the B22
> beauty-pass, tracked separately — not part of this bar work.

## Build plan

1. **`ToolTopBar.svelte`** + `TOOL_BAR_ORDER`/`toolBarItems()` in `roles.ts`;
   adopt the bar in the 6 launcher Svelte tools (drop their bespoke brand headers
   + the Component Editor `← Editor` link). — *Phase 1, this change.*
2. **Redirect payload** — a `tools=` builder wired into `atlas/` + `sheet/`
   `+page.server.ts`, replacing the `sibling` logic.
3. **Python twin** — render the bar from `?tools=` in `ui_server.py` + `ui.html`,
   mirror the icon set, delete the old single-sibling links.
4. **Docs** — `ui-inventory.md` §7 → canonical, both CLAUDE.md full-page notes,
   `docs/STATUS.md`.
