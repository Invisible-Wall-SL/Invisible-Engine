/**
 * How the loader's GPU warm-up (`gpuWarmup.ts`) spreads its steps over frames, so the loading bar
 * keeps moving while it runs.
 *
 * Time alone was the budget, and it let a frame take far more than its share: an upload or a link
 * costs the main thread little in Chrome but the GPU process a lot, and the frame waits for it. A
 * real Android phone (Adreno 830, uncompressed art) drew 50–100 ms frames under the bar as 15–44 MB
 * of textures and 4–12 shader compiles landed in one frame each. So a frame now also stops at a
 * byte budget and after one program; a step over a budget on its own still runs, alone in its
 * frame, since one texture cannot be split.
 *
 * Plain functions over an injected clock and frame wait, so a fixture drives them without a GPU
 * (`fixtures/warmupSchedule.fixture.ts`).
 */

/** One warm-up step and what it asks of the GPU. */
export type WarmupStep = {
	run: () => void;
	/** Texture data the step uploads, bytes. */
	bytes?: number;
	/** The step compiles a shader program. */
	compiles?: boolean;
};

export type WarmupBudget = {
	/** Main-thread time one frame spends warming, ms. */
	ms: number;
	/** Texture data one frame uploads, bytes. */
	bytes: number;
	/** Programs one frame compiles. */
	compiles: number;
};

/** Half a 2048² uncompressed page a frame; a bigger texture runs alone in its frame. */
export const WARMUP_FRAME_BUDGET: WarmupBudget = {
	ms: 8,
	bytes: 8 * 1024 * 1024,
	compiles: 1,
};

let frameBudget = WARMUP_FRAME_BUDGET;

/**
 * Replace the budget {@link runWarmup} spends a frame by. The current-games harness's determinism
 * mode (`apps/lines` `determinism.ts`) lifts it: its clock moves only between frames, so time never
 * ended a warm-up frame there and the warm-up ran in one frame on every build before the byte and
 * program budgets. Kept there, the frame the load ends on, and every seeded draw after it, do not
 * move with these budgets.
 */
export function setWarmupFrameBudget(budget: WarmupBudget): void {
	frameBudget = budget;
}

/** The share of the loading bar, percent, the warm-up fills after the asset loads. */
export const WARMUP_PROGRESS_SHARE = 15;

/** Bytes that weigh as much as one program in the progress the warm-up reports. */
const BYTES_PER_COMPILE = 4 * 1024 * 1024;

/** What uploading a texture source sends to the GPU: its levels' data when it holds them (a
 *  compressed page), else four bytes a pixel. */
export function sourceBytes(source: {
	resource: unknown;
	pixelWidth: number;
	pixelHeight: number;
}): number {
	const { resource } = source;
	if (Array.isArray(resource))
		return resource.reduce(
			(sum: number, level: unknown) => sum + (ArrayBuffer.isView(level) ? level.byteLength : 0),
			0,
		);
	return source.pixelWidth * source.pixelHeight * 4;
}

type FrameUse = { ms: number; bytes: number; compiles: number; steps: number };

const emptyFrameUse = (): FrameUse => ({ ms: 0, bytes: 0, compiles: 0, steps: 0 });

/** Whether `step` still fits a frame that has used `use`. A frame's first step always fits. */
function fitsFrame(use: FrameUse, step: WarmupStep, budget: WarmupBudget): boolean {
	if (use.steps === 0) return true;
	if (use.ms >= budget.ms) return false;
	if (use.bytes + (step.bytes ?? 0) > budget.bytes) return false;
	return !(step.compiles && use.compiles >= budget.compiles);
}

/** A step's share of the warm-up, for the progress it reports: its bytes, a program as 4 MB. */
export const stepWeight = (step: WarmupStep): number =>
	1 + (step.bytes ?? 0) / BYTES_PER_COMPILE + (step.compiles ? 1 : 0);

/** How long a warm-up frame waits while no frame has come: a hidden tab or an offscreen iframe an
 *  operator preloads into never gets one, and the load must still finish there. */
export const FRAMELESS_WAIT_MS = 50;
/** How long it waits once frames come: a slow frame is waited for, not packed with more steps. */
export const FRAME_WAIT_MS = 1000;

export type FrameHost = {
	requestFrame: (callback: () => void) => void;
	setTimer: (callback: () => void, ms: number) => number;
	clearTimer: (id: number) => void;
};

/**
 * The warm-up's wait for its next frame. It used to give up after 50 ms on every page, so a frame
 * slower than that (an upload the GPU was still busy with) got the next steps too: up to 38 MB of
 * textures landed in one frame in Chromium, 44 MB on an Android phone. Now the short wait holds
 * only while no frame comes; a frame that comes, even after its wait gave up, makes the next waits
 * hold for the frame itself, and a wait that gives up makes the next one short again.
 */
export function createFrameWait(host: FrameHost): () => Promise<void> {
	let framesCome = false;
	return () =>
		new Promise<void>((resolve) => {
			const timer = host.setTimer(
				() => {
					framesCome = false;
					resolve();
				},
				framesCome ? FRAME_WAIT_MS : FRAMELESS_WAIT_MS,
			);
			host.requestFrame(() => {
				host.clearTimer(timer);
				framesCome = true;
				resolve();
			});
		});
}

export type WarmupClock = {
	now: () => number;
	/** Resolves on the next frame. */
	nextFrame: () => Promise<void>;
};

/**
 * Run `steps` in order, starting a new frame whenever the next step does not fit the current one.
 * `onProgress` hears the share done, 0–1, after every step. A step that throws is reported and
 * skipped: the warm-up never stands in the way of the game starting.
 */
export async function runWarmup(
	steps: readonly WarmupStep[],
	clock: WarmupClock,
	{ onProgress }: { onProgress?: (done: number) => void } = {},
): Promise<void> {
	const total = steps.reduce((sum, step) => sum + stepWeight(step), 0);
	let done = 0;
	let use = emptyFrameUse();
	for (const step of steps) {
		if (!fitsFrame(use, step, frameBudget)) {
			await clock.nextFrame();
			use = emptyFrameUse();
		}
		const start = clock.now();
		try {
			step.run();
		} catch (error) {
			console.warn('[gpu-warmup]', error);
		}
		use.ms += clock.now() - start;
		use.bytes += step.bytes ?? 0;
		use.compiles += step.compiles ? 1 : 0;
		use.steps += 1;
		done += stepWeight(step);
		onProgress?.(done / total);
	}
}
