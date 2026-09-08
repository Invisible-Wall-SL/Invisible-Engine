/**
 * The **launcher profile** — the machine-independent setup blob the desktop Invisible
 * Launcher reads on "↻ Sync from cloud" to know how to clone, build and publish a
 * project. Served by `GET /api/launcher/projects`.
 *
 * Historically this was a pure passthrough of `projects.launcher_profile`, a column
 * ONLY the desktop launcher ever wrote (its owner-only "⬆ Setup" POST). So a project
 * created ONLINE — in Invisible Game Maker or `/admin` — synced down with no `game`
 * block and no repo, and the desktop's ☁ Publish refused it with "this project has no
 * 'Cloud publish' section". Every online project therefore had its build command, cwd,
 * output dir, protocol and cloud key hand-typed (in practice: copy-pasted from another
 * project) before it could ever be built. That was never a real question: a standalone
 * game builds one way, and the only per-project variable — the mock RGS protocol — is
 * already recorded as the project's authored game kind (`projects.game_type`).
 *
 * So the profile is now DERIVED when nothing is stored. `launcherProfileFor` is the one
 * entry point:
 *
 *   stored profile with a `game` block  → served as-is (the desktop already knows best)
 *   stored profile with `kind: 'comfy'` → untouched (a ComfyUI workspace, not a game)
 *   anything else                       → a derived `game.publish` block from the kind
 *
 * A derived profile is flagged `derived: true`. That flag matters: the desktop's sync is
 * server-AUTHORITATIVE but must never be server-DESTRUCTIVE, and a derived block is a
 * default, not a decision — so the launcher keeps a local publish block in preference to
 * it, exactly as it already keeps one when the server has nothing to say.
 */
import { protocolFor } from './mockProtocol';
import type { MockProtocol } from './testServerManifest';

// Standalone game repos vendor the engine as a git submodule and share ONE root
// pnpm-lock.yaml that flattens `engine/packages/*`. The desktop launcher's build runs
// `pnpm install` with CI=1 → frozen-lockfile. If a machine's `engine/` submodule has
// drifted off the committed pin (the launcher's sync skips the submodule update when a
// dirty tree blocks its ff-pull), that frozen install hard-fails with
// ERR_PNPM_OUTDATED_LOCKFILE even though the pushed lockfile is correct.
//
// Fix at the contract boundary: every game build-cmd we hand the launcher pins the
// submodule to the superproject's committed commit FIRST, so engine == pin == committed
// lockfile right before the frozen install. This reaches EVERY launcher (even ones that
// predate the source-side fix) on its next "Sync from cloud" — no exe rebuild, no
// re-seed. Idempotent; only game-publish profiles; leaves an already-pinning cmd alone.
// See gotcha-game-deploy-lockfile-submodule-drift.
const SUBMODULE_PIN = 'git submodule update --init --recursive';
const DEFAULT_GAME_BUILD_CMD = 'pnpm install && pnpm build';

/** The build recipe every standalone game shares — there is no per-project variant. */
const BUILD_CMD = `${SUBMODULE_PIN} && ${DEFAULT_GAME_BUILD_CMD}`;
const BUILD_CWD = '.';
const BUILD_OUT = 'build';

/** The `game.publish` block the desktop launcher builds and publishes from. */
export interface LauncherPublishBlock {
	/** Cloud/game key on the test server — the portal project key, used verbatim. */
	key: string;
	/** Display name on the portal Games card. */
	name: string;
	/** Portal project key the game is scoped to (omitting it registers it global). */
	project: string;
	/** Mock RGS the test server deals this game with. */
	protocol: MockProtocol;
	build_cmd: string;
	/** Relative to the project root. */
	build_cwd: string;
	/** Relative to `build_cwd` (the games build with adapter-static → `build/`). */
	build_out: string;
}

/** The minimum a project must state for its profile to be derivable. */
export interface DerivableProject {
	key: string;
	name: string;
	/** The authored game kind (`projects.game_type`), already defaulted by the caller. */
	gameType: string;
}

/**
 * The publish block a project's own identity implies. Pure — no IO, no defaults hidden
 * in a dialog. The cloud key IS the portal project key: they are the same slug rule
 * (`^[a-z0-9][a-z0-9_-]{0,63}$`) and keeping them equal is what scopes the registered
 * game to its project instead of landing it global.
 */
export function derivePublishBlock(project: DerivableProject): LauncherPublishBlock {
	return {
		key: project.key,
		name: project.name || project.key,
		project: project.key,
		protocol: protocolFor(project.gameType),
		build_cmd: BUILD_CMD,
		build_cwd: BUILD_CWD,
		build_out: BUILD_OUT,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Bring a STORED profile's build command up to the submodule-pinning contract above.
 * Only touches a profile that actually carries a `game.publish`; leaves an already
 * pinning command alone.
 */
function normalizeStoredProfile(profile: unknown): unknown {
	if (!isRecord(profile)) return profile;
	const game = profile.game;
	if (!isRecord(game)) return profile;
	const pub = game.publish;
	if (!isRecord(pub)) return profile;

	const current = typeof pub.build_cmd === 'string' ? pub.build_cmd.trim() : '';
	const base = current || DEFAULT_GAME_BUILD_CMD;
	if (base.includes('submodule update')) return profile; // already pins — leave as-is

	return {
		...profile,
		game: { ...game, publish: { ...pub, build_cmd: `${SUBMODULE_PIN} && ${base}` } },
	};
}

/** True when a stored profile already answers "how do I build this game?". */
function hasPublishBlock(profile: unknown): boolean {
	return isRecord(profile) && isRecord(profile.game) && isRecord(profile.game.publish);
}

/**
 * The profile to serve the desktop launcher for one project: the stored one when it
 * carries a build recipe, otherwise one derived from the project's game kind.
 *
 * One carve-out here — **`kind: 'comfy'`**, a ComfyUI workspace the launcher tracks as a
 * folder, not a game. Deriving a publish block for it would put a ☁ Publish path (and a
 * "Launch Game" button) on a project that has no game to build. The other carve-out —
 * the shared default `cloud` scope, which is not a title either — belongs to the endpoint
 * that enumerates projects, because deciding WHICH projects are real games is its job;
 * this module only decides what a game's profile looks like. Keeping that split is also
 * what keeps this module a leaf (no DB, no `$env`), so it can be verified offline.
 *
 * A derived profile carries NO `repo`, because the portal genuinely doesn't know one: an
 * online project is data-only until someone scaffolds a standalone repo for it. The
 * desktop reports that honestly ("no repo URL in its portal profile — nothing to clone")
 * and its build preflight names the empty folder and the fix.
 */
export function launcherProfileFor(stored: unknown, project: DerivableProject): unknown {
	if (hasPublishBlock(stored)) return normalizeStoredProfile(stored);
	if (isRecord(stored) && stored.kind === 'comfy') return stored;

	const base = isRecord(stored) ? stored : {};
	return {
		...base,
		kind: 'game',
		derived: true,
		game: { ...(isRecord(base.game) ? base.game : {}), publish: derivePublishBlock(project) },
	};
}
