<script lang="ts" module>
	export type WinLinePoint = { x: number; y: number };

	export type EmitterEventWinLine =
		| { type: 'winLineShow'; points: WinLinePoint[]; amount: string }
		| { type: 'winLineHide' };
</script>

<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { Container, Graphics, type GraphicsProps } from 'pixi-svelte';
	import { ResponsiveBitmapText } from 'components-pixi';

	import { getContext } from '../game/context';
	import BoardContainer from './BoardContainer.svelte';
	import { SYMBOL_SIZE } from '../game/constants';
	import { bakedWinLineConfig } from '../editor-scenes';

	type DrawGraphics = Parameters<GraphicsProps['draw']>[0];

	const context = getContext();

	// Resolved win-line style (Invisible Symbols State Machine output, coded defaults
	// applied). Static for the session — the bundle is baked at build time.
	const cfg = bakedWinLineConfig();
	const line = cfg.line;
	const text = cfg.text;

	let points = $state<WinLinePoint[]>([]);
	let amount = $state('');
	// The amount is stamped only AFTER the line finishes drawing (immediately when the
	// draw isn't animated). Gated so an animated line reveals first → last → amount.
	let revealed = $state(true);
	// Draw progress 0→1 along the polyline. Instant (duration 0) unless animated.
	const progress = new Tween(1, { duration: 0 });

	/** Total pixel length of the polyline (for a length-proportional draw duration). */
	function pathLength(pts: WinLinePoint[]): number {
		let total = 0;
		for (let i = 1; i < pts.length; i += 1) {
			total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
		}
		return total;
	}

	context.eventEmitter.subscribeOnMount({
		winLineShow: async (emitterEvent) => {
			points = emitterEvent.points;
			amount = emitterEvent.amount;
			if (line.animated && emitterEvent.points.length >= 2) {
				revealed = false;
				progress.set(0, { duration: 0 });
				// ~220ms per 4 symbol-widths of line, scaled by speed, clamped to a sane range.
				const len = pathLength(emitterEvent.points);
				const duration = Math.min(
					2000,
					Math.max(180, ((len / (SYMBOL_SIZE * 4)) * 220) / line.speed),
				);
				await progress.set(1, { duration });
				revealed = true;
			} else {
				progress.set(1, { duration: 0 });
				revealed = true;
			}
		},
		winLineHide: () => {
			points = [];
			amount = '';
			revealed = true;
			progress.set(1, { duration: 0 });
		},
	});

	// Stamp the pay amount just below where the line ends (the last paying symbol).
	const label = $derived(
		points.length
			? {
					x: points[points.length - 1].x,
					y: points[points.length - 1].y + SYMBOL_SIZE * 0.55,
				}
			: undefined,
	);

	/** Trace the polyline into the graphics path, but only up to `p` (0→1) of its total
	 *  length — interpolating the final partial segment so the head advances smoothly. */
	function tracePath(graphics: DrawGraphics, pts: WinLinePoint[], p: number): void {
		graphics.moveTo(pts[0].x, pts[0].y);
		if (p >= 1) {
			for (let i = 1; i < pts.length; i += 1) graphics.lineTo(pts[i].x, pts[i].y);
			return;
		}
		const target = pathLength(pts) * p;
		let acc = 0;
		for (let i = 1; i < pts.length; i += 1) {
			const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
			if (acc + d <= target) {
				graphics.lineTo(pts[i].x, pts[i].y);
				acc += d;
			} else {
				const t = d > 0 ? (target - acc) / d : 0;
				graphics.lineTo(
					pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
					pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
				);
				return;
			}
		}
	}

	// Re-created whenever the points or the draw progress change, so the <Graphics>
	// redraws the growing line (the closure captures the current progress value).
	const draw = $derived.by(() => {
		const pts = points;
		const p = progress.current;
		const coreWidth = SYMBOL_SIZE * line.width;
		return (graphics: DrawGraphics) => {
			if (pts.length < 2) return;
			// Optional glow: a soft halo built from a few progressively wider, fainter
			// strokes in the glow colour under the core line (no filter dependency).
			if (line.glow) {
				const halos = [
					{ w: coreWidth * 4.5, a: 0.08 },
					{ w: coreWidth * 3, a: 0.13 },
					{ w: coreWidth * 1.8, a: 0.2 },
				];
				for (const halo of halos) {
					tracePath(graphics, pts, p);
					graphics.stroke({
						color: line.glowColor,
						width: halo.w,
						alpha: halo.a,
						cap: 'round',
						join: 'round',
					});
				}
			}
			tracePath(graphics, pts, p);
			graphics.stroke({
				color: line.color,
				width: coreWidth,
				alpha: 0.95,
				cap: 'round',
				join: 'round',
			});
		};
	});
</script>

{#if points.length}
	<BoardContainer>
		<Graphics {draw} />

		{#if label && revealed}
			<Container x={label.x} y={label.y}>
				<ResponsiveBitmapText
					anchor={{ x: 0.5, y: 0 }}
					maxWidth={SYMBOL_SIZE * 3}
					text={amount}
					style={{
						fontFamily: text.font,
						fontSize: SYMBOL_SIZE * text.size,
						fill: text.color,
						align: 'center',
						fontWeight: 'bold',
						letterSpacing: 0,
					}}
				/>
			</Container>
		{/if}
	</BoardContainer>
{/if}
