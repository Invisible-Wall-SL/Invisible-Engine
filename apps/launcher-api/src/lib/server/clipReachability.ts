/**
 * Which Invisible Flipbook clips a project actually PLAYS.
 *
 * Two exporters ship a clip and they must agree, or the build is incoherent:
 *
 *   - `editorArtExport` ships the clip's ART (its atlas pages);
 *   - `flipbookExport` ships the CLIP itself (the registry the runtime resolves `clipId` against).
 *
 * Gating only the first is worse than gating neither. It leaves a REGISTERED clip whose sheet was
 * never exported — and the bake refuses exactly that state, correctly, because a clip whose frames
 * have no textures is an animation that silently plays short. That is what happened when the art
 * gate shipped alone (#644): `f_ocean` lost its atlas, kept its registry entry, and the next bake
 * bailed with "1 flipbook clip(s) reference frames that NO shipped sheet packs".
 *
 * So reachability lives here, computed the same way for both callers. Each loads it independently
 * — the two exporters run as separate steps and from separate endpoints, so threading a value
 * between them would only work for one of the three call paths.
 */
import type { ComponentDef, LayoutDoc } from 'engine-layout';
import { createSingleFlight } from './concurrency';
import { listComponents } from './componentStorage';
import { loadDoc } from './editorStorage';
import { loadFlowV2Doc } from './flowV2Storage';
import { listEffects, loadEffect } from './fxStorage';
import { exportRigFlipbooks, referencedClipIds } from './rigFlipbookExport';
import { loadSymbolsDoc } from './symbolsStorage';

/**
 * Every `clipId` named anywhere in a value, however deeply nested.
 *
 * A generic walk rather than a per-schema reader, deliberately. A clip is referenced from at
 * least five unrelated shapes — a Flipbook layout node, a symbol cell, a symbol LAYER, an FX
 * layer, a rig binding — and each is free to move; a hand-written reader per shape is the
 * copied-list mistake this pipeline has already made twice (`config-ts`, then `engine-game`).
 * Over-collecting is harmless (a clip named anywhere ships), while under-collecting deletes art
 * a game plays, so the walk is deliberately indiscriminate about where the field lives.
 */
export function collectClipIds(value: unknown, into: Set<string>): void {
	if (!value) return;
	if (Array.isArray(value)) {
		for (const v of value) collectClipIds(v, into);
		return;
	}
	if (typeof value !== 'object') return;
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		if (k === 'clipId' && typeof v === 'string' && v) into.add(v);
		else collectClipIds(v, into);
	}
}

/**
 * The clip ids something in this project plays, or `null` when that cannot be determined — in
 * which case the caller MUST ship everything rather than guess.
 *
 * Sources are every authoring surface that can name a clip: the layout doc, component defs, the
 * symbols doc (a flipbook symbol cell carries `clipId`, and `symbolExport` relies on the art
 * export's clip walk to ship its sheets), FX effects, the flow graph, and RIG BINDINGS — a Spine
 * rig can play a clip at a beat, which is a `clipId` living in a skeleton rather than in any doc.
 *
 * The rig source was found by running this against a real project before shipping: it reported 6
 * orphans, one of which (`f_lobster`) is bound by `rigFlipbooks.R_Lobster` and would have been
 * wrongly pruned. Anything added to the pipeline that can name a clip belongs in this list — the
 * cost of forgetting is deleted art, not a warning.
 *
 * Component defs are read with `listComponents({ projectKey })` — project + shared, i.e. ALL of
 * them rather than only those the doc currently instantiates. That over-collects on purpose: shipping a clip nothing plays costs
 * bytes, dropping one something plays costs an animation, and the two are not worth trading.
 *
 * A clip played only from a game's own TypeScript is invisible here. That is the known limit, and
 * why an unreferenced clip is REPORTED by its caller rather than silently dropped.
 */
/**
 * Concurrent callers within one assemble share a single run — see {@link collectPlayedClipIds}.
 *
 * ⚠️ Everyone who joins gets the FIRST caller's result, so the callers must agree on the answer.
 * They now do: the only `preloaded` field either passes is `doc`, and that is the same
 * `loadDoc(clientKey, projectKey)` this function would fetch itself, so a join can differ in COST
 * but never in OUTCOME. Do not reintroduce a caller-specific `defs` here (see below).
 */
const joinReachability = createSingleFlight();

export async function collectPlayedClipIds(
	clientKey: string,
	projectKey: string,
	preloaded?: { doc?: LayoutDoc; defs?: Record<string, ComponentDef> },
): Promise<Set<string> | null> {
	return joinReachability(`${clientKey}/${projectKey}`, () =>
		collectPlayedClipIdsUncached(clientKey, projectKey, preloaded),
	);
}

async function collectPlayedClipIdsUncached(
	clientKey: string,
	projectKey: string,
	preloaded?: { doc?: LayoutDoc; defs?: Record<string, ComponentDef> },
): Promise<Set<string> | null> {
	const ids = new Set<string>();
	try {
		collectClipIds(preloaded?.doc ?? ((await loadDoc(clientKey, projectKey)) as LayoutDoc), ids);
		collectClipIds(preloaded?.defs ?? (await listComponents({ projectKey })), ids);
		collectClipIds(await loadSymbolsDoc(clientKey, projectKey), ids);
		for (const row of await listEffects(clientKey, projectKey)) {
			const { doc: effectDoc } = await loadEffect(clientKey, projectKey, row.id);
			collectClipIds(effectDoc, ids);
		}
		collectClipIds(await loadFlowV2Doc(clientKey, projectKey), ids);
		// Rig bindings. `exportRigFlipbooks` only READS (walks the skeleton index and builds a
		// manifest), so calling it here costs a listing, not a write.
		for (const id of referencedClipIds(await exportRigFlipbooks(clientKey, projectKey))) {
			ids.add(id);
		}
	} catch (e) {
		// Reachability unknown — the caller ships every clip. Never prune on a guess.
		console.log(`[clips] reachability undetermined (${e}) — treating every clip as played.`);
		return null;
	}
	return ids;
}
