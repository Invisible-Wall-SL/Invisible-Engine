import type { EffectParam } from 'engine-fx';
import { clearEffects, registerEffects, resolveEffect, type EffectDoc } from 'engine-layout';

import { editorProjectKey } from './editorProject.client';

/**
 * The PLACED effects' docs for the editor family (Scene Editor + Component Editor), held in the
 * engine's own effect registry (`registerEffects` / `resolveEffect`) — the lookup the game resolves
 * a placed `effect` node with. So what the editor lists as an effect node's parameters (Invisible FX
 * Step 2: its `fxParam` bindings, its `fx:<id>` timeline channels), what its validation checks and
 * what a state-machine preview blends from are read exactly as the game reads them.
 *
 * The live particle overlay registers each doc it loads ({@link notePlacedEffect}), so the registry
 * holds what the stage plays; a panel asking for an effect the overlay has not loaded fetches it
 * once. Reactive through {@link placedEffectsVersion}. A different bound project drops them all.
 */
const version = $state({ n: 0 });
/** Ids already fetched or in flight — bookkeeping only, never rendered. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const pending = new Set<string>();
let loadedFor: string | null = null;

function bindProject(): void {
	const project = editorProjectKey();
	if (loadedFor === project) return;
	loadedFor = project;
	pending.clear();
	clearEffects();
}

/** Bumped whenever a doc lands in the registry — read it where a list of parameters renders. */
export function placedEffectsVersion(): number {
	return version.n;
}

/** Hand a doc the editor loaded to the registry (the overlay calls this after each fetch). */
export function notePlacedEffect(doc: EffectDoc): void {
	bindProject();
	if (resolveEffect(doc.id) === doc) return;
	registerEffects([doc]);
	version.n += 1;
}

async function load(effectId: string): Promise<void> {
	try {
		const res = await fetch(`/api/editor/effect?id=${encodeURIComponent(effectId)}`);
		if (!res.ok) return;
		const body = (await res.json()) as { doc?: EffectDoc | null };
		if (body.doc && loadedFor === editorProjectKey()) notePlacedEffect(body.doc);
	} catch {
		// An unreadable effect lists no parameters; its node keeps every other binding and channel.
	}
}

/**
 * The placed effect `effectId`, as the game resolves it — fetched the first time it is asked for
 * (`undefined` until then, or when it cannot be read). Reactive.
 */
export function placedEffect(effectId: string | undefined): EffectDoc | undefined {
	void version.n;
	bindProject();
	if (!effectId) return undefined;
	const doc = resolveEffect(effectId);
	if (!doc && !pending.has(effectId)) {
		pending.add(effectId);
		void load(effectId);
	}
	return doc;
}

/** The placed effect's exposed parameters (`undefined` while it is not loaded). Reactive. */
export function placedEffectParams(
	effectId: string | undefined,
): readonly EffectParam[] | undefined {
	return placedEffect(effectId)?.params;
}
