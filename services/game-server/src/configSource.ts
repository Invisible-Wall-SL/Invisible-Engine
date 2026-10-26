import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { normalizeGameConfigDoc, onlineGameOf, type OnlineGame } from 'game-config';

/**
 * WHICH GAME A ROOM PLAYS (`docs/design/realtime-multiplayer.md` §9): the game's config, read by
 * the server, never sent by a device. A room reads it once, when it is created, and keeps that
 * version for its life; a new publish reaches new rooms.
 *
 * Two sources, by env:
 *  - `GAME_SERVER_CONFIG_DIR`: a directory of `<game>.json` GameConfigDocs (local runs, the gate);
 *  - `GAME_SERVER_CONFIG_URL`: a URL with `{game}` in it, answering a GameConfigDoc or `{ doc }`,
 *    sent `Authorization: Bearer $GAME_SERVER_CONFIG_TOKEN` when that is set.
 *
 * Answers, good or bad, are kept for {@link CACHE_MS}, and at most {@link MAX_IN_FLIGHT} reads run
 * at once, so a device asking for rooms of games that do not exist cannot make the server fetch for
 * every request.
 */

/** A game key: what the launcher's project keys look like. Anything else is never looked up. */
const GAME_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const CACHE_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_CONFIG_BYTES = 2_000_000;
/** Config reads in flight at once; a read past it is refused at once and not cached. */
const MAX_IN_FLIGHT = 4;

export type LoadGame = (game: string) => Promise<OnlineGame>;

export type ConfigSourceOptions = {
	dir?: string;
	url?: string;
	token?: string;
	now?: () => number;
};

const tooLarge = (game: string) => new Error(`the config of "${game}" is too large`);

const parse = (text: string, game: string): OnlineGame => {
	const raw: unknown = JSON.parse(text);
	const docRaw =
		raw && typeof raw === 'object' && 'doc' in raw ? (raw as { doc: unknown }).doc : raw;
	const resolved = onlineGameOf(normalizeGameConfigDoc(docRaw) ?? null);
	if (!resolved) throw new Error(`"${game}" is not an online game`);
	if ('refused' in resolved)
		throw new Error(`"${game}" cannot be played online: ${resolved.refused}`);
	return resolved;
};

export function createConfigSource(options: ConfigSourceOptions): LoadGame {
	const now = options.now ?? Date.now;
	const cache = new Map<string, { at: number; answer: Promise<OnlineGame> }>();
	let inFlight = 0;

	const fetchText = async (game: string): Promise<string> => {
		if (options.dir) {
			const bytes = await readFile(join(options.dir, `${game}.json`));
			if (bytes.byteLength > MAX_CONFIG_BYTES) throw tooLarge(game);
			return bytes.toString('utf8');
		}
		if (options.url) {
			const res = await fetch(options.url.replaceAll('{game}', encodeURIComponent(game)), {
				headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
			if (!res.ok) throw new Error(`the config of "${game}" answered ${res.status}`);
			if (Number(res.headers.get('content-length')) > MAX_CONFIG_BYTES) throw tooLarge(game);
			const bytes = await res.arrayBuffer();
			if (bytes.byteLength > MAX_CONFIG_BYTES) throw tooLarge(game);
			return new TextDecoder().decode(bytes);
		}
		throw new Error('no config source: set GAME_SERVER_CONFIG_DIR or GAME_SERVER_CONFIG_URL');
	};

	return (game) => {
		if (!GAME_KEY.test(game)) return Promise.reject(new Error('not a game key'));
		const hit = cache.get(game);
		if (hit && now() - hit.at < CACHE_MS) return hit.answer;
		if (inFlight >= MAX_IN_FLIGHT)
			return Promise.reject(new Error('too many config reads at once'));
		inFlight += 1;
		const answer = fetchText(game)
			.then((text) => parse(text, game))
			.finally(() => {
				inFlight -= 1;
			});
		// A rejection is still cached, but marked handled so an unawaited copy never crashes us.
		answer.catch(() => {});
		cache.set(game, { at: now(), answer });
		if (cache.size > 1000) cache.delete(cache.keys().next().value as string);
		return answer;
	};
}
