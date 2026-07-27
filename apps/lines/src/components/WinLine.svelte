<script lang="ts" module>
	export type WinLinePoint = { x: number; y: number };

	export type EmitterEventWinLine =
		| {
				type: 'winLineShow';
				points: WinLinePoint[];
				amount: string;
				message: string;
				/** The WHOLE payline (all reels), drawn as a static underlay beneath the winning
				 *  segment when the author enabled "Show full payline". Absent ⇒ nothing extra is
				 *  drawn (byte-identical to before). */
				fullPoints?: WinLinePoint[];
				/** The winning payline's authored colour (`#rrggbb`, Invisible Game Config). When set,
				 *  the line draws in this colour instead of the single Symbols-tool default, and it is
				 *  published as the reusable win colour for assets on this win. Absent ⇒ the default. */
				color?: string;
		  }
		| { type: 'winLineHide' };
</script>

<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { Container, Graphics, type GraphicsProps } from 'pixi-svelte';
	import { ResponsiveBitmapText } from 'components-pixi';
	import { roundSkip } from 'utils-shared/skipToken';

	import { getContext } from '../game/context';
	import BoardContainer from './BoardContainer.svelte';
	import { SYMBOL_SIZE } from '../game/constants';
	import { boardDimensions } from '../game/gameConfig';
	import { bakedWinLineConfig } from '../editor-scenes';

	type DrawGraphics = Parameters<GraphicsProps['draw']>[0];

	const context = getContext();

	// Resolved win-line style (Invisible Symbols State Machine output, coded defaults
	// applied). Static for the session — the bundle is baked at build time.
	const cfg = bakedWinLineConfig();
	const line = cfg.line;
	const text = cfg.text;

	let points = $state<WinLinePoint[]>([]);
	// The whole payline (all reels), drawn as a static underlay when "Show full payline" is on.
	let fullPoints = $state<WinLinePoint[]>([]);
	/** The winning payline's authored colour (Invisible Game Config), when it has one. Overrides the
	 *  single Symbols-tool line colour for this win; `undefined` ⇒ the authored default draws. */
	let winColor = $state<string | undefined>(undefined);
	let amount = $state('');
	/** The authored per-win message (Invisible Win Text), already localized + interpolated by
	 *  `winLineTextFor`. Empty unless authored — that is the parity default, since the win line
	 *  had no message layer before the tool existed. */
	let message = $state('');
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
			fullPoints = emitterEvent.fullPoints ?? [];
			amount = emitterEvent.amount;
			message = emitterEvent.message;
			winColor = emitterEvent.color;
			// Publish the reusable win colour so any asset shown on this win can tint itself to the
			// winning payline. Cleared on hide. `null` when the line has no authored colour.
			context.stateGame.winLineColor = emitterEvent.color ?? null;
			// A slammed round draws the line COMPLETE at once (final state, not a dropped line).
			if (line.animated && !roundSkip.isSkipped() && emitterEvent.points.length >= 2) {
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
			fullPoints = [];
			amount = '';
			message = '';
			winColor = undefined;
			context.stateGame.winLineColor = null;
			revealed = true;
			progress.set(1, { duration: 0 });
		},
	});

	// The reel WINDOW in board-local space — the SAME rect `BoardMask` clips the reels to, resolved
	// from the live geometry, so the amount tracks an authored reel-grid override rather than a
	// hardcoded board size. `WinLine` mounts OUTSIDE the mask (a sibling of `Board`), so nothing
	// clips the amount for us: staying inside is this component's job.
	const windowHeight = $derived(
		boardDimensions().y * context.stateGameDerived.boardGeometry().rowPitchLocal,
	);
	const windowWidth = $derived(
		context.stateGameDerived.boardLayout().width +
			(boardDimensions().x - 1) * context.stateGameDerived.boardGeometry().columnExtraLocal,
	);

	/** The amount's RENDERED box, reported by `ResponsiveBitmapText` (its `maxWidth` is only the cap,
	 *  not the drawn width). Until it has measured, a font-size estimate keeps the FIRST frame close
	 *  so the amount doesn't visibly jump once the real size arrives. */
	let labelSize = $state({ width: 0, height: 0 });
	const labelBox = $derived({
		width: labelSize.width || SYMBOL_SIZE * text.size * 2,
		height: labelSize.height || SYMBOL_SIZE * text.size,
	});

	/** Gap between the line's end and the stamped amount. */
	const LABEL_GAP = SYMBOL_SIZE * 0.55;

	/**
	 * What the line stamps: the authored message ABOVE the amount, as ONE text block rather than
	 * two nodes — so the measured `labelBox` covers both lines and the in-window placement below
	 * (flip + clamp) keeps governing the whole stamp. Unauthored ⇒ `message` is empty ⇒ this is
	 * exactly the amount, byte-identical to before.
	 */
	const labelText = $derived(message ? `${message}\n${amount}` : amount);

	const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

	/**
	 * Stamp the pay amount at the line's end (the last paying symbol) but ALWAYS INSIDE the reel
	 * window: preferred BELOW the end, FLIPPED ABOVE when below would overflow the bottom edge — a win
	 * landing on the bottom row otherwise stamped the amount off the board, behind the HUD. Both axes
	 * are then clamped as a safety net (a short board or large font can overflow either way, and a
	 * line ending on the last reel can push the text past the right edge). The text anchors top-centre,
	 * so its box spans `x ± width/2` by `y … y + height`.
	 */
	const label = $derived.by(() => {
		if (!points.length) return undefined;
		const last = points[points.length - 1];
		const { width, height } = labelBox;
		let y = last.y + LABEL_GAP;
		if (y + height > windowHeight) y = last.y - LABEL_GAP - height;
		return {
			x: clamp(last.x, width / 2, Math.max(width / 2, windowWidth - width / 2)),
			y: clamp(y, 0, Math.max(0, windowHeight - height)),
		};
	});

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
		const full = fullPoints;
		const p = progress.current;
		const coreWidth = SYMBOL_SIZE * line.width;
		// The winning payline's authored colour overrides BOTH the core line and its glow halo, so the
		// whole line reads as that colour; un-coloured wins keep the single Symbols-tool defaults.
		const coreColor = winColor ?? line.color;
		const haloColor = winColor ?? line.glowColor;
		return (graphics: DrawGraphics) => {
			// Optional full-payline underlay: the WHOLE path (all reels), drawn COMPLETE (no
			// animated reveal — it is context, not the win) BENEATH the winning segment, in its own
			// colour. Off by default, so an un-authored game draws nothing here.
			if (line.fullPayline && full.length >= 2) {
				tracePath(graphics, full, 1);
				graphics.stroke({
					color: line.fullPaylineColor,
					width: coreWidth,
					alpha: 0.85,
					cap: 'round',
					join: 'round',
				});
			}
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
						color: haloColor,
						width: halo.w,
						alpha: halo.a,
						cap: 'round',
						join: 'round',
					});
				}
			}
			tracePath(graphics, pts, p);
			graphics.stroke({
				color: coreColor,
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

		{#if label && revealed && labelText}
			<Container x={label.x} y={label.y}>
				<ResponsiveBitmapText
					anchor={{ x: 0.5, y: 0 }}
					maxWidth={SYMBOL_SIZE * 3}
					onresize={(sizes) => (labelSize = sizes)}
					text={labelText}
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
