/**
 * Export a project's Invisible FX effects into the game-loadable `deploy/` subtree —
 * the EffectDoc analogue of `flowExport.ts` / `editorArtExport.ts` / `fontExport.ts`.
 * Closes the "authored the effect in /fx, it saves to R2, but the shipped game has no
 * effects" gap (docs/design/invisible-fx.md §8, RULE 8).
 *
 * Like a FlowDoc — and UNLIKE the art/font/symbol exports — an EffectDoc carries NO
 * binary assets of its own: its particle ART is an atlas the editor-art export already
 * ships (FX references it by `art.assetKey`, never re-packs textures, §4 / §8). So this
 * is a pure-JSON copy with no texture mirroring. A project holds MANY named effects, so
 * (unlike Flow's single `flow.json`) each is written under its own deploy file plus a
 * lightweight index:
 *
 *   <client>/<project>/<id>.fx.json            ← the authored doc (saved by /api/fx/save)
 *   <client>/<project>/deploy/effects/<id>.json   ← the exported doc (this writes it)
 *   <client>/<project>/deploy/effects/index.json  ← the list the game registers
 *
 * The existing transport then carries it: `bake-editor-doc.mjs` triggers this and embeds
 * the returned `effects` in the baked bundle as `effects`; `pull-project-assets.mjs`
 * mirrors `deploy/` (incl. `deploy/effects/`) into `static/assets/`. The game registers
 * it via `BakedBundle.effects` (`bakedEffects()`) — absent ⇒ no effects (parity).
 *
 * Each doc is re-normalized through `normalizeEffectDoc` (the same serialize contract
 * `/api/fx/save` and the headless round-trip use) so only the PURE doc travels — editor-
 * only state can never reach the deploy/baked artifact. Stale `deploy/effects/` objects
 * from a previous export are pruned, so an un-authored / de-authored project bakes no
 * effects (parity). Idempotent — re-running converges.
 */
import { normalizeEffectDoc, type EffectDoc } from 'engine-fx';
import { listEffects } from './fxStorage';
import { SUB, fxDocKey } from './projectPaths';
import { deleteObjects, getObjectText, listAllKeys, putObjectText } from './r2';

export interface EffectExportIndex {
	/** The exported, normalized EffectDocs. Empty when the project authored nothing —
	 *  the parity-safe fall-through (no effects ship). */
	effects: EffectDoc[];
	/** Every distinct `art.assetKey` the exported effects reference. The bake checks each
	 *  against the atlases it ships (`editorArt.sheets`) — a dangling key = an invisible
	 *  effect (§8). Empty when no effect references art. */
	referencedAssetKeys: string[];
}

/** The distinct, non-empty `art.assetKey`s an effect's layers reference. */
function assetKeysOf(effect: EffectDoc): string[] {
	const keys = new Set<string>();
	for (const layer of effect.layers) {
		const k = layer.art?.assetKey;
		if (typeof k === 'string' && k) keys.add(k);
	}
	return [...keys];
}

export async function exportEffects(
	clientKey: string,
	projectKey: string,
): Promise<EffectExportIndex> {
	const deployPrefix = `${SUB.deploy(clientKey, projectKey)}/`;
	const effectsPrefix = `${deployPrefix}effects/`;

	// Load + normalize every saved effect (the normalize is the gatekeeper — only the pure
	// doc travels). A doc that fails to load/parse is skipped, never a hard failure.
	const rows = await listEffects(clientKey, projectKey);
	const effects: EffectDoc[] = [];
	for (const row of rows) {
		const raw = await getObjectText(fxDocKey(clientKey, projectKey, row.id));
		if (!raw) continue;
		let doc: EffectDoc;
		try {
			doc = normalizeEffectDoc(JSON.parse(raw), row.id);
		} catch {
			continue;
		}
		// The slugged id is authoritative for the file stem (matches the source `<id>.fx.json`).
		doc.id = row.id;
		effects.push(doc);
	}

	// Write each pure doc + the index the game registers, tracking what we wrote so stale
	// objects from a previous export get pruned (the deploy mirror then matches the source).
	const written = new Set<string>();
	for (const doc of effects) {
		const docKey = `${effectsPrefix}${doc.id}.json`;
		await putObjectText(docKey, JSON.stringify(doc, null, '\t'), 'application/json');
		written.add(docKey);
	}

	const index = effects.map((e) => ({ id: e.id, name: e.name, layers: e.layers.length }));
	const indexKey = `${effectsPrefix}index.json`;
	await putObjectText(indexKey, JSON.stringify(index, null, '\t'), 'application/json');
	written.add(indexKey);

	// Prune leftovers so deploy/effects/ mirrors the project's current effects exactly.
	const existing = await listAllKeys(effectsPrefix);
	const stale = existing.filter((k) => !written.has(k));
	await deleteObjects(stale);

	const referenced = new Set<string>();
	for (const e of effects) for (const k of assetKeysOf(e)) referenced.add(k);

	return { effects, referencedAssetKeys: [...referenced] };
}
