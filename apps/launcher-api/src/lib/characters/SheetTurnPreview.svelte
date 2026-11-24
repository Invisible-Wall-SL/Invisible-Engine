<script lang="ts">
	/**
	 * A sheet's character TURNING, as the game draws it: one character at the game's size walking
	 * round a slow circle, each frame the answer of the game's own animator (`sheetTurn.ts`
	 * `turnAnimator`) to a velocity sample along the heading. With the sheet's smooth turn off the
	 * picture snaps from facing to facing; with it on it leans and sweeps through the facings in
	 * between, which *Turn about* (the heading turned half round at once) shows.
	 *
	 * A clip or a still image is drawn with the directions preview's parts (`clipDrawing.ts`,
	 * `RegionThumb`), mirrored about the place as the game mirrors, and the lean is a rotation about
	 * the place OUTSIDE the mirror, so a mirrored facing leans the same way. A rig is the game's own
	 * look (`SheetTurnRig.svelte`), fetched with Pixi only when a rig sheet is shown.
	 *
	 * One clock: a frame is asked only while the preview plays and is on screen. What is drawn is
	 * stated on the root (`data-turn-facing`, `data-turn-lean` in degrees, `data-turn-clip`).
	 */
	import { untrack, type Component } from 'svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { cellPlays, characterGrid, clipsWithStills } from '$lib/flipbook/characterSet';
	import { clipDrawing, clipMirror, noClipDrawing } from '$lib/flipbook/clipDrawing';
	import { clipSheetKeys, type FlipbookClip } from 'engine-flipbook';
	import { sheetTurns } from 'engine-layout';
	import type { CharacterSheet } from 'game-config';
	import { fetchRegions, type RegionSet } from '../../routes/(app)/editor/editorRegions.client';
	import RegionThumb from '../../routes/(app)/editor/RegionThumb.svelte';
	import { rigSourceOf, type RigFactsByName } from './rigFacts';
	import type { LoadedRig } from './rigLoad.client';
	import type SheetTurnRig from './SheetTurnRig.svelte';
	import {
		TURN_PREVIEW_CIRCLE_MS,
		headingDegrees,
		leanDegrees,
		turnAnimator,
		turnPreviewKind,
		turnSample,
		turnStageBox,
		type TurnReading,
	} from './sheetTurn';

	interface Props {
		sheet: CharacterSheet;
		/** Every clip id of the project, and the clips read in full, by id. */
		clipIds: readonly string[];
		clips: Record<string, FlipbookClip>;
		/** The rigs read so far, and how one is loaded for a look. */
		rigs: RigFactsByName;
		load: (rig: string) => Promise<LoadedRig>;
	}
	let { sheet, clipIds, clips: projectClips, rigs, load }: Props = $props();

	const kind = $derived(turnPreviewKind(sheet));
	const smooth = $derived(sheetTurns(sheet));

	let playing = $state(true);
	let visible = $state(false);
	let root = $state<HTMLDivElement>();
	/** The preview's clock, the heading the character moves along and what the animator answered. */
	let clock = $state(0);
	let heading = $state(0);
	let reading = $state.raw<TurnReading | undefined>(undefined);
	/** When what is drawn started, on the clock: a clip not looped stays on its last frame. */
	let started = $state.raw({ key: '', at: 0 });

	// An edit of the sheet makes a new animator, which starts in the facing the last one drew.
	let facing: TurnReading['facing'] | undefined;
	const animator = $derived(turnAnimator(sheet, clipIds, rigSourceOf(rigs), facing));
	$effect(() => {
		const at = clock;
		const next = animator?.read(turnSample(sheet, heading, at));
		reading = next;
		facing = animator?.facing;
		const key = next && 'clip' in next.frame ? `${next.plays}|${next.frame.clip.play}` : '';
		if (untrack(() => started.key) !== key) started = { key, at };
	});

	$effect(() => {
		if (!root) return;
		const seen = new IntersectionObserver((entries) => {
			visible = entries.some((entry) => entry.isIntersecting);
		});
		seen.observe(root);
		return () => seen.disconnect();
	});

	/** The longest the clock moves on in one frame: a tab come back to does not leap. */
	const MAX_STEP_MS = 100;
	$effect(() => {
		if (!playing || !visible) return;
		let raf = 0;
		let last = performance.now();
		const tick = (at: number): void => {
			const ms = Math.min(Math.max(at - last, 0), MAX_STEP_MS);
			last = at;
			heading += (ms / TURN_PREVIEW_CIRCLE_MS) * Math.PI * 2;
			clock += ms;
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	function turnAbout(): void {
		heading += Math.PI;
		playing = true;
	}

	// ── a clip or a still image ──────────────────────────────────────────────────────────────
	const clips = $derived(clipsWithStills(sheet, projectClips));
	let regionSets = $state<Record<string, RegionSet>>({});
	function ensureRegions(key: string): void {
		if (!key || regionSets[key]) return;
		void fetchRegions(key).then((set) => {
			if (set) regionSets = { ...regionSets, [key]: set };
		});
	}

	const clipFrame = $derived(reading && 'clip' in reading.frame ? reading.frame.clip : undefined);
	const clipId = $derived(clipFrame?.clipId);
	const action = $derived(clipFrame?.action);
	const clip = $derived(clipId === undefined ? undefined : clips[clipId]);
	const drawing = $derived(
		clip
			? clipDrawing(sheet, clip, regionSets, 1)
			: noClipDrawing(clipId === undefined ? '' : 'Its clip could not be read.'),
	);
	const mirror = $derived(clip && clipFrame ? clipMirror(clip, clipFrame.flipX) : { sx: 1, sy: 1 });

	/** Every clip the action drawn plays in some facing: the stage holds each, so it does not
	 *  change size as the character turns. */
	const round = $derived.by(() => {
		if (kind !== 'clips' || action === undefined) return [];
		const row = characterGrid(sheet, clipIds).rows.find((r) => r.state === action);
		const ids = new Set((row?.cells ?? []).flatMap((cell) => cellPlays(cell)?.clipId ?? []));
		return [...ids].flatMap((id) => clips[id] ?? []);
	});
	$effect(() => {
		for (const each of clip ? [clip, ...round] : round)
			for (const key of clipSheetKeys(each)) ensureRegions(key);
	});
	const stage = $derived.by(() => {
		const reaches = [drawing, ...round.map((each) => clipDrawing(sheet, each, regionSets, 1))].map(
			(d) => d.reach,
		);
		const least = (sheet.draw?.width ?? 0) / 2;
		return turnStageBox(sheet, {
			side: Math.max(least, ...reaches.map((r) => r.side)),
			up: Math.max(least, ...reaches.map((r) => r.up)),
			down: Math.max(0, ...reaches.map((r) => r.down)),
		});
	});

	const draw = $derived.by(() => {
		const count = drawing.walk.length;
		if (!count || !clipFrame) return null;
		const tick = Math.floor(((clock - (clipFrame.loop ? 0 : started.at)) * drawing.fps) / 1000);
		const step = clipFrame.loop ? tick % count : Math.min(tick, count - 1);
		return drawing.draws[drawing.walk[step]] ?? null;
	});

	// ── a rig ────────────────────────────────────────────────────────────────────────────────
	let Rig = $state.raw<Component<Parameters<typeof SheetTurnRig>[1]> | undefined>(undefined);
	$effect(() => {
		if (kind === 'rig' && !Rig) void import('./SheetTurnRig.svelte').then((m) => (Rig = m.default));
	});
	const rigFrame = $derived(reading && 'rig' in reading.frame ? reading.frame.rig : undefined);
</script>

<div
	class="turn"
	bind:this={root}
	data-turn-preview={smooth ? 'smooth' : 'snap'}
	data-turn-facing={reading?.facing ?? ''}
	data-turn-lean={leanDegrees(reading?.lean ?? 0)}
	data-turn-clip={reading?.plays ?? ''}
	data-turn-heading={headingDegrees(heading)}
>
	<div class="bar">
		<IconButton
			icon={playing ? 'pause' : 'play'}
			label={playing ? 'Pause the turn' : 'Play the turn'}
			onclick={() => (playing = !playing)}
		/>
		<IconButton icon="reverse" label="Turn about: head the other way at once" onclick={turnAbout} />
		<span class="says">
			{#if reading}
				<b>{reading.facing}</b>
				{reading.plays}{smooth ? ` · leans ${leanDegrees(reading.lean)}°` : ' · no smooth turn'}
			{:else}
				{kind
					? 'Nothing plays yet.'
					: 'Nothing is drawn until it has a source, a width and an action.'}
			{/if}
		</span>
	</div>
	{#if kind === 'rig'}
		{#if Rig}<Rig {sheet} frame={rigFrame} atMs={clock} {rigs} {load} />{/if}
	{:else if kind === 'clips'}
		<div class="stage" style:width="{stage.width}px" style:height="{stage.height}px">
			<div
				class="place"
				style:left="{stage.placeX}px"
				style:top="{stage.placeY}px"
				style:transform="rotate({reading?.lean ?? 0}rad)"
			>
				<div class="place" style:transform="scale({mirror.sx}, {mirror.sy})">
					{#if draw}
						<div class="art" style:left="{-draw.feetX}px" style:top="{-draw.feetY}px">
							<RegionThumb set={draw.set} region={draw.record} size={drawing.size} box={draw.box} />
						</div>
					{/if}
				</div>
			</div>
			{#if drawing.problem}<span class="why">{drawing.problem}</span>{/if}
		</div>
	{/if}
</div>

<style>
	.turn {
		margin-top: 12px;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-bottom: 6px;
	}
	.says {
		margin-left: 6px;
		font-family: ui-monospace, monospace;
		font-size: 11px;
		color: #94a3b8;
	}
	.says b {
		color: #e2e8f0;
		text-transform: uppercase;
	}
	.stage {
		position: relative;
		overflow: hidden;
		border-radius: 8px;
		background: repeating-conic-gradient(#10151c 0% 25%, #0c1016 0% 50%) 50% / 16px 16px;
	}
	.place {
		position: absolute;
		width: 0;
		height: 0;
		transform-origin: 0 0;
	}
	.art {
		position: absolute;
	}
	/* The thumbnail paints its own dark tile behind the art; here the stage shows through. */
	.art :global(canvas) {
		background: transparent;
		border-radius: 0;
	}
	.why {
		position: absolute;
		inset: auto 6px 6px;
		font-size: 10px;
		color: #fca5a5;
	}
</style>
