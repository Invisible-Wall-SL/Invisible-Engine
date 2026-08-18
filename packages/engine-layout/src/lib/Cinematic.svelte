<script lang="ts">
	/**
	 * Play an Invisible Cinematic in-game — the runtime twin of `/rigger`'s Cinematic mode.
	 * Plan: `docs/design/invisible-cinematic.md` · State: `docs/status/cinematic.md`.
	 *
	 * Mounts one `<SpineProvider>` per cast member (keyed by the rig's FOLDER, which is the spine
	 * bundle name the game registered — the export seeds those bundles into the shipped art, so a
	 * cast rig is always loadable) and drives them all from ONE clock through the shared
	 * `engine-cinematic` evaluator. Same evaluator the editor preview runs, so what an author
	 * scrubbed is what the game plays.
	 *
	 * Deliberately NOT a Scene: design §4.1 has a cinematic eventually binding tracks to an
	 * existing Scene's nodes, but Phase 1–3 cast rigs directly (`cast[].nodeId` is null), so this
	 * renders the cast itself. When the Scene binding lands, this component gains a branch; the
	 * doc format does not change.
	 */
	import { onDestroy } from 'svelte';
	import { getContextApp, SpineProvider } from 'pixi-svelte';
	import { cuesCrossed, resolveVisible, type CinematicTrack } from 'engine-cinematic';
	import type { CinematicDoc, Scene } from './types';
	import CinematicActor from './CinematicActor.svelte';
	import LayoutScene from './LayoutScene.svelte';

	type Props = {
		doc: CinematicDoc;
		/**
		 * The bound SET (design §12.3), mounted HERE rather than beside this component so it can
		 * take its authored depth among the cast (`doc.stage.setZ`) instead of a fixed backdrop
		 * band. It carries the sprites, text and effect nodes — and an `fx:` cue fires an effect
		 * node, so this is what makes a cue layerable against the rigs at all.
		 */
		scene?: Scene;
		/** Start playing on mount. Off ⇒ the cinematic holds at `startTime` until `playing` flips. */
		playing?: boolean;
		/** Where the playhead starts (and where a `loop`ing cinematic returns to). */
		startTime?: number;
		loop?: boolean;
		/** Playback rate; 1 = authored speed. */
		speed?: number;
		/** Fired once when a non-looping cinematic reaches its end — the Flow `complete` seam. */
		oncomplete?: () => void;
	};
	const props: Props = $props();

	const appContext = getContextApp();

	let time = $state(props.startTime ?? 0);
	let done = false;

	const duration = $derived(Math.max(props.doc.duration || 0, 0));
	/** Cast in draw order — the same z the author saw on the /rigger stage. */
	const cast = $derived([...(props.doc.stage?.cast ?? [])].sort((a, b) => (a.z ?? 0) - (b.z ?? 0)));
	/**
	 * One draw-ordered list of LAYERS: the cast, with the set spliced in at its `setZ`. Mount
	 * order is draw order inside the container, so emitting the set at the right index is the
	 * whole implementation — no zIndex sorting, no second container.
	 *
	 * `setZ` absent ⇒ -1 ⇒ the set leads, which is byte-identical to the old fixed "mounted
	 * BEHIND the cast" markup. Every existing cinematic therefore renders exactly as before.
	 */
	const layers = $derived.by(() => {
		const setZ = props.doc.stage?.setZ ?? -1;
		const out: Array<{ set: true } | { set: false; member: (typeof cast)[number] }> = [];
		let placed = !props.scene;
		for (const member of cast) {
			if (!placed && (member.z ?? 0) > setZ) {
				out.push({ set: true });
				placed = true;
			}
			out.push({ set: false, member });
		}
		if (!placed) out.push({ set: true });
		return out;
	});
	/** On screen at `t`? A keyed visibility track wins; otherwise the actor's static toggle. */
	const visibleAt = (member: { actorId: string; visible?: boolean }, t: number): boolean =>
		resolveVisible(
			member.visible,
			(props.doc.tracks as CinematicTrack[]).filter(
				(tr) => tr.actorId === member.actorId && tr.kind === 'visibility',
			),
			t,
		);

	const tracksFor = (actorId: string): CinematicTrack[] =>
		(props.doc.tracks as CinematicTrack[]).filter((t) => t.actorId === actorId);

	/**
	 * Advance the playhead. Driven by the Pixi ticker rather than an internal rAF so the cinematic
	 * shares the game's clock — a paused/throttled game pauses the cinematic with it, and
	 * `deltaMS` already accounts for frame time.
	 */
	const cueKeys = $derived(
		(
			(props.doc.tracks as CinematicTrack[]).find((t) => t.kind === 'cue') as
				| { keys?: { time: number; cue: string }[] }
				| undefined
		)?.keys ?? [],
	);

	function tick() {
		if (!props.playing || duration <= 0 || done) return;
		const prev = time;
		time += (appContext.app.ticker.deltaMS / 1000) * (props.speed ?? 1);
		// `cuesCrossed` owns the "did we cross it" rule (and refuses on a backwards or over-large
		// step, i.e. a seek), so the game and the editor preview share ONE definition of "fired".
		if (props.oncue && cueKeys.length) {
			for (const k of cuesCrossed(cueKeys, prev, time)) props.oncue(k.cue);
		}
		if (time < duration) return;
		if (props.loop) {
			time = duration > 0 ? time % duration : 0;
			return;
		}
		// Land exactly ON the last frame before reporting completion, so the final pose is the one
		// the author authored rather than whatever the overshoot happened to land on.
		time = duration;
		done = true;
		props.oncomplete?.();
	}

	appContext.app.ticker.add(tick);
	onDestroy(() => appContext.app.ticker.remove(tick));

	// Re-arm when the caller restarts it (a screen replayed, or a different cinematic mounted).
	$effect(() => {
		void props.doc.id;
		void props.startTime;
		time = props.startTime ?? 0;
		done = false;
	});
</script>

{#each layers as layer (layer.set ? '__set__' : layer.member.actorId)}
	{#if layer.set}
		{#if props.scene}
			<LayoutScene scene={props.scene} />
		{/if}
	{:else}
		<!--
			Visibility is read at the CURRENT time, not once at mount, so a keyed visibility track takes
			effect mid-play. `time` is reactive state, so this re-evaluates as the playhead moves.
		-->
		{#if layer.member.rigFolder && visibleAt(layer.member, time)}
			<SpineProvider key={layer.member.rigFolder}>
				<CinematicActor cast={layer.member} tracks={tracksFor(layer.member.actorId)} {time} />
			</SpineProvider>
		{/if}
	{/if}
{/each}
