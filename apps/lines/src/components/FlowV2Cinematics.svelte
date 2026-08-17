<script lang="ts">
	/**
	 * Invisible Flow v2 — the in-game CINEMATIC renderer. Mounts one `<Cinematic>` per cinematic the
	 * flow currently wants on screen, reading the interpreter's reactive `playingCinematics` map (a
	 * `SvelteMap`, so a `playCinematic` node's `play`/`stop` exec re-runs this render).
	 *
	 * The cinematic itself owns everything about its content — cast, strips, property and camera keys,
	 * all authored in `/rigger` — so this component only decides WHETHER one is on screen. When a
	 * non-looping cinematic reaches its end, `oncomplete` settles the promise an `awaitComplete` node
	 * is holding on and unmounts it, which is the whole "play a cinematic and wait for it" contract.
	 *
	 * Inert when no v2 flow is authored, when the flow authors no `playCinematic` node, or when the
	 * project shipped no cinematics — `bakedCinematic()` returns undefined and nothing renders
	 * (parity). A named-but-missing cinematic is deliberately silent rather than fatal: the flow
	 * still runs, and the validator already warns about an empty `ref` at authoring time.
	 */
	import { MainContainer } from 'components-layout';
	import { Cinematic } from 'engine-layout/svelte';

	import { bakedCinematic } from '../editor-scenes';
	import type { LinesFlowV2 } from '../game/flowV2Runtime.svelte';

	const { flow }: { flow: LinesFlowV2 | undefined } = $props();

	/** Only the entries whose cinematic actually shipped — an unknown id renders nothing. */
	const active = $derived(
		[...(flow?.playingCinematics?.entries() ?? [])]
			.map(([id, opts]) => ({ id, opts, doc: bakedCinematic(id) }))
			.filter((entry) => !!entry.doc),
	);
</script>

{#if active.length}
	<MainContainer>
		{#each active as entry (entry.id)}
			<Cinematic
				doc={entry.doc!}
				playing
				loop={entry.opts.loop}
				speed={entry.opts.speed}
				oncomplete={() => flow?.cinematicComplete(entry.id)}
			/>
		{/each}
	</MainContainer>
{/if}
