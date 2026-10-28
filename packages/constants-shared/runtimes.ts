/**
 * The published runtimes: one build of `apps/lines` per game family (`docs/design/phase-11.md`
 * §2.3), released to `test_server/_runtime/<id>/`. THE one list: publish picks a game's id from it,
 * the release and rollback workflows' matrix and choices are checked against it
 * (`apps/launcher-api/scripts/check-runtime-choice.ts`), and the current-games harness builds from
 * it.
 *
 * Import-free with only erasable syntax, so a plain `node` script can import this file as it is.
 */
import type { GameFamily } from './gameKinds';

export const RUNTIMES = [
	// `lines` keeps its id: every published manifest names it. It carries every family until
	// P11.1c strips it to `slot`, so a non-slot game not yet republished still plays.
	{ id: 'lines', family: 'slot', families: 'all' },
	{ id: 'match3', family: 'match3', families: 'match3' },
	{ id: 'arcade', family: 'arcade', families: 'arcade' },
	{ id: 'card', family: 'card', families: 'card' },
] as const satisfies readonly { id: string; family: GameFamily; families: string }[];

export type RuntimeId = (typeof RUNTIMES)[number]['id'];

export const RUNTIME_IDS: readonly RuntimeId[] = RUNTIMES.map((r) => r.id);

/** The runtime every family can fall back to while its own has no release yet (until P11.1c). */
export const FALLBACK_RUNTIME_ID: RuntimeId = 'lines';

/** The runtime a game of `family` is published to. */
export const runtimeIdOfFamily = (family: GameFamily): RuntimeId =>
	RUNTIMES.find((r) => r.family === family)?.id ?? FALLBACK_RUNTIME_ID;

/** The `PUBLIC_IE_FAMILIES` value runtime `id` is built with. Throws on an unknown id. */
export const releaseFamiliesOf = (id: string): string => {
	const runtime = RUNTIMES.find((r) => r.id === id);
	if (!runtime) throw new Error(`'${id}' is not a runtime id (${RUNTIME_IDS.join(', ')}).`);
	return runtime.families;
};
