# Coded-component asset naming convention

Some game pieces stay **coded** (not editor-authored) because they're dynamic,
full-bleed, or event-driven: the animated **background**, the **win** and
**transition** overlays, the **free-spin** intro/outro/counter. In the Invisible
Editor these are placed as `bind` anchors — the game mounts the real component,
the editor shows a stand-in **preview** of the art so you can still "see the game
composed."

For that preview to work **the same way in every game without per-game config**,
each coded component looks up its art by a **convention asset name**. Name your
asset the convention name and the editor previews it automatically; name it
something else and the editor shows a plain placeholder (or you set
`preview.art` on the node explicitly).

> **Source of truth = code, not this page.** The authoritative map is
> `BOUND_COMPONENT_DEFAULTS` in
> `packages/engine-layout/src/lib/boundComponentCatalog.ts`. This page mirrors it
> for humans; if they disagree, the code wins — fix this page.

## The convention

| Coded component (`bind.component`) | Asset kind | Convention name | Editor fit |
|---|---|---|---|
| `Background` | spine bundle | `foregroundAnimation` | cover (full-bleed) |
| `Win` | spine bundle | `bigwin` | contain (centred) |
| `Transition` | spine bundle | `transition` | contain |
| `FreeSpinIntro` | spine bundle | `fsIntro` | contain |
| `FreeSpinOutro` | spine bundle | `fsOutro` | contain |
| `FreeSpinCounter` | atlas region | `Frame_FSCounter.png` | contain |

- **Spine bundle name** = the folder/bundle the spine is synced under
  (`<client>/<project>/spines/<bundle>/`) — the editor matches the last path
  segment against the convention name.
- **Atlas region name** = a frame packed in one of the project's atlas/sheet
  manifests — the editor finds whichever manifest contains it.

## How it resolves (precedence)

1. An explicit `preview.art` on the placement node always wins (per-node
   override for off-convention assets).
2. Otherwise the catalog default for the component name, resolved against the
   project's own synced assets.
3. Asset not found → plain placeholder (no crash).

`preview` is **editor-only** — the running game ignores it entirely and mounts
the real coded component. This page is only about what the *editor* draws.

## Adding a new coded component

Add an entry to `BOUND_COMPONENT_DEFAULTS` (name → `{ space, preview: { kind,
bundle|region, fit } }`) and document it here. Every game that registers that
component name via `registerBoundComponents` and ships the convention-named asset
gets the editor preview for free — no seed or per-item change.

Related: [symbol-naming.md](symbol-naming.md), `docs/design/invisible-editor.md`.
