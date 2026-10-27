/**
 * `/shaders`' Particles element (step 8d.7): the REAL `ParticlePreviewStage` the preview pane mounts,
 * in a Pixi app of its own, its ticker stepped by hand at 60 fps so every moment is the same on any
 * machine. The materials are made for particles, so `?fxdebug=1` prints their load.
 *
 * `custom:solid` paints each particle green (`shared.ts`); `custom:strength` paints it green × the
 * material's strength, so a strength of 0.25 is dark. The atlas frame is magenta (the plain sprites).
 */
import { Application } from 'pixi.js';
import {
	customElementFx,
	setCustomElementFx,
	type CustomElementFx,
} from '@fxroot/packages/constants-shared/elementFx';
import { compileShaderEffect, graphBuilder } from '@fxroot/packages/engine-shadergraph/index';
import { ParticlePreviewStage } from '@fxroot/apps/launcher-api/src/routes/(app)/shaders/particlePreview.client';
import { RegionArt } from '@fxroot/apps/launcher-api/src/routes/(app)/shaders/shaderPreview.client';
import { SHADER_EFFECTS, census, debugLines } from './shared';

const page = window as unknown as { result?: unknown; ready?: boolean };
const SIZE = 400;
const FRAME_MS = 1000 / 60;

function strength(): CustomElementFx {
	const g = graphBuilder({
		id: 'strength',
		name: 'Strength',
		phase: 'loop',
		durationMs: 1000,
		params: [{ id: 'color', label: 'Colour', kind: 'color', default: '#00ff00' }],
	});
	const split = g.node('unpremultiply');
	const tint = g.node('param', { param: 'color' });
	const time = g.node('time');
	const scaled = g.node('multiply');
	const join = g.node('premultiply');
	const out = g.node('output');
	g.wire(tint, 'out', scaled, 'a');
	g.wire(time, 'intensity', scaled, 'b');
	g.wire(scaled, 'out', join, 'rgb');
	g.wire(split, 'alpha', join, 'alpha');
	g.wire(join, 'out', out, 'color');
	const result = compileShaderEffect({ ...g.doc(), madeFor: 'particles' });
	if (!result.ok) throw new Error(result.issues.map((i) => i.message).join('; '));
	return result.effect;
}

/** The pixels at `angle` (degrees, 0 = right) `radius` world units from the centre. */
function pixelAt(canvas: HTMLCanvasElement, angle: number, radius: number): number[] {
	const scale = canvas.width / SIZE;
	const unit = SIZE / 400;
	const x = Math.round((SIZE / 2 + Math.cos((angle * Math.PI) / 180) * radius * unit) * scale);
	const y = Math.round((SIZE / 2 + Math.sin((angle * Math.PI) / 180) * radius * unit) * scale);
	const c = document.createElement('canvas');
	c.width = canvas.width;
	c.height = canvas.height;
	const g = c.getContext('2d') as CanvasRenderingContext2D;
	g.drawImage(canvas, 0, 0);
	return [...g.getImageData(x, y, 1, 1).data];
}

/** Green pixels above and below the centre line. */
function halves(canvas: HTMLCanvasElement): { above: number; below: number } {
	const c = document.createElement('canvas');
	c.width = canvas.width;
	c.height = canvas.height;
	const g = c.getContext('2d') as CanvasRenderingContext2D;
	g.drawImage(canvas, 0, 0);
	const d = g.getImageData(0, 0, c.width, c.height).data;
	const out = { above: 0, below: 0 };
	for (let i = 0; i < d.length; i += 4) {
		if (d[i + 3] < 128 || d[i + 1] < 150 || d[i] > 90 || d[i + 2] > 90) continue;
		if (i / 4 / c.width < c.height / 2) out.above++;
		else out.below++;
	}
	return out;
}

/** A short digest of every pixel, to tell two frames apart. */
function digest(canvas: HTMLCanvasElement): number {
	const c = document.createElement('canvas');
	c.width = canvas.width;
	c.height = canvas.height;
	const g = c.getContext('2d') as CanvasRenderingContext2D;
	g.drawImage(canvas, 0, 0);
	const d = g.getImageData(0, 0, c.width, c.height).data;
	let h = 2166136261;
	for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619);
	return h >>> 0;
}

async function main() {
	const solid = { ...SHADER_EFFECTS[0], madeFor: 'particles' as const, cost: 4, samples: 1 };
	setCustomElementFx([solid, strength()]);
	const app = new Application();
	await app.init({
		width: SIZE,
		height: SIZE,
		preference: 'webgl',
		backgroundAlpha: 0,
		antialias: false,
		resolution: 1,
	});
	document.body.appendChild(app.canvas);
	app.ticker.stop();
	let now = performance.now();
	app.ticker.update(now);
	const step = (ms: number) => {
		for (let t = 0; t < ms; t += FRAME_MS) app.ticker.update((now += FRAME_MS));
	};
	const art = new RegionArt();
	const stage = new ParticlePreviewStage(app, art);
	const canvas = app.canvas as HTMLCanvasElement;
	const result: Record<string, unknown> = {
		gl: (app.renderer as unknown as { context: { webGLVersion: number } }).context.webGLVersion,
	};
	const lines = () => debugLines.slice();

	// Hidden, or with no effect: nothing is drawn and no layer mounts.
	stage.show(customElementFx('custom:solid'));
	step(300);
	result.hidden = { pixels: census(canvas), lines: lines(), state: stage.state };
	stage.setVisible(true);
	stage.show(undefined);
	step(100);
	result.noEffect = { pixels: census(canvas), state: stage.state };

	// The Burst on the soft dot.
	let since = debugLines.length;
	stage.show(customElementFx('custom:solid'));
	step(500);
	const radius = 77;
	result.burst = {
		state: stage.state,
		pixels: census(canvas),
		ring: Array.from({ length: 24 }, (_, i) => pixelAt(canvas, i * 15, radius)),
		centre: pixelAt(canvas, 0, 0),
		lines: debugLines.slice(since),
	};
	step(1250);
	result.gone = census(canvas);
	step(550);
	result.again = census(canvas);

	// Paused: nothing moves; Restart empties the stage and the ring starts again at the centre.
	stage.playing = false;
	const held = digest(canvas);
	step(600);
	result.paused = { same: digest(canvas) === held, pixels: census(canvas) };
	stage.restart();
	app.ticker.update((now += FRAME_MS));
	result.restarted = census(canvas);
	stage.playing = true;
	step(200);
	result.restartedPlaying = census(canvas);

	// Strength: a uniform write, no remount, seen on a paused stage too.
	since = debugLines.length;
	stage.show(customElementFx('custom:strength'));
	step(400);
	stage.playing = false;
	const full = census(canvas);
	stage.setIntensity(0.25);
	app.ticker.update((now += FRAME_MS));
	const low = census(canvas);
	stage.setIntensity(1);
	app.ticker.update((now += FRAME_MS));
	result.strength = { full, low, back: census(canvas), lines: debugLines.slice(since) };
	// Still paused, an edit (another effect) rebuilds the emitter: it is played a moment, so shows.
	stage.show(customElementFx('custom:solid'));
	app.ticker.update((now += FRAME_MS));
	result.pausedEdit = census(canvas);
	stage.playing = true;

	// The Fountain: a jet from below the centre rising above it.
	stage.show(customElementFx('custom:solid'));
	stage.setShape('fountain');
	step(1200);
	result.fountain = { state: stage.state, pixels: census(canvas), halves: halves(canvas) };

	// An atlas region as the art: the material draws it (green), never the magenta sprite.
	stage.setShape('burst');
	await stage.useRegion('atlas', 'sq');
	step(500);
	result.region = { state: stage.state, pixels: census(canvas) };

	// A kind no longer registered: the particles draw plain, never invisible.
	since = debugLines.length;
	setCustomElementFx([]);
	stage.show({ ...solid });
	step(500);
	result.unregistered = {
		state: stage.state,
		pixels: census(canvas),
		lines: debugLines.slice(since),
	};

	// Hidden again: released, nothing drawn; every rebuild gave its slot back.
	setCustomElementFx([solid]);
	stage.show(customElementFx('custom:solid'));
	step(100);
	since = debugLines.length;
	stage.setVisible(false);
	step(100);
	result.hiddenAgain = { pixels: census(canvas), lines: debugLines.slice(since) };
	since = debugLines.length;
	stage.setVisible(true);
	step(100);
	result.slots = debugLines.slice(since);

	stage.destroy();
	art.destroy();
	result.destroyed = app.stage.children.length;
	page.result = result;
	page.ready = true;
}

main().catch((error) => {
	console.error(`[uncaught] ${error instanceof Error ? error.stack : error}`);
	page.ready = true;
});
