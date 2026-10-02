import type { CueDecl, TemplateVocabulary } from 'engine-flow-v2';
import { engineSignalsForKind } from 'engine-layout';
import type { ComponentDef, LayoutNode, Scene } from 'engine-layout';

/**
 * Signal names the GAME drives for a project of `gameType`, so a flow must not offer to fire them.
 *
 * `getComponentSignal` resolves a registered name against the game's registry and never consults
 * the open bus, so `emitComponentSignal('win')` is a no-op — and the emitter broadcast that rides
 * along carries the CATALOG name (`win`), not the event the game actually publishes (`winShow`), so
 * it reaches nobody either. A `fireCue win` would therefore sit in the graph looking wired and do
 * nothing, with no warning. These names are still perfectly good on a scene spine — that is how a
 * character reacts to a real win with no flow at all — they are just not the flow's to fire.
 *
 * Per KIND: the game registers the Hold and Win family only in a Hold and Win game, so in any other
 * kind a cue named `featureEnter` or `coinLand` is the author's own, and fireable.
 */
const gameDrivenSignals = (gameType: string | undefined): ReadonlySet<string> =>
	new Set(engineSignalsForKind(gameType).map((s) => s.key));

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
 * Every author-named cue signal on a scene's CUED nodes — spines (which swap animation) and
 * flipbooks (which swap clip) — sorted + de-duplicated. Both kinds ride the same bus, so the
 * palette must offer both; harvesting only spines would silently leave a flipbook character
 * un-fireable while the editor happily saved its cue.
 *
 * Walks RECURSIVELY: a cued node is very often nested inside a `container` (the only layout node
 * kind with `children`), and a top-level-only scan would miss most of a real scene.
 *
 * Walks INTO COMPONENTS too, given their defs (Phase 12a): a cue authored inside a component (a frog
 * in the Pot that plays on a Flow cue `frogCheer`) and a placement's per-instance signal override
 * are as fireable as a scene's own — the open bus reaches the instance either way. Each def is walked
 * once, nested instances included, so a component that contains itself cannot loop. Without the defs
 * (they live in R2, which this pure helper does not read) only the scenes' own nodes count.
 *
 * Names the game drives for the project's kind ({@link gameDrivenSignals}) are excluded: they work
 * on the node but are not flow-fireable, so offering them in the palette would author a dead node.
 */
export function collectSceneCueNames(
	scenes: readonly Scene[],
	components: readonly ComponentDef[] = [],
	gameType?: string,
): string[] {
	const gameDriven = gameDrivenSignals(gameType);
	const defs = new Map<string, ComponentDef[]>();
	for (const def of components) defs.set(def.id, [...(defs.get(def.id) ?? []), def]);
	const names = new Set<string>();
	const add = (signal: string | undefined): void => {
		const name = signal?.trim();
		if (name && !gameDriven.has(name)) names.add(name);
	};
	const entered = new Set<string>();
	const walk = (nodes: readonly LayoutNode[]): void => {
		for (const node of nodes) {
			if (node.kind === 'container') {
				walk(node.children ?? []);
				continue;
			}
			if (node.kind === 'componentInstance') {
				for (const rebinds of Object.values(node.cueSignalOverrides ?? {})) {
					for (const signal of Object.values(rebinds)) add(signal);
				}
				if (entered.has(node.componentId)) continue;
				entered.add(node.componentId);
				for (const def of defs.get(node.componentId) ?? []) walk([def.root]);
				continue;
			}
			if (node.kind !== 'spine' && node.kind !== 'flipbook') continue;
			for (const cue of node.cues ?? []) add(cue.signal);
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
