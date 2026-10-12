<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'MODE_HOLD_AND_WIN/pots',
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
	import books from './data/hold_and_win_pots_books';

	setContext();

	/**
	 * The pots, Lucky Spin, full board and jackpot books (Phase 4 steps 6–8), recorded from the pots
	 * mock. Before `<Game>` mounts, the sample config gets the pots preset's `holdAndWin` block with
	 * its meters' symbols renamed onto the sample art, and the boot meter levels the facade would
	 * publish (`__IE_HOLD_AND_WIN_METERS__`) — red one special short of full, as the forced `meter:red`
	 * book expects.
	 */
	const RENAMED: Record<string, string> = { BOOST: 'H1', MULTI: 'H2', COLLECT: 'H3' };
	const ROLES: Record<string, string[]> = {
		H1: ['payer', 'meterSpecial'],
		H2: ['coinMultiplier', 'meterSpecial'],
		H3: ['collector', 'meterSpecial'],
		H4: ['mystery'],
	};

	const config = getActiveGameConfig();
	const block = primaryHoldAndWin(normalizeGameConfigDoc(HOLD_AND_WIN_PRESETS.pots)!);
	if (block) {
		setPrimaryHoldAndWin(config, {
			...block,
			meters: (block.meters ?? []).map((meter) => ({
				...meter,
				symbol: RENAMED[meter.symbol] ?? meter.symbol,
			})),
		});
	}
	(
		globalThis as { __IE_HOLD_AND_WIN_METERS__?: { id: string; level: number; max: number }[] }
	).__IE_HOLD_AND_WIN_METERS__ = [
		{ id: 'red', level: 10, max: 12 },
		{ id: 'blue', level: 0, max: 12 },
		{ id: 'green', level: 0, max: 12 },
	];

	/** Tags the specials' roles for this book only, and puts the symbols back afterwards. */
	const playPotsBook = async (name: string) => {
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

<!-- Two specials fly into the red pot, which ticks 10 → 11 → 12 and pulses full; three fly into the
     blue pot. The full red pot then starts the feature: it drains to empty, "PAYER ACTIVE", and the
     active modifiers show under the counter. -->
<Story
	name="meter red"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playPotsBook('meterRed'),
	})}
	{template}
/>

<!-- "LUCKY SPIN", then the reveal anticipates on every reel with the spin button inert, then the
     feature; the end counts the Total Win bar up coin by coin. -->
<Story
	name="lucky spin"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playPotsBook('lucky'),
	})}
	{template}
/>

<!-- The board fills: "GRAND JACKPOT" celebration, then the tally lands the bar on the feature total
     (the GRAND added once the last coin is in). -->
<Story
	name="full board"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playPotsBook('fullBoard'),
	})}
	{template}
/>

<!-- A MINI jackpot coin: a small highlight as the tally names it, then the count-up. -->
<Story
	name="jackpot MINI"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playPotsBook('jackpotMini'),
	})}
	{template}
/>
