<script lang="ts">
	/**
	 * Play an Invisible Cinematic in-game — the runtime twin of `/rigger`'s Cinematic mode.
	 * Plan: `docs/design/invisible-cinematic.md` · State: `docs/status/cinematic.md`.
	 *
	 * Mounts one `<RigProvider>` per cast member (keyed by the rig's FOLDER, which is the rig
	 * bundle name the game registered — the export seeds those bundles into the shipped art, so a
	 * cast rig is always loadable) and drives them all from ONE clock through the shared
	 * `engine-cinematic` evaluator. Same evaluator the editor preview runs, so what an author
	 * scrubbed is what the game plays.
	 *
	 * NODE ACTORS (Rive plan §3.1): a `screen`-hosted timeline also drives nodes of its set by
	 * name. They render nothing here — the set's own `<LayoutNodeView>`s read their channels through
	 * the `cinematicNodeContext` driver this component provides. A doc with no node actor provides
	 * a driver that matches nothing, so every node renders as before. When its host screen is
	 * already on stage (`setMounted`) the set is not drawn here: the caller mounts that screen with
	 * the driver `ondriver` hands it, so the timeline moves the screen the player already sees.
	 */
	import { onDestroy, untrack } from 'svelte';
	import { getContextApp, RigProvider } from 'pixi-svelte';
	import {
		cuesCrossed,
		isNodeActor,
		playbackTime,
		resolveVisible,
		sampleNodeActor,
		type CinematicTrack,
	} from 'engine-cinematic';
	import type { CinematicDoc, Scene } from './types';
	import { keyedNodeChannels, resolveNodeActors } from './cinematicNodes';
	import { setCinematicNodeDriver, type CinematicNodeDriver } from './cinematicNodeContext';
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
		/** The set is already on stage (a flow-shown host screen): draw no copy of it here. */
		setMounted?: boolean;
		/** Handed this player's node driver once, at mount, for a set drawn elsewhere. */
		ondriver?: (driver: CinematicNodeDriver) => void;
		/** Start playing on mount. Off ⇒ the cinematic holds at `startTime` until `playing` flips. */
		playing?: boolean;
		/** Where the playhead starts (and where a `loop`ing cinematic returns to). */
		startTime?: number;
		/** Loop it (as a Flow node asks), whatever the doc's own loop type says. */
		loop?: boolean;
		/** Playback rate; 1 = authored speed. */
		speed?: number;
		/** Fired once when a non-looping cinematic reaches its end — the Flow `complete` seam. */
		oncomplete?: () => void;
		/** Fired for each cue key the playhead crosses, with its `ns:name` string. */
		oncue?: (cue: string) => void;
	};
	const props: Props = $props();

	const appContext = getContextApp();

	let time = $state(props.startTime ?? 0);
	let done = false;
	/** A `pingPong` doc's seconds into its there-and-back lap; `time` is where the lap samples. */
	let lap = 0;

	const duration = $derived(Math.max(props.doc.duration || 0, 0));
	/** Cast RIGS in draw order — the same z the author saw on the /rigger stage. Node actors draw
	 *  inside the set, so they take no place on this line. */
	const cast = $derived(
		(props.doc.stage?.cast ?? [])
			.filter((member) => !isNodeActor(member))
			.sort((a, b) => (a.z ?? 0) - (b.z ?? 0)),
	);
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
		let placed = !props.scene || !!props.setMounted;
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
				{ keys?: { time: number; cue: string }[] } | undefined
		)?.keys ?? [],
	);

	// The set's nodes that node actors drive, keyed by node id. Read by each top-level
	// `<LayoutNodeView>` once, at init; `sample()` reads `time`, so a driven node follows the playhead.
	const nodeActors = $derived(resolveNodeActors(props.doc, props.scene));
	const driver: CinematicNodeDriver = (nodeId) => {
		const actor = nodeActors.get(nodeId);
		if (!actor) return undefined;
		const tracks = actor.tracks as unknown as CinematicTrack[];
		return {
			channels: keyedNodeChannels(actor.tracks),
			// The LAST text track, the one `sampleNodeActor` samples (validation flags a second one).
			textTrack: tracks.filter((t) => t.kind === 'text').pop(),
			sample: () => sampleNodeActor(tracks, time),
		};
	};
	setCinematicNodeDriver(driver);
	untrack(() => props.ondriver)?.(driver);

	// Game content mounts after the Pixi app has initialised, so the application is already here.
	const ticker = appContext.stateApp.pixiApplication?.ticker;

	function tick() {
		if (!ticker || !props.playing || duration <= 0 || done) return;
		const prev = time;
		const dt = (ticker.deltaMS / 1000) * (props.speed ?? 1);
		// The doc's own loop type (Rive plan Phase 9b): a ping-pong samples its lap reflected, so the
		// way back crosses no cue. Absent ⇒ the one-shot path below, as before.
		if (props.doc.loop === 'pingPong' && !props.loop) {
			lap = (lap + dt) % (2 * duration);
			time = playbackTime('pingPong', lap, duration);
			if (props.oncue && cueKeys.length) {
				for (const k of cuesCrossed(cueKeys, prev, time)) props.oncue(k.cue);
			}
			return;
		}
		time += dt;
		// `cuesCrossed` owns the "did we cross it" rule (and refuses on a backwards or over-large
		// step, i.e. a seek), so the game and the editor preview share ONE definition of "fired".
		if (props.oncue && cueKeys.length) {
			for (const k of cuesCrossed(cueKeys, prev, time)) props.oncue(k.cue);
		}
		if (time < duration) return;
		if (props.loop || props.doc.loop === 'loop') {
			time = duration > 0 ? time % duration : 0;
			return;
		}
		// Land exactly ON the last frame before reporting completion, so the final pose is the one
		// the author authored rather than whatever the overshoot happened to land on.
		time = duration;
		done = true;
		props.oncomplete?.();
	}

	ticker?.add(tick);
	onDestroy(() => ticker?.remove(tick));

	// Re-arm when the caller restarts it (a screen replayed, or a different cinematic mounted).
	$effect(() => {
		void props.doc.id;
		void props.startTime;
		time = props.startTime ?? 0;
		lap = time;
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
			<RigProvider key={layer.member.rigFolder}>
				<CinematicActor cast={layer.member} tracks={tracksFor(layer.member.actorId)} {time} />
			</RigProvider>
		{/if}
	{/if}
{/each}
