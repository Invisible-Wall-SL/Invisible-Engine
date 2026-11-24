import { mechanicFor } from 'engine-game/src/game/mechanic';
import type { GameConfigDoc } from 'game-config';

const PROTOCOLS = new Set(['ws:', 'wss:', 'http:', 'https:']);

/** Whether `value` is a whole ws(s):// or http(s):// address with a host. */
const isAddress = (value: string): boolean => {
	try {
		const url = new URL(value);
		return PROTOCOLS.has(url.protocol) && url.hostname !== '';
	} catch {
		return false;
	}
};

/** The game server address as the launch URL carries it: trimmed, without a trailing slash. */
const normalized = (address: string): string => address.trim().replace(/\/+$/, '');

/**
 * Why an online arcade game (`arcade.online`, `mechanicFor().room`) cannot be published with the
 * launcher's game server address (`GAME_SERVER_URL`), or `null`. The runtime refuses to boot an
 * online game without `?rooms_url=` (`apps/lines` `game/online.ts`), so a publish without one would
 * ship a game nobody can play. A game that is not online never needs one.
 */
export function roomsAddressRefusal(
	config: GameConfigDoc | null | undefined,
	address: string,
): string | null {
	if (!mechanicFor(config).room) return null;
	const value = normalized(address);
	if (!value)
		return (
			'This game is played online in a room on the Invisible Game Server, and the launcher has no ' +
			'game server address (GAME_SERVER_URL is set empty), so it is not published.'
		);
	if (!isAddress(value))
		return (
			`The launcher's game server address (GAME_SERVER_URL "${value}") is not a ws://, wss://, ` +
			'http:// or https:// address, so this online game is not published.'
		);
	return null;
}

/** `url` with `rooms_url` set to the game server address when `config` is an online game; any
 *  other game's launch URL, and one that already names a game server, comes back unchanged. Call
 *  after {@link roomsAddressRefusal} passed. */
export function withRoomsUrl(
	url: string,
	config: GameConfigDoc | null | undefined,
	address: string,
): string {
	if (!mechanicFor(config).room || paramOf(url, 'rooms_url')) return url;
	return withParam(url, 'rooms_url', normalized(address));
}

const splitUrl = (url: string) => {
	const hash = url.indexOf('#');
	const head = hash < 0 ? url : url.slice(0, hash);
	const query = head.indexOf('?');
	return {
		path: query < 0 ? head : head.slice(0, query),
		params: new URLSearchParams(query < 0 ? '' : head.slice(query + 1)),
		fragment: hash < 0 ? '' : url.slice(hash),
	};
};

/** A parameter's value in `url`'s query (never its fragment); empty when absent. */
const paramOf = (url: string, name: string): string => splitUrl(url).params.get(name) ?? '';

/** `url` with `name=value` in its query, the fragment kept after it. Only that parameter's text
 *  changes: one already holding `value` leaves `url` exactly as it was. */
function withParam(url: string, name: string, value: string): string {
	const { params, fragment } = splitUrl(url);
	const head = url.slice(0, url.length - fragment.length);
	const pair = `${name}=${encodeURIComponent(value)}`;
	if (!params.has(name)) {
		const sep = head.includes('?') ? (/[?&]$/.test(head) ? '' : '&') : '?';
		return `${head}${sep}${pair}${fragment}`;
	}
	if (params.getAll(name).join() === value) return url;
	const [path, query] = [head.slice(0, head.indexOf('?')), head.slice(head.indexOf('?') + 1)];
	let placed = false;
	const kept = query.split('&').flatMap((part) => {
		if (new URLSearchParams(part).has(name) === false) return [part];
		if (placed) return [];
		placed = true;
		return [pair];
	});
	return `${path}?${kept.join('&')}${fragment}`;
}

/** What a stored game card's link needs to reach its room, and whether it can. */
export type GameServerLink = { url: string; refusal: string | null };

/**
 * A game card's stored link as it is handed to a person. An online game's (by its project's config,
 * what an authoring boot and a standalone build of it run) gets `rooms_url` = the launcher's
 * address, replacing a stale or empty one, and `rooms_game` = its project when the link names
 * neither that nor a `project`, so a card registered without them (the desktop launcher's
 * standalone build) still joins its project's rooms. `published`: whether the project's PUBLISHED
 * config is an online game, the one the game server deals a room of that project from. A game that
 * cannot be played that way gets a `refusal` saying why instead of a link that loads and never
 * connects. A card with no URL, and a game that is not online, come back exactly as stored.
 */
export function gameServerLink(
	url: string,
	config: GameConfigDoc | null | undefined,
	projectKey: string,
	published: boolean,
	address: string,
): GameServerLink {
	if (!url || !mechanicFor(config).room) return { url, refusal: null };
	if (roomsAddressRefusal(config, address))
		return {
			url,
			refusal:
				'This game is played online in a room on the Invisible Game Server, and the launcher has ' +
				`no usable game server address (GAME_SERVER_URL "${normalized(address)}"), so this link ` +
				'cannot join a room.',
		};
	if (!published)
		return {
			url,
			refusal:
				'This game is played online in a room on the Invisible Game Server, which deals a room ' +
				`from the PUBLISHED Game Config of project "${projectKey}", and that project has no ` +
				'published online config yet. Publish it in Invisible Game Maker, then reload.',
		};
	let out = withParam(url, 'rooms_url', normalized(address));
	if (!paramOf(out, 'rooms_game') && !paramOf(out, 'project'))
		out = withParam(out, 'rooms_game', projectKey);
	return { url: out, refusal: null };
}
