import { eq, isNull, or } from 'drizzle-orm';
import { getDb } from './db';
import { games } from './db/schema';
import type { Game } from './db/schema';

/** Game key slug: same rule as project/client keys (`^[a-z0-9][a-z0-9_-]{0,63}$`). */
const GAME_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidGameKey(value: string): boolean {
	return GAME_KEY_RE.test(value);
}

/** A launchable game URL must be a well-formed absolute https:// URL. The launcher
 *  renders it as an `<a href>` Launch tile, so reject anything that isn't plainly https. */
export function isValidGameUrl(value: string): boolean {
	try {
		return new URL(value).protocol === 'https:';
	} catch {
		return false;
	}
}

/** The conventional test-server launch URL for a game published to `gamesBaseUrl`
 *  (R2 `test_server/<key>/` behind Cloudflare). Used as the auto-fill when a game is
 *  created without an explicit URL. Mirrors the live games' pattern: the page under
 *  `<base>/<key>/`, a `demo` session, and the game's own RGS proxy at `<host>/api/<key>`.
 *  The launcher appends `?project=` (and `&k=`) at click time; this supplies the rest.
 *
 *  `runtime=1` is REQUIRED and easy to forget: it is what makes the shared engine bundle
 *  fetch the project's live authoring data (`/api/editor/runtime`) — the ONLY path that carries
 *  the authored Invisible Game Config (grid/paylines/paytable/strips) into the game. WITHOUT it
 *  the game falls back to the lighter `/api/editor/doc` fetch (scene layout only) and runs the
 *  compiled 5×3 template, silently ignoring everything authored in `/config`. `publishGame`
 *  already includes it; a card auto-created here must too, or an admin-created online game shows
 *  the template board no matter what its config says. */
export function defaultGameUrl(key: string, gamesBaseUrl: string): string {
	const base = gamesBaseUrl.replace(/\/+$/, '');
	const host = base.replace(/^https?:\/\//, '');
	return `${base}/${key}/?runtime=1&sessionID=demo&rgs_url=${host}/api/${key}&lang=en`;
}

export async function listGames(): Promise<Game[]> {
	return getDb().select().from(games).orderBy(games.name);
}

/** Games visible for a given project: those scoped to it, plus global (null) games. */
export async function listGamesForProject(projectKey: string): Promise<Game[]> {
	return getDb()
		.select()
		.from(games)
		.where(or(isNull(games.projectKey), eq(games.projectKey, projectKey)))
		.orderBy(games.name);
}

/**
 * Games this project actually OWNS — strictly `project_key = key`, no global rows.
 *
 * Distinct from {@link listGamesForProject}, which deliberately also returns global
 * (`project_key IS NULL`) games because they are *visible* under every project. Anything
 * that reports or acts on what a project owns must use THIS: the delete confirmation
 * briefly used the visibility query and so named global games it was never going to
 * touch, on a project that owned none. Same predicate as `softDeleteProject`, so what
 * the dialog promises and what the delete does cannot drift apart.
 */
export async function listGamesOwnedByProject(projectKey: string): Promise<Game[]> {
	return getDb().select().from(games).where(eq(games.projectKey, projectKey)).orderBy(games.name);
}

export async function gameExists(key: string): Promise<boolean> {
	const [row] = await getDb().select({ key: games.key }).from(games).where(eq(games.key, key));
	return Boolean(row);
}

export async function getGame(key: string): Promise<Game | undefined> {
	const [row] = await getDb().select().from(games).where(eq(games.key, key));
	return row;
}

/**
 * True when a game's launch URL is the Invisible Game Maker's generic online runtime
 * (it carries `?runtime=1`). Those cards are published ENTIRELY online — no per-key
 * built bundle — and boot the shared `_runtime/*` bundle against live R2 authoring
 * data. The desktop launcher's `register-game` uses this to refuse overwriting an
 * online card with a desktop build (the mirror of the `hasOwnBuiltBundle` guard the
 * online `publishGame` already applies in the other direction). Keep the two keys
 * distinct instead: `<game>` for the desktop build, `<game>remake` for the online one.
 */
export function isOnlineRuntimeGameUrl(url: string): boolean {
	try {
		return new URL(url).searchParams.get('runtime') === '1';
	} catch {
		return /[?&]runtime=1(?:&|$)/.test(url);
	}
}

/** Build metadata stamped by the desktop launcher at publish time. All optional;
 *  `builtAt` accepts an ISO string or Date and is stored as a Date (null when absent). */
export type GameBuildInfo = {
	version?: string;
	builtAt?: string | Date | null;
	debug?: boolean;
};

/** Coerce a `builtAt` input (ISO string | Date | null/undefined) to a Date or null. */
function toBuiltAt(value: string | Date | null | undefined): Date | null {
	if (value == null || value === '') return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

export async function createGame(
	key: string,
	name: string,
	url: string,
	projectKey: string | null = null,
	build: GameBuildInfo = {},
): Promise<void> {
	await getDb()
		.insert(games)
		.values({
			key,
			name,
			url,
			projectKey,
			version: build.version ?? '',
			builtAt: toBuiltAt(build.builtAt),
			debug: build.debug ?? false,
		});
}

/** Persist build metadata on an existing game (used by the desktop publish upsert). */
export async function setGameBuildInfo(key: string, build: GameBuildInfo): Promise<void> {
	await getDb()
		.update(games)
		.set({
			version: build.version ?? '',
			builtAt: toBuiltAt(build.builtAt),
			debug: build.debug ?? false,
		})
		.where(eq(games.key, key));
}

/** Scope a game to a project (or `null` to make it global). */
export async function setGameProject(key: string, projectKey: string | null): Promise<void> {
	await getDb().update(games).set({ projectKey }).where(eq(games.key, key));
}

export async function renameGame(key: string, name: string): Promise<void> {
	await getDb().update(games).set({ name }).where(eq(games.key, key));
}

export async function setGameUrl(key: string, url: string): Promise<void> {
	await getDb().update(games).set({ url }).where(eq(games.key, key));
}

export async function deleteGame(key: string): Promise<void> {
	await getDb().delete(games).where(eq(games.key, key));
}
