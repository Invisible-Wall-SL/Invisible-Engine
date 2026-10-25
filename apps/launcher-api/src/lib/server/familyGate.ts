import { mechanicFor } from 'engine-game/src/game/mechanic';
import { resolveFamily, type ConfigFamily, type GameConfigDoc } from 'game-config';

const FAMILY_NAMES: Record<Exclude<ConfigFamily, 'slot'>, string> = {
	match3: 'match-3',
	arcade: 'arcade',
};

/**
 * Why a config cannot ship, or `null`. Gated on what the shared runtime can PLAY
 * (`mechanicFor(config).unplayable`, the same answer that stops its boot), never on the family, so a
 * family publishes the day its mechanic is declared playable, with no change here (§9 #26). Enforced
 * by the online publish and by the desktop bake's config export, with no override: there is nothing
 * a player could be shown.
 *
 * Playable is not deliverable. A non-slot game still never reaches a real-money partner: the
 * delivery build refuses it (`scripts/build-delivery.mjs`), and a free-play runtime refuses a
 * delivery profile at boot.
 */
export function unplayableFamilyMessage(doc: GameConfigDoc | null | undefined): string | null {
	const kind = resolveFamily(doc);
	if (!mechanicFor(doc).unplayable || kind === 'slot') return null;
	const family = FAMILY_NAMES[kind];
	return (
		`This game's config is ${family === 'arcade' ? 'an' : 'a'} ${family} game, and the game ` +
		`runtime cannot play ${family === 'arcade' ? 'an' : 'a'} ${family} game yet, so it is not ` +
		'published. Set it back to a slot in Invisible Game Config to publish it as one.'
	);
}

/**
 * Why a game may not be launched against a PARTNER RGS (`/api/partner-session`), or `null`. Only a
 * slot is: a free-play game has no wallet, and an RGS match-3 game's wire exists only on our test
 * server until a real provider's does (§9 #2). The server-side twin of the delivery build's gate and
 * of the runtime's `<Authenticate freePlay | mockOnly>` refusal, so no partner session is minted
 * for a game that would refuse it.
 */
export function partnerRgsRefusal(doc: GameConfigDoc | null | undefined): string | null {
	if (resolveFamily(doc) === 'slot') return null;
	return mechanicFor(doc).outcome === 'rules'
		? 'This game is free play: it has no wallet, so it is never launched against a partner RGS.'
		: 'This game is not a slot: its real-money wire exists only on our test server until a real ' +
				"provider's, so it is not launched against a partner RGS.";
}
