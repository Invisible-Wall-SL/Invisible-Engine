import type { CueDecl, TemplateVocabulary } from 'engine-flow-v2';
import { ENGINE_SIGNAL_CATALOG } from 'engine-layout';
import type { LayoutNode, Scene } from 'engine-layout';

/**
 * Signal names the GAME drives, so a flow must not offer to fire them.
 *
 * `getComponentSignal` resolves a registered name against the game's registry and never consults
 * the open bus, so `emitComponentSignal('win')` is a no-op — and the emitter broadcast that rides
 * along carries the CATALOG name (`win`), not the event the game actually publishes (`winShow`), so
 * it reaches nobody either. A `fireCue win` would therefore sit in the graph looking wired and do
 * nothing, with no warning. These names are still perfectly good on a scene spine — that is how a
 * character reacts to a real win with no flow at all — they are just not the flow's to fire.
 */
const GAME_DRIVEN_SIGNALS = new Set(ENGINE_SIGNAL_CATALOG.map((s) => s.key));

/**
 * WHAT A FLOW MAY FIRE — the engine's own cues plus the ones THIS project's scenes ask for.
 *
 * A `fireCue` node's `ref` is checked against `TemplateVocabulary.cues` (`validate.ts`'s
 * `refResolves`), and the palette/inspector only ever offer that same list. The engine list is
 * closed by design (board / win / free-spin / sound / UI — the transcribed `EmitterEvent*` unions),
 * so a flow could address the coded presentation and NOTHING an author placed.
 *
 * A spine placed in the Scene Editor can now carry an AUTHOR-NAMED cue (`SpineCue.signal`), which
 * resolves through the open component-signal bus (`emitComponentSignal`) when the flow runtime
 * broadcasts a cue of that name. This module is the launcher-side half of that: it harvests those
 * names off the LayoutDoc and widens the per-project vocabulary with them, so the name an author
 * typed on a spine is a node they can drag out of the palette.
 *
 * PER-PROJECT, NOT ENGINE. `standardVocab.ts` stays closed — the widening lives here, exactly like
 * `withProjectSounds` (./soundOptions) widens the sound enums with a project's own uploads.
 */

/**
 * Every author-named cue signal on a scene's spines, sorted + de-duplicated.
 *
 * Walks RECURSIVELY: a spine is very often nested inside a `container` (the only layout node kind
 * with `children`), and a top-level-only scan would miss most of a real scene's rig.
 *
 * A `componentInstance`'s own spines are NOT harvested — its def lives in R2 component storage,
 * which this pure helper does not read (the same limit the loader's container-event projection
 * already carries for custom components' signals).
 *
 * Names the game drives ({@link GAME_DRIVEN_SIGNALS}) are excluded: they work on the spine but are
 * not flow-fireable, so offering them in the palette would author a dead node.
 */
export function collectSceneCueNames(scenes: readonly Scene[]): string[] {
	const names = new Set<string>();
	const walk = (nodes: readonly LayoutNode[]): void => {
		for (const node of nodes) {
			if (node.kind === 'container') {
				walk(node.children ?? []);
				continue;
			}
			if (node.kind !== 'spine') continue;
			for (const cue of node.cues ?? []) {
				const name = cue.signal?.trim();
				if (name && !GAME_DRIVEN_SIGNALS.has(name)) names.add(name);
			}
		}
	};
	for (const scene of scenes) walk(scene.nodes ?? []);
	return [...names].sort();
}

/**
 * A flow vocabulary whose cue list also offers this project's author-named scene cues.
 *
 * Each name becomes a payload-less {@link CueDecl}, so `derivePins`' `fireCue` case (`decl?.payload
 * ?? []`) yields exactly `[exec-in, exec-out]` and `refResolves` accepts the ref — palette,
 * inspector, pins and validator all follow the one list for free.
 *
 * De-duplicated against the names already in `vocab.cues` (and against each other), so an author who
 * names a spine cue `winShow` re-uses the engine's decl instead of shadowing it with a second entry.
 *
 * Returns the vocabulary UNCHANGED when the project's scenes name no new cue, so a project without
 * author-named cues keeps the exact object identity the editor had before.
 */
export function withSceneCues(vocab: TemplateVocabulary, names: string[]): TemplateVocabulary {
	const known = new Set(vocab.cues.map((c) => c.name));
	const added: CueDecl[] = [];
	for (const name of names) {
		if (known.has(name)) continue;
		known.add(name);
		added.push({ name, payload: [] });
	}
	if (!added.length) return vocab;
	return { ...vocab, cues: [...vocab.cues, ...added] };
}
