import { resolveFamily, type GameConfigDoc } from 'game-config';

const FAMILY_NAMES = { match3: 'match-3', arcade: 'arcade' } as const;

/**
 * Why a config cannot ship yet, or `null`. A match-3 or arcade config can be authored from P10.1
 * (`docs/design/game-families.md` §8), but the shared runtime only learns to play one in P10.5 and
 * P10.8. Until then it would play the config as a slot, or draw a blank board, so the online
 * publish and the desktop bake's config export both refuse it. A slot config is never refused here.
 */
export function unplayableFamilyMessage(doc: GameConfigDoc | null | undefined): string | null {
	const family = resolveFamily(doc);
	if (family === 'slot') return null;
	return (
		`This game's config is a ${FAMILY_NAMES[family]} game, and the game runtime cannot play ` +
		`${family === 'arcade' ? 'an' : 'a'} ${FAMILY_NAMES[family]} game yet, so it is not published. ` +
		'Set it back to a slot in Invisible Game Config to publish it as one.'
	);
}
