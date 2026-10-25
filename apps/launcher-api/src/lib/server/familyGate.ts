import { resolveFamily, resolveOutcome, type GameConfigDoc } from 'game-config';

const FAMILY_NAMES = { match3: 'match-3', arcade: 'arcade' } as const;

/**
 * Why a config cannot ship, or `null`. A slot config is never refused here; every other family is,
 * by the online publish and by the desktop bake's config export, with no override.
 *
 * - A rules-decided match-3 game plays in the shared runtime since P10.5 (`docs/design/game-families.md`
 *   §8), in the launcher's authoring preview. Publishing a non-slot game is still off: it is the
 *   owner's call to switch on, separately from building the runtime.
 * - An RGS-decided match-3 game plays its interactive round since P10.6, against the test server's
 *   match-3 mock in the authoring preview. Live real money also waits on a real provider's match-3
 *   wire, so it stays refused even once publishing a non-slot game is switched on.
 * - An arcade game needs its runtime (P10.8). Until then the runtime refuses to boot one
 *   (`GameMechanic.unplayable`).
 */
export function unplayableFamilyMessage(doc: GameConfigDoc | null | undefined): string | null {
	const family = resolveFamily(doc);
	if (family === 'slot') return null;
	if (family === 'match3' && resolveOutcome(doc) === 'rules')
		return (
			"This game's config is a free-play match-3 game. It plays in the authoring preview, but " +
			'publishing a game that is not a slot is not switched on yet, so it is not published.'
		);
	if (family === 'match3')
		return (
			"This game's config is a real-money match-3 game. It plays against the test server's " +
			'match-3 mock in the authoring preview, but publishing a game that is not a slot is not ' +
			"switched on yet, and live real money waits on a real provider's match-3 wire, so it is " +
			'not published.'
		);
	return (
		`This game's config is a ${FAMILY_NAMES[family]} game, and the game runtime cannot play ` +
		`${family === 'arcade' ? 'an' : 'a'} ${FAMILY_NAMES[family]} game yet, so it is not published. ` +
		'Set it back to a slot in Invisible Game Config to publish it as one.'
	);
}
