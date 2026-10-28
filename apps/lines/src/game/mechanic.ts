import { mechanicFor, type GameMechanic } from 'engine-game';
import { normalizeGameConfigDoc } from 'game-config';

import { bakedGameConfig } from '../editor-scenes';
import { familyRefusal } from './runtimeFamilies';

/**
 * The mechanic this runtime's config plays as (`engine-game` `mechanicFor`): the one question every
 * family branch asks — the boot, `<Authenticate>`, `Game.svelte`. Read after the runtime bundle has
 * landed (`+layout.ts`'s `load`), which is before any of them runs.
 */
export const gameMechanic = (): GameMechanic =>
	mechanicFor(normalizeGameConfigDoc(bakedGameConfig()) ?? null);

/** Why this runtime cannot boot its config's family (`runtimeFamilies.ts`), checked before the
 *  mechanic is: a left-out family's mechanic would run against inert stubs. */
export const gameFamilyRefusal = (): string | undefined =>
	familyRefusal(normalizeGameConfigDoc(bakedGameConfig()) ?? null);
