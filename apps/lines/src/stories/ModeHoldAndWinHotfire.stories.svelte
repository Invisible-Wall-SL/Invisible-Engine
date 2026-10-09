<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'MODE_HOLD_AND_WIN/hotfire',
	});
</script>

<script lang="ts">
	import {
		StoryGameTemplate,
		StoryLocale,
		type TemplateArgs,
		templateArgs,
	} from 'components-storybook';
	import {
		HOLD_AND_WIN_PRESETS,
		normalizeGameConfigDoc,
		primaryHoldAndWin,
		setPrimaryHoldAndWin,
	} from 'game-config';

	import Game from '../components/Game.svelte';
	import { setContext } from '../game/context';
	import { getActiveGameConfig } from '../game/gameConfig';
	import { playBet } from '../game/utils';
	import books from './data/hold_and_win_grand_hotfire_books';

	setContext();

	/**
	 * Super Hotfire Diamonds (the COLLECTOR preset, Phase 4 step 10): the pre-feature wheel and the
	 * collector streak, from books recorded off the collector mock. Before `<Game>` mounts, the sample
	 * config gets the collector preset's `holdAndWin` block (its wheel prizes) and the board follows
	 * the server's 3×3 window, as a live game does (`__IE_SERVER_CONFIG__`); the collector diamond
	 * (COLLECT → H4) is tagged `collector` for each book only.
	 */
	const ROLES: Record<string, string[]> = { H4: ['collector'] };

	const config = getActiveGameConfig();
	const block = primaryHoldAndWin(normalizeGameConfigDoc(HOLD_AND_WIN_PRESETS.collector)!);
	if (block) setPrimaryHoldAndWin(config, block);
	(
		globalThis as { __IE_SERVER_CONFIG__?: { window: { reels: number; rows: number } } }
	).__IE_SERVER_CONFIG__ = { window: { reels: 3, rows: 3 } };

	const playHotfireBook = async (name: string) => {
		const { symbols } = getActiveGameConfig();
		const original = Object.fromEntries(
			Object.keys(ROLES).map((symbol) => [symbol, symbols[symbol]]),
		);
		for (const [symbol, roles] of Object.entries(ROLES)) {
			if (symbols[symbol]) symbols[symbol] = { ...symbols[symbol], special_properties: roles };
		}
		try {
			const book = books.find((candidate) => candidate.name === name);
			if (book) await playBet({ ...book, state: book.events } as never);
		} finally {
			for (const [symbol, entry] of Object.entries(original)) if (entry) symbols[symbol] = entry;
		}
	};
</script>

{#snippet template(args: TemplateArgs<any>)}
	<StoryGameTemplate
		skipLoadingScreen={args.skipLoadingScreen}
		action={async () => {
			await args.action?.(args.data);
		}}
	>
		<StoryLocale lang="en">
			<Game />
		</StoryLocale>
	</StoryGameTemplate>
{/snippet}

<!-- The wheel spins onto COIN BOOST ×2, the held coins count up, fly into the collector and clear;
     two later respins land coins that fly in the same way. -->
<Story
	name="trigger"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playHotfireBook('collectorTrigger'),
	})}
	{template}
/>

<!-- One new coin every respin: each flies into the (double) collector, which climbs on arrival,
     and clears — the streak. -->
<Story
	name="chain"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playHotfireBook('collectorChain'),
	})}
	{template}
/>

<!-- The wheel lands "+1 COLLECT": "DOUBLE COLLECT", and the counter reads DOUBLE COLLECTOR. -->
<Story
	name="wheel extra collect"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playHotfireBook('collectorWheelExtraCollect'),
	})}
	{template}
/>

<!-- The wheel lands "COIN BOOST ×2": the held coins count up before the collector takes them. -->
<Story
	name="wheel coin boost"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playHotfireBook('collectorWheelCoinBoost'),
	})}
	{template}
/>

<!-- The wheel lands "GRAND": the GRAND JACKPOT celebration follows, and the end adds it to the bar. -->
<Story
	name="wheel jackpot GRAND"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playHotfireBook('collectorWheelJackpotGrand'),
	})}
	{template}
/>
