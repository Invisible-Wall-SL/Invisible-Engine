import { mechanicFor } from 'engine-game/src/game/mechanic';
import type { GameConfigDoc } from 'game-config';

const ADDRESS = /^(wss?|https?):\/\/[^\s/?#]+/i;

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
	if (!ADDRESS.test(value))
		return (
			`The launcher's game server address (GAME_SERVER_URL "${value}") is not a ws://, wss://, ` +
			'http:// or https:// address, so this online game is not published.'
		);
	return null;
}

/** `url` with `rooms_url` set to the game server address when `config` is an online game; any
 *  other game's launch URL comes back unchanged. Call after {@link roomsAddressRefusal} passed. */
export function withRoomsUrl(
	url: string,
	config: GameConfigDoc | null | undefined,
	address: string,
): string {
	if (!mechanicFor(config).room) return url;
	return `${url}&rooms_url=${encodeURIComponent(normalized(address))}`;
}
