import { salmonsConfig } from '../../../../packages/engine-mechanics/src/salmons.js';

/**
 * Salmons as it was published before its bot salmon (2026-11-20): no config character draws the
 * salmon's look, and bears and fishermen fill the room by count. The checks of
 * `check:characters-tool` that give the salmon a config character of its own (`salmonsSalmon`)
 * start from it, and so do the sheets the Salmons playtest plays with `--rig`; §7 reads the game as
 * it is now.
 */
export const salmonsBeforeItsBotSalmon = (): ReturnType<typeof salmonsConfig> => {
	const doc = salmonsConfig();
	const { arcade } = doc;
	arcade.characters = arcade.characters.filter((c: { id: string }) => c.id !== 'salmonBot');
	arcade.online.bots.characters = [
		{ character: 'bear', brain: 'bearBot' },
		{ character: 'fisherman', brain: 'fishermanBot' },
	];
	return doc;
};
