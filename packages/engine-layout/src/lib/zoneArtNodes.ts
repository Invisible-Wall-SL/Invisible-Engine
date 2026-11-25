import type { ZoneStamp } from 'game-config';

import type { ContainerNode, LayoutDoc, LayoutNode, Scene } from './types';

/**
 * ZONE ART DRAWN BY THE LAYOUT (`docs/design/zone-art.md`, `engine-layout/zone-art`): an arcade
 * game's zone stamps (`game-config` `zoneArtStamps`) as ordinary layout nodes, a sprite or a
 * Flipbook clip each, in one container placed just under the play field's spawn layer with the
 * layer's own transform, so a stamp sits on its zone wherever the layer's bodies do and under them.
 * Every screen and runtime draws them with the nodes it already draws: nothing new renders them.
 *
 * Pure. Imported only by the arcade runtime (`apps/lines` `game/zoneArt.ts`); never from the
 * package's index, so no other runtime carries it. A doc with no stamp comes back as it was.
 */

/** The container's id: one per doc, on the screen of the play field's layer. */
export const ZONE_ART_NODE = 'zone-art';

/** A clip's natural size (its Bounds box), when known: a stamp of it then keeps its ratio. */
export type ClipSize = (clipId: string) => { w: number; h: number } | undefined;

/** The largest `w × h` of ratio `natural` that fits in `w × h`. */
function contain(natural: { w: number; h: number } | undefined, w: number, h: number) {
	if (!natural || !(natural.w > 0) || !(natural.h > 0)) return { w, h };
	const k = Math.min(w / natural.w, h / natural.h);
	return { w: natural.w * k, h: natural.h * k };
}

/** One stamp as a node, centred on its box. A sprite fits its frame inside the box; a clip with a
 *  known size is fitted the same, one with none fills it. */
export function zoneStampNode(stamp: ZoneStamp, clipSize?: ClipSize): LayoutNode {
	const at = {
		id: `${ZONE_ART_NODE}:${stamp.zone}`,
		x: stamp.x + stamp.w / 2,
		y: stamp.y + stamp.h / 2,
		anchor: { x: 0.5, y: 0.5 },
		locked: true,
	};
	const { source } = stamp;
	if (source.kind === 'sprite') {
		const assetKey = source.region.slice(0, source.region.indexOf('::'));
		return {
			...at,
			kind: 'sprite',
			assetKey,
			region: source.region,
			width: stamp.w,
			height: stamp.h,
			keepAspect: true,
		};
	}
	const size = contain(clipSize?.(source.clip), stamp.w, stamp.h);
	return {
		...at,
		kind: 'flipbook',
		clipId: source.clip,
		width: size.w,
		height: size.h,
		loop: true,
		...(source.fps ? { fps: source.fps } : {}),
	};
}

/** The top-level spawn layer the play field's bodies are drawn in: `layer` when a screen has it at
 *  its top level, else the first top-level spawn layer of a world screen, else of any screen. */
export function playFieldLayerOf(
	doc: LayoutDoc,
	layer?: string,
): { scene: Scene; node: LayoutNode } | undefined {
	const top = (scene: Scene) => scene.nodes.filter((n) => n.kind === 'spawnLayer');
	const found = (scenes: readonly Scene[], pick: (n: LayoutNode) => boolean) => {
		for (const scene of scenes) {
			const node = top(scene).find(pick);
			if (node) return { scene, node };
		}
		return undefined;
	};
	if (layer) return found(doc.scenes, (n) => n.id === layer);
	return (
		found(
			doc.scenes.filter((s) => !!s.world),
			() => true,
		) ?? found(doc.scenes, () => true)
	);
}

/**
 * `doc` with `stamps` drawn: a container of them just before the play field's layer, at its
 * place, scale, rotation, parallax and per-layout overrides, of its depth. `doc` itself when there is no stamp, no such layer, or
 * the doc already holds the container.
 */
export function withZoneArtNodes(
	doc: LayoutDoc,
	stamps: readonly ZoneStamp[],
	options: { layer?: string; clipSize?: ClipSize } = {},
): LayoutDoc {
	if (!stamps.length) return doc;
	const at = playFieldLayerOf(doc, options.layer);
	if (!at || doc.scenes.some((s) => s.nodes.some((n) => n.id === ZONE_ART_NODE))) return doc;
	const { node: layer } = at;
	const container: ContainerNode = {
		id: ZONE_ART_NODE,
		label: 'Zone art',
		kind: 'container',
		x: layer.x,
		y: layer.y,
		...(layer.scale ? { scale: layer.scale } : {}),
		...(layer.rotation ? { rotation: layer.rotation } : {}),
		...(layer.zIndex !== undefined ? { zIndex: layer.zIndex } : {}),
		...(layer.parallax ? { parallax: layer.parallax } : {}),
		...(layer.overrides ? { overrides: layer.overrides } : {}),
		locked: true,
		children: stamps.map((stamp) => zoneStampNode(stamp, options.clipSize)),
	};
	return {
		...doc,
		scenes: doc.scenes.map((scene) =>
			scene === at.scene
				? {
						...scene,
						nodes: scene.nodes.flatMap((n) => (n === layer ? [container, n] : [n])),
					}
				: scene,
		),
	};
}
