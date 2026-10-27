/**
 * The Scene Editor's live FX overlay (`EditorEffectLayer.svelte`) mounted alone, drawn through the
 * editor's shared renderer into its 2D canvas, with its requests answered in memory (`shared.ts`).
 * Each case mounts it on one placed effect node, lets it run, and counts the canvas's pixels; the
 * compiled set is registered the way the editor page does (`registerCustomElementFx`).
 */
import { flushSync, mount, unmount } from 'svelte';
import { emitterSecondsToWallMs, type EffectParamValues } from 'engine-fx';
import { registerCustomElementFx } from '$lib/customElementFx.svelte';
import EditorEffectLayer from '@fxroot/apps/launcher-api/src/routes/(app)/editor/EditorEffectLayer.svelte';
import { CLOCK_EMITTER_SECONDS, SHADER_EFFECTS, census, debugLines, served, sleep } from './shared';

const page = window as unknown as { result?: unknown; ready?: boolean };
const RUN_MS = 900;

function overlay(effectId: string, values?: EffectParamValues) {
	const target = document.createElement('div');
	target.style.cssText = 'position:relative;width:400px;height:300px';
	document.body.appendChild(target);
	const scenes = [
		{
			id: 'main',
			name: 'Main',
			nodes: [{ id: 'fx1', name: 'fx', kind: 'effect', effectId, x: 200, y: 150 }],
		},
	];
	const component = mount(EditorEffectLayer, {
		target,
		props: {
			scenes,
			layoutType: 'desktop',
			frameWidth: 400,
			frameHeight: 300,
			panX: 0,
			panY: 0,
			zoom: 1,
			playing: true,
			worldTransformOf: () => ({ x: 200, y: 150 }),
			...(values ? { effectParamValues: () => values } : {}),
		} as never,
	});
	return {
		canvas: () => target.querySelector('canvas'),
		pixels: () => census(target.querySelector('canvas') as HTMLCanvasElement),
		close: () => {
			unmount(component);
			target.remove();
		},
	};
}

async function run(effectId: string, values?: EffectParamValues) {
	const since = debugLines.length;
	const view = overlay(effectId, values);
	await sleep(RUN_MS);
	const pixels = view.pixels();
	view.close();
	await sleep(50);
	return { pixels, lines: debugLines.slice(since) };
}

/**
 * How long a finite plain effect stays on screen: the canvas sampled every few ms from its first
 * drawn pixel to its last. The editor plays it at the game's speed, so that is the game's wall time
 * for its emitter time (`emitterSecondsToWallMs`), not that many seconds.
 */
async function clock() {
	const view = overlay('clock');
	const began = performance.now();
	let first = -1;
	let last = -1;
	let peak = 0;
	while (performance.now() - began < 2500) {
		const drawn = view.canvas() ? view.pixels().magenta : 0;
		const at = performance.now() - began;
		if (drawn > 0) {
			if (first < 0) first = at;
			last = at;
			peak = Math.max(peak, drawn);
		}
		if (first >= 0 && at - last > 600) break;
		await sleep(15);
	}
	const end = view.pixels();
	view.close();
	await sleep(50);
	return {
		expectedMs: emitterSecondsToWallMs(CLOCK_EMITTER_SECONDS),
		emitterSeconds: CLOCK_EMITTER_SECONDS,
		firstMs: first,
		lastMs: last,
		peak,
		end,
	};
}

async function main() {
	const result: Record<string, unknown> = {};
	result.unregistered = await run('solid');
	// Mounted before the set registers, as on a page whose set answers late: it draws plain, then
	// the registration remounts it through the material.
	const since = debugLines.length;
	const view = overlay('solid');
	await sleep(RUN_MS);
	const before = view.pixels();
	registerCustomElementFx(SHADER_EFFECTS);
	flushSync();
	await sleep(RUN_MS);
	const after = view.pixels();
	view.close();
	await sleep(50);
	result.registers = { before, after, lines: debugLines.slice(since) };
	result.registered = await run('solid');
	result.param = await run('solid', { hue: '#0000ff' });
	result.unknownKind = await run('gone');
	result.noMaterial = await run('plain');
	result.clock = await clock();

	// The page's 8 slots are shared by every overlay, so none may leak.
	{
		// Unmounted while its art is still loading, nine times.
		served.assetDelayMs = 300;
		const since = debugLines.length;
		for (let i = 0; i < 9; i++) {
			const view = overlay('solid');
			await sleep(100);
			view.close();
			await sleep(350);
		}
		served.assetDelayMs = 0;
		result.midLoad = { lines: debugLines.slice(since), after: await run('solid') };
	}
	{
		// A config the library refuses once the material has mounted, nine times.
		const since = debugLines.length;
		for (let i = 0; i < 9; i++) await run('throws');
		result.throws = { lines: debugLines.slice(since), after: await run('solid') };
	}
	{
		// Nine overlays at once, then eight again.
		const mountAll = async (n: number) => {
			const since = debugLines.length;
			const views = Array.from({ length: n }, () => overlay('solid'));
			// Nine stages building at once on a software GPU: wait for every mount's line.
			const mounted = () =>
				debugLines.slice(since).filter((l) => /solid\/main: (on \(|plain)/.test(l)).length;
			for (let waited = 0; mounted() < n && waited < 10_000; waited += 100) await sleep(100);
			for (const v of views) v.close();
			await sleep(50);
			return debugLines.slice(since);
		};
		result.instances = { nine: await mountAll(9), eight: await mountAll(8) };
	}
	page.result = result;
	page.ready = true;
}

main().catch((error) => {
	console.error(`[uncaught] ${error instanceof Error ? error.stack : error}`);
	page.ready = true;
});
