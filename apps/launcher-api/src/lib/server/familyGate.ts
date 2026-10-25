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
