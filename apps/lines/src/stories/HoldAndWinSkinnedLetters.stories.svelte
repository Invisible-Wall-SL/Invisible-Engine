<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'MODE_HOLD_AND_WIN/skinned letters strip (12c)',
	});
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	import { App, resolveAnchor } from 'pixi-svelte';
	import { StoryLocale, StoryGameTemplate } from 'components-storybook';
	import { isComponentMounted, LayoutScene } from 'engine-layout/svelte';
	import {
		LETTERS_STRIP_DEF,
		LETTERS_STRIP_MOUNT,
		LETTER_TILE_DEF,
		registerBoundComponents,
		registerComponents,
		registerComponentSignals,
		registerComponentValues,
		type ComponentDef,
		type LayoutNode,
		type Scene,
	} from 'engine-layout';
	import { valueSource } from 'engine-game';
	import {
		HOLD_AND_WIN_PRESETS,
		normalizeGameConfigDoc,
		primaryHoldAndWin,
		setPrimaryHoldAndWin,
	} from 'game-config';
	import { scopeOf } from 'utils-event-emitter';

	import LetterTilePart from '../components/LetterTilePart.svelte';
	import LettersStrip from '../components/LettersStrip.svelte';
	import { setContext } from '../game/context';
	import { eventEmitter } from '../game/eventEmitter';
	import { featureComponentSignals } from '../game/featureSignals';
	import { getActiveGameConfig } from '../game/gameConfig';
	import { lightLetter, stateLetters } from '../game/holdAndWinLetters.svelte';

	setContext();

	/**
	 * Phase 12c — the Letters Strip's `tile`, on the classic preset's "GRAND" (one story each):
	 * - the built-in strip as it ships (`tile` blank): the coded letters;
	 * - a strip copy (`myStrip`) drawing each letter as the built-in Letter Tile;
	 * - …as a tile with a "LIT" node gated on **Letter lit**, which must show on the lit letter only;
	 * - …naming a component that is not registered, or the strip itself: the coded letters again.
	 * `window.__light(reel)` lights a letter as the column-complete beat does; `window.__probe()` lists
	 * the strip's texts (shown, fill, on-screen scale) and whether the coded row would step aside.
	 */
	const block = primaryHoldAndWin(normalizeGameConfigDoc(HOLD_AND_WIN_PRESETS.classic)!);
	if (block) setPrimaryHoldAndWin(getActiveGameConfig(), block);

	const tilePart = LETTER_TILE_DEF.root.children[0] as LayoutNode & { kind: 'container' };
	const gatedTile: ComponentDef = {
		...LETTER_TILE_DEF,
		id: 'gatedTile',
		root: {
			...LETTER_TILE_DEF.root,
			children: [
				{
					...tilePart,
					children: [
						...tilePart.children,
						{
							id: 'gatedTile-gate',
							kind: 'text',
							x: 0,
							y: -45,
							anchor: { x: 0.5, y: 0.5 },
							text: 'LIT',
							style: { fontSize: 18, fill: 0x33ff66 },
							hiddenUntilSignal: 'letterLit',
						},
					],
				},
			],
		},
	};
	registerComponents({
		lettersStrip: LETTERS_STRIP_DEF,
		myStrip: { ...LETTERS_STRIP_DEF, id: 'myStrip' },
		letterTile: LETTER_TILE_DEF,
		gatedTile,
	});
	registerBoundComponents({ LettersStrip, LetterTilePart });
	registerComponentSignals(featureComponentSignals(eventEmitter, true));
	registerComponentValues(
		Object.fromEntries(
			[0, 1, 2, 3, 4].map((reel) => [
				`letter.${reel}.lit`,
				valueSource(() => (stateLetters.lit.includes(reel) ? 1 : 0)),
			]),
		),
	);

	const sceneOf = (componentId: string, tile?: string): Scene => ({
		id: componentId,
		name: componentId,
		nodes: [
			{
				id: 'strip',
				kind: 'componentInstance',
				componentId,
				x: 600,
				y: 300,
				...(tile ? { params: { tile } } : {}),
			},
		],
	});

	type Node = NonNullable<ReturnType<typeof resolveAnchor>>;
	type TextLike = Node & { text: string; style: { fill: unknown } };
	const isText = (node: Node): node is TextLike => 'text' in node && typeof node.text === 'string';
	const shown = (node: Node | null): boolean => {
		for (let at = node; at; at = at.parent) if (!at.visible || at.alpha <= 0) return false;
		return true;
	};
	const textsUnder = (node: Node): TextLike[] =>
		node.children.flatMap((child: Node) => [
			...(isText(child) ? [child] : []),
			...textsUnder(child),
		]);

	onMount(() => {
		Object.assign(window, {
			__light: (reel: number) => {
				lightLetter(reel);
				eventEmitter.broadcast({
					type: 'respinColumnComplete',
					reel,
					letter: 'GRAND'[reel],
					newlyLit: true,
					cleared: false,
					amount: 0,
					cells: [],
					scope: scopeOf('reel', reel),
				});
			},
			__probe: () => {
				const strip = resolveAnchor('strip');
				return {
					counted: isComponentMounted(LETTERS_STRIP_MOUNT),
					texts: strip
						? textsUnder(strip).map((text) => ({
								text: text.text,
								shown: shown(text),
								fill: text.style.fill,
								scale: Math.round(text.worldTransform.a * 100) / 100,
								x: Math.round(text.getGlobalPosition().x),
							}))
						: null,
				};
			},
		});
	});
</script>

{#snippet stage(componentId: string, tile?: string)}
	<StoryGameTemplate skipLoadingScreen={true} action={async () => {}}>
		<StoryLocale lang="en">
			<App>
				<LayoutScene scene={sceneOf(componentId, tile)} />
			</App>
		</StoryLocale>
	</StoryGameTemplate>
{/snippet}

<Story name="as it ships (coded letters)">
	{@render stage('lettersStrip')}
</Story>

<Story name="a copy drawing the Letter Tile">
	{@render stage('myStrip', 'letterTile')}
</Story>

<Story name="a tile gated on Letter lit">
	{@render stage('myStrip', 'gatedTile')}
</Story>

<Story name="a missing tile (coded letters)">
	{@render stage('myStrip', 'noSuchTile')}
</Story>

<Story name="a tile naming the strip (coded letters)">
	{@render stage('myStrip', 'myStrip')}
</Story>
