import { resolveArcade, resolveArcadeOnline, resolveFamily, resolveOutcome } from './family';
import type { ArcadeBrain } from './arcadeCharacters';
import type { ArcadeBody, ArcadeZone, ResolvedArcadeOnline } from './family';
import { validateFamily } from './familyValidate';
import type { GameConfigDoc } from './types';

/** An online arcade game as its room plays it (P10.14, P10.15): one answer the game server and a
 *  device both derive from the same config, so the two step the same field at the same rates. */
export type OnlineGame = {
	field: { w: number; h: number };
	online: ResolvedArcadeOnline;
	/** The arcade bodies by component id: a character's `body` names one. */
	bodies: Record<string, ArcadeBody>;
	/** The field's zones: `online.rules.zones` gives some of them a part in the rules. */
	zones: ArcadeZone[];
	/** The brains the room's bots play with, by `arcade.characters` id (P10.16). */
	brains: Record<string, ArcadeBrain>;
};

/**
 * The online game a config describes: `undefined` for a game that is not online, `{ refused }`
 * for one whose room could not be played (the validator's first error), else the game.
 */
export function onlineGameOf(
	doc: GameConfigDoc | null | undefined,
): OnlineGame | { refused: string } | undefined {
	if (!doc || resolveFamily(doc) !== 'arcade' || !doc.arcade?.online) return undefined;
	if (resolveOutcome(doc) !== 'rules') return { refused: 'an online game is free play only' };
	const error = validateFamily(doc).find((issue) => issue.severity === 'error');
	if (error) return { refused: `${error.path}: ${error.message}` };
	const arcade = resolveArcade(doc);
	const field = arcade.field;
	const online = field ? resolveArcadeOnline(doc, field) : undefined;
	if (!field || !online) return { refused: 'arcade.field: an online game needs a field size' };
	const brains: Record<string, ArcadeBrain> = {};
	for (const bot of online.bots.characters) {
		const brain = arcade.characters.find((c) => c.id === bot.brain)?.brain;
		if (brain) brains[bot.brain] = brain;
	}
	return { field, online, bodies: arcade.bodies, zones: arcade.zones, brains };
}
