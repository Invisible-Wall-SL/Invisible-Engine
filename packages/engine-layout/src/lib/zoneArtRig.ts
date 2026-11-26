/**
 * ZONE ART DRAWN AS A RIG (`docs/design/zone-art.md`, `engine-layout/zone-art-rig`): a zone stamp
 * (or a piece of scenery) whose picture is one of the project's rigs playing one of its animations
 * (`game-config` `ZoneArtRig`). One `RigView` per picture, posed at once at the start the seed
 * picks for its zone (`zoneArtPhaseFor`), so neighbouring rigs do not play in lockstep, and moved
 * on by its holder: a plain arcade game's mount ({@link zoneRigMount}) on the app's ticker, a
 * Salmons river on its own ticker while the piece is in view.
 *
 * Imported lazily, and only by a game whose zone art names a rig (`apps/lines`
 * `ZoneArtRig.svelte` for a game of its config's own zones, `online.ts` for a generator's art): a
 * game with none never loads this module.
 */

import * as RIG from 'engine-rig/pixi';
import type { ZoneArtRig } from 'game-config';
import { getRigLoadScale } from 'pixi-svelte';
import { Container, Rectangle, type Ticker } from 'pixi.js';

import type { ArtMount } from './arcadeArt.svelte';
import { rigHeaderBox } from './rigBox';

/** The longest a rig moves on in one frame: one drawn again after a while does not leap. */
const MAX_STEP_MS = 100;

export type ZoneRig = {
	/** The picture: a container whose origin is the middle of the rig's box and which measures as
	 *  that box (`boundsArea`), so it is placed, scaled and culled as a sprite anchored at its
	 *  middle is. */
	readonly view: Container;
	/** The rig's box, px, at the container's scale of 1. */
	readonly w: number;
	readonly h: number;
	/** Move it on by `ms`. */
	update(ms: number): void;
	/** What it plays (the probe's): its animation and how far into it it is, seconds. */
	drawn(): { rig: string; animation: string; loop: boolean; time: number };
	destroy(): void;
};

/** Draws a rig picture starting at `phase` (0 to 1 of its animation); `undefined` while its rig is
 *  not loaded, or has no such animation: the holder then draws as it does without zone art. */
export type ZoneRigDraw = (source: ZoneArtRig, phase: number) => ZoneRig | undefined;

/** The rig a game loaded under its bundle name, if it did (`pixi-svelte` `loadedAssets`). */
export function zoneRigDataOf(
	assets: Record<string, unknown> | undefined,
	rig: string,
): RIG.SkeletonData | undefined {
	const data = assets && Object.hasOwn(assets, rig) ? assets[rig] : undefined;
	return typeof (data as RIG.SkeletonData | undefined)?.findAnimation === 'function'
		? (data as RIG.SkeletonData)
		: undefined;
}

/**
 * `source` drawn from `data`, its animation started at `phase` of its length when it loops (a
 * one-shot plays from its start). Its box is the rig's Bounds box, else its bounds in that first
 * pose; `undefined` when it has neither, or no such animation.
 */
export function createZoneRig(
	data: RIG.SkeletonData,
	source: ZoneArtRig,
	phase = 0,
): ZoneRig | undefined {
	if (!data.findAnimation(source.animation)) return undefined;
	const loop = source.loop !== false;
	const rig = new RIG.RigView({ skeletonData: data, autoUpdate: false });
	const entry = rig.state.setAnimation(0, source.animation, loop);
	const length = entry.animationEnd - entry.animationStart;
	if (loop && length > 0) entry.trackTime = (((phase % 1) + 1) % 1) * length;
	rig.update(0);
	let box = rigHeaderBox(data, getRigLoadScale(source.rig));
	if (!box) {
		const posed = rig.bounds;
		if (posed.width > 0 && posed.height > 0)
			box = { x: posed.minX, y: posed.minY, w: posed.width, h: posed.height };
	}
	if (!box) {
		rig.destroy();
		return undefined;
	}
	const view = new Container({ label: `zone-art-rig:${source.rig}` });
	rig.position.set(-(box.x + box.w / 2), -(box.y + box.h / 2));
	view.boundsArea = new Rectangle(-box.w / 2, -box.h / 2, box.w, box.h);
	view.addChild(rig);
	return {
		view,
		w: box.w,
		h: box.h,
		update: (ms) => rig.update(Math.min(Math.max(ms, 0), MAX_STEP_MS) / 1000),
		drawn: () => ({
			rig: source.rig,
			animation: source.animation,
			loop,
			time: rig.state.getCurrent(0)?.trackTime ?? 0,
		}),
		destroy: () => {
			if (!view.destroyed) view.destroy({ children: true });
		},
	};
}

/** Draws each rig picture from the rigs `assets` holds when it is asked (`ZoneRigDraw`). */
export const zoneRigDraw =
	(assets: () => Record<string, unknown> | undefined): ZoneRigDraw =>
	(source, phase) => {
		const data = zoneRigDataOf(assets(), source.rig);
		return data && createZoneRig(data, source, phase);
	};

/** A rig stamp of a plain arcade game (`zoneArtNodes.ts` `zoneStampNode`): its picture, where it
 *  starts, and the box it is fitted in, px. */
export type ZoneRigStamp = { source: ZoneArtRig; phase: number; w: number; h: number };

/**
 * A plain arcade game's rig stamp, drawn at the middle of its box (the bound node's place) and
 * fitted inside it, its own ratio kept, moved on by the app's ticker. Nothing while its rig is not
 * loaded or has no such animation, as without zone art.
 */
export function zoneRigMount(
	stamp: ZoneRigStamp,
	assets: () => Record<string, unknown> | undefined,
): ArtMount {
	return (into, app) => {
		const picture = zoneRigDraw(assets)(stamp.source, stamp.phase);
		if (!picture) return () => {};
		picture.view.scale.set(Math.min(stamp.w / picture.w, stamp.h / picture.h));
		into.addChild(picture.view);
		const tick = (ticker: Ticker) => picture.update(ticker.deltaMS);
		app.ticker.add(tick);
		return () => {
			app.ticker.remove(tick);
			picture.destroy();
		};
	};
}
