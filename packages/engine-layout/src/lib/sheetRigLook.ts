/**
 * A CHARACTER DRAWN AS A RIG BY ITS SHEET (`docs/design/character-pipeline.md` §12.7, step C6a):
 * one `RigView` per character, placed by the sheet's draw box and playing the animation its
 * resolver answers (`characterSheet.ts` `createSheetRigAnimator`). It is mounted through the
 * channel an online room's code looks use (`arcadeArt.svelte.ts`): `<SpawnLayer>` draws the mount
 * in place of the instance's own tree, and knows only that the instance has one.
 *
 * Imported lazily, and only by a room whose config names a rig on a sheet
 * (`engine-layout/sheet-rig`): a game with none never loads this module.
 */

import * as RIG from 'engine-rig/pixi';
import type { CharacterSheet } from 'game-config';
import { getRigLoadScale } from 'pixi-svelte';
import type { Container } from 'pixi.js';

import type { ArtMount } from './arcadeArt.svelte';
import {
	sheetRigPlacement,
	sheetRigPoints,
	type RigBox,
	type SheetRigFrame,
} from './characterSheet';

/** A rig's Bounds box as its header holds it: skeleton space (y up, `x`/`y` its bottom-left
 *  corner; absent ⇒ centred on the origin), before the load scale. */
type RigHeader = { x?: number; y?: number; width?: number; height?: number };

/**
 * A rig's box in the view's own px (y down): the Bounds box of its header (the Rigger's), at the
 * scale the rig was loaded at, or `undefined` when the header has no positive size.
 */
export function rigHeaderBox(header: RigHeader, loadScale: number): RigBox | undefined {
	const { width = 0, height = 0 } = header;
	if (!(width > 0) || !(height > 0)) return undefined;
	const x = typeof header.x === 'number' && Number.isFinite(header.x) ? header.x : -width / 2;
	const y = typeof header.y === 'number' && Number.isFinite(header.y) ? header.y : -height / 2;
	return {
		x: x * loadScale,
		y: -(y + height) * loadScale,
		w: width * loadScale,
		h: height * loadScale,
	};
}

export type SheetRigLook = {
	/** The rig it draws: a frame of another rig needs another look. */
	readonly rig: string;
	readonly mount: ArtMount;
	/** Draw this frame of the sheet's animator. */
	frame(frame: SheetRigFrame): void;
	/** Its hand (a line it holds starts there) and its middle, as `sheetClipPoints` gives a
	 *  clip's. */
	points(): { hand: { dx: number; lift: number }; middle: number };
	/** What it draws now (the probe's). */
	drawn(): {
		rig: string;
		animation: string | undefined;
		skin: string | undefined;
		flipX: boolean;
		loop: boolean;
		mounted: boolean;
		/** Its box as drawn, px. */
		width: number;
		height: number;
	};
	destroy(): void;
};

/**
 * A look for `rig`, whose loaded data is `data`, drawn by `sheet`. Its box is the rig's Bounds
 * box, else its bounds in the first pose it is drawn in.
 */
export function createSheetRigLook(
	rig: string,
	data: RIG.SkeletonData,
	sheet: CharacterSheet,
): SheetRigLook {
	const view = new RIG.RigView(data);
	let box = rigHeaderBox(data, getRigLoadScale(rig));
	let parent: Container | undefined;
	let playing: string | undefined;
	let shown: SheetRigFrame | undefined;
	let skin: string | undefined;

	const place = (flipX: boolean) => {
		if (!box) return;
		const { scale, x, y } = sheetRigPlacement(sheet, box);
		view.scale.set(flipX ? -scale : scale, scale);
		view.position.set(flipX ? -x : x, y);
	};
	const wear = (name: string | undefined) => {
		if (name === skin) return;
		skin = name;
		const next = name === undefined ? data.defaultSkin : data.findSkin(name);
		view.skeleton.setSkin(next);
		view.skeleton.setSlotsToSetupPose();
	};

	return {
		rig,
		mount: (into) => {
			parent = into;
			into.addChild(view);
			return () => {
				if (parent === into) parent = undefined;
				if (!view.destroyed) into.removeChild(view);
			};
		},
		frame(frame) {
			wear(frame.skin);
			const key = `${frame.animation}|${frame.loop}|${frame.play}`;
			if (key !== playing && data.findAnimation(frame.animation)) {
				playing = key;
				view.state.setAnimation(0, frame.animation, frame.loop);
			}
			if (!box && playing !== undefined) {
				const posed = view.bounds;
				if (posed.width > 0 && posed.height > 0)
					box = { x: posed.minX, y: posed.minY, w: posed.width, h: posed.height };
			}
			shown = frame;
			place(frame.flipX);
		},
		points() {
			const flipX = shown?.flipX === true;
			return sheetRigPoints(sheet, box ?? { x: 0, y: 0, w: 1, h: 1 }, flipX, (name) =>
				view.getBonePosition(name),
			);
		},
		drawn() {
			const scale = box ? sheetRigPlacement(sheet, box).scale : 0;
			return {
				rig,
				animation: shown?.animation,
				skin,
				flipX: shown?.flipX === true,
				loop: shown?.loop === true,
				mounted: parent !== undefined,
				width: (box?.w ?? 0) * scale,
				height: (box?.h ?? 0) * scale,
			};
		},
		destroy() {
			parent = undefined;
			if (!view.destroyed) view.destroy();
		},
	};
}
