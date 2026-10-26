<script lang="ts">
	import { curvePoint, type MotionCurve } from './shaderEditor';
	import { useShaderThumbs } from './shaderThumbs.svelte';

	// A motion node's thumbnail: its value over one play (t 0…1 across, its lowest to its highest
	// value up), drawn on a 2-D canvas when its curve changes, with the preview's playhead and the
	// value there marked over it. Hatched while it cannot be worked out.
	let { id }: { id: string } = $props();
	const thumbs = useShaderThumbs();
	const curve = $derived(thumbs?.curves.get(id));
	const at = $derived(curve ? curvePoint(curve, thumbs?.t ?? 0) : undefined);

	const W = 150;
	const H = 40;
	const PAD = 4;
	let canvas: HTMLCanvasElement | undefined = $state();

	const shown = (v: number): string => String(Number(v.toFixed(3)));

	$effect(() => {
		const el = canvas;
		const plotted = curve;
		const ctx = el?.getContext('2d');
		if (!el || !ctx) return;
		const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
		el.width = W * dpr;
		el.height = H * dpr;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, W, H);
		if (!plotted) return;
		const { values, min, max } = plotted;
		const y = (v: number): number =>
			max > min ? H - PAD - ((v - min) / (max - min)) * (H - 2 * PAD) : H / 2;
		if (min < 0 && max > 0) {
			ctx.strokeStyle = '#2a323d';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(0, Math.round(y(0)) + 0.5);
			ctx.lineTo(W, Math.round(y(0)) + 0.5);
			ctx.stroke();
		}
		ctx.strokeStyle = '#38bdf8';
		ctx.lineWidth = 1.5;
		ctx.lineJoin = 'round';
		ctx.beginPath();
		values.forEach((v, i) => {
			const x = (i / Math.max(1, values.length - 1)) * W;
			if (i) ctx.lineTo(x, y(v));
			else ctx.moveTo(x, y(v));
		});
		ctx.stroke();
	});
</script>

<div
	class="curve"
	class:none={curve === null}
	title={curve
		? `Its value over one play (t 0…1), params at their defaults: ${shown(curve.min)} to ${shown(curve.max)}`
		: 'Its value cannot be worked out yet: something it reads is broken or unwired'}
>
	<canvas bind:this={canvas} style="width:{W}px;height:{H}px"></canvas>
	{#if curve && at}
		<span class="playhead" style="left:{at.x * 100}%"></span>
		<span
			class="dot"
			style="left:{at.x * 100}%;top:{((PAD + (1 - at.y) * (H - 2 * PAD)) / H) * 100}%"
		></span>
		<span class="range">{shown(curve.min)} … {shown(curve.max)}</span>
	{/if}
</div>

<style>
	.curve {
		position: relative;
		width: 150px;
		height: 40px;
		margin: 0 auto 12px;
		border-radius: 4px;
		background: #0b0e13;
		box-shadow: 0 0 0 1px #2a323d;
	}
	.curve.none {
		background: repeating-linear-gradient(-45deg, #222a35 0 5px, #141a22 5px 10px);
	}
	canvas {
		display: block;
	}
	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: #f8fafc88;
		pointer-events: none;
	}
	.dot {
		position: absolute;
		width: 5px;
		height: 5px;
		margin: -2.5px 0 0 -2.5px;
		border-radius: 50%;
		background: #f8fafc;
		pointer-events: none;
	}
	.range {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		margin-top: 1px;
		font-size: 9px;
		color: #64748b;
		text-align: center;
		white-space: nowrap;
	}
</style>
