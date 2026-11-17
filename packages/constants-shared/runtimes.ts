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
	// `lines` keeps its id: every published manifest names it. Slot only since P11.1c.
	{ id: 'lines', family: 'slot', families: 'slot' },
	{ id: 'match3', family: 'match3', families: 'match3' },
	{ id: 'arcade', family: 'arcade', families: 'arcade' },
	{ id: 'card', family: 'card', families: 'card' },
	// An arcade game whose play field is drawn in 3D (`docs/design/3d-games.md`): the arcade build
	// with `PUBLIC_IE_3D=1`. After `arcade`, so an arcade game is published to `arcade` until its
	// config asks for the 3D view. Released by dispatch only until a game plays it.
	{ id: 'arcade3d', family: 'arcade', families: 'arcade', view: '3d', release: 'dispatch' },
] as const satisfies readonly {
	id: string;
	family: GameFamily;
	families: string;
	view?: '3d';
	/** `'dispatch'`: a push to `main` does not release it; the "Runtime release" dispatch does. */
	release?: 'dispatch';
}[];

export type RuntimeId = (typeof RUNTIMES)[number]['id'];

export const RUNTIME_IDS: readonly RuntimeId[] = RUNTIMES.map((r) => r.id);

/** The slot runtime: what an unknown family maps to, and the one runtime a checkout from before
 *  the family seams builds (the current-games harness). */
export const FALLBACK_RUNTIME_ID: RuntimeId = 'lines';

/** The runtime a game of `family` is published to. */
export const runtimeIdOfFamily = (family: GameFamily): RuntimeId =>
	RUNTIMES.find((r) => r.family === family)?.id ?? FALLBACK_RUNTIME_ID;

/** The runtimes a push to `main` releases: every one but those still released by dispatch only. */
export const PUSH_RELEASED_IDS: readonly RuntimeId[] = RUNTIMES.filter(
	(r) => !('release' in r),
).map((r) => r.id);

/** The `PUBLIC_IE_3D` value runtime `id` is built with: `'1'` for a 3D view, else empty. */
export const release3dOf = (id: string): string =>
	RUNTIMES.some((r) => r.id === id && 'view' in r && r.view === '3d') ? '1' : '';

/** The `PUBLIC_IE_FAMILIES` value runtime `id` is built with. Throws on an unknown id. */
export const releaseFamiliesOf = (id: string): string => {
	const runtime = RUNTIMES.find((r) => r.id === id);
	if (!runtime) throw new Error(`'${id}' is not a runtime id (${RUNTIME_IDS.join(', ')}).`);
	return runtime.families;
};
