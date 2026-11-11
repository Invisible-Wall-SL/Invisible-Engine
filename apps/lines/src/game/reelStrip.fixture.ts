/**
 * Offline fixture for the board's DIRECT POSITION PASS (`reelStrip.ts`, used by
 * `reelStripView.svelte.ts`) — run with:
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs apps/lines/src/game/reelStrip.fixture.ts
 *
 * Pins:
 *  1. THE CULL IS THE PER-CELL TEST. For every strip index, `measureStrip`'s thresholds decide what
 *     `SymbolWrap` decided from that cell's own `y` (in frame, both forms; held) and what
 *     `ReelPaddingPool` decided (entered), across fractional and exact-edge positions, both layers,
 *     rolling and at rest, a stepped column's window, several pitches and leads.
 *  2. THE PLACER writes `symbolY`'s expression onto every attached container: at once on attach,
 *     on every drawn value, and nothing after release.
 *  4. THE CULLER answers each watched cell what the per-cell test answers, at once on watch, after
 *     every measure and after a renumbering re-watch, and WRITES a cell's answer only when it
 *     changes: a crossing writes to the cells that crossed and to no other.
 *  3. SAME FRAME, ON THE FRAME CLOCK. A reel's laps run on `FrameTweenCore` with the board's
 *     listener attached: at every Pixi tick each container sits at the motion sampled for THAT frame
 *     (what `Tween` samples after the tick, and used to draw a frame later), the cull answers for that
 *     same position, and a relayout (a `duration: 0` renumbering) moves no cell on screen.
 */

import { linear } from 'svelte/easing';
import { Tween } from 'svelte/motion';

import {
	FrameTweenCore,
	bindFrameClock,
	frameClockTick,
} from '../../../../packages/pixi-svelte/src/lib/frameClock.ts';
import { measureStrip, StripCuller, StripPlacer, type StripWindow } from './reelStrip.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

/** `createReelForSpinning`'s `symbolY` expression. */
const lattice = (pitch: number, lead: number) => (i: number, y: number) => y + (i + lead) * pitch;

/** `SymbolWrap` and `ReelPaddingPool`, per cell, as they read on `main`. */
const perCell = (y: number, window: StripWindow, pitch: number, animate: boolean) => {
	const { top, bottom, rolling } = window;
	const margin = rolling && !animate ? (pitch * 1) / 2 : 0;
	return {
		inFrame: margin === 0 ? y >= top && y <= bottom : y + margin > top && y - margin < bottom,
		held: margin > 0 && y < top,
		entered: !(y <= top - (pitch * 1) / 2),
	};
};

const main = async () => {
	// 1. The thresholds decide what the per-cell tests decided.
	{
		let compared = 0;
		let wrong = '';
		for (const pitch of [120, 117.5, 133.33333333333334, 96]) {
			for (const lead of [0.5, 0.25, 0.5 + 1 / 3]) {
				const cellY = lattice(pitch, lead);
				for (const [top, rows] of [
					[0, 3],
					[0, 4],
					[pitch / 2, 3],
					[37.25, 5],
				]) {
					const bottom = top + rows * pitch;
					// Fractional positions across two laps, plus every position that puts a cell's y (or
					// y ± half a row) exactly on an edge.
					const positions: number[] = [];
					for (let k = -1400; k <= 200; k += 7.3) positions.push(k);
					for (let i = -2; i < 14; i++)
						for (const edge of [top, bottom, top - pitch / 2, bottom + pitch / 2, top + pitch / 2])
							positions.push(edge - (i + lead) * pitch);
					for (const drawnY of positions)
						for (const rolling of [false, true])
							for (const animate of [false, true]) {
								const window: StripWindow = { top, bottom, halfRow: pitch / 2, rolling };
								const m = measureStrip(cellY, drawnY, window, animate);
								for (let i = -5; i < 60; i++) {
									const want = perCell(cellY(i, drawnY), window, pitch, animate);
									const got = {
										inFrame: i >= m.lo && i <= m.hi,
										held: m.margin > 0 && i < m.heldFrom,
										entered: i >= m.enteredFrom,
									};
									compared++;
									if (
										!wrong &&
										(got.inFrame !== want.inFrame ||
											got.held !== want.held ||
											got.entered !== want.entered)
									)
										wrong = JSON.stringify({
											pitch,
											lead,
											top,
											drawnY,
											rolling,
											animate,
											i,
											want,
											got,
										});
								}
							}
				}
			}
		}
		check(
			`the thresholds decide every cell as its own test did (${compared} cells)`,
			!wrong,
			wrong,
		);

		const flat = measureStrip(
			() => 5,
			0,
			{ top: 0, bottom: 360, halfRow: 60, rolling: true },
			false,
		);
		check(
			'a strip with no pitch puts every cell on one side of each edge',
			flat.lo === -Infinity && flat.hi === Infinity && flat.heldFrom === -Infinity,
			JSON.stringify(flat),
		);
	}

	// 2. The placer.
	{
		const cellY = lattice(120, 0.5);
		const placer = new StripPlacer(cellY);
		const cells = [{ symbolIndex: 0 }, { symbolIndex: 3 }, { symbolIndex: 7 }];
		const containers = cells.map(() => ({ y: Number.NaN }));
		const releases = cells.map((cell, i) => placer.attach(containers[i], cell, -120));
		check(
			'a container is placed the moment it is attached',
			containers.every((c, i) => c.y === cellY(cells[i].symbolIndex, -120)),
		);
		placer.place(-77.5);
		cells[1].symbolIndex = 4;
		placer.place(-60);
		check(
			'…and on every drawn value after, at its cell’s current index',
			containers.every((c, i) => c.y === cellY(cells[i].symbolIndex, -60)),
		);
		releases[2]();
		const before = containers[2].y;
		placer.place(10);
		check(
			'a released container is left alone',
			containers[2].y === before && containers[0].y === cellY(0, 10),
		);
	}

	// 4. The culler.
	{
		const pitch = 120;
		const cellY = lattice(pitch, 0.5);
		const window: StripWindow = { top: 0, bottom: 3 * pitch, halfRow: pitch / 2, rolling: true };
		const culler = new StripCuller();
		let writes = 0;
		let needless = 0;
		const target = () => {
			const answer = { inFrame: false, held: false };
			return new Proxy(answer, {
				set(obj, key, value) {
					writes += 1;
					if (Reflect.get(obj, key) === value) needless += 1;
					return Reflect.set(obj, key, value);
				},
			});
		};
		const cells = Array.from({ length: 24 }, (_, i) => ({ symbolIndex: i }));
		let drawnY = -20 * pitch;
		culler.measure(measureStrip(cellY, drawnY, window, false));
		const answers = cells.map(() => target());
		let releases = cells.map((cell, i) => culler.watch(cell, answers[i]));
		const agrees = () =>
			cells.every((cell, i) => {
				const want = perCell(cellY(cell.symbolIndex, drawnY), window, pitch, false);
				return answers[i].inFrame === want.inFrame && answers[i].held === want.held;
			});
		check('a watched cell is answered the moment it is watched', agrees());
		let wrong = '';
		let crossings = 0;
		let quietWrites = 0;
		for (let step = 0; step < 400; step++) {
			const before = answers.map((a) => `${a.inFrame}${a.held}`);
			const writesBefore = writes;
			drawnY += 13.7;
			culler.measure(measureStrip(cellY, drawnY, window, false));
			if (!wrong && !agrees()) wrong = `drawnY ${drawnY}`;
			if (answers.some((a, i) => `${a.inFrame}${a.held}` !== before[i])) crossings += 1;
			else quietWrites += writes - writesBefore;
		}
		check('every measure answers every cell as its own test does', !wrong, wrong);
		check(
			`a crossing writes only what changed, a quiet frame nothing (${crossings} crossings)`,
			crossings > 0 && needless === 0 && quietWrites === 0,
			`${needless} needless writes, ${quietWrites} on quiet frames`,
		);
		// The reel renumbers the strip each lap; the board re-watches every renumbered cell.
		releases.forEach((release) => release());
		cells.forEach((cell) => (cell.symbolIndex += 10));
		drawnY = -12 * pitch;
		culler.measure(measureStrip(cellY, drawnY, window, false));
		releases = cells.map((cell, i) => culler.watch(cell, answers[i]));
		check(
			'a renumbered, re-watched strip is answered as before',
			agrees() && answers.some((a) => a.inFrame) && answers.some((a) => !a.inFrame),
		);
		releases.forEach((release) => release());
		const writesAfter = writes;
		culler.measure(measureStrip(cellY, drawnY + 2 * pitch, window, false));
		check('a released cell is never written again', writes === writesAfter);
	}

	// 3. On the frame clock: the board draws each frame's own sample, and a relayout moves nothing.
	{
		let now = 1000;
		performance.now = () => now;
		const raf: FrameRequestCallback[] = [];
		globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => raf.push(cb);
		let svelteFrame: ((t: number) => void) | undefined;
		const internal: string = 'svelte/internal/client';
		const svelte = (await import(internal)) as {
			raf: { tick: (fn: (t: number) => void) => void; now: () => number };
		};
		svelte.raf.tick = (fn) => (svelteFrame = fn);
		svelte.raf.now = () => now;
		const drain = async () => {
			for (let i = 0; i < 20; i++) await Promise.resolve();
		};
		const FRAME = 1000 / 60;
		const release = bindFrameClock();

		const pitch = 120;
		const lead = 0.5;
		const reelLength = 5;
		const home = -pitch;
		const speed = 2.4;
		const cellY = lattice(pitch, lead);
		const window: StripWindow = { top: 0, bottom: 3 * pitch, halfRow: pitch / 2, rolling: true };

		// The reel's strip, relaid at each lap's end as `preSpinPadding` does: a fresh lap of cells
		// above the ones on screen, which are renumbered, and the reel moved up by the same amount, so
		// the picture stays where it is.
		const strip: { symbolIndex: number }[] = Array.from({ length: 2 * reelLength }, (_, i) => ({
			symbolIndex: i,
		}));
		const core = new FrameTweenCore(home - reelLength * pitch);
		const reference = new Tween(home - reelLength * pitch);
		const placer = new StripPlacer(cellY);
		let measure = measureStrip(cellY, core.motion.drawn, window, false);
		core.motion.listen((drawnY) => {
			placer.place(drawnY);
			measure = measureStrip(cellY, drawnY, window, false);
		});
		const containers = new Map<{ symbolIndex: number }, { y: number }>();
		const attach = (cell: { symbolIndex: number }) => {
			const container = { y: Number.NaN };
			containers.set(cell, container);
			placer.attach(container, cell, core.motion.drawn);
		};
		strip.forEach(attach);

		const relayout = () => {
			const fresh = Array.from({ length: reelLength }, (_, i) => ({ symbolIndex: i }));
			for (const cell of strip) cell.symbolIndex += reelLength;
			strip.unshift(...fresh);
			fresh.forEach(attach);
			const to = home - reelLength * pitch;
			void core.set(to, { duration: 0 });
			void reference.set(to, { duration: 0 });
		};
		const duration = (reelLength * pitch) / speed;
		let lapsDone = 0;
		const roll = async (it: { set: FrameTweenCore['set'] }, own: boolean) => {
			// A fourth lap, so the third hands over to one as every lap of a spin does.
			for (let k = 0; k < 4; k++) {
				await it.set(home, { duration, easing: linear, runOn: true });
				if (own) {
					lapsDone++;
					relayout();
				}
			}
		};
		now = 5000.5;
		void roll(core, true);
		void roll(reference, false);
		frameClockTick({ lastTime: 5000 - FRAME, elapsedMS: FRAME });

		let sameFrame = true;
		let cullSame = true;
		let unevenCells = 0;
		let worstDrawn = 0;
		let worstTween = 0;
		let previous: Map<object, number> | undefined;
		let previousTween: number | undefined;
		let detail = '';
		const ideal = speed * FRAME;
		for (let f = 1; f <= 52; f++) {
			const t = 5000 + f * FRAME;
			now = t;
			for (const cb of raf.splice(0)) {
				cb(t);
				await drain();
			}
			// The Pixi tick: what it draws.
			frameClockTick({ lastTime: t - FRAME, elapsedMS: FRAME });
			const drawn = new Map([...containers].map(([cell, c]) => [cell, c.y]));
			const lapsBefore = lapsDone;
			for (const cell of strip) {
				const want = perCell(cellY(cell.symbolIndex, core.motion.drawn), window, pitch, false);
				if (want.inFrame !== (cell.symbolIndex >= measure.lo && cell.symbolIndex <= measure.hi))
					cullSame = false;
			}
			// Svelte's callback, after the tick: the tween samples this frame (and a lap may end).
			const run = svelteFrame;
			svelteFrame = undefined;
			run?.(t);
			await drain();
			if (lapsBefore === 0 && lapsDone === 0) {
				for (const [cell, y] of drawn)
					if (Math.abs(y - cellY(cell.symbolIndex, reference.current)) > 1e-9) {
						sameFrame = false;
						detail ||= `frame ${f}: drawn ${y} want ${cellY(cell.symbolIndex, reference.current)}`;
					}
			}
			if (previous && f < 50) {
				const steps = [...drawn]
					.filter(([cell]) => previous!.has(cell))
					.map(([cell, y]) => y - previous!.get(cell)!);
				if (steps.some((step) => Math.abs(step - steps[0]) > 1e-9)) unevenCells++;
				worstDrawn = Math.max(worstDrawn, Math.abs(steps[0] - ideal));
			}
			// The tween's own step at the same frames, across its relayouts (+ a lap per relayout).
			const tweenVisual = reference.current + lapsDone * reelLength * pitch;
			if (previousTween !== undefined && f > 1 && f < 50)
				worstTween = Math.max(worstTween, Math.abs(tweenVisual - previousTween - ideal));
			previousTween = tweenVisual;
			previous = drawn;
		}
		const bound = (2 * ideal * FRAME) / (duration + FRAME) + 1e-9;
		check(
			'through the first lap each container sits, at the Pixi tick, at the motion sampled for that frame',
			sameFrame,
			detail,
		);
		check('…the cull answers for the position drawn, on every frame', cullSame);
		check(
			'…a relayout moves no cell against another: all step alike on every frame',
			unevenCells === 0,
		);
		check(
			`…and through three laps every step is interval × speed (worst ${worstDrawn.toFixed(2)} of ${ideal.toFixed(1)} px, bound ${bound.toFixed(2)}), where the tween stops on each lap’s end (worst ${worstTween.toFixed(1)} px)`,
			lapsDone >= 3 && worstDrawn <= bound && worstTween > ideal / 4,
		);
		release();
	}
};

void main().then(() => {
	if (failures) throw new Error(`reelStrip.fixture: ${failures} FAILED`);
	console.log('\nreelStrip.fixture: all ok');
});
