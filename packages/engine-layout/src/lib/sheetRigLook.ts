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
import { leanedPoint } from './characterTurn';
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

/** The longest a rig moves on in one frame: a look drawn again after a while does not leap. */
const MAX_STEP_MS = 100;

export type SheetRigLook = {
	/** The rig it draws: a frame of another rig needs another look. */
	readonly rig: string;
	readonly mount: ArtMount;
	/** Draw this frame of the sheet's animator, at `atMs` on the clock the room draws by: the rig
	 *  moves on by the time since its last frame (none on its first, so it is posed at once). */
	frame(frame: SheetRigFrame, atMs: number): void;
	/** Its hand (a line it holds starts there) and its middle, as `sheetClipPoints` gives a
	 *  clip's. */
	points(): { hand: { dx: number; lift: number }; middle: number };
	/** What it draws now (the probe's). */
	drawn(): {
		rig: string;
		animation: string | undefined;
		skin: string | undefined;
		flipX: boolean;
		/** The lean it is drawn at (a sheet that turns smoothly), radians; 0 upright. */
		lean: number;
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
	// Advanced by `frame`, not by the shared ticker: a look that is not drawn costs nothing.
	const view = new RIG.RigView({ skeletonData: data, autoUpdate: false });
	let box = rigHeaderBox(data, getRigLoadScale(rig));
	let lastAt: number | undefined;
	let parent: Container | undefined;
	let playing: string | undefined;
	let shown: SheetRigFrame | undefined;
	let skin: string | undefined;

	// A sheet that turns smoothly draws the rig at its frame's lean about the character's place
	// (the sheet's feet): the rig's own origin is carried round the place with it. The mirror is in
	// the scale, which is applied before the rotation, so a mirrored rig leans the same way.
	const place = (flipX: boolean, lean = 0) => {
		if (!box) return;
		const { scale, x, y } = sheetRigPlacement(sheet, box);
		const at = leanedPoint({ dx: flipX ? -x : x, lift: -y }, lean);
		view.scale.set(flipX ? -scale : scale, scale);
		view.position.set(at.dx, -at.lift);
		view.rotation = lean;
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
		frame(frame, atMs) {
			wear(frame.skin);
			const key = `${frame.animation}|${frame.loop}|${frame.play}`;
			if (key !== playing && data.findAnimation(frame.animation)) {
				playing = key;
				view.state.setAnimation(0, frame.animation, frame.loop);
			}
			view.update(
				lastAt === undefined ? 0 : Math.min(Math.max(atMs - lastAt, 0), MAX_STEP_MS) / 1000,
			);
			lastAt = atMs;
			if (!box && playing !== undefined) {
				const posed = view.bounds;
				if (posed.width > 0 && posed.height > 0)
					box = { x: posed.minX, y: posed.minY, w: posed.width, h: posed.height };
			}
			shown = frame;
			place(frame.flipX, frame.lean);
		},
		points() {
			const flipX = shown?.flipX === true;
			// Before its box is known a point is read off a square one, as a clip's would be.
			const upright = box
				? sheetRigPoints(sheet, box, flipX, (name) => view.getBonePosition(name))
				: sheetRigPoints(sheet, { x: 0, y: 0, w: 1, h: 1 }, flipX, () => undefined);
			const lean = shown?.lean;
			if (!lean) return upright;
			// The hand turns with the body, and the middle is how high the turned middle is.
			return {
				hand: leanedPoint(upright.hand, lean),
				middle: leanedPoint({ dx: 0, lift: upright.middle }, lean).lift,
			};
		},
		drawn() {
			const scale = box ? sheetRigPlacement(sheet, box).scale : 0;
			return {
				rig,
				animation: shown?.animation,
				skin,
				flipX: shown?.flipX === true,
				lean: shown?.lean ?? 0,
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
