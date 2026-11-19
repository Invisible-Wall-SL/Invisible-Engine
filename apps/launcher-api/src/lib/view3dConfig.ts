/**
 * Is a project a 3D game (`docs/design/3d-games.md`): does its stored Game Config carry an
 * `arcade.world3d` block? Read from the RAW stored doc, because `game-config` (in every runtime) does
 * not know the block and `normalizeGameConfigDoc` drops it. A 3D project's Flow is authored and
 * judged against its kind's vocabulary plus the 3D view's actions (`engine-flow-v2` `withView3d`).
 */
export const isView3dConfig = (raw: unknown): boolean => {
	const arcade = raw && typeof raw === 'object' ? (raw as { arcade?: unknown }).arcade : undefined;
	const world3d =
		arcade && typeof arcade === 'object' ? (arcade as { world3d?: unknown }).world3d : undefined;
	return !!world3d && typeof world3d === 'object';
};
