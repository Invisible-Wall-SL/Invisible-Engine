/** Types for a 3D level made per room (`onlineGenerators3d.js`). Pinned by `scripts/check-arena-3d.mjs`. */

import type { CrashArena } from './crashArena';
import type { World3d } from './online3d';

export declare const WORLD3D_GENERATORS: Readonly<
	Record<string, { make(seed: number | string): CrashArena }>
>;

export declare function generatedWorld3d(
	world: World3d,
	seed: number,
): { world: World3d; made: CrashArena | undefined };
