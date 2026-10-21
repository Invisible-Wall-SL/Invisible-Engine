<script lang="ts" module>
	import type { ElementFxEntry } from 'constants-shared/elementFx';
	import type { ElementFxPose } from 'pixi-svelte/elementFx';

	export type Props = {
		/** The element's authored Element FX (a node's, a screen's or the reels' `elementFx`), read
		 *  once at mount: an `always` entry loops, an `enter` entry plays now, a `cue` entry plays
		 *  each time its cue fires. */
		entries: readonly ElementFxEntry[];
		/** The owning instance's signal scope: a scoped cue plays only the matching instance's FX. */
		scope?: string;
		/** Where a timeline poses each `keyed` entry now (by entry id), read every frame. */
		pose?: (entryId: string) => ElementFxPose | undefined;
	};
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { getContextApp, getContextParent } from 'pixi-svelte';
	import {
		elementFxHostFor,
		playElementFx,
		type ElementFxHandle,
		type ElementFxPlay,
	} from 'pixi-svelte/elementFx';
	import { particleTimeScale } from 'pixi-svelte/particleClock';
	import { scopeMatches } from 'utils-event-emitter';

	import { getComponentFiredSignals } from './componentFiredSignalsContext';
	import { getComponentSignal } from './registerComponentSignals';

	/**
	 * Plays an element's authored Element FX on the container it is mounted in (the node's, the
	 * screen's or the reels' own). Draws nothing. Cues come off the component-signal bus, so a Flow
	 * `fireCue`, a game signal or a component signal all reach it, scoped like every other cue; inside
	 * a component they also come off the instance's own fired signals, which is where its timelines
	 * and state machine raise theirs. A `keyed` entry is posed by `pose` instead of played. Follows
	 * the game's turbo through the particle clock.
	 */
	const props: Props = $props();
	const parentContext = getContextParent();
	const appContext = getContextApp();
	const fired = getComponentFiredSignals();
	const instanceCues = untrack(() => props.entries)
		.flatMap((e) => (e.disabled ? [] : [e.trigger === 'cue' ? e.cue : undefined, e.stopCue]))
		.filter((cue, i, all): cue is string => !!cue && all.indexOf(cue) === i);
	/** The instance's fire counts this player has seen, so only a fire after mount plays. */
	const seen: Record<string, number> = {};
	/** The instance's fires, as `start` / `stop` callbacks keyed by cue (set by the effect below). */
	let onInstanceFire: ((cue: string) => void) | undefined;

	const toPlay = (entry: ElementFxEntry): ElementFxPlay => ({
		kind: entry.kind,
		durationMs: entry.durationMs,
		delayMs: entry.delayMs,
		intensity: entry.intensity,
		repeat: entry.trigger === 'always' ? 0 : (entry.repeat ?? 1),
		params: entry.params,
	});

	$effect(() =>
		untrack(() => {
			const target = parentContext.parent;
			const host = elementFxHostFor(appContext.stateApp.pixiApplication, particleTimeScale);
			if (!host) return;
			const playing: Record<string, ElementFxHandle> = {};
			const unsubs: (() => void)[] = [];
			const start = (entry: ElementFxEntry): void => {
				playing[entry.id]?.stop();
				playing[entry.id] = playElementFx(target, toPlay(entry), host);
			};
			const stop = (entry: ElementFxEntry): void => {
				playing[entry.id]?.stop();
				delete playing[entry.id];
			};
			const runs: Record<string, (() => void)[]> = {};
			const listen = (cue: string, run: () => void): void => {
				(runs[cue] ??= []).push(run);
				unsubs.push(
					getComponentSignal(cue).subscribe((scope) => {
						if (scopeMatches(props.scope, scope)) run();
					}),
				);
			};
			for (const entry of props.entries) {
				if (entry.disabled) continue;
				if (entry.trigger === 'cue') {
					if (entry.cue) listen(entry.cue, () => start(entry));
				} else if (entry.trigger === 'keyed') {
					playing[entry.id] = playElementFx(
						target,
						{ ...toPlay(entry), pose: () => props.pose?.(entry.id) },
						host,
					);
				} else {
					start(entry);
				}
				if (entry.stopCue) listen(entry.stopCue, () => stop(entry));
			}
			onInstanceFire = (cue) => {
				for (const run of runs[cue] ?? []) run();
			};
			return () => {
				onInstanceFire = undefined;
				for (const unsub of unsubs) unsub();
				for (const handle of Object.values(playing)) handle.stop();
			};
		}),
	);

	// The owning instance's own fires (its timelines' and state machine's cues): a count that rises
	// after mount plays the cue's entries, as a bus fire would.
	$effect(() => {
		if (!fired) return;
		for (const cue of instanceCues) {
			const count = fired.counts[cue] ?? 0;
			const before = untrack(() => seen[cue]);
			seen[cue] = count;
			if (before !== undefined && count > before) untrack(() => onInstanceFire?.(cue));
		}
	});
</script>
