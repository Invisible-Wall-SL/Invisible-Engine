/**
 * Server-side Publish for the Invisible Game Maker (design doc Phase 1). Turns an
 * online-authored project into an immediately-playable game on the Invisible Test
 * Server — with NO desktop launcher, NO per-game repo, and NO build:
 *
 *   1. resolve the project's client + game type, refuse a game with its own desktop build,
 *      then the sound (1a) + flow (1b) gates,
 *   2. assemble the runtime bundle ONCE (the same `buildRuntimeBundle` the live
 *      `/api/editor/runtime` runs), re-check the flow it actually ships, and freeze it +
 *      its `deploy/` files as an immutable published snapshot (`publishedRuntime.ts`),
 *      then point players at it,
 *   3. mint/get the project's read-only token (gates the public fetches),
 *   4. map gameType → mock `protocol` + shared `runtime` bundle id,
 *   5. merge the test-server manifest (`test_server/games.json`) — read-modify-write,
 *   6. upsert the `games` registry row so the game shows in the portal,
 *   7. best-effort POST the test server's `/refresh`.
 *
 * "Publish" is a DATA + MANIFEST operation: re-running it re-snapshots + re-registers,
 * never rebuilds. Players boot the snapshot; authors (launcher links) boot live data.
 */
import type { SoundLicenceSummary } from '$lib/soundUsage';
import { ENV } from './env';
import {
	checkFlowV2ForPublish,
	checkShippedFlowV2,
	describeFlowErrors,
	invalidFlowMessage,
	type FlowPublishCheck,
} from './flowV2Validation';
import { createGame, gameExists, renameGame, setGameProject, setGameUrl } from './games';
import { resolveMockContract } from './mockContract';
import { paytableDriftDetails, paytableDriftMessage } from './paytableDrift';
import { UNASSIGNED_CLIENT } from './projectPaths';
import { getOrMintReadToken, projectClientKey, projectGameType, projectName } from './projects';
import { listAllObjects } from './r2';
import {
	commitSnapshot,
	discardSnapshot,
	stageSnapshot,
	type SnapshotMeta,
} from './publishedRuntime';
import { buildRuntimeBundle } from './runtimeBundle';
import { checkSoundsForPublish } from './soundPublishCheck';
import { loadGameConfigDoc } from './gameConfigStorage';
import { invalidateRuntimeBundle, withDeployWrite } from './runtimeBundleCache';
import { SHARED_RUNTIME_ID, runtimePointer, upsertTestServerGame } from './testServerManifest';
import { postTestServerRefresh } from './testServerRefresh';

export interface PublishResult {
	/** The game key (== the project key). */
	key: string;
	/** The full playable game URL on the test server (also returned as `playUrl`). */
	url: string;
	playUrl: string;
	/** What this publish shipped, licence-wise — surfaced ONCE, here, because the moment a build
	 *  goes out is when "who owns this audio" stops being paperwork. Never blocking. */
	sounds: SoundLicenceSummary;
	/** What this publish shipped, flow-wise. `absent` = no stored flow, so the game runs without
	 *  the flow's screens (free-spin intro/outro); `overridden` = shipped despite validation errors. */
	flow: FlowPublishCheck['status'] | 'overridden';
	/** Spine bundles the scene or the symbols doc references that resolved to nothing, so they
	 *  ship as nothing (`EditorArtIndex.spinesMissing` + `SymbolExportIndex.spinesMissing`).
	 *  Never blocking — shown next to the publish so the author re-binds them. */
	spinesMissing: { scene: string[]; symbols: string[] };
	/** The immutable snapshot players now boot. */
	snapshot: SnapshotMeta;
}

/**
 * Thrown when a project must NOT be published through the generic online runtime —
 * e.g. it already has its own built bundle on the test server (a desktop-launcher
 * game like Book of Borut / Hot Fruits). The endpoint surfaces the message as a 409
 * so the UI explains why, instead of silently clobbering a real game.
 */
export class PublishBlockedError extends Error {
	constructor(
		message: string,
		/** What blocked it, for a UI that can offer a way through. `own-bundle` never can — it would
		 *  clobber a real game — while `unapproved-sounds`, `invalid-flow` and `paytable-drift` are
		 *  deliberate-override cases (the last two for the owner role only; see the publish endpoint). */
		readonly reason:
			| 'own-bundle'
			| 'unapproved-sounds'
			| 'invalid-flow'
			| 'paytable-drift' = 'own-bundle',
		/** The names behind the refusal, so the UI lists them instead of saying "something". */
		readonly details: string[] = [],
	) {
		super(message);
		this.name = 'PublishBlockedError';
	}
}

/**
 * True when a game key already has its OWN built bundle uploaded at
 * `test_server/<key>/...` (the desktop-launcher publish path). Those games are
 * served from their own files with their real `protocol` and NO `runtime` field;
 * the online Game Maker (generic runtime) must never overwrite them.
 */
async function hasOwnBuiltBundle(key: string): Promise<boolean> {
	const objects = await listAllObjects(`test_server/${key}/`);
	return objects.some((o) => !o.key.endsWith('/'));
}

/**
 * The prebuilt runtime bundle id a game is served from (`test_server/_runtime/<runtime>/`).
 *
 * EVERY game type shares ONE bundle, and that is a decision, not a gap — it replaces the old
 * "add a runtime per type" TODO, which Phase D of `docs/design/game-type-templates.md` found to be
 * the wrong shape:
 *
 *   - `runtime-release.yml` builds a runtime FROM `apps/<id>`. A `_runtime/ways` would therefore be
 *     built from `apps/ways`, which is still the vanilla upstream sample: no flow-v2 interpreter,
 *     no editor scenes, no symbols registry, no game-config resolver. It cannot consume a runtime
 *     bundle at all, so pointing a ways project at it would not give that project a ways game — it
 *     would break it.
 *   - The shared bundle (built from `apps/lines`, which carries the whole engine) now ADAPTS: the
 *     config states its `winModel`, `activeWinModel()` reads it, payline-specific surfaces stand
 *     down for a non-lines model, and `ways` book events are identical to `lines` anyway.
 *
 * So a bundle per type buys nothing for `ways` and costs a broken game. It becomes worth revisiting
 * only for a type that needs bespoke COMPILED code the shared bundle cannot carry — `cluster`'s
 * tumble board is the first real candidate.
 *
 * The id stays `'lines'` for compatibility: every published manifest already references it, and
 * `runtime-release.yml` auto-publishes it on every engine merge. The name is historical — it means
 * "the shared engine runtime", not "the lines game", which is why the Game Maker card no longer
 * PRINTS it (it read as a game type: "lines runtime" on a cluster game). See `SHARED_RUNTIME_ID`.
 */
function runtimeFor(_gameType: string): string {
	return SHARED_RUNTIME_ID;
}

/**
 * Publish (or re-publish) a project as a playable test-server game. `projectKey` is
 * the BARE launcher project key; it is also used verbatim as the GAME key.
 */
export async function publishGame(
	projectKey: string,
	launcherOrigin: string,
	options: {
		allowUnapproved?: boolean;
		allowInvalidFlow?: boolean;
		allowPaytableDrift?: boolean;
		by?: string;
	} = {},
): Promise<PublishResult> {
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	const gameType = await projectGameType(projectKey);
	const name = (await projectName(projectKey)) ?? projectKey;
	const key = projectKey;

	// GUARD: never clobber a game that has its OWN built bundle. Desktop-launcher
	// games (Book of Borut, Hot Fruits) live at test_server/<key>/ and are served
	// from there with their real protocol + NO runtime field. Stamping
	// runtime:'lines' on one would shadow its real bundle with the generic lines
	// runtime + the wrong mock RGS — exactly the Book-of-Borut regression. The online
	// Game Maker only publishes games authored ENTIRELY online (no per-key bundle).
	// Checked first: it is final and costs one listing, where the assemble costs ~20s.
	if (await hasOwnBuiltBundle(key)) {
		throw new PublishBlockedError(
			`"${name}" already has its own published build (a desktop-launcher game), so the ` +
				`online Game Maker won't republish it — that would overwrite the real game with the ` +
				`generic runtime. Re-publish it from the desktop launcher instead.`,
		);
	}

	// 1a. THE SOUND GATE. Before anything is written: a sound the game plays that nobody has
	// approved must not reach players unnoticed. Deliberately refused here rather than dropped from
	// the export — a missing sound is SILENT, and silence is the one defect QA cannot see.
	const soundCheck = await checkSoundsForPublish(clientKey, projectKey);
	if (soundCheck.unapproved.length && !options.allowUnapproved) {
		throw new PublishBlockedError(
			`${soundCheck.unapproved.length} sound${soundCheck.unapproved.length === 1 ? '' : 's'} ` +
				`the game plays ${soundCheck.unapproved.length === 1 ? 'is' : 'are'} still marked draft: ` +
				`${soundCheck.unapproved.join(', ')}. Approve them in Invisible Sound, or publish anyway.`,
			'unapproved-sounds',
			soundCheck.unapproved,
		);
	}

	// 1b. THE FLOW GATE. The v2 flow drives the game's screens, and the editor's Validation panel is
	// advisory — so an error there (a hold nothing releases, a dead second wire, an unresolved ref)
	// would otherwise reach players as a hung or silently skipped round. Checked here on the STORED
	// flow so a refusal is instant, and again below on the flow the snapshot actually freezes — an
	// autosave during the assemble must not slip past the gate into a player's game.
	const refuseFlow = (check: FlowPublishCheck) => {
		if (check.status !== 'invalid' || options.allowInvalidFlow) return;
		throw new PublishBlockedError(
			invalidFlowMessage(check.errors),
			'invalid-flow',
			describeFlowErrors(check.errors),
		);
	};
	refuseFlow(await checkFlowV2ForPublish(clientKey, projectKey));

	// 1c. THE PAYTABLE GATE. A project that captured its partner's declared paytable must not ship
	// quoting other prices unnoticed — the info page is built from the authored config, the partner
	// pays its own. No capture ⇒ nothing to compare ⇒ never gated.
	const drift = paytableDriftDetails(await loadGameConfigDoc(clientKey, projectKey));
	if (drift.length && !options.allowPaytableDrift) {
		throw new PublishBlockedError(paytableDriftMessage(drift), 'paytable-drift', drift);
	}

	// 2. Assemble once, gate what ships, freeze it. All under the project's deploy lock, so the
	// `deploy/` tree the snapshot copies is exactly the one this assemble wrote. The snapshot is only
	// STAGED here: players switch to it at the end, once the game is registered, so a publish that
	// fails part-way leaves them on the previous version.
	const { bundle, flowCheck, snapshot } = await withDeployWrite(projectKey, async () => {
		const assembled = await buildRuntimeBundle(projectKey, false);
		const shipped = await checkShippedFlowV2(clientKey, projectKey, {
			flowV2: assembled.flowV2,
			flowV2Library: assembled.flowV2Library,
			scenes: assembled.doc.scenes,
		});
		refuseFlow(shipped);
		const engine = await runtimePointer(runtimeFor(gameType));
		const staged = await stageSnapshot(clientKey, projectKey, assembled, {
			by: options.by ?? null,
			flow: shipped.status === 'invalid' ? 'overridden' : shipped.status,
			runtime: runtimeFor(gameType),
			engine: engine ? { version: engine.version, shortCommit: engine.shortCommit } : null,
		});
		return { bundle: assembled, flowCheck: shipped, snapshot: staged };
	});
	if (flowCheck.status === 'invalid') {
		console.warn(
			`[publish] ${projectKey}: published with ${flowCheck.errors.length} flow error(s) by ` +
				`override: ${describeFlowErrors(flowCheck.errors).join(' | ')}`,
		);
	}
	// The stranded-spine report, which this path used to compute and throw away — so the ONLINE
	// publish (the one that shipped the missing free-spin cage) said nothing, and the only warning
	// was the browser console at boot, right next to the throw it was meant to pre-empt. Logged,
	// not thrown: a missing spine is visible on screen like a blank sprite, so it warns the way
	// the region guard does rather than blocking a publish on legacy data.
	const spinesMissing = {
		scene: bundle.editorArt.spinesMissing ?? [],
		symbols: bundle.symbols.index.spinesMissing ?? [],
	};
	if (spinesMissing.scene.length > 0) {
		console.warn(
			`[publish] ${projectKey}: ${spinesMissing.scene.length} placed spine bundle(s) resolved to ` +
				`NOTHING and will be MISSING in-game: ${spinesMissing.scene.join(', ')}. A bundle under ` +
				"another project's prefix is not exported into this game — re-pick the rig from this " +
				'project, or promote it to the shared library (/admin → Spines).',
		);
	}
	if (spinesMissing.symbols.length > 0) {
		console.warn(
			`[publish] ${projectKey}: ${spinesMissing.symbols.length} bound symbol spine bundle(s) ` +
				`resolved to NOTHING and will be MISSING in-game: ${spinesMissing.symbols.join(', ')}. ` +
				'Re-bind the symbol in Invisible Symbols, or promote the rig to the shared library.',
		);
	}
	// An authoring boot's cached assemble predates this publish's exports. Drop it.
	invalidateRuntimeBundle(projectKey);

	const base = ENV.GAMES_BASE_URL.replace(/\/+$/, '');
	const gamesHost = base.replace(/^https?:\/\//, '');
	const origin = launcherOrigin.replace(/\/+$/, '');
	let url: string;
	// Steps 3-6 register the game. Players switch to the new snapshot only once they have all
	// succeeded; a failure drops the staged copy and leaves them on the previous version.
	try {
		// 3. The public read-only token (gates /api/editor/runtime + /api/deploy/f/...).
		const readToken = await getOrMintReadToken(projectKey);
		if (!readToken) throw new Error(`Unknown project '${projectKey}'.`);

		// The project's math contract for the mock RGS (protocol + grid + cascade), from its Game Config.
		// The SAME derivation `/api/game-config/mock` serves live, so the snapshot written below can only
		// ever be an older copy of the live answer — never a different one.
		const { protocol, grid, cascade } = await resolveMockContract(projectKey);
		const runtime = runtimeFor(gameType);

		// 4 + 5. Merge the test-server manifest (read-modify-write, preserves siblings).
		//
		// `projectKey` + `docBase` + `readToken` are what turn the entry from a FROZEN copy of the math
		// into a pointer back at the live one: the test server re-reads `/api/game-config/mock` with them,
		// so editing `/config` changes the board the mock deals without a republish. The grid/cascade
		// below stay as the fallback for when that fetch can't be made (launcher down, entry published
		// before this). None of the three is a new exposure — all appear verbatim in the public game URL
		// built below.
		//
		// `projectKey` is written even though `key === projectKey` here (line above), because the test
		// server cannot tell that from the entry — and the OTHER publisher
		// (`scripts/publish-game-bundle.mjs`) names games independently of their project. Stating it is
		// what lets that side read the same field instead of guessing from the key.
		await upsertTestServerGame(key, {
			protocol,
			name,
			runtime,
			updatedAt: new Date().toISOString(),
			projectKey,
			docBase: launcherOrigin.replace(/\/+$/, ''),
			readToken,
			...(grid ? { grid } : {}),
			...(cascade === undefined ? {} : { cascade }),
		});

		// 6. Register the game. The launch URL boots the generic runtime (`?runtime=1`)
		//    against THIS project's published snapshot, gated by the read token, with the
		//    per-key mock RGS proxy. `editorDocBase` points the runtime back at this
		//    launcher for its /api/editor/runtime + asset fetches.
		url =
			`${base}/${key}/?runtime=1&project=${encodeURIComponent(projectKey)}` +
			`&k=${encodeURIComponent(readToken)}` +
			`&editorDocBase=${encodeURIComponent(origin)}` +
			`&rgs_url=${gamesHost}/api/${key}` +
			`&sessionID=demo&lang=en&currency=USD&device=desktop`;

		if (await gameExists(key)) {
			await setGameUrl(key, url);
			await renameGame(key, name);
			await setGameProject(key, projectKey);
		} else {
			await createGame(key, name, url, projectKey);
		}

		await commitSnapshot(clientKey, projectKey, snapshot);
	} catch (e) {
		await discardSnapshot(clientKey, projectKey, snapshot.id).catch(() => undefined);
		throw e;
	}
	console.info(
		`[publish] ${projectKey}: snapshot ${snapshot.id} is live — ${snapshot.files} files, ` +
			`${(snapshot.bytes / 1e6).toFixed(1)} MB`,
	);

	// 7. Best-effort refresh — Phase 0 made /refresh 202 + background-hydrate, so a
	//    slow or failing call must never fail the publish.
	try {
		await postTestServerRefresh();
	} catch {
		// ignore — the test server re-hydrates on its own cadence too.
	}

	return {
		key,
		url,
		playUrl: url,
		sounds: soundCheck.licences,
		flow: flowCheck.status === 'invalid' ? 'overridden' : flowCheck.status,
		spinesMissing,
		snapshot,
	};
}
