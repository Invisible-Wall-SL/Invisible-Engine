import type { Scene } from './types';

/**
 * Generic doc-driven scene mounting (§20.1, retiring the hard-coded-id mount limitation).
 *
 * A game's `Game.svelte` mounts a fixed set of scenes by HARD-CODED id (`basegame`,
 * `hudBar`, `freeSpinIntro`, …) in a fixed order. So an author who adds a brand-new screen
 * in the Scene Editor (a scene with a custom id, e.g. `hud_xxk3a9`) sees it in the editor
 * preview but NOT in the shipped game — nothing mounts it. This selector returns every
 * author scene the game does NOT already handle, so the game can mount them generically as
 * an overlay layer, in doc order, with no FlowDoc required.
 *
 * Selection mirrors `backgroundScenes` (selection by a contract, not by id): return the
 * scenes — in the doc's order — whose `id` is NOT in `reservedIds` (the ids the game already
 * mounts/handles, incl. any FlowDoc-authored screen ids) AND whose `space` is NOT
 * `'background'` (those are already handled by `backgroundScenes`, mounted as a persistent
 * layer behind everything on the coded path; under a screen-driving v2 flow every scene —
 * background-space included — mounts only as a flow container). Each returned scene renders
 * through `<LayoutScene>`, which
 * self-wraps by `scene.space` and honours `scene.visibleSource` — so no scaling/gating code
 * is needed here.
 *
 * PARITY: a game that ships no extra scenes and reserves all its current ids ⇒ this returns
 * `[]` ⇒ the game's `{#each}` renders nothing ⇒ byte-identical to before (the same discipline
 * as `backgroundScenes`/§25). `apps/lines`' fallback layout has exactly this property.
 */
export const extraMountScenes = (
	scenes: Scene[],
	reservedIds: ReadonlySet<string> | Iterable<string>,
): Scene[] => {
	const reserved = reservedIds instanceof Set ? reservedIds : new Set(reservedIds);
	return scenes.filter((scene) => !reserved.has(scene.id) && scene.space !== 'background');
};

/**
 * Author-created HUD screens (§16 HUD generalization). The Scene Editor's "New HUD screen"
 * mints a Scene with a `hud_`-prefixed id (see `isHudScene` in `referenceLayouts/hud.ts`)
 * carrying the author's OWN HUD chrome — buttons, a bottom bar, readouts. A game renders these
 * as its TOP HUD layer via `<LayoutScene>` (a `space:'standard'` + `align.vertical:'bottom'`
 * scene bottom-frames exactly like the coded bar). Selection is by the `hud_` id prefix — which
 * excludes the canonical `hudBar`/`hudCorners` (camelCase, no underscore), because those drive
 * the coded `<UI>` chrome — dropping `space:'background'` scenes and empty scaffolds, in doc
 * order (so a reorder in the editor re-layers them).
 */
export const authoredHudScenes = (scenes: Scene[]): Scene[] =>
	scenes.filter(
		(scene) =>
			scene.id.startsWith('hud_') && scene.space !== 'background' && scene.nodes.length > 0,
	);

/**
 * Whether the author authored replacement HUD screen(s) that should SUPPRESS the entire coded
 * `<UI>` chrome (the owner-confirmed FULL-REPLACE contract, mirroring `hasAuthoredBackground`).
 * True when at least one `hud_`-prefixed non-background scene carries real content ⇒ the author
 * screens BECOME the HUD. No such scene ⇒ `false` ⇒ the coded `<UI>` renders unchanged — parity
 * for every game (e.g. `apps/lines`' fallback doc) that authors no HUD screen.
 */
export const hasAuthoredHud = (scenes: Scene[]): boolean => authoredHudScenes(scenes).length > 0;

/**
 * The canonical coded-`<UI>` HUD scene ids — the two scenes the bespoke coded HUD chrome draws
 * (`hudBar` = the bottom bar, `hudCorners` = the corner buttons). The single source of truth so
 * both `Game.svelte` (gating the coded `<UI>` on these ids) and `fullReplaceHudScenes` (adopting a
 * content-bearing one) agree — no per-site literal.
 */
export const CODED_HUD_SCENE_IDS = ['hudBar', 'hudCorners'] as const;

/**
 * The HUD scenes to MOUNT once the coded `<UI>` is fully suppressed (the §16 FULL-REPLACE contract).
 * A SUPERSET of `authoredHudScenes`: it also adopts a content-bearing canonical `hudBar`/`hudCorners`
 * scene. Why this is needed: `hasAuthoredHud` (and thus suppression) is intentionally keyed on
 * `hud_`-prefixed screens ONLY, so a normal coded-HUD game with content on `hudBar` never trips
 * full-replace (parity). But the moment an author DOES add a `hud_*` screen, the coded `<UI>` — the
 * only mount path for `hudBar`/`hudCorners` — is switched off; a `hudBar` the author had populated
 * with real buttons would then mount NOWHERE (its nodes are orphaned). This selector re-adopts it, so
 * the invariant "a HUD scene the author filled with nodes always mounts somewhere" holds. Empty
 * `hudBar`/`hudCorners` scaffolds are dropped (`nodes.length > 0`); doc order preserved (an editor
 * reorder re-layers). Callers use this ONLY when `hasAuthoredHud` is true — with no `hud_*` screen the
 * coded `<UI>` renders `hudBar`/`hudCorners` itself, so adopting them here would double-mount.
 */
export const fullReplaceHudScenes = (scenes: Scene[]): Scene[] =>
	scenes.filter(
		(scene) =>
			scene.space !== 'background' &&
			scene.nodes.length > 0 &&
			(scene.id.startsWith('hud_') ||
				(CODED_HUD_SCENE_IDS as readonly string[]).includes(scene.id)),
	);
