import { clearEffects, registerEffects, resolveEffect, type EffectDoc } from 'engine-layout';

import { editorProjectKey, withEditorProject } from './editorProject.client';

/**
 * The PLACED effects' docs for the editor family (Scene Editor + Component Editor), held in the
 * engine's own effect registry (`registerEffects` / `resolveEffect`) — the lookup the game resolves
 * a placed `effect` node with. So what the editor lists as an effect node's parameters (Invisible FX
 * Step 2: its `fxParam` bindings, its `fx:<id>` timeline channels), what its validation checks and
 * what a state-machine preview blends from are read exactly as the game reads them.
 *
 * The live particle overlay registers each doc it loads ({@link notePlacedEffect}), so the registry
 * holds what the stage plays; a panel asking for an effect the overlay has not loaded fetches it
 * once, pinned to the tab's project (a session another tab moved is refused, never answered with
 * that project's effect). A failed read is asked again after {@link RETRY_MS}. Reactive through
 * {@link placedEffectsVersion}. A different bound project drops them all.
 */
const version = $state({ n: 0 });
/** How long a failed read waits before the next ask fetches it again — so a dangling id is not
 *  re-fetched on every render. */
const RETRY_MS = 5000;
/** Ids fetched, in flight or waiting to retry — bookkeeping only, never rendered. */
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
	const project = loadedFor;
	let doc: EffectDoc | null | undefined;
	try {
		const res = await fetch(
			withEditorProject(`/api/editor/effect?id=${encodeURIComponent(effectId)}`),
		);
		if (res.ok) doc = ((await res.json()) as { doc?: EffectDoc | null }).doc;
	} catch {
		// An unreadable effect lists no parameters; its node keeps every other binding and channel.
	}
	if (project !== loadedFor) return;
	if (doc) notePlacedEffect(doc);
	else setTimeout(() => pending.delete(effectId), RETRY_MS);
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
