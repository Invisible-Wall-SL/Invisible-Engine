# Invisible FX — status

> Design: [docs/design/invisible-fx.md](../design/invisible-fx.md) · Guide: [docs/tools/fx.md](../tools/fx.md) · Agent: `.claude/agents/invisible-fx.md`

**One-line state:** Shipped on `main` — all three particle tiers + the event trigger, a pro emitter inspector, a preset library, and rig-timeline direct binding are live; remaining work is the Tier-C perf ceiling live-verify, a `docs/tools/fx.md` refresh, and the Borut submodule bump.

## Current state
Live on `main`, owner-verified in the 2026-06-29 pass except the ⏳ items called out below.

- **All three tiers ship** (`/fx`, `fx` tool scope): **A** sprite/flipbook particles from project atlas regions, **B** an emitter pinned onto a bone of a playing Spine backdrop (`SpineBoneAttach`), and **C** whole Spine clips *as* the particles (pooled `SpineParticleBehavior`). The `skeletonKey` key-stability seam for Tier-C shipping is closed.
- **Event trigger end-to-end.** A `trigger.on:'event'` layer fires when a matching cue crosses the runtime event bus (a Flow v1 Broadcast / v2 `fireCue`), with an optional **Stop event** and **Duration**. The full author→ship→fire chain (export → `deploy/effects/` → bake → pull → `bakedEffects()` register) is wired.
- **Pro `/fx` inspector knobs:** emission **direction (centre °) + spread (±°)** and particle spin; a **movement** toggle (eased `moveSpeed` vs **gravity/acceleration** — up-direction + downward gravity = a fountain); **colour** start/end tint; **blend mode** (Normal/Add/Screen/Multiply); five **spawn kinds** — point / circle / ring / rectangle / **burst** (even fan). All are live sliders + number boxes that re-tune the preview verbatim (pure config edits, no schema change).
- **Preset library** — per-layer "Apply preset…" (Fountain, Fire, Smoke, Sparks, Explosion-burst, Rain, Snow, Confetti, Magic glow) preserving art/placement/trigger.
- **Rig-timeline direct binding** — on a Rigger event keyframe you pick the effect + host bone directly (`evtObj.fx`), baked to a `rigFx` manifest and played by `RiggedEffect` on the beat (`forceEmit`); the cue-broadcast path stays as the advanced mode.
- **Live particle previews everywhere** — the effect plays not just in `/fx` (`FxStage`) but in the **Rigger** and **Symbols state machine** via the shared `fxOverlay` on their raw-WebGL stages, all now riding the bone's **full transform** (position + rotation + per-axis scale) to match the game.
- **Effect atlases auto-ship** — `exportEditorArt` walks the project's effects and ships every layer's `art.assetKey`, so a placed/bound effect's particles have textures with no extra step.

⏳ **Still open (live-verify):** Tier-C spine-particle **GPU/perf ceiling** in a published game (expect tens, not hundreds); owner pixel-verify of the rig-bound FX size/rotation on live WebGL across `/symbols`, `/rigger`, and the game.

## Open items / next
1. **Tier-C perf ceiling live-verify** — confirm a published game renders a spine-particle effect at 60fps and find the pool-size ceiling; flipbook-bake stays the per-effect fallback.
2. **Refresh `docs/tools/fx.md`** (docs-keeper, rule 9) for the newer inspector: Emission/Movement/Colour/Blend/Presets and the Burst spawn kind — the guide predates them.
3. **Borut `engine` submodule bump** (owner) — once the Tier-C pixels are confirmed, Book of Borut bumps to ship the runtime FX (it has its own bundle; the shared `_runtime/lines` is already published).
4. Consolidation candidate: **three FX renderers** (engine `SpineBoneAttach`, `/fx` `FxStage`, tool `fxOverlay`) are kept in sync by hand — a future unify.

## Blocked (owner / external)
- **Shipped-game submodule bumps** are owner-owned (Book of Borut) — see item 3.
- **Owner live-verify** of the WebGL pixels / Tier-C perf is the gate on marking those items done.

## Recent changes
- 2026-07-14 — `/symbols` + Rigger `fxOverlay` now apply the bone's full transform, matching the game ([detail in history](../history.md))
- 2026-07-14 — rig FX rides the bone's full transform (rotation + scale) via `followRotation`/`followScale`; published to `_runtime/lines` ([detail in history](../history.md))
- 2026-07-14 — fixed `SpineBoneAttach` bone-follow drift in a scaled game (map world→parent-local) ([detail in history](../history.md))
- 2026-07-13 — live runtime bundle now ships FX (effects + rigFx), parity with the offline bake ([detail in history](../history.md))
- 2026-07-13 — rig FX render fixes: cross-talk firing + effect-ignored-rig-transform in `RiggedEffect` ([detail in history](../history.md))
- 2026-07-10 — rig-timeline DIRECT binding (pick an effect on a Rigger keyframe) + live particle preview in the Rigger ([detail in history](../history.md))
