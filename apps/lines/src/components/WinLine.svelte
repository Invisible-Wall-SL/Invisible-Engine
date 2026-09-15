<script lang="ts" module>
	export type WinLinePoint = { x: number; y: number };

	export type WinLineShape = 'path' | 'cells' | 'reels';

	/** Re-formats a stamped amount for a given RAW book value, through the same authored
	 *  `amountFormat` + currency formatter the final string was built with (`winLineTextFor`), so a
	 *  counting stamp reads like the one that lands on every frame.
	 *
	 *  A NAMED alias rather than an inline `(value: number) => string`: the emitter union is parsed
	 *  by `scripts/gen-flow-vocabulary.mjs`, whose brace/angle depth walk counts the `>` of a `=>`
	 *  as a closing bracket and silently drops the whole union from the `/flow` palette. */
	export type WinAmountFormatter = (value: number) => string;

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
				/** WHICH SHAPE to draw, decided by the project's declared win model (see `winLineShapeFor`
				 *  in `game/flowEffects.ts`). `'path'` traces the connected polyline (an ordinary payline);
				 *  `'cells'` draws a disconnected vertical bar per paying cell (a Book-of expansion /
				 *  cluster win, where a connected polyline would zig-zag unreadably); `'reels'` merges
				 *  those into ONE bar per winning reel (a ways win, which pays by whole-reel
				 *  participation). Both bar shapes stamp the amount ONCE, centred. Absent ⇒ `'path'`. */
				shape?: WinLineShape;
				/** The win's RAW book amount — the target a counted stamp runs up to. Absent ⇒ the
				 *  stamp is drawn whole (the `stamp: false` replay dispatches carry no amount). */
				amountValue?: number;
				/** Re-formats the stamp for a given value through the SAME authored `amountFormat` +
				 *  currency formatter `amount` was built with, so every counting frame reads like the
				 *  one that lands. Absent ⇒ no count is possible and `amount` is used as-is. */
				amountAt?: WinAmountFormatter;
		  }
		| {
				type: 'winLineHide';
				/** Wipe EVERY drawn line, not just the current one. Only meaningful with "show all win
				 *  lines at once" on, where a per-win hide is deliberately ignored so the round's lines
				 *  stay on screen together; the round-level clears (next spin, cycle stop) set this. */
				all?: boolean;
		  }
		/** The BIG-WIN RUN-UP stamp (Invisible Symbols State Machine → "Count up to cue the big win").
		 *  ONE amount centred on the reel window — the round TOTAL, not a payline's payout — counted
		 *  from zero up to `target`, the big-win threshold, as the cue that the overlay is coming.
		 *  Awaited: `flowEffects.ts#cueBigWinCountUp` holds the round until the count lands, then
		 *  hides it and lets the overlay carry the number the rest of the way. Broadcast ONLY on a
		 *  round that reaches a big-win tier with the switch on.
		 *
		 *  The comment sits OUTSIDE the member because `gen-flow-vocabulary.mjs` reads the
		 *  discriminant from the member's FIRST field, so a doc comment in front of `type:` drops the
		 *  event from the `/flow` palette. */
		| {
				type: 'winAmountCue';
				target: number;
				amountAt: WinAmountFormatter;
		  }
		| { type: 'winAmountCueHide' };
</script>

<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { Container, Graphics, type GraphicsProps } from 'pixi-svelte';
	import { ResponsiveBitmapText } from 'components-pixi';
	import { roundSkip } from 'utils-shared/skipToken';

	import { getContext } from '../game/context';
	import { BoardContainer } from 'engine-game';
	import { SYMBOL_SIZE } from 'engine-game';
	import { boardDimensions } from '../game/gameConfig';
	import { bakedWinLineConfig } from '../editor-scenes';

	type DrawGraphics = Parameters<GraphicsProps['draw']>[0];

	const context = getContext();

	// Resolved win-line style (Invisible Symbols State Machine output, coded defaults
	// applied). Static for the session — the bundle is baked at build time.
	const cfg = bakedWinLineConfig();
	const line = cfg.line;
	const text = cfg.text;

	/** ONE drawn line. The overlay holds a LIST because "show all win lines at once" keeps every
	 *  paying line of the round on screen together; the default one-at-a-time narration is simply
	 *  the list never growing past a single entry. */
	type DrawnLine = {
		id: number;
		/** Identity of the drawn line (its traced cells + shape). A line re-shown while it is already
		 *  up — the resting win cycle redraws the round's lines — REPLACES its earlier entry rather
		 *  than stacking a second copy on top of it. */
		key: string;
		points: WinLinePoint[];
		/** The whole payline (all reels), drawn as a static underlay when "Show full payline" is on. */
		fullPoints: WinLinePoint[];
		/** The winning payline's authored colour (Invisible Game Config), when it has one. Overrides
		 *  the single Symbols-tool line colour for this win; `undefined` ⇒ the authored default. */
		color: string | undefined;
		/** Which shape this win draws: the connected polyline, per-cell bars, or one merged bar per
		 *  winning reel. See the `shape` field on `winLineShow`. */
		shape: WinLineShape;
		amount: string;
		/** The authored per-win message (Invisible Win Text), already localized + interpolated by
		 *  `winLineTextFor`. Empty unless authored — that is the parity default, since the win line
		 *  had no message layer before the tool existed. */
		message: string;
		/** Draw progress 0→1 along the polyline. Instant (duration 0) unless animated. The amount is
		 *  stamped only once this reaches 1, so an animated line reveals first → last → amount. */
		progress: Tween<number>;
		/** The win's RAW book amount — what a counted stamp runs up to. 0 when the dispatch carried
		 *  no amount (the replay's `stamp: false`), where nothing is stamped anyway. */
		amountValue: number;
		/** Re-formats the stamp per count tick through the authored template. Absent ⇒ the stamp is
		 *  drawn from the pre-formatted `amount` string, whatever `count` says. */
		amountAt?: WinAmountFormatter;
		/** The counted value, 0 → `amountValue`. Seeded AT the amount (duration 0) when counting is
		 *  off, so the rendered string is the final one from the first frame. */
		count: Tween<number>;
		/** The stamp's alpha, 0 → 1 when fading in. Seeded at 1 when it is not. */
		fade: Tween<number>;
		/** The stamp's RENDERED box, reported by `ResponsiveBitmapText` (its `maxWidth` is only the
		 *  cap, not the drawn width). Until it has measured, a font-size estimate keeps the FIRST
		 *  frame close so the amount doesn't visibly jump once the real size arrives. */
		labelSize: { width: number; height: number };
	};

	let lines = $state<DrawnLine[]>([]);
	let nextId = 0;

	/** The BIG-WIN RUN-UP stamp — ONE centred amount counting up to the big-win threshold as the cue
	 *  that the overlay is coming. Held apart from `lines` on purpose: it belongs to the ROUND, not
	 *  to a payline, so it has no points to trace, no key to merge on, and it is centred whatever the
	 *  authored `placement` says (a total did not land anywhere). */
	type CueStamp = {
		amountAt: WinAmountFormatter;
		count: Tween<number>;
		fade: Tween<number>;
		labelSize: { width: number; height: number };
	};

	let cue = $state<CueStamp | null>(null);

	/** Whether every paying line of the round stays on screen TOGETHER (Invisible Symbols State
	 *  Machine → "Show all win lines at once"). Off (the default) ⇒ each `winLineShow` REPLACES the
	 *  drawn line and every `winLineHide` clears it — byte-identical to before this switch. */
	const allAtOnce = cfg.line.allAtOnce;

	/** The overlay's two halves are authored as separate sections in the tool, so each draws on its
	 *  own switch: the traced line, and the stamped amount. `winLineEnabledForWin` already skipped
	 *  the whole broadcast when BOTH are off, so at least one of these is true here. */
	const showLine = line.enabled;
	const showText = text.enabled;

	/** Stamp the amount in the middle of the reel window instead of at the line's end. In this mode
	 *  only the most recently shown line stamps — with "show all win lines at once" every amount
	 *  would otherwise land on the same spot and render as one unreadable pile. */
	const centreText = text.placement === 'boardCenter';

	/** The stamp's count-up + fade-in (Invisible Symbols State Machine → "Count up"). All default
	 *  OFF, so an un-authored project stamps the final amount at full alpha exactly as before.
	 *  `cueBigWin` is the ONE the renderer only guards with: the run-up is orchestrated by
	 *  `flowEffects.ts#cueBigWinCountUp`, so an un-authored project can never be sent one. */
	const countUp = text.countUp;
	const countUpMs = Math.max(0, text.countUpDuration) * 1000;
	const cueBigWin = text.cueBigWin;
	const fadeIn = text.fadeIn;
	const fadeInMs = Math.max(0, text.fadeInDuration) * 1000;

	/** A tween length in ms, re-read from the skip token at the moment it is used: a press landing
	 *  mid-narration means "show me the result now", so whatever is still to run collapses. */
	const tweenMs = (ms: number) => (roundSkip.isSkipped() ? 0 : ms);

	/** Names a drawn line by the cells it traces, so the same line shown twice stays ONE entry. */
	const lineKey = (points: WinLinePoint[], shape: WinLineShape): string =>
		`${shape}|${points.map((point) => `${Math.round(point.x)}:${Math.round(point.y)}`).join(',')}`;

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
			const shape = emitterEvent.shape ?? 'path';
			// A slammed round draws the line COMPLETE at once (final state, not a dropped line). A bar
			// shape never head-traces (there is no single path to sweep) — its bars all appear
			// together, so it takes the instant branch too. With the line turned off there is nothing
			// to reveal, so the stamp must not wait on a tween that reveals nothing.
			const animated =
				showLine &&
				line.animated &&
				!roundSkip.isSkipped() &&
				shape === 'path' &&
				emitterEvent.points.length >= 2;
			// The count needs BOTH a raw target and the formatter that renders the frames in between;
			// the `stamp: false` replay dispatches carry neither, and with no stamp drawn there is
			// nothing to count anyway.
			const amountValue = emitterEvent.amountValue ?? 0;
			const counts = countUp && showText && emitterEvent.amountAt !== undefined;
			const fades = fadeIn && showText;
			const entry: DrawnLine = {
				id: (nextId += 1),
				key: lineKey(emitterEvent.points, shape),
				points: emitterEvent.points,
				fullPoints: emitterEvent.fullPoints ?? [],
				color: emitterEvent.color,
				shape,
				amount: emitterEvent.amount,
				message: emitterEvent.message,
				progress: new Tween(animated ? 0 : 1, { duration: 0 }),
				amountValue,
				amountAt: emitterEvent.amountAt,
				count: new Tween(counts ? 0 : amountValue, { duration: 0 }),
				fade: new Tween(fades ? 0 : 1, { duration: 0 }),
				labelSize: { width: 0, height: 0 },
			};
			// Publish the reusable win colour so any asset shown on this win can tint itself to the
			// winning payline. Cleared on hide. `null` when the line has no authored colour. With every
			// line on screen at once this is the LAST one drawn — the one just announced.
			context.stateGame.winLineColor = emitterEvent.color ?? null;
			if (!allAtOnce) lines = [entry];
			else {
				const at = lines.findIndex((drawn) => drawn.key === entry.key);
				if (at >= 0) lines[at] = entry;
				else lines.push(entry);
			}
			if (animated) {
				// ~220ms per 4 symbol-widths of line, scaled by speed, clamped to a sane range.
				const len = pathLength(emitterEvent.points);
				const duration = Math.min(
					2000,
					Math.max(180, ((len / (SYMBOL_SIZE * 4)) * 220) / line.speed),
				);
				await entry.progress.set(1, { duration });
			}
			// The fade is deliberately NOT awaited: it runs WHILE the count does, so the number is
			// already moving as the stamp arrives rather than starting once it is fully opaque.
			if (fades) void entry.fade.set(1, { duration: tweenMs(fadeInMs) });
			// The count IS awaited, so the win narration (the symbol celebration that follows this
			// broadcast) waits for the number to land instead of talking over it.
			if (counts) await entry.count.set(amountValue, { duration: tweenMs(countUpMs) });
		},
		winLineHide: (emitterEvent) => {
			// In all-at-once mode a PER-WIN hide is ignored — the lines staying up together IS the
			// mode. Only a round-level clear (`all`: the next spin, or the win cycle stopping) wipes
			// them. Off, every hide clears the single drawn line, exactly as before.
			if (allAtOnce && !emitterEvent.all) return;
			lines = [];
			context.stateGame.winLineColor = null;
		},
		winAmountCue: async (emitterEvent) => {
			// The sender already gated on the switch; this is the renderer's own guard, so an
			// un-authored project can never draw a run-up whatever reaches it.
			if (!cueBigWin || !showText) return;
			const entry: CueStamp = {
				amountAt: emitterEvent.amountAt,
				count: new Tween(0, { duration: 0 }),
				fade: new Tween(fadeIn ? 0 : 1, { duration: 0 }),
				labelSize: { width: 0, height: 0 },
			};
			cue = entry;
			if (fadeIn) void entry.fade.set(1, { duration: tweenMs(fadeInMs) });
			await entry.count.set(emitterEvent.target, { duration: tweenMs(countUpMs) });
		},
		winAmountCueHide: () => {
			cue = null;
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

	/** Half a cell's height — a column-win bar spans one full cell centred on each winning symbol, so
	 *  cells stacked in the same reel merge into one continuous vertical bar. */
	const cellHalf = $derived(context.stateGameDerived.boardGeometry().rowPitchLocal / 2);

	/** Gap between the line's end and the stamped amount. */
	const LABEL_GAP = SYMBOL_SIZE * 0.55;

	/**
	 * What a line stamps: the authored message ABOVE the amount, as ONE text block rather than
	 * two nodes — so the measured label box covers both lines and the in-window placement below
	 * (flip + clamp) keeps governing the whole stamp. Unauthored ⇒ `message` is empty ⇒ this is
	 * exactly the amount, byte-identical to before.
	 */
	const labelTextOf = (drawn: DrawnLine): string => {
		// Counting ⇒ the amount is re-rendered from the live tween through the authored template;
		// otherwise it is the string the dispatch already formatted. The message line above it never
		// counts — it names the win, it does not report it.
		const amount = countUp && drawn.amountAt ? drawn.amountAt(drawn.count.current) : drawn.amount;
		return drawn.message ? `${drawn.message}\n${amount}` : amount;
	};

	const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

	/**
	 * Stamp the pay amount at the line's end (the last paying symbol) but ALWAYS INSIDE the reel
	 * window: preferred BELOW the end, FLIPPED ABOVE when below would overflow the bottom edge — a win
	 * landing on the bottom row otherwise stamped the amount off the board, behind the HUD. Both axes
	 * are then clamped as a safety net (a short board or large font can overflow either way, and a
	 * line ending on the last reel can push the text past the right edge). The text anchors top-centre,
	 * so its box spans `x ± width/2` by `y … y + height`.
	 *
	 * `boardCenter` placement short-circuits all of that: the stamp sits in the middle of the reel
	 * window regardless of where the win landed, which is the point of the mode.
	 */
	function labelFor(drawn: DrawnLine): { x: number; y: number } | undefined {
		const points = drawn.points;
		if (!points.length) return undefined;
		/** Both bar shapes share every "not a traced path" branch (no head-trace, amount stamped
		 *  once over the whole set). */
		const bars = drawn.shape !== 'path';
		const width = drawn.labelSize.width || SYMBOL_SIZE * text.size * 2;
		const height = drawn.labelSize.height || SYMBOL_SIZE * text.size;
		// Centred on the reel window's own middle — the text anchors top-centre, so the box is
		// lifted by half its height to sit ON the centre rather than hang below it.
		if (centreText) {
			return { x: windowWidth / 2, y: Math.max(0, (windowHeight - height) / 2) };
		}
		// A bar shape stamps ONCE, centred over the winning columns (their x-extent) just beneath the
		// lowest bar; an ordinary payline stamps at its last paying symbol. Both then flip-above +
		// clamp to stay inside the reel window, exactly as before.
		const anchorX = bars
			? (Math.min(...points.map((pt) => pt.x)) + Math.max(...points.map((pt) => pt.x))) / 2
			: points[points.length - 1].x;
		const anchorBottom = bars
			? Math.max(...points.map((pt) => pt.y)) + cellHalf
			: points[points.length - 1].y;
		// Where the flipped-above stamp sits: clear of the bars' TOP for a bar shape, else the point.
		const anchorTop = bars
			? Math.min(...points.map((pt) => pt.y)) - cellHalf
			: points[points.length - 1].y;
		let y = anchorBottom + LABEL_GAP;
		if (y + height > windowHeight) y = anchorTop - LABEL_GAP - height;
		return {
			x: clamp(anchorX, width / 2, Math.max(width / 2, windowWidth - width / 2)),
			y: clamp(y, 0, Math.max(0, windowHeight - height)),
		};
	}

	/** Where the run-up stamp sits: the reel window's own middle, the SAME geometry `boardCenter`
	 *  placement uses (the text anchors top-centre, so the box is lifted by half its height to sit ON
	 *  the centre rather than hang below it). It is centred regardless of the authored placement —
	 *  the round total did not land on any line. */
	const cueLabel = $derived.by(() => {
		if (!cue) return undefined;
		const height = cue.labelSize.height || SYMBOL_SIZE * text.size;
		return { x: windowWidth / 2, y: Math.max(0, (windowHeight - height) / 2) };
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

	/** `'cells'` — one vertical segment per winning cell, from its centre ± half a cell. Sub-paths in
	 *  a single stroke, so cells stacked in a reel merge and separate columns stay disconnected —
	 *  the readable "these whole columns pay" shape, not a criss-cross zig-zag. */
	function traceColumns(graphics: DrawGraphics, pts: WinLinePoint[], half: number): void {
		for (const pt of pts) {
			graphics.moveTo(pt.x, pt.y - half);
			graphics.lineTo(pt.x, pt.y + half);
		}
	}

	/** `'reels'` — ONE bar per winning reel, spanning that reel's topmost to bottommost winning cell
	 *  (± half a cell). A ways win pays by whole-reel participation, so the reel is the unit: cells
	 *  on the same reel become a single continuous bar even when they are NOT adjacent, rather than
	 *  the scatter of one-cell dashes `traceColumns` would leave. Reels are keyed by the point's `x`,
	 *  which is the cell SEAT's x (`winLinePointsFor`) — on a FLAT board that is one exact value per
	 *  reel, so the grouping is lossless. A converging board would give each row its own x and this
	 *  would have to key on the reel index instead; perspective stands the ways/roll behaviours down
	 *  (docs/design/perspective-board-mode.md), so it is not that today. */
	function traceReels(graphics: DrawGraphics, pts: WinLinePoint[], half: number): void {
		const spans: { x: number; top: number; bottom: number }[] = [];
		for (const pt of pts) {
			const span = spans.find((candidate) => candidate.x === pt.x);
			if (!span) spans.push({ x: pt.x, top: pt.y, bottom: pt.y });
			else {
				span.top = Math.min(span.top, pt.y);
				span.bottom = Math.max(span.bottom, pt.y);
			}
		}
		for (const span of spans) {
			graphics.moveTo(span.x, span.top - half);
			graphics.lineTo(span.x, span.bottom + half);
		}
	}

	// Re-created whenever the points or the draw progress change, so the <Graphics>
	// redraws the growing line (the closure captures the current progress value). Called from the
	// template per drawn line, so each line in the all-at-once set gets its own stroke pass.
	function drawFor(entry: DrawnLine) {
		const pts = entry.points;
		const full = entry.fullPoints;
		const p = entry.progress.current;
		const drawn = entry.shape;
		const half = cellHalf;
		const coreWidth = SYMBOL_SIZE * line.width;
		// The winning payline's authored colour (Invisible Game Config) overrides BOTH the core line
		// and its glow halo, so the whole line reads as that colour — UNLESS the author turned off
		// "Use payline colour from config", which makes the Symbols-tool swatch authoritative. When on
		// (default) or the win has no config colour, the swatch is the fallback (byte-parity with before).
		const configColor = line.useConfigColor ? entry.color : undefined;
		const coreColor = configColor ?? line.color;
		const haloColor = configColor ?? line.glowColor;
		// Stamp the current shape into the path: merged per-reel bars for a ways win, per-cell bars for
		// a cluster/expansion win, the progressive polyline otherwise. Called once per stroke so the
		// halo + core layer up.
		const trace = (graphics: DrawGraphics) => {
			if (drawn === 'reels') return traceReels(graphics, pts, half);
			if (drawn === 'cells') return traceColumns(graphics, pts, half);
			return tracePath(graphics, pts, p);
		};
		return (graphics: DrawGraphics) => {
			// Optional full-payline underlay: the WHOLE path (all reels), drawn COMPLETE (no
			// animated reveal — it is context, not the win) BENEATH the winning segment, in its own
			// colour. Off by default, so an un-authored game draws nothing here. Skipped for a column
			// win — a "full payline" is a connected-line notion that a bar shape has no analogue for.
			if (drawn === 'path' && line.fullPayline && full.length >= 2) {
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
					trace(graphics);
					graphics.stroke({
						color: haloColor,
						width: halo.w,
						alpha: halo.a,
						cap: 'round',
						join: 'round',
					});
				}
			}
			trace(graphics);
			graphics.stroke({
				color: coreColor,
				width: coreWidth,
				alpha: 0.95,
				cap: 'round',
				join: 'round',
			});
		};
	}
</script>

{#if lines.length || cue}
	<BoardContainer>
		<!-- Every line strokes BEFORE any stamp, so with the whole round on screen at once a later
		     line's graphics can never be drawn over an earlier line's amount. -->
		{#if showLine}
			{#each lines as entry (entry.id)}
				<Graphics draw={drawFor(entry)} />
			{/each}
		{/if}

		{#each lines as entry, index (entry.id)}
			{@const label = labelFor(entry)}
			{@const labelText = labelTextOf(entry)}
			{@const stamps = showText && (!centreText || index === lines.length - 1)}
			{#if stamps && label && entry.progress.current >= 1 && labelText}
				<Container x={label.x} y={label.y} alpha={entry.fade.current}>
					<ResponsiveBitmapText
						anchor={{ x: 0.5, y: 0 }}
						maxWidth={SYMBOL_SIZE * 3}
						onresize={(sizes) => (entry.labelSize = sizes)}
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
		{/each}

		<!-- The big-win run-up: the round total, centred, counting to the threshold the overlay
		     takes over at. Drawn in the same font/size/colour as a line's stamp, so the number the
		     player is reading does not change typeface as the cue hands over. -->
		{#if cue && cueLabel}
			<Container x={cueLabel.x} y={cueLabel.y} alpha={cue.fade.current}>
				<ResponsiveBitmapText
					anchor={{ x: 0.5, y: 0 }}
					maxWidth={SYMBOL_SIZE * 3}
					onresize={(sizes) => {
						if (cue) cue.labelSize = sizes;
					}}
					text={cue.amountAt(cue.count.current)}
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
