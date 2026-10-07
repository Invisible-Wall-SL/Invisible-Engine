/**
 * The skeleton LOAD scale (`parser.scale`) each rig bundle was actually read with, keyed by
 * its asset key — recorded by `assetLoad.ts` as the bundle is processed.
 *
 * It has to be recorded because the rig readers scale the skeleton GEOMETRY but copy
 * `skeleton.data.width/height` through UNSCALED (see `SkeletonJson`/`SkeletonBinary`), so the
 * load scale survives every sizing path: a bundle read at 2 renders twice as large as the same
 * bundle read at 1, both at its natural size AND at any requested `width`. A surface that must
 * be pixel-identical with an authoring tool (which loads at its own fixed scale) therefore has
 * to divide the difference back out — see `<RigProvider loadScaleBase>`.
 */
const rigLoadScales = new Map<string, number>();

export const setRigLoadScale = (key: string, scale: number): void => {
	rigLoadScales.set(key, scale);
};

/** The load scale a bundle was read with; `1` (the reader default) when it wasn't recorded. */
export const getRigLoadScale = (key: string): number => rigLoadScales.get(key) ?? 1;
