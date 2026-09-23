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
 * still ship in FULL, but the reason has changed: consumers now exist (a symbol cell, a placed
 * `flipbook` node, and a rig-timeline `event.flipbook` binding), so a filter is finally BUILDABLE —
 * it is just not built. Writing one means walking all FOUR referrers, and the rig one does not live
 * in the layout doc at all: it is in the rig `.irig`, reachable only through the `rigFlipbooks`
 * manifest (`rigFlipbookExport.ts`). Missing a referrer would delete a clip that is genuinely in
 * use, which is worse than the bytes — a clip is a name list plus two numbers. Tracked in
 * `docs/status/flipbook.md` open item 3.
 */
import { clipSheetKeys, type FlipbookClip } from 'engine-flipbook';
import { collectPlayedClipIds } from './clipReachability';
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
	opts?: {
		/**
		 * Per-phase collector, surfaced as `flipbooks:<name>` in `/api/editor/runtime`'s
		 * `Server-Timing` — the same treatment `art` and `symbols` have.
		 *
		 * WHY. This exporter measured **18.2s** on `test6` with no internal visibility at all, which
		 * makes it the third-largest block in the assemble and the only one nobody has looked
		 * inside. Its shape is not obviously the latency-bound loop the other two turned out to be:
		 * `collectPlayedClipIds` walks the whole project for reachability, and the per-clip write
		 * loop is small JSON, so the cost could sit in either — or in the prune's `listAllKeys`.
		 * Guessing which is what these phases exist to stop.
		 */
		timings?: Record<string, number>;
	},
): Promise<FlipbookExportIndex> {
	/** Record a phase's elapsed ms under `flipbooks:<name>`, or run it untimed when no record was
	 *  passed (Publish and the desktop bake call this without one). */
	const phase = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
		if (!opts?.timings) return run();
		const startedAt = Date.now();
		try {
			return await run();
		} finally {
			opts.timings[`flipbooks:${name}`] = Date.now() - startedAt;
		}
	};
	const deployPrefix = `${SUB.deploy(clientKey, projectKey)}/`;
	const clipsDeployPrefix = `${deployPrefix}clips/`;

	// `loadFlipbookDoc` lists + parses every `<id>.clip.json` and runs the collection normalizer
	// (the gatekeeper — editor-only state can never reach the deploy artifact, and duplicate ids
	// collapse last-wins). A corrupt clip is skipped there, never a hard failure.
	const doc = await phase('doc', () => loadFlipbookDoc(clientKey, projectKey));
	// Ship only the clips something PLAYS, using the SAME reachability the art export uses. These
	// two must agree: gating the art alone leaves a registered clip whose sheet was never exported,
	// and the bake refuses that — a clip whose frames have no textures is an animation that plays
	// short without saying so. `null` means reachability is unknown, and then every clip ships.
	const played = await phase('reachability', () => collectPlayedClipIds(clientKey, projectKey));
	const clips = played ? doc.clips.filter((c) => played.has(c.id)) : doc.clips;
	const dropped = doc.clips.length - clips.length;
	if (dropped > 0) {
		console.log(
			`[clips] not shipping ${dropped} unplayed clip(s): ` +
				`${doc.clips
					.filter((c) => !clips.includes(c))
					.map((c) => c.id)
					.join(', ')}`,
		);
	}

	// Write each pure clip + the index the game registers, tracking what we wrote so stale objects
	// from a previous export get pruned (the deploy mirror then matches the source).
	const written = new Set<string>();
	await phase('write', async () => {
		for (const clip of clips) {
			const docKey = `${clipsDeployPrefix}${clip.id}.json`;
			await putObjectText(docKey, JSON.stringify(clip, null, '\t'), 'application/json');
			written.add(docKey);
		}
	});

	const index = clips.map((c) => ({ id: c.id, name: c.name, frames: c.frames.length }));
	const indexKey = `${clipsDeployPrefix}index.json`;
	await putObjectText(indexKey, JSON.stringify(index, null, '\t'), 'application/json');
	written.add(indexKey);

	// Prune leftovers so deploy/clips/ mirrors the project's current clips exactly.
	await phase('prune', async () => {
		const existing = await listAllKeys(clipsDeployPrefix);
		const stale = existing.filter((k) => !written.has(k));
		await deleteObjects(stale);
	});

	const referenced = new Set<string>();
	// EVERY sheet a clip touches, not just its primary: a clip may span pages via scoped
	// frames, and shipping only the primary would lose the rest of the animation.
	for (const clip of clips) for (const key of clipSheetKeys(clip)) referenced.add(key);

	return { clips, referencedAssetKeys: [...referenced] };
}
