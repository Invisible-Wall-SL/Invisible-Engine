import {
	createRenderQualityController,
	type RenderQualityController,
	type RenderQualitySnapshot,
} from 'pixi-svelte/renderQuality';

import { CAPS_3D, type Caps3d } from './tier';

/**
 * Dynamic resolution for the 3D canvas (`docs/design/3d/runtime-evaluation.md` §5.3, step T3).
 * The 2D controller (`pixi-svelte` `renderQuality.ts`: windows of frames, a slow / headroom verdict
 * with hysteresis, a trial undone when it brings no gain) walks a 3D ladder instead of the HUD's:
 *
 * 1. the 3D canvas's pixel ratio × 0.85, then × 0.7 (the HUD keeps its own, so it stays sharp);
 * 2. the shadow map halved, then blob shadows;
 * 3. the LOD bias + 0.25, twice.
 *
 * It never changes the asset tier (§5.1). MSAA is a context attribute of the 3D canvas, so it stays
 * what the tier set. Post-processing would be rung 2 (the `full` / `ultra` chunk); there is none to
 * turn off yet. Pure: pinned in Node by `scripts/check-engine-3d.mjs`.
 */

/** One rung: what the world renders at. `resolution` and `msaa` are what the 2D controller reads. */
export type Quality3dLevel = {
	/** Share of the tier's pixel-ratio cap the 3D canvas renders at. */
	resolution: number;
	msaa: boolean;
	shadows: Caps3d['shadows'];
	shadowMapSize: number;
	lodBias: number;
	/** What this rung changed, for the readout. */
	step: string;
};

/** The rungs a tier's caps start a device on, top first; equal rungs are left out. */
export function qualityLadder3d(caps: Caps3d): Quality3dLevel[] {
	const top: Quality3dLevel = {
		resolution: 1,
		msaa: caps.antialias,
		shadows: caps.shadows,
		shadowMapSize: caps.shadowMapSize,
		lodBias: caps.lodBias,
		step: 'the tier',
	};
	const rungs: Quality3dLevel[] = [top];
	const next = (change: Partial<Quality3dLevel>, step: string) => {
		const from = rungs[rungs.length - 1];
		rungs.push({ ...from, ...change, step });
	};
	next({ resolution: 0.85 }, '3D pixel ratio × 0.85');
	next({ resolution: 0.7 }, '3D pixel ratio × 0.7');
	if (caps.shadows === 'map') {
		next({ shadowMapSize: Math.max(256, caps.shadowMapSize / 2) }, 'shadow map halved');
		next({ shadows: 'blob', shadowMapSize: 0 }, 'blob shadows');
	}
	next({ lodBias: caps.lodBias + 0.25 }, 'LOD bias + 0.25');
	next({ lodBias: caps.lodBias + 0.5 }, 'LOD bias + 0.5');
	return rungs;
}

/** `?render3d=low|medium|high`: the caps of `quarter` / `half` / `full`, pinned (no adapting). */
export const RENDER3D_PINS = Object.freeze({
	low: 'quarter',
	medium: 'half',
	high: 'full',
} as const);

/** The pinned caps a `?render3d=` names, or `undefined`. */
export function render3dPin(search: string): Caps3d | undefined {
	const value = new URLSearchParams(search).get('render3d');
	const tier =
		value && value in RENDER3D_PINS
			? RENDER3D_PINS[value as keyof typeof RENDER3D_PINS]
			: undefined;
	return tier ? CAPS_3D[tier] : undefined;
}

export type Quality3d = {
	/** The rung to render at now. */
	readonly level: Quality3dLevel;
	/** One frame's interval; returns the new rung when it changed. */
	frame(intervalMs: number, visible: boolean): Quality3dLevel | undefined;
	visibilityChanged(): void;
	snapshot(): RenderQualitySnapshot & { rung: Quality3dLevel; pinned: boolean };
};

/**
 * The controller for one mounted world: adaptive on the tier's ladder, or fixed on a pin. The 3D
 * field is always "playing" and always "quiet" (no reel to wait for), so every visible frame
 * counts and a switch lands at once.
 */
export function createQuality3d(caps: Caps3d, { pinned = false } = {}): Quality3d {
	const ladder = qualityLadder3d(caps);
	let level = ladder[0];
	const controller: RenderQualityController | undefined = pinned
		? undefined
		: createRenderQualityController(ladder);
	return {
		get level() {
			return level;
		},
		frame(intervalMs, visible) {
			if (!controller) return undefined;
			const next = controller.frame(intervalMs, { measuring: true, quiet: true, visible });
			if (!next) return undefined;
			level = next as Quality3dLevel;
			return level;
		},
		visibilityChanged() {
			controller?.visibilityChanged();
		},
		snapshot() {
			const base: RenderQualitySnapshot = controller
				? controller.snapshot()
				: {
						mode: 'full',
						level: { index: 0, resolution: level.resolution, msaa: level.msaa },
						levels: 1,
						downStopped: false,
						history: [],
						trials: [],
					};
			return { ...base, rung: level, pinned };
		},
	};
}
