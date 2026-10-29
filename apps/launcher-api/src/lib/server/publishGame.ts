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
 *   4. map gameType → mock `protocol`, and the config's family → its `runtime` bundle id,
 *   5. merge the test-server manifest (`test_server/games.json`) — read-modify-write,
 *   6. upsert the `games` registry row so the game shows in the portal,
 *   7. best-effort POST the test server's `/refresh`.
 *
 * "Publish" is a DATA + MANIFEST operation: re-running it re-snapshots + re-registers,
 * never rebuilds. Players boot the snapshot; authors (launcher links) boot live data.
 */
import type { SoundLicenceSummary } from '$lib/soundUsage';
import { resolveFixedBugs } from './bugReportsStore';
import { ENV } from './env';
import {
	checkFlowV2ForPublish,
	checkShippedFlowV2,
	describeFlowErrors,
	flowGateRefusal,
	flowScreensMissing,
	type FlowPublishCheck,
} from './flowV2Validation';
import { createGame, gameExists, renameGame, setGameProject, setGameUrl } from './games';
import { mockContractOfBundle } from './mockContract';
import { primaryRespinMode, type GameConfigDoc } from 'game-config';
import { protocolFor } from './mockProtocol';
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
import { unshippedCustomKinds } from './shaderExport';
import { checkSoundsForPublish, type SoundPublishCheck } from './soundPublishCheck';
import { unplayableFamilyMessage } from './familyGate';
import { roomsAddressRefusal, withRoomsUrl } from './onlineLaunch';
import { loadGameConfigDoc } from './gameConfigStorage';
import { invalidateRuntimeBundle, withDeployWrite } from './runtimeBundleCache';
import { runtimePointer, upsertTestServerGame } from './testServerManifest';
import { chooseRuntime, kindFamilyRefusal } from './runtimeChoice';
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
	/** Rig bundles the scene or the symbols doc references that resolved to nothing, so they
	 *  ship as nothing (`EditorArtIndex.spinesMissing` + `SymbolExportIndex.spinesMissing`).
	 *  Never blocking — shown next to the publish so the author re-binds them. */
	spinesMissing: { scene: string[]; symbols: string[] };
	/** Custom Element FX kinds (`custom:<id>`) the game names but does not ship: they play nothing,
	 *  their graph deleted or not compiling (`unshippedCustomKinds`). Never blocking. */
	shaderEffectsMissing: string[];
	/** Flow containers (ids) whose screen the shipped layout does not have: they draw nothing, and a
	 *  step waiting on one never continues. Never blocking — an author may be mid-edit. */
	flowScreensMissing: string[];
	/** A `holdAndWin` project whose shipped config has no `holdAndWin` block — the mock deals its
	 *  base game as plain lines and no feature ever triggers. Never blocking; the fix is saving
	 *  `/config` once (a project scaffolded before the kind's config was seeded). */
	holdAndWinConfigMissing: boolean;
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
		 *  clobber a real game — and neither can `unplayable-family`, `kind-family` (a config of another
		 *  family than the project's kind), `runtime-unreleased` (its family's runtime has no release)
		 *  or `flow-wrong-kind` (a flow left from a kind change), a game
		 *  the runtime cannot play, nor `no-game-server` (an online game while the launcher has no
		 *  game server address to write into its launch URL);
		 *  `unapproved-sounds`, `invalid-flow` and `paytable-drift` are deliberate-override cases (the
		 *  last two for the owner role only; see the publish endpoint). */
		readonly reason:
			| 'own-bundle'
			| 'unplayable-family'
			| 'kind-family'
			| 'runtime-unreleased'
			| 'no-game-server'
			| 'flow-wrong-kind'
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
export async function hasOwnBuiltBundle(key: string): Promise<boolean> {
	const objects = await listAllObjects(`test_server/${key}/`);
	return objects.some((o) => !o.key.endsWith('/'));
}

/** The flow gate's refusal for a verdict on a project of kind `gameType` (`flowGateRefusal`). */
const flowRefusal = (
	check: FlowPublishCheck,
	gameType: string,
	allowInvalidFlow?: boolean,
): PublishBlockedError | null => {
	const refusal = flowGateRefusal(check, gameType, allowInvalidFlow);
	return refusal && new PublishBlockedError(refusal.message, refusal.reason, refusal.details);
};

type GateOptions = {
	allowUnapproved?: boolean;
	allowInvalidFlow?: boolean;
	allowPaytableDrift?: boolean;
	/** Stands in for the stored Game Config — the config a caller is about to save. */
	config?: GameConfigDoc | null;
};

/**
 * Step 1 of {@link publishGame}: every gate it runs before the ~20 s assemble, in order, as a
 * verdict rather than a throw — the own-bundle guard, then sounds, the stored flow, the family and the paytable.
 */
async function runPublishGates(
	clientKey: string,
	projectKey: string,
	name: string,
	gameType: string,
	options: GateOptions,
): Promise<{ refusal: PublishBlockedError } | { refusal: null; soundCheck: SoundPublishCheck }> {
	// GUARD: never clobber a game that has its OWN built bundle. Desktop-launcher
	// games (Book of Borut, Hot Fruits) live at test_server/<key>/ and are served
	// from there with their real protocol + NO runtime field. Stamping
	// runtime:'lines' on one would shadow its real bundle with the generic lines
	// runtime + the wrong mock RGS — exactly the Book-of-Borut regression. The online
	// Game Maker only publishes games authored ENTIRELY online (no per-key bundle).
	// Checked first: it is final and costs one listing, where the assemble costs ~20s.
	if (await hasOwnBuiltBundle(projectKey)) {
		return {
			refusal: new PublishBlockedError(
				`"${name}" already has its own published build (a desktop-launcher game), so the ` +
					`online Game Maker won't republish it — that would overwrite the real game with the ` +
					`generic runtime. Re-publish it from the desktop launcher instead.`,
			),
		};
	}

	// 1a. THE SOUND GATE. Before anything is written: a sound the game plays that nobody has
	// approved must not reach players unnoticed. Deliberately refused here rather than dropped from
	// the export — a missing sound is SILENT, and silence is the one defect QA cannot see.
	const soundCheck = await checkSoundsForPublish(clientKey, projectKey);
	if (soundCheck.unapproved.length && !options.allowUnapproved) {
		return {
			refusal: new PublishBlockedError(
				`${soundCheck.unapproved.length} sound${soundCheck.unapproved.length === 1 ? '' : 's'} ` +
					`the game plays ${soundCheck.unapproved.length === 1 ? 'is' : 'are'} still marked draft: ` +
					`${soundCheck.unapproved.join(', ')}. Approve them in Invisible Sound, or publish anyway.`,
				'unapproved-sounds',
				soundCheck.unapproved,
			),
		};
	}

	// 1b. THE FLOW GATE. The v2 flow drives the game's screens, and the editor's Validation panel is
	// advisory — so an error there (a hold nothing releases, a dead second wire, an unresolved ref)
	// would otherwise reach players as a hung or silently skipped round. Checked here on the STORED
	// flow so a refusal is instant, and again on the flow the snapshot actually freezes — an
	// autosave during the assemble must not slip past the gate into a player's game. A flow of
	// another family than the project's kind (left from an `/admin` kind change) is refused with no
	// override.
	const flow = flowRefusal(
		await checkFlowV2ForPublish(clientKey, projectKey, options.config),
		gameType,
		options.allowInvalidFlow,
	);
	if (flow) return { refusal: flow };

	const config =
		options.config === undefined ? await loadGameConfigDoc(clientKey, projectKey) : options.config;
	// 1c. THE FAMILY GATE. A config the runtime cannot play yet (`mechanicFor().unplayable`: an
	// RGS-decided arcade game, until P10.10). No override: there is nothing a player could be
	// shown. A playable non-slot game publishes to our test server only; a rules one is dealt the
	// refusing `freePlay` mock.
	const unplayable = unplayableFamilyMessage(config);
	if (unplayable) return { refusal: new PublishBlockedError(unplayable, 'unplayable-family') };
	// The config's family picks the runtime (`runtimeFor`), so it must be the kind's family too.
	const kindFamily = kindFamilyRefusal(gameType, config);
	if (kindFamily) return { refusal: new PublishBlockedError(kindFamily, 'kind-family') };
	// An online game boots only with its game server's address in the launch URL (`rooms_url`).
	const noServer = roomsAddressRefusal(config, ENV.GAME_SERVER_URL);
	if (noServer) return { refusal: new PublishBlockedError(noServer, 'no-game-server') };

	// 1d. THE PAYTABLE GATE. A project that captured its partner's declared paytable must not ship
	// quoting other prices unnoticed — the info page is built from the authored config, the partner
	// pays its own. No capture ⇒ nothing to compare ⇒ never gated.
	const drift = paytableDriftDetails(config);
	if (drift.length && !options.allowPaytableDrift) {
		return {
			refusal: new PublishBlockedError(paytableDriftMessage(drift), 'paytable-drift', drift),
		};
	}
	return { refusal: null, soundCheck };
}

/**
 * What {@link publishGame} would refuse before publishing `projectKey` now, or `null` — its gates,
 * without the publish. `config` checks a config about to be saved in place of the stored one (the
 * Book-of migration gates its republish before it writes anything).
 */
export async function publishGateRefusal(
	projectKey: string,
	options: GateOptions = {},
): Promise<PublishBlockedError | null> {
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	const name = (await projectName(projectKey)) ?? projectKey;
	const gameType = await projectGameType(projectKey);
	return (await runPublishGates(clientKey, projectKey, name, gameType, options)).refusal;
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

	const gates = await runPublishGates(clientKey, projectKey, name, gameType, options);
	if (gates.refusal) throw gates.refusal;
	const { soundCheck } = gates;
	const refuseFlow = (check: FlowPublishCheck) => {
		const refusal = flowRefusal(check, gameType, options.allowInvalidFlow);
		if (refusal) throw refusal;
	};

	// 2. Assemble once, gate what ships, freeze it. All under the project's deploy lock, so the
	// `deploy/` tree the snapshot copies is exactly the one this assemble wrote. The snapshot is only
	// STAGED here: players switch to it at the end, once the game is registered, so a publish that
	// fails part-way leaves them on the previous version.
	const { bundle, flowCheck, snapshot, runtime } = await withDeployWrite(projectKey, async () => {
		const assembled = await buildRuntimeBundle(projectKey, false);
		const shipped = await checkShippedFlowV2(clientKey, projectKey, {
			flowV2: assembled.flowV2,
			flowV2Library: assembled.flowV2Library,
			scenes: assembled.doc.scenes,
			settings: assembled.doc.settings,
			components: [
				...Object.values(assembled.componentDefs),
				...(assembled.componentVersions ?? []),
			],
			config: assembled.config,
			shaderEffects: assembled.shaderEffects,
		});
		refuseFlow(shipped);
		// Again on the config that ships: the assembly re-reads it, so an edit since the gates ran
		// could have changed its family.
		const kindFamily = kindFamilyRefusal(gameType, assembled.config);
		if (kindFamily) throw new PublishBlockedError(kindFamily, 'kind-family');
		const noServer = roomsAddressRefusal(assembled.config, ENV.GAME_SERVER_URL);
		if (noServer) throw new PublishBlockedError(noServer, 'no-game-server');
		const chosen = await chooseRuntime(assembled.config, runtimePointer);
		if (chosen.unreleased)
			throw new PublishBlockedError(
				`The ${chosen.id} runtime has no release yet, so this game has nothing to be played on. ` +
					'Run "Runtime release" for it, then publish again.',
				'runtime-unreleased',
			);
		const engine = chosen.pointer;
		const staged = await stageSnapshot(clientKey, projectKey, assembled, {
			by: options.by ?? null,
			flow: shipped.status === 'invalid' ? 'overridden' : shipped.status,
			runtime: chosen.id,
			engine: engine ? { version: engine.version, shortCommit: engine.shortCommit } : null,
		});
		return { bundle: assembled, flowCheck: shipped, snapshot: staged, runtime: chosen.id };
	});
	if (flowCheck.status === 'invalid') {
		console.warn(
			`[publish] ${projectKey}: published with ${flowCheck.errors.length} flow error(s) by ` +
				`override: ${describeFlowErrors(flowCheck.errors).join(' | ')}`,
		);
	}
	// The stranded-rig report, which this path used to compute and throw away — so the ONLINE
	// publish (the one that shipped the missing free-spin cage) said nothing, and the only warning
	// was the browser console at boot, right next to the throw it was meant to pre-empt. Logged,
	// not thrown: a missing rig is visible on screen like a blank sprite, so it warns the way
	// the region guard does rather than blocking a publish on legacy data.
	const rigsMissing = {
		scene: bundle.editorArt.spinesMissing ?? [],
		symbols: bundle.symbols.index.spinesMissing ?? [],
	};
	if (rigsMissing.scene.length > 0) {
		console.warn(
			`[publish] ${projectKey}: ${rigsMissing.scene.length} placed rig bundle(s) resolved to ` +
				`NOTHING and will be MISSING in-game: ${rigsMissing.scene.join(', ')}. A bundle under ` +
				"another project's prefix is not exported into this game — re-pick the rig from this " +
				'project, or promote it to the shared library (/admin → rigs).',
		);
	}
	if (rigsMissing.symbols.length > 0) {
		console.warn(
			`[publish] ${projectKey}: ${rigsMissing.symbols.length} bound symbol rig bundle(s) ` +
				`resolved to NOTHING and will be MISSING in-game: ${rigsMissing.symbols.join(', ')}. ` +
				'Re-bind the symbol in Invisible Symbols, or promote the rig to the shared library.',
		);
	}
	// A custom Element FX the game names but does not ship plays nothing, silently: its graph was
	// deleted, or no longer compiles. Logged like the rigs: the rest of the game is fine.
	const shaderEffectsMissing = unshippedCustomKinds({ ...bundle });
	if (shaderEffectsMissing.length > 0) {
		console.warn(
			`[publish] ${projectKey}: ${shaderEffectsMissing.length} shader effect(s) named in the game ` +
				`will play NOTHING: ${shaderEffectsMissing.join(', ')}. Its graph was deleted or does not ` +
				'compile — fix or re-save it, or pick another effect.',
		);
	}
	const holdAndWinConfigMissing =
		gameType === 'holdAndWin' && !primaryRespinMode(bundle.config?.modes);
	if (holdAndWinConfigMissing) {
		console.warn(
			`[publish] ${projectKey}: a Hold and Win project with no Hold and Win mode in its Game ` +
				'Config — the mock deals it plain lines. Save the config once in /config and re-publish.',
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

		// The project's math contract for the mock RGS (protocol + grid + cascade), derived from the
		// bundle this publish freezes — the config players are about to boot — by the SAME derivation
		// `/api/game-config/mock?source=published` serves, so the fallback copy written below can only
		// ever be an older copy of the on-demand answer, never a different one.
		const { protocol, grid, cascade } = mockContractOfBundle(
			protocolFor(gameType),
			bundle,
			projectKey,
			gameType,
		);

		// 4 + 5. Merge the test-server manifest (read-modify-write, preserves siblings).
		//
		// `projectKey` + `docBase` + `readToken` are what turn the entry from a FROZEN copy of the math
		// into a pointer back at the project: the test server re-reads `/api/game-config/mock` with them
		// — the published contract for players, the live one for authoring boots — so a republish,
		// a rollback or an authoring edit reaches the matching mock with nothing else to remember. The
		// grid/cascade below stay as the fallback for when that fetch can't be made (launcher down,
		// entry published before this). None of the three is a new exposure — all appear verbatim in the public game URL
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
		//    An online game also names its game server (`rooms_url`).
		url = withRoomsUrl(
			`${base}/${key}/?runtime=1&project=${encodeURIComponent(projectKey)}` +
				`&k=${encodeURIComponent(readToken)}` +
				`&editorDocBase=${encodeURIComponent(origin)}` +
				`&rgs_url=${gamesHost}/api/${key}` +
				`&sessionID=demo&lang=en&currency=USD&device=desktop`,
			bundle.config,
			ENV.GAME_SERVER_URL,
		);

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

	// A repair run's fixes ship with this snapshot (ADR-0012 §4). Best effort and repeatable: a bug
	// that cannot be resolved here is resolved by hand, and never fails a publish.
	try {
		await resolveFixedBugs(projectKey, snapshot.id);
	} catch (e) {
		console.warn(`[publish] ${projectKey}: could not resolve repaired bugs:`, e);
	}

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
		spinesMissing: rigsMissing,
		shaderEffectsMissing,
		flowScreensMissing: flowScreensMissing(bundle.flowV2, bundle.doc.scenes),
		holdAndWinConfigMissing,
		snapshot,
	};
}
