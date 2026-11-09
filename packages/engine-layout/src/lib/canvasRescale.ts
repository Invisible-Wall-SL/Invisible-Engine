import type { LayoutProfile } from 'constants-shared/layoutProfile';

import type { EditorGuideSet } from './editorGuides';
import { findReelGridNode } from './reelGrid';
import type { LayoutDoc, LayoutNode, NodeOverride, Point2D, Scene } from './types';

/** The parts of a doc a rescale reads: the editor holds these, not a whole `LayoutDoc`. */
export type RescalableLayout = Pick<LayoutDoc, 'mainSizesMap' | 'scenes'>;

export interface CanvasRescale<D extends RescalableLayout> {
	/** `doc` on the bigger canvas, with a `layoutProfile` whose bucket boxes are scaled too. */
	doc: D & { layoutProfile: LayoutProfile };
	/** No scene carries a reel grid (`findReelGridNode`), so a slot's board is the coded default:
	 *  sized in coded units, it does NOT follow the canvas. Add a Reel Grid before rescaling a slot. */
	codedBoard: boolean;
}

/** A scene whose numbers are canvas units: `game` (the doc's box), `standard` (the profile's
 *  bucket box) and a `canvas` screen that scales with the window. */
export function sceneInCanvasUnits(scene: Pick<Scene, 'space' | 'scaleWithWindow'>): boolean {
	return (
		!scene.space ||
		scene.space === 'game' ||
		scene.space === 'standard' ||
		(scene.space === 'canvas' && scene.scaleWithWindow === true)
	);
}

/**
 * Put a whole layout on a canvas `factor` times larger (or smaller), looking exactly as it did —
 * the step from a 1920×1080 game to a 3840×2160 one (`docs/design/arcade-4k-builds.md` Phase 2).
 *
 * The doc's boxes and its layout profile's bucket boxes scale, so the window fits the bigger box
 * by a smaller factor. Each top-level node of a scene laid out in canvas units moves and scales by
 * `factor`, so everything under it keeps its own (local) numbers and draws where it did; that is
 * exact for the art the project has, and it is why no per-kind field needs rewriting. Two kinds of
 * number sit outside a node's scale and are multiplied directly: a reel grid's board nudge, and a
 * scene's world, camera and editor guides.
 *
 * A `canvas` screen that does not scale with the window is window pixels, and a `background` one
 * cover-fits the window: neither depends on the canvas, so both are left alone.
 *
 * When the art is later re-made at the bigger size, a node drawn at its art's natural size needs
 * its scale back at 1 — the art carries the factor then.
 */
export function rescaleCanvas<D extends RescalableLayout>(
	doc: D,
	factor: number,
	profile: LayoutProfile,
): CanvasRescale<D> {
	if (!Number.isFinite(factor) || factor <= 0) throw new Error(`bad canvas factor: ${factor}`);
	const k = (v: number) => v * factor;
	const box = <B extends { width: number; height: number }>(b: B): B => ({
		...b,
		width: k(b.width),
		height: k(b.height),
	});
	const point = (p: Point2D | undefined): Point2D =>
		p ? { x: k(p.x), y: k(p.y) } : { x: factor, y: factor };
	const moved = <T extends Pick<NodeOverride, 'x' | 'y' | 'scale'>>(t: T): T => ({
		...t,
		...(t.x !== undefined && { x: k(t.x) }),
		...(t.y !== undefined && { y: k(t.y) }),
		...(t.scale && { scale: point(t.scale) }),
	});
	const guides = (set: EditorGuideSet): EditorGuideSet =>
		Object.fromEntries(
			Object.entries(set).map(([id, g]) => [
				id,
				{ ...g, ...(g?.x && { x: g.x.map(k) }), ...(g?.y && { y: g.y.map(k) }) },
			]),
		);

	const node = (n: LayoutNode): LayoutNode => {
		const out = {
			...n,
			x: k(n.x),
			y: k(n.y),
			scale: point(n.scale),
			...(n.overrides && {
				overrides: Object.fromEntries(
					Object.entries(n.overrides).map(([id, o]) => [id, o && moved(o)]),
				),
			}),
		} as LayoutNode;
		if (out.kind === 'reelGrid') {
			if (out.boardNudgeX !== undefined) out.boardNudgeX = k(out.boardNudgeX);
			if (out.boardNudgeY !== undefined) out.boardNudgeY = k(out.boardNudgeY);
		}
		return out;
	};

	const scenes = doc.scenes.map((scene): Scene => {
		const out: Scene = { ...scene };
		if (scene.guides) out.guides = guides(scene.guides);
		if (!sceneInCanvasUnits(scene)) return out;
		out.nodes = scene.nodes.map(node);
		if (scene.world) out.world = { w: k(scene.world.w), h: k(scene.world.h) };
		if (scene.camera) {
			const c = scene.camera;
			out.camera = {
				...c,
				...(c.deadZone && { deadZone: { w: k(c.deadZone.w), h: k(c.deadZone.h) } }),
				...(c.lookAhead !== undefined && { lookAhead: k(c.lookAhead) }),
				...(c.autoScroll && { autoScroll: { x: k(c.autoScroll.x), y: k(c.autoScroll.y) } }),
			};
		}
		return out;
	});

	return {
		doc: {
			...doc,
			mainSizesMap: Object.fromEntries(
				Object.entries(doc.mainSizesMap).map(([id, b]) => [id, box(b)]),
			),
			layoutProfile: {
				...profile,
				buckets: profile.buckets.map((b) => ({ ...b, box: box(b.box) })),
			},
			scenes,
		},
		codedBoard: !findReelGridNode(doc),
	};
}
