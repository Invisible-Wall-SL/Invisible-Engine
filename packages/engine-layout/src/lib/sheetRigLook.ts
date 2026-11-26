/**
 * A CHARACTER DRAWN AS A RIG BY ITS SHEET (`docs/design/character-pipeline.md` §12.7, step C6a):
 * one `RigView` per character, placed by the sheet's draw box and playing the animation its
 * resolver answers (`characterSheet.ts` `createSheetRigAnimator`). It is mounted through the
 * channel an online room's code looks use (`arcadeArt.svelte.ts`): `<SpawnLayer>` draws the mount
 * in place of the instance's own tree, and knows only that the instance has one.
 *
 * A SMOOTH TURN (`view.turn`, §13) mixes the picture a facing leaves with the one it takes
 * (`SheetRigFrame.blend`), the walk carried on at the phase it was at. Two animations that draw
 * the same parts are mixed as ONE POSE by the rig runtime (`AnimationState`'s mix). Two that draw
 * different parts (a rig of one drawing a facing), or the same one mirrored, cannot be: they are
 * two pictures, each a rig view of its own, CROSS-FADED. A rig drawn part by part at an alpha
 * would show its parts through one another, so the fading view is flattened by a filter while it
 * fades. The pass covers the view's box as it is drawn this frame: Pixi's own measure for a filter
 * finds no size in a `RigView` (it is measured through a part that is not drawn) and would skip
 * the pass, drawing both pictures at full strength.
 *
 * Imported lazily, and only by a room whose config names a rig on a sheet
 * (`engine-layout/sheet-rig`): a game with none never loads this module.
 */

import * as RIG from 'engine-rig/pixi';
import type { CharacterSheet } from 'game-config';
import { getRigLoadScale } from 'pixi-svelte';
import { AlphaFilter, Container, Rectangle } from 'pixi.js';

import type { ArtMount } from './arcadeArt.svelte';
import { fadeAlphas, leanedPoint, phaseKept } from './characterTurn';
import {
	sheetLeanPivot,
	sheetRigPlacement,
	sheetRigPoints,
	type SheetRigFrame,
} from './characterSheet';
import { rigHeaderBox } from './rigBox';

/** The longest a rig moves on in one frame: a look drawn again after a while does not leap. */
const MAX_STEP_MS = 100;

/** How far a fading view's pass reaches past its box: a share of the box's longer side, and no
 *  less than `min` px, so a part that swings out of it between two measures is not cut. */
const FADE_MARGIN = Object.freeze({ share: 0.25, min: 8 });

/**
 * Whether two animations of a rig may be mixed as one pose: they show the same attachment in
 * every slot they key (a slot neither keys is the setup pose's in both). Two that swap parts
 * (one drawing a facing) would change them in one frame half way through a mix.
 */
export function rigPoseMixes(data: RIG.SkeletonData, from: string, to: string): boolean {
	const shownBy = (name: string): Map<number, string> | undefined => {
		const animation = data.findAnimation(name);
		if (!animation) return undefined;
		const shown = new Map<number, string>();
		for (const timeline of animation.timelines)
			if (timeline instanceof RIG.AttachmentTimeline)
				shown.set(timeline.slotIndex, timeline.attachmentNames.join('\n'));
		return shown;
	};
	const a = shownBy(from);
	const b = shownBy(to);
	if (!a || !b) return false;
	const setup = (slot: number) => data.slots[slot]?.attachmentName ?? '';
	for (const slot of new Set([...a.keys(), ...b.keys()]))
		if ((a.get(slot) ?? setup(slot)) !== (b.get(slot) ?? setup(slot))) return false;
	return true;
}

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
		/** The picture it is turning from while two are mixed: its animation, how much of the
		 *  frame's own picture is drawn, whether the two are one pose (else two views
		 *  cross-faded, at these alphas) and where in its cycle each is, 0 to 1. */
		blend:
			| {
					from: string;
					weight: number;
					pose: boolean;
					alpha: { from: number; to: number };
					phase: { from: number; to: number };
			  }
			| undefined;
	};
	destroy(): void;
};

/** One rig view of a look and what it plays. */
type Layer = {
	view: RIG.RigView;
	playing: string | undefined;
	skin: string | undefined;
	/** Drawn mirrored: the same animation mirrored is another picture. */
	flipX: boolean;
	fade: AlphaFilter | undefined;
	/** Whether its filter is on: set only when that changes. */
	faded: boolean;
	/** The box its filter's pass covers while it fades, in its own space. */
	area: Rectangle;
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
	const root = new Container();
	// Advanced by `frame`, not by the shared ticker: a look that is not drawn costs nothing.
	const layer = (): Layer => {
		const view = new RIG.RigView({ skeletonData: data, autoUpdate: false });
		return {
			view,
			playing: undefined,
			skin: undefined,
			flipX: false,
			fade: undefined,
			faded: false,
			area: new Rectangle(),
		};
	};
	/** The view the frame's own picture is drawn by, and the one a cross-fade leaves (made with
	 *  the first cross-fade: a look that never fades has one view). */
	let front = layer();
	let back: Layer | undefined;
	root.addChild(front.view);
	let box = rigHeaderBox(data, getRigLoadScale(rig));
	let lastAt: number | undefined;
	let parent: Container | undefined;
	let shown: SheetRigFrame | undefined;
	/** The blend it draws, if it draws one. */
	let mixed: SheetRigFrame['blend'];
	let fading: { from: number; to: number } | undefined;
	const mixes = new Map<string, boolean>();
	const posed = (from: string, to: string): boolean => {
		const key = `${from}\n${to}`;
		let known = mixes.get(key);
		if (known === undefined) mixes.set(key, (known = rigPoseMixes(data, from, to)));
		return known;
	};

	// A sheet that turns smoothly draws the rig at its frame's lean about its pivot (the middle
	// of its box, or the sheet's feet): the rig's own origin is carried round it. The mirror is in
	// the scale, which is applied before the rotation, so a mirrored rig leans the same way.
	const place = (on: Layer, flipX: boolean, lean = 0) => {
		const { view } = on;
		on.flipX = flipX;
		if (!box) return;
		const { scale, x, y } = sheetRigPlacement(sheet, box);
		const at = leanedPoint(
			{ dx: flipX ? -x : x, lift: -y },
			lean,
			lean ? sheetLeanPivot(sheet, box) : 0,
		);
		view.scale.set(flipX ? -scale : scale, scale);
		view.position.set(at.dx, -at.lift);
		view.rotation = lean;
	};
	const wear = (on: Layer, name: string | undefined) => {
		if (name === on.skin) return;
		on.skin = name;
		const next = name === undefined ? data.defaultSkin : data.findSkin(name);
		on.view.skeleton.setSkin(next);
		on.view.skeleton.setSlotsToSetupPose();
	};
	const keyOf = (frame: SheetRigFrame) => `${frame.animation}|${frame.loop}|${frame.play}`;
	/** Where in its cycle a view is, 0 to 1 (0 for one that plays nothing, or a pose of no
	 *  length). */
	const phaseOf = (on: Layer | undefined): number => {
		const entry = on?.view.state.getCurrent(0);
		if (!entry) return 0;
		return phaseKept(entry.trackTime, entry.animationEnd - entry.animationStart, 1);
	};
	/**
	 * Have `on` play the frame's animation. One that carries on a cycle (`phase`, 0 to 1) starts
	 * at that share of its own length, not at its first key; `mixMs` mixes it in from the pose
	 * `on` is in.
	 */
	const play = (on: Layer, frame: SheetRigFrame, phase?: number, mixMs = 0) => {
		wear(on, frame.skin);
		const key = keyOf(frame);
		if (key === on.playing || !data.findAnimation(frame.animation)) return;
		on.playing = key;
		const entry = on.view.state.setAnimation(0, frame.animation, frame.loop);
		if (phase !== undefined)
			entry.trackTime = phaseKept(phase, 1, entry.animationEnd - entry.animationStart);
		entry.mixDuration = mixMs / 1000;
	};
	const opacity = (on: Layer, alpha: number) => {
		const faded = alpha < 1;
		if (faded) {
			if (!on.fade) {
				on.fade = new AlphaFilter();
				on.fade.resolution = 'inherit';
			}
			on.fade.alpha = alpha;
		}
		if (faded === on.faded) return;
		on.faded = faded;
		on.view.filterArea = faded ? on.area : undefined;
		on.view.filters = faded && on.fade ? [on.fade] : [];
	};
	/** Fit a fading view's pass to its box as it is drawn now, else to the rig's. */
	const cover = (on: Layer) => {
		const drawn = on.view.getLocalBounds();
		const at =
			drawn.width > 0 && drawn.height > 0
				? { x: drawn.minX, y: drawn.minY, w: drawn.width, h: drawn.height }
				: box;
		if (!at) return;
		const margin = Math.max(FADE_MARGIN.min, FADE_MARGIN.share * Math.max(at.w, at.h));
		on.area.x = at.x - margin;
		on.area.y = at.y - margin;
		on.area.width = at.w + 2 * margin;
		on.area.height = at.h + 2 * margin;
	};
	const rest = () => {
		fading = undefined;
		opacity(front, 1);
		// A view put away stops where it was: what it next plays starts afresh, at the phase
		// it is handed.
		if (back) {
			back.view.visible = false;
			back.playing = undefined;
		}
	};

	return {
		rig,
		mount: (into) => {
			parent = into;
			into.addChild(root);
			return () => {
				if (parent === into) parent = undefined;
				if (!root.destroyed) into.removeChild(root);
			};
		},
		frame(frame, atMs) {
			const step =
				lastAt === undefined ? 0 : Math.min(Math.max(atMs - lastAt, 0), MAX_STEP_MS) / 1000;
			lastAt = atMs;
			// A picture left that another rig drew is another look's, and one this rig cannot play
			// is no picture: this look has nothing to mix then.
			const blend =
				frame.blend?.from.rig === rig &&
				data.findAnimation(frame.animation) &&
				data.findAnimation(frame.blend.from.animation)
					? frame.blend
					: undefined;
			const pose =
				blend !== undefined && blend.pose && posed(blend.from.animation, frame.animation);
			if (blend && !pose) {
				// Two pictures: the view that drew the one left goes behind and plays on, and the
				// other takes the frame's at the same phase. Turned back, the two change places
				// and neither starts again.
				if (front.playing !== keyOf(frame) || front.flipX !== frame.flipX) {
					const left = front;
					front = back ?? layer();
					back = left;
					root.addChild(front.view);
					front.view.visible = true;
				}
				back ??= layer();
				if (!back.view.parent) root.addChildAt(back.view, 0);
				play(front, frame, phaseOf(back));
				play(back, blend.from, phaseOf(front));
				back.view.visible = true;
				fading = fadeAlphas(blend.weight);
				opacity(front, fading.to);
				opacity(back, fading.from);
				back.view.update(step);
				place(back, blend.from.flipX, blend.from.lean);
			} else {
				rest();
				// One pose: the runtime mixes the animation in from the one playing, over what is
				// left of the blend, and carries its cycle on.
				if (blend) play(front, frame, phaseOf(front), blend.leftMs);
				else play(front, frame, frame.kept ? phaseOf(front) : undefined);
			}
			front.view.update(step);
			if (!box && front.playing !== undefined) {
				const first = front.view.bounds;
				if (first.width > 0 && first.height > 0)
					box = { x: first.minX, y: first.minY, w: first.width, h: first.height };
			}
			shown = frame;
			mixed = blend;
			// One pose leans as far between its two pictures as it is mixed.
			const lean =
				blend && pose && frame.lean !== undefined && blend.from.lean !== undefined
					? blend.from.lean + (frame.lean - blend.from.lean) * blend.weight
					: frame.lean;
			place(front, frame.flipX, lean);
			for (const on of [front, back]) if (on?.faded && on.view.visible) cover(on);
		},
		points() {
			const flipX = shown?.flipX === true;
			// Before its box is known a point is read off a square one, as a clip's would be.
			const upright = box
				? sheetRigPoints(sheet, box, flipX, (name) => front.view.getBonePosition(name))
				: sheetRigPoints(sheet, { x: 0, y: 0, w: 1, h: 1 }, flipX, () => undefined);
			const lean = front.view.rotation;
			if (!lean || !box) return upright;
			// The hand turns with the body, and the middle is how high the turned middle is.
			const about = sheetLeanPivot(sheet, box);
			return {
				hand: leanedPoint(upright.hand, lean, about),
				middle: leanedPoint({ dx: 0, lift: upright.middle }, lean, about).lift,
			};
		},
		drawn() {
			const scale = box ? sheetRigPlacement(sheet, box).scale : 0;
			const blend = mixed;
			return {
				rig,
				animation: shown?.animation,
				skin: front.skin,
				flipX: shown?.flipX === true,
				lean: front.view.rotation,
				loop: shown?.loop === true,
				mounted: parent !== undefined,
				width: (box?.w ?? 0) * scale,
				height: (box?.h ?? 0) * scale,
				blend: blend && {
					from: blend.from.animation,
					weight: blend.weight,
					pose: fading === undefined,
					alpha: fading ?? { from: 0, to: 1 },
					phase: { from: phaseOf(fading ? back : front), to: phaseOf(front) },
				},
			};
		},
		destroy() {
			parent = undefined;
			for (const on of [front, back]) on?.fade?.destroy();
			if (!root.destroyed) root.destroy({ children: true });
		},
	};
}
