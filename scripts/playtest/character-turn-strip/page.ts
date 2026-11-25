/**
 * The page of `character-turn-strip.mjs`: it drives the game's own sheet animator and looks
 * (`engine-layout` `characterSheet.ts`, `sheetRigLook.ts`, `sheetClipLook.ts`) with a character that walks a slow
 * circle and turns about, and paints every frame around each change of picture into one strip.
 */

import * as RIG from 'engine-rig/pixi';
import type { CharacterSheet } from 'game-config';
import {
	CLIP_FACINGS,
	type ClipFacing,
} from '../../../packages/engine-layout/src/lib/characterClips';
import { Application, Container, Graphics, Texture, TextureSource, Ticker } from 'pixi.js';

import {
	createSheetAnimator,
	createSheetRigAnimator,
	sheetDraw,
	sheetLeanPivot,
} from '../../../packages/engine-layout/src/lib/characterSheet';
import {
	clearFlipbooks,
	registerFlipbooks,
	resolveFlipbook,
} from '../../../packages/engine-layout/src/lib/registerFlipbooks';
import { createSheetClipLook } from '../../../packages/engine-layout/src/lib/sheetClipLook';
import { createSheetRigLook } from '../../../packages/engine-layout/src/lib/sheetRigLook';
import { bearAtlasText, bearSheet, bearSkeleton, drawBearAtlas } from './bearRig';
import {
	FISH_FACINGS,
	FISH_FRAMES,
	FISH_SIZE,
	drawFish,
	fishClipId,
	fishFrame,
	fishSheet,
} from './fishClips';

const FRAME_MS = 1000 / 60;
const CELL = { w: 120, h: 150 };

export type StripRequest = {
	/** `rig`: the bear's sheet; `rig-shared`: a rig whose facings draw the same parts; `clip`: a
	 *  fish seen from above, of frame clips. */
	subject: 'rig' | 'rig-shared' | 'clip';
	view: CharacterSheet['view'];
	/** Frames kept before and after each change of picture. */
	before: number;
	after: number;
	/** How fast the walked direction goes round, degrees a second. */
	circle: number;
	/** In place of the walk: one cell a ground heading, `from` to `to` (degrees, clockwise from
	 *  north) in `step`s, each drawn by a fresh character started in the facing nearest that
	 *  heading (as the samples page draws it) and walked along it on the 2:1 isometric screen
	 *  until its turn has settled. */
	sweep?: { from: number; to: number; step: number };
	/** In place of the walk with its about-turn: round and round clockwise at `circle` degrees a
	 *  second from north, on the 2:1 isometric screen, as the samples page sweeps its heading. */
	round?: boolean;
};

/** One cell of a sweep: the heading, the facing drawn, mirrored or not, and the lean the look
 *  drew (its view's rotation), radians. */
export type SweepCell = { heading: number; facing: string; flipX: boolean; lean: number };

type Cell = { image: HTMLCanvasElement; label: string; mark: boolean };

type Subject = {
	/** Draw the frame of `atMs` for a character moving (`x`, `y`) on the screen; what it drew. */
	frame(
		atMs: number,
		on: { x: number; y: number },
	): { key: string; label: string; facing: string; flipX: boolean; lean: number } | undefined;
	destroy(): void;
};

const degrees = (lean: number | undefined) => `${Math.round(((lean ?? 0) * 180) / Math.PI)}°`;
const mixed = (blend: { weight: number; pose: boolean } | undefined) =>
	blend ? ` ${blend.pose ? 'pose' : 'fade'} ${blend.weight.toFixed(2)}` : '';

/** The screen's projection of a world vector: the strip's world IS the screen, or (a sweep) the
 *  ground flattened twice as wide as deep, as the isometric screen draws it. */
type Project = (x: number, y: number) => { x: number; y: number };
const SCREEN: Project = (x, y) => ({ x, y });
const ISO_SCREEN: Project = (x, y) => ({ x, y: y / 2 });

function rigSubject(
	request: StripRequest,
	into: Container,
	start: ClipFacing = 'e',
	project: Project = SCREEN,
): Subject {
	const atlas = new RIG.TextureAtlas(bearAtlasText('bear.png'));
	atlas.pages[0].setTexture(RIG.RigPageTexture.from(TextureSource.from(drawBearAtlas())));
	const data = new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(atlas)).readSkeletonData(
		bearSkeleton(request.subject === 'rig-shared'),
	);
	const sheet = { ...bearSheet('R_Bear'), view: request.view } as CharacterSheet;
	const animator = createSheetRigAnimator(
		sheet,
		{
			has: (_rig, animation) => !!data.findAnimation(animation),
			durationMs: (_rig, animation) => (data.findAnimation(animation)?.duration ?? 0) * 1000,
		},
		start,
	);
	const look = createSheetRigLook('R_Bear', data, sheet);
	look.mount(into);
	return {
		frame(atMs, on) {
			const world = project === SCREEN ? on : { x: on.x, y: on.y * 2 };
			const frame = animator.frame({ atMs, vx: world.x, vy: world.y, project });
			if (!frame) return undefined;
			look.frame(frame, atMs);
			const name = frame.animation.replace(/^Walk_|^Idle_/, '');
			return {
				facing: animator.facing,
				flipX: frame.flipX,
				lean: look.drawn().lean,
				key: `${frame.animation}|${frame.flipX}`,
				label: `${Math.round(atMs)} ${name}${frame.flipX ? '↔' : ''} ${degrees(frame.lean)}${mixed(look.drawn().blend)}`,
			};
		},
		destroy: () => look.destroy(),
	};
}

function clipSubject(request: StripRequest, into: Container): Subject {
	const assets: Record<string, unknown> = {};
	clearFlipbooks();
	registerFlipbooks(
		FISH_FACINGS.map((facing) => {
			const frames = Array.from({ length: FISH_FRAMES }, (_, step) => fishFrame(facing, step));
			frames.forEach((name, step) => (assets[name] = Texture.from(drawFish(facing, step))));
			return { id: fishClipId(facing), assetKey: 'fish', frames, fps: 10, loop: true };
		}),
	);
	const sheet = { ...fishSheet(undefined), view: request.view } as CharacterSheet;
	const animator = createSheetAnimator(
		sheet,
		{ has: (id) => !!resolveFlipbook(id), cycleMs: () => (FISH_FRAMES / 10) * 1000 },
		'e',
	);
	const look = createSheetClipLook({ assets: () => assets, loaded: () => true });
	look.mount(into);
	// A clip plays on the shared ticker: it is moved on by this page's clock, a frame at a time.
	Ticker.shared.autoStart = false;
	Ticker.shared.stop();
	const draw = sheetDraw(sheet);
	const box = { w: FISH_SIZE, h: FISH_SIZE };
	const about = sheetLeanPivot(sheet, box);
	return {
		frame(atMs, on) {
			const frame = animator.frame({ atMs, vx: on.x, vy: on.y });
			if (!frame) return undefined;
			const clipOf = (of: typeof frame) => ({
				clipId: of.clipId,
				flipX: of.flipX,
				loop: of.loop,
				play: of.play,
				...draw,
				own: false,
			});
			look.frame(clipOf(frame), {
				lean: frame.lean ?? 0,
				about,
				kept: frame.kept === true,
				marked: false,
				...(frame.blend
					? {
							blend: {
								clip: clipOf(frame.blend.from),
								turn: { lean: frame.blend.from.lean ?? 0, about },
								weight: frame.blend.weight,
							},
						}
					: {}),
			});
			Ticker.shared.update(performance.timeOrigin + 1000 + atMs);
			return {
				facing: animator.facing,
				flipX: frame.flipX,
				lean: look.drawn().lean,
				key: `${frame.clipId}|${frame.flipX}`,
				label: `${Math.round(atMs)} ${frame.clipId.replace('fish_swim_', '')}${frame.flipX ? '↔' : ''} ${degrees(frame.lean)}${mixed(frame.blend)}`,
			};
		},
		destroy: () => look.destroy(),
	};
}

async function run(
	request: StripRequest,
): Promise<{ events: string[]; cells: number; sweep?: SweepCell[] }> {
	const app = new Application();
	await app.init({
		width: CELL.w,
		height: CELL.h,
		backgroundColor: request.subject === 'clip' ? 0x3f78a8 : 0x5f8f5a,
		antialias: true,
		preference: 'webgl',
		autoStart: false,
	});
	const top = request.subject === 'clip';
	const ground = new Graphics().ellipse(0, 0, 30, 12).fill({ color: 0x000000, alpha: 0.25 });
	ground.visible = !top;
	const body = new Container();
	const arrow = new Graphics();
	const world = new Container();
	world.position.set(CELL.w / 2, top ? CELL.h / 2 : CELL.h - 34);
	world.addChild(ground, body, arrow);
	app.stage.addChild(world);
	if (request.sweep) {
		const { from, to, step } = request.sweep;
		const cells: Cell[] = [];
		const measured: SweepCell[] = [];
		for (let h = from; h <= to + 1e-9; h += step) {
			const start = CLIP_FACINGS[((Math.round(h / 45) % 8) + 8) % 8];
			const one = rigSubject(request, body, start, ISO_SCREEN);
			const heading = (h * Math.PI) / 180;
			// The screen direction of the ground heading: the ground drawn half as deep.
			const on = { x: Math.sin(heading) * 120, y: (-Math.cos(heading) * 120) / 2 };
			let drew: ReturnType<Subject['frame']>;
			for (let atMs = 0; atMs <= 400; atMs += FRAME_MS) drew = one.frame(atMs, on);
			arrow
				.clear()
				.moveTo(0, 0)
				.lineTo(on.x * 0.2, on.y * 0.2)
				.stroke({ color: 0xffffff, width: 2 });
			app.render();
			if (drew) {
				const image = document.createElement('canvas');
				image.width = app.canvas.width;
				image.height = app.canvas.height;
				image.getContext('2d')?.drawImage(app.canvas, 0, 0);
				const flip = drew.flipX ? '↔' : '';
				const label = `${h}° ${drew.facing}${flip} ${((drew.lean * 180) / Math.PI).toFixed(1)}°`;
				cells.push({ image, label, mark: drew.facing !== start });
				measured.push({ heading: h, facing: drew.facing, flipX: drew.flipX, lean: drew.lean });
			}
			one.destroy();
		}
		paint(cells, app.canvas.width / CELL.w, 8);
		app.destroy();
		return { events: [], cells: cells.length, sweep: measured };
	}
	const round = request.round === true && !top;
	const subject = top
		? clipSubject(request, body)
		: round
			? rigSubject(request, body, 'n', ISO_SCREEN)
			: rigSubject(request, body);

	// The walk: east, round to the south-east and the south, about turn (a reversal), then on; or
	// round and round from north.
	const plan = (atMs: number): number => {
		const s = atMs / 1000;
		if (round) return request.circle * s;
		const turnAt = 150 / request.circle;
		return s < turnAt ? 90 + request.circle * s : 90 + request.circle * turnAt + 180;
	};
	const kept: Cell[] = [];
	const events: string[] = [];
	const frames: { at: number; key: string; label: string; image?: HTMLCanvasElement }[] = [];
	const total = Math.ceil(
		(round ? (450 / request.circle) * 1000 : (150 / request.circle) * 1000 + 1400) / FRAME_MS,
	);
	let last = '';
	let lastLean = 0;
	const changes: number[] = [];
	for (let i = 0; i < total; i += 1) {
		const atMs = i * FRAME_MS;
		const heading = (plan(atMs) * Math.PI) / 180;
		// A direction on the SCREEN: the world's axes are the screen's here, or the ground drawn
		// half as deep.
		const on = {
			x: Math.sin(heading) * 120,
			y: (-Math.cos(heading) * 120) / (round ? 2 : 1),
		};
		const drew = subject.frame(atMs, on);
		if (!drew) continue;
		arrow
			.clear()
			.moveTo(0, 0)
			.lineTo(on.x * 0.2, on.y * 0.2 * (top || round ? 1 : 0.5))
			.stroke({ color: 0xffffff, width: 2, alpha: top ? 0.5 : 1 });
		app.render();
		if (last && drew.key !== last) {
			changes.push(frames.length);
			const deg = (lean: number) => ((lean * 180) / Math.PI).toFixed(2);
			const ground = (plan(atMs) % 360).toFixed(1);
			events.push(
				`${Math.round(atMs)} ms (heading ${ground}°): ${last} → ${drew.key}, tilt ${deg(lastLean)}° → ${deg(drew.lean)}°`,
			);
		}
		last = drew.key;
		lastLean = drew.lean;
		const image = document.createElement('canvas');
		image.width = app.canvas.width;
		image.height = app.canvas.height;
		image.getContext('2d')?.drawImage(app.canvas, 0, 0);
		frames.push({ at: atMs, key: drew.key, image, label: drew.label });
	}
	const wanted = new Set<number>();
	for (const change of changes)
		for (let i = change - request.before; i <= change + request.after; i += 1)
			if (i >= 0 && i < frames.length) wanted.add(i);
	for (const i of [...wanted].sort((a, b) => a - b)) {
		const frame = frames[i];
		if (frame.image)
			kept.push({ image: frame.image, label: frame.label, mark: changes.includes(i) });
	}
	paint(kept, app.canvas.width / CELL.w, 12);
	subject.destroy();
	app.destroy();
	return { events, cells: kept.length };
}

/** Paint `kept` into one strip of `columns`, each cell labelled (a marked one in yellow). */
function paint(kept: Cell[], scale: number, columns: number): void {
	const strip = document.createElement('canvas');
	strip.id = 'strip';
	strip.width = columns * CELL.w * scale;
	strip.height = Math.ceil(kept.length / columns) * (CELL.h + 14) * scale;
	strip.style.width = `${strip.width / scale}px`;
	const g = strip.getContext('2d');
	if (!g) throw new Error('no 2d context');
	g.fillStyle = '#222';
	g.fillRect(0, 0, strip.width, strip.height);
	g.font = `${9 * scale}px sans-serif`;
	kept.forEach((cell, i) => {
		const x = (i % columns) * CELL.w * scale;
		const y = Math.floor(i / columns) * (CELL.h + 14) * scale;
		g.drawImage(cell.image, x, y);
		g.fillStyle = cell.mark ? '#ffd24a' : '#ddd';
		g.fillText(cell.label, x + 3 * scale, y + (CELL.h + 10) * scale);
	});
	document.body.replaceChildren(strip);
}

(window as unknown as { strip: typeof run }).strip = run;
