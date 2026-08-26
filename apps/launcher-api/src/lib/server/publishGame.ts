/**
 * Server-side Publish for the Invisible Game Maker (design doc Phase 1). Turns an
 * online-authored project into an immediately-playable game on the Invisible Test
 * Server — with NO desktop launcher, NO per-game repo, and NO build:
 *
 *   1. resolve the project's client + game type,
 *   2. freshen the `deploy/` exports so the live runtime serves current art/fonts/sounds/
 *      symbols (the SAME `ensureDeployExports` the live `/api/editor/runtime` runs),
 *   3. mint/get the project's read-only token (gates the public live fetches),
 *   4. map gameType → mock `protocol` + shared `runtime` bundle id,
 *   5. merge the test-server manifest (`test_server/games.json`) — read-modify-write,
 *   6. upsert the `games` registry row so the game shows in the portal,
 *   7. best-effort POST the test server's `/refresh`.
 *
 * "Publish" is a DATA + MANIFEST operation: re-running it re-exports + re-registers,
 * never rebuilds. The generic runtime boots the project from the live fetch.
 */
import type { SoundLicenceSummary } from '$lib/soundUsage';
import { ENV } from './env';
import { createGame, gameExists, renameGame, setGameProject, setGameUrl } from './games';
import { resolveMockContract } from './mockContract';
import { UNASSIGNED_CLIENT } from './projectPaths';
import { getOrMintReadToken, projectClientKey, projectGameType, projectName } from './projects';
import { listAllObjects } from './r2';
import { ensureDeployExports } from './runtimeBundle';
import { checkSoundsForPublish } from './soundPublishCheck';
import { invalidateRuntimeBundle } from './runtimeBundleCache';
import { upsertTestServerGame } from './testServerManifest';

export interface PublishResult {
	/** The game key (== the project key). */
	key: string;
	/** The full playable game URL on the test server (also returned as `playUrl`). */
	url: string;
	playUrl: string;
	/** What this publish shipped, licence-wise — surfaced ONCE, here, because the moment a build
	 *  goes out is when "who owns this audio" stops being paperwork. Never blocking. */
	sounds: SoundLicenceSummary;
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
		 *  clobber a real game — while `unapproved-sounds` is a deliberate-override case. */
		readonly reason: 'own-bundle' | 'unapproved-sounds' = 'own-bundle',
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
 * "the shared engine runtime", not "the lines game".
 */
function runtimeFor(_gameType: string): string {
	return 'lines';
}

/**
 * Publish (or re-publish) a project as a playable test-server game. `projectKey` is
 * the BARE launcher project key; it is also used verbatim as the GAME key.
 */
export async function publishGame(
	projectKey: string,
	launcherOrigin: string,
	options: { allowUnapproved?: boolean } = {},
): Promise<PublishResult> {
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	const gameType = await projectGameType(projectKey);
	const name = (await projectName(projectKey)) ?? projectKey;

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

	// 2. Freshen deploy/ so the live runtime serves the current art/fonts/sounds/symbols.
	await ensureDeployExports(projectKey, clientKey);
	// A bundle assembled moments before this publish landed would keep being served for the
	// rest of its TTL, so a publish-then-reload could still show pre-publish data. Drop it.
	invalidateRuntimeBundle(projectKey);

	// 3. The public read-only token (gates /api/editor/runtime + /api/deploy/f/...).
	const readToken = await getOrMintReadToken(projectKey);
	if (!readToken) throw new Error(`Unknown project '${projectKey}'.`);

	// The project's math contract for the mock RGS (protocol + grid + cascade), from its Game Config.
	// The SAME derivation `/api/game-config/mock` serves live, so the snapshot written below can only
	// ever be an older copy of the live answer — never a different one.
	const { protocol, grid, cascade } = await resolveMockContract(projectKey);
	const runtime = runtimeFor(gameType);
	const key = projectKey;

	// GUARD: never clobber a game that has its OWN built bundle. Desktop-launcher
	// games (Book of Borut, Hot Fruits) live at test_server/<key>/ and are served
	// from there with their real protocol + NO runtime field. Stamping
	// runtime:'lines' on one would shadow its real bundle with the generic lines
	// runtime + the wrong mock RGS — exactly the Book-of-Borut regression. The online
	// Game Maker only publishes games authored ENTIRELY online (no per-key bundle).
	if (await hasOwnBuiltBundle(key)) {
		throw new PublishBlockedError(
			`"${name}" already has its own published build (a desktop-launcher game), so the ` +
				`online Game Maker won't republish it — that would overwrite the real game with the ` +
				`generic runtime. Re-publish it from the desktop launcher instead.`,
		);
	}

	// 4 + 5. Merge the test-server manifest (read-modify-write, preserves siblings).
	//
	// `docBase` + `readToken` are what turn the entry from a FROZEN copy of the math into a pointer
	// back at the live one: the test server re-reads `/api/game-config/mock` with them, so editing
	// `/config` changes the board the mock deals without a republish. The grid/cascade below stay as
	// the fallback for when that fetch can't be made (launcher down, entry published before this).
	// Neither field is a new exposure — both appear verbatim in the public game URL built below.
	await upsertTestServerGame(key, {
		protocol,
		name,
		runtime,
		updatedAt: new Date().toISOString(),
		docBase: launcherOrigin.replace(/\/+$/, ''),
		readToken,
		...(grid ? { grid } : {}),
		...(cascade === undefined ? {} : { cascade }),
	});

	// 6. Register the game. The launch URL boots the generic runtime (`?runtime=1`)
	//    against THIS project's live authoring data, gated by the read token, with the
	//    per-key mock RGS proxy. `editorDocBase` points the runtime back at this
	//    launcher for its live /api/editor/runtime + /api/deploy/f fetches.
	const base = ENV.GAMES_BASE_URL.replace(/\/+$/, '');
	const gamesHost = base.replace(/^https?:\/\//, '');
	const origin = launcherOrigin.replace(/\/+$/, '');
	const url =
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

	// 7. Best-effort refresh — Phase 0 made /refresh 202 + background-hydrate, so a
	//    slow or failing call must never fail the publish.
	try {
		await fetch(`${base}/refresh`, { method: 'POST' });
	} catch {
		// ignore — the test server re-hydrates on its own cadence too.
	}

	return { key, url, playUrl: url, sounds: soundCheck.licences };
}
