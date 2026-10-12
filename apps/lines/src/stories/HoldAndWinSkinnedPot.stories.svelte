<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'MODE_HOLD_AND_WIN/skinned pot (12c)',
	});
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	import { App, resolveAnchorPoint } from 'pixi-svelte';
	import { StoryLocale, StoryGameTemplate } from 'components-storybook';
	import {
		HOLD_AND_WIN_PRESETS,
		normalizeGameConfigDoc,
		primaryHoldAndWin,
		setPrimaryHoldAndWin,
	} from 'game-config';
	import { isComponentMounted, LayoutScene } from 'engine-layout/svelte';
	import {
		POT_METER_DEF,
		registerBoundComponents,
		registerComponentSignals,
		registerComponents,
		type ComponentDef,
		type LayoutNode,
		type Scene,
	} from 'engine-layout';

	import PotMeter from '../components/PotMeter.svelte';
	import { setContext } from '../game/context';
	import { eventEmitter } from '../game/eventEmitter';
	import { featureComponentSignals } from '../game/featureSignals';
	import { getActiveGameConfig } from '../game/gameConfig';
	import { meterAnchor, potMeterMountKey, pulseMeter } from '../game/holdAndWinMeters.svelte';
	import { recordHoldAndWinEvent } from '../game/stateHoldAndWin.svelte';

	setContext();

	/**
	 * Phase 12c — the builtin Pot Meter three ways, on the pots preset's meters: RED as coded (the
	 * parity reference), BLUE skinned by its art params alone (the progress bar's background, bar
	 * and frame as the pot, its fill and its frame; a gold label), and GREEN as a project copy of
	 * the Pot Meter with the author's own nodes inside its `Pot` part (a glass, the H1 rig and a
	 * caption) — the coded drawing gives way, while the part still grows with its stages and pulses.
	 * A second frog pot sits on RED: each frog pot's ACTIVE badge waits for **Pot — activate**, and the
	 * copy keeps the Pot Meter's scope, so `window.__activatePot('green')` reveals green's badge only.
	 * RED therefore has two pots, and `__potAnchor('red')` returns whichever registered last.
	 * GOLD is a copy whose `Pot` part was DELETED, drawn only with the author's nodes: it still counts
	 * as gold's pot (`window.__potCounted('gold')`) and owns the `meter:gold` anchor.
	 * The levels step on their own; a test can set one with `window.__setPotLevel(id, level)` and read
	 * where a pot's flights land with `window.__potAnchor(id)`.
	 */
	const config = getActiveGameConfig();
	const block = primaryHoldAndWin(normalizeGameConfigDoc(HOLD_AND_WIN_PRESETS.pots)!);
	if (block) {
		setPrimaryHoldAndWin(config, {
			...block,
			meters: [
				...(block.meters ?? []),
				{ id: 'gold', symbol: 'H4', maxLevel: 12, sizeStages: [5, 9], activates: 'payer' },
			],
		});
	}

	const MAX = 12;
	const levels: Record<string, number> = { red: 4, blue: 6, green: 10, gold: 2 };
	const publish = () =>
		recordHoldAndWinEvent({
			type: 'meterLevels',
			meters: Object.entries(levels).map(([id, level]) => ({ id, level, max: MAX })),
		});
	publish();
	const setLevel = (id: string, level: number) => {
		levels[id] = level;
		publish();
		if (level >= MAX) pulseMeter(id);
	};

	const partOf = (def: ComponentDef): LayoutNode & { kind: 'container' } => {
		const part = def.root.children[0];
		if (part.kind !== 'container') throw new Error('the Pot Meter part is a container');
		return part;
	};
	const frogPot: ComponentDef = {
		...POT_METER_DEF,
		id: 'frogPot',
		name: 'Frog pot',
		scope: 'project',
		root: {
			...POT_METER_DEF.root,
			children: [
				{
					...partOf(POT_METER_DEF),
					children: [
						{ id: 'glass', kind: 'rect', x: 0, y: 0, width: 150, height: 110, color: 0x1d4d2a },
						{
							id: 'frog',
							kind: 'spine',
							assetKey: 'H1',
							defaultAnimation: 'h1_static',
							x: 0,
							y: 20,
							scale: { x: 0.07, y: 0.07 },
						},
						{
							id: 'caption',
							kind: 'text',
							x: 0,
							y: -75,
							text: 'FROG POT',
							style: { fontFamily: 'Arial', fontSize: 22, fill: 0x9fffa0, fontWeight: 'bold' },
						},
						{
							id: 'active',
							kind: 'rect',
							x: 0,
							y: 75,
							width: 130,
							height: 24,
							color: 0xffd54a,
							hiddenUntilSignal: 'potActivate',
						},
					],
				},
			],
		},
	};
	const drawnPot: ComponentDef = {
		...POT_METER_DEF,
		id: 'drawnPot',
		name: 'Drawn pot',
		scope: 'project',
		root: {
			...POT_METER_DEF.root,
			children: [
				{ id: 'drawn-body', kind: 'rect', x: 0, y: 0, width: 140, height: 90, color: 0x6b4e16 },
				{
					id: 'drawn-caption',
					kind: 'text',
					x: 0,
					y: -70,
					text: 'NO POT PART',
					style: { fontFamily: 'Arial', fontSize: 20, fill: 0xffd54a, fontWeight: 'bold' },
				},
			],
		},
	};
	registerComponents({ potMeter: POT_METER_DEF, frogPot, drawnPot });
	registerBoundComponents({ PotMeter });
	registerComponentSignals(featureComponentSignals(eventEmitter, true));
	const activatePot = (id: string) =>
		eventEmitter.broadcast({
			type: 'potsConsume',
			meters: [id],
			activates: [],
			scope: [`meter:${id}`],
		});

	const scene: Scene = {
		id: 'skinned-pot',
		name: 'Skinned pot',
		nodes: [
			{
				id: 'pot-red',
				kind: 'componentInstance',
				componentId: 'potMeter',
				x: 220,
				y: 300,
				params: { meter: 'red' },
			},
			{
				id: 'pot-blue',
				kind: 'componentInstance',
				componentId: 'potMeter',
				x: 560,
				y: 300,
				params: {
					meter: 'blue',
					backgroundImage: 'progressBarBackground.png',
					fillImage: 'progressBar.png',
					frameImage: 'progressBarFrame.png',
					artWidth: 246,
					artHeight: 44,
					labelFill: 0xffd54a,
					labelScale: 1.3,
				},
			},
			{
				id: 'pot-green',
				kind: 'componentInstance',
				componentId: 'frogPot',
				x: 900,
				y: 300,
				params: { meter: 'green' },
			},
			{
				id: 'pot-gold-drawn',
				kind: 'componentInstance',
				componentId: 'drawnPot',
				x: 560,
				y: 560,
				params: { meter: 'gold' },
			},
			{
				id: 'pot-red-frog',
				kind: 'componentInstance',
				componentId: 'frogPot',
				x: 900,
				y: 560,
				params: { meter: 'red' },
			},
		],
	};

	onMount(() => {
		Object.assign(window, {
			__setPotLevel: setLevel,
			__potAnchor: (id: string) => resolveAnchorPoint(meterAnchor(id)),
			__activatePot: activatePot,
			__potCounted: (id: string) => isComponentMounted(potMeterMountKey(id)),
		});
		if (new URLSearchParams(window.location.search).has('still')) return;
		const tick = setInterval(() => {
			for (const id of Object.keys(levels)) setLevel(id, (levels[id] + 1) % (MAX + 1));
		}, 900);
		return () => clearInterval(tick);
	});
</script>

<Story name="coded, art params, authored children">
	<StoryGameTemplate skipLoadingScreen={true} action={async () => {}}>
		<StoryLocale lang="en">
			<App>
				<LayoutScene {scene} />
			</App>
		</StoryLocale>
	</StoryGameTemplate>
</Story>
