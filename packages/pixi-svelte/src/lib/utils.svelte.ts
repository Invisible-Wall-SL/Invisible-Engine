import WebFont from 'webfontloader';
import type * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';

import type { PixiPoint, Sizes } from './types';
import { spineNaturalBounds } from './spineBounds';

export const REM = 16;
export const MIN_CLICKABLE_SIZE = 3 * REM; // 44 x 44 is minimum clickable size

export const getPointValues = ({
	point,
	defaultValue,
}: {
	point: PixiPoint;
	defaultValue: number;
}) => {
	const finalDefaultValue = defaultValue === undefined ? 0 : defaultValue;
	if (typeof point === 'number') return [point, point];
	return [point?.x || finalDefaultValue, point?.y || finalDefaultValue];
};

export const anchorToPivot = ({ anchor, sizes }: { anchor: PixiPoint; sizes: Sizes }) => {
	const { width, height } = sizes;
	const [anchorX, anchorY] = getPointValues({ point: anchor, defaultValue: 0 });
	return { x: width * anchorX, y: height * anchorY };
};

/**
 * The VISIBLE-content box of a texture, as fractions of the texture frame:
 * `{ cx, cy, cw, ch }` where `cw`/`ch` are the opaque content's size and `cx`/`cy` its
 * centre (0..1). Lets a caller size + centre a sprite by what's actually drawn, ignoring
 * transparent margin baked into the art (so a padded icon and a tight one render at the
 * same on-screen size). Measured ONCE per texture via an offscreen 2D canvas (alpha
 * scan) and cached. Returns `null` when it can't measure (cross-origin taint, no
 * resource, fully transparent) so the caller falls back to plain sizing — never throws.
 */
const contentBoxCache = new Map<
	number,
	{ cx: number; cy: number; cw: number; ch: number } | null
>();
export function textureContentBox(texture: {
	uid?: number;
	frame?: { x: number; y: number; width: number; height: number };
	source?: { resource?: unknown };
}): { cx: number; cy: number; cw: number; ch: number } | null {
	const uid = texture?.uid;
	if (uid == null) return null;
	if (contentBoxCache.has(uid)) return contentBoxCache.get(uid) ?? null;
	let result: { cx: number; cy: number; cw: number; ch: number } | null = null;
	try {
		const frame = texture.frame;
		const src = texture.source?.resource as CanvasImageSource | undefined;
		if (frame && src && frame.width > 0 && frame.height > 0) {
			const W = Math.max(1, Math.round(frame.width));
			const H = Math.max(1, Math.round(frame.height));
			const canvas =
				typeof OffscreenCanvas !== 'undefined'
					? new OffscreenCanvas(W, H)
					: Object.assign(document.createElement('canvas'), { width: W, height: H });
			const ctx = (canvas as HTMLCanvasElement).getContext('2d', { willReadFrequently: true });
			if (ctx) {
				ctx.clearRect(0, 0, W, H);
				ctx.drawImage(src, frame.x, frame.y, frame.width, frame.height, 0, 0, W, H);
				const data = ctx.getImageData(0, 0, W, H).data;
				let minX = W,
					minY = H,
					maxX = -1,
					maxY = -1;
				for (let y = 0; y < H; y++) {
					for (let x = 0; x < W; x++) {
						if (data[(y * W + x) * 4 + 3] > 8) {
							if (x < minX) minX = x;
							if (x > maxX) maxX = x;
							if (y < minY) minY = y;
							if (y > maxY) maxY = y;
						}
					}
				}
				if (maxX >= minX && maxY >= minY) {
					const cw = (maxX - minX + 1) / W;
					const ch = (maxY - minY + 1) / H;
					const cx = (minX + (maxX - minX + 1) / 2) / W;
					const cy = (minY + (maxY - minY + 1) / 2) / H;
					result = { cx, cy, cw, ch };
				}
			}
		}
	} catch {
		result = null;
	}
	contentBoxCache.set(uid, result);
	return result;
}

/**
 * Detects if WebGL is enabled.
 * Inspired from http://www.browserleaks.com/webgl#howto-detect-webgl
 *
 * @return { number } -1 for not Supported,
 *										0 for disabled
 *										1 for enabled
 */
export function detectWebGL() {
	// Check for the WebGL rendering context
	if (window && !!window.WebGLRenderingContext) {
		let canvas = document.createElement('canvas'),
			names = ['webgl', 'experimental-webgl', 'moz-webgl', 'webkit-3d'],
			context = false;

		for (const i in names) {
			try {
				// @ts-ignore
				context = canvas.getContext(names[i]);
				// @ts-ignore
				if (context && typeof context.getParameter === 'function') {
					// WebGL is enabled.
					return 1;
				}
			} catch (e) {}
		}

		// WebGL is supported, but disabled.
		return 0;
	}

	// WebGL not supported.
	return -1;
}

export const preloadFont = () =>
	new Promise<void>((resolve) => {
		try {
			WebFont.load({
				typekit: {
					id: 'aba0ebl',
				},
				active: () => {
					resolve();
				},
				inactive: () => {
					console.error('Web font load inactive');
					resolve();
				},
			});
		} catch (error) {
			console.error(error);
			resolve();
		}
	});

/**
 * Resolve the uniform scale a `Spine` needs so an explicit `width`/`height` renders at
 * that size — robust to animation/skin-driven art whose setup pose has no attachments.
 *
 * spine-pixi-v8's own `width`/`height` setters scale relative to the spine's CURRENT
 * frame bounds, which are degenerate (0) for art driven by an animation before it has
 * advanced — so the requested size silently does nothing and the spine renders raw
 * (oversized). We instead size against the pose-independent authored bounds
 * (`skeleton.data.width/height`), the same fallback the editor renderer uses. When the
 * data omits a size we fall back to the live setup bounds; if those are also degenerate
 * we leave the axis at scale 1 (nothing reliable to size against).
 *
 * Each axis is sized by the dimension given for it; when only one is given it's applied
 * uniformly to both (preserving aspect), mirroring the prior `SpineProvider` behaviour.
 *
 * `fit` (additive, default unset = prior behaviour): when set AND both `width` and
 * `height` are given, return a UNIFORM scale that covers (`max`) or contains (`min`) the
 * given box against the authored dims — true cover/contain with NO axis stretch. This is
 * how a doc-driven background spine sizes against the canvas (see
 * docs/design/invisible-editor.md §10). `fit` is ignored when only one dimension is given
 * (already uniform) or when neither is — so non-background spines are unaffected.
 */
export function spineSizeScale({
	spine,
	width,
	height,
	fit,
}: {
	spine: SPINE_PIXI.Spine;
	width?: number;
	height?: number;
	fit?: 'cover' | 'contain';
}): { x: number; y: number } {
	if (width === undefined && height === undefined) return { x: 1, y: 1 };

	const data = spine.skeleton?.data;
	let naturalWidth = data && data.width > 0 ? data.width : 0;
	let naturalHeight = data && data.height > 0 ? data.height : 0;

	if (!(naturalWidth > 0) || !(naturalHeight > 0)) {
		// No authored size — try the live bounds (valid for spines whose setup pose has
		// attachments). Degenerate bounds (animation-driven, not yet advanced) stay 0.
		const bounds = spine.bounds;
		if (bounds && bounds.width > 0 && bounds.height > 0) {
			if (!(naturalWidth > 0)) naturalWidth = bounds.width;
			if (!(naturalHeight > 0)) naturalHeight = bounds.height;
		}
	}

	if ((!(naturalWidth > 0) || !(naturalHeight > 0)) && data) {
		// Still degenerate (a spine exported with no skeleton size AND no setup-pose art):
		// synthesize the natural size from the animations so an authored width/height can
		// still size it deterministically (same number the editor uses). Cached per data.
		const synth = spineNaturalBounds(data);
		if (!(naturalWidth > 0) && synth.width > 0) naturalWidth = synth.width;
		if (!(naturalHeight > 0) && synth.height > 0) naturalHeight = synth.height;
	}

	if (!(naturalWidth > 0) || !(naturalHeight > 0)) return { x: 1, y: 1 };

	if (width !== undefined && height !== undefined) {
		if (fit) {
			const sx = width / naturalWidth;
			const sy = height / naturalHeight;
			const s = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
			return { x: s, y: s };
		}
		return { x: width / naturalWidth, y: height / naturalHeight };
	}
	if (width !== undefined) {
		const s = width / naturalWidth;
		return { x: s, y: s };
	}
	const s = (height as number) / naturalHeight;
	return { x: s, y: s };
}

export function propsSyncEffect<TProps extends object, TTarget>({
	props,
	target,
	ignore,
}: {
	props: TProps;
	target?: TTarget | (() => TTarget);
	ignore?: (keyof TProps)[];
}) {
	$effect(() => {
		// The whole thing is wrapped inside an $effect
		// and because of ”props[key]“，it will react with every single props updated.
		let targetInstance = target instanceof Function ? target() : target;
		if (targetInstance) {
			(Object.keys(props) as (keyof TProps)[])
				.filter((key) => (ignore ? !ignore.includes(key) : true))
				.forEach((key) => {
					if (props[key] !== undefined) {
						// @ts-ignore
						targetInstance[key] = props[key];
					}
				});
		}
	});
}
