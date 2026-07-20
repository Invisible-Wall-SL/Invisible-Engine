/**
 * Export a project's Invisible Flipbook clips into the game-loadable `deploy/` subtree —
 * the FlipbookClip analogue of `effectExport.ts` / `flowExport.ts` / `editorArtExport.ts`.
 * Closes the "authored the clip in /flipbook, it saves to R2, but the shipped game has no
 * clips" gap (docs/design/invisible-flipbook.md §"Travel", RULE 8).
 *
 * Like an EffectDoc — and UNLIKE the art/font/symbol exports — a clip carries NO binary assets
 * of its own: its frames are regions of an atlas the editor-art export already ships (a clip
 * references its sheet by `assetKey` and never re-packs textures). So this is a pure-JSON copy
 * with no texture mirroring. A project holds MANY named clips, so each is written under its own
 * deploy file plus a lightweight index:
 *
 *   <client>/<project>/clips/<id>.clip.json        ← the authored doc (saved by /api/flipbook/save)
 *   <client>/<project>/deploy/clips/<id>.json      ← the exported clip (this writes it)
 *   <client>/<project>/deploy/clips/index.json     ← the list the game registers
 *
 * The existing transport then carries it: `bake-editor-doc.mjs` triggers this and embeds the
 * returned `clips` in the baked bundle as `flipbooks`; `pull-project-assets.mjs` mirrors
 * `deploy/` (incl. `deploy/clips/`) into `static/assets/`. The game registers it via
 * `BakedBundle.flipbooks` (`bakedFlipbooks()` → `registerFlipbooks`) — absent ⇒ no clips (parity).
 *
 * Every clip travels through `normalizeFlipbookDoc` (the same contract `/api/flipbook/save` and
 * the offline fixtures use) so only the PURE doc ships and duplicate ids collapse exactly as the
 * runtime registry would resolve them. Stale `deploy/clips/` objects from a previous export are
 * pruned, so a de-authored project bakes no clips (parity). Idempotent — re-running converges.
 *
 * ── DIVERGENCE FROM THE EFFECTS CHAIN: no reachability filter ──────────────────────────────
 * The bake prunes UNREACHABLE effects (`bake-editor-doc.mjs`, the "Ship only REACHABLE effects"
 * block) — an effect nothing places, rig-binds, or event-triggers never reaches the game. Clips
 * deliberately ship in FULL: no consumer references a `clipId` yet (design-doc step 6 — FX,
 * Symbols and Scene Editor bindings — is unbuilt), so an equivalent reachability filter would
 * compute "referenced by nothing" for every clip and ship ZERO. A clip is a name list plus two
 * numbers, so shipping them all costs negligible bytes. Add the filter here once consumers exist
 * and a clip can actually be shown to be referenced.
 */
import type { FlipbookClip } from 'engine-flipbook';
import { loadFlipbookDoc } from './flipbookStorage';
import { SUB } from './projectPaths';
import { deleteObjects, listAllKeys, putObjectText } from './r2';

export interface FlipbookExportIndex {
	/** The exported, normalized clips. Empty when the project authored nothing — the
	 *  parity-safe fall-through (no clips ship). */
	clips: FlipbookClip[];
	/** Every distinct source-sheet `assetKey` the exported clips reference. The bake checks each
	 *  against the atlases it ships (`editorArt.sheets`) — a dangling key = a clip whose frames
	 *  have no textures. Empty when no clip references a sheet. */
	referencedAssetKeys: string[];
}

export async function exportClips(
	clientKey: string,
	projectKey: string,
): Promise<FlipbookExportIndex> {
	const deployPrefix = `${SUB.deploy(clientKey, projectKey)}/`;
	const clipsDeployPrefix = `${deployPrefix}clips/`;

	// `loadFlipbookDoc` lists + parses every `<id>.clip.json` and runs the collection normalizer
	// (the gatekeeper — editor-only state can never reach the deploy artifact, and duplicate ids
	// collapse last-wins). A corrupt clip is skipped there, never a hard failure.
	const doc = await loadFlipbookDoc(clientKey, projectKey);
	const clips = doc.clips;

	// Write each pure clip + the index the game registers, tracking what we wrote so stale objects
	// from a previous export get pruned (the deploy mirror then matches the source).
	const written = new Set<string>();
	for (const clip of clips) {
		const docKey = `${clipsDeployPrefix}${clip.id}.json`;
		await putObjectText(docKey, JSON.stringify(clip, null, '\t'), 'application/json');
		written.add(docKey);
	}

	const index = clips.map((c) => ({ id: c.id, name: c.name, frames: c.frames.length }));
	const indexKey = `${clipsDeployPrefix}index.json`;
	await putObjectText(indexKey, JSON.stringify(index, null, '\t'), 'application/json');
	written.add(indexKey);

	// Prune leftovers so deploy/clips/ mirrors the project's current clips exactly.
	const existing = await listAllKeys(clipsDeployPrefix);
	const stale = existing.filter((k) => !written.has(k));
	await deleteObjects(stale);

	const referenced = new Set<string>();
	for (const clip of clips) if (clip.assetKey) referenced.add(clip.assetKey);

	return { clips, referencedAssetKeys: [...referenced] };
}
