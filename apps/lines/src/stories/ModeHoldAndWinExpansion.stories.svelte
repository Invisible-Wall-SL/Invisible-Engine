<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'MODE_HOLD_AND_WIN/board expansion',
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
		HOLD_AND_WIN_TEST_FIXTURES,
		normalizeGameConfigDoc,
		primaryHoldAndWin,
		setPrimaryHoldAndWin,
	} from 'game-config';

	import Game from '../components/Game.svelte';
	import { setContext } from '../game/context';
	import { getActiveGameConfig } from '../game/gameConfig';
	import { playBet } from '../game/utils';
	import books from './data/hold_and_win_expansion_books';

	setContext();

	/**
	 * Board expansion (Phase 11b) on books the real mock and facade dealt for the `pots-expansion-*`
	 * test fixtures. Before `<Game>` mounts, the sample config gets that fixture's `holdAndWin` block
	 * (its `expansion`: 3 → 6 rows), so the respin board is built six rows tall with the bottom three
	 * locked. The coin and the unlock symbol are tagged on the sample art standing in for them.
	 */
	const ROLES: Record<string, string[]> = { S: ['coin'], W: ['jackpot'], H1: ['unlock'] };

	const config = getActiveGameConfig();

	const playExpansionBook = async (name: string, fixture: string) => {
		const block = primaryHoldAndWin(normalizeGameConfigDoc(HOLD_AND_WIN_TEST_FIXTURES[fixture])!);
		if (block) setPrimaryHoldAndWin(config, { ...block, meters: [] });
		const { symbols } = config;
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

{#snippet template(args: TemplateArgs)}
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

<!-- Unlock symbols: each one that lands plays where it stands, flies into the row it opens, and the
     locked cells fade under "ROW UNLOCKED · 4 ROWS"; the symbol leaves and the counter resets. -->
<Story
	name="unlock symbol"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playExpansionBook('unlockSymbol', 'pots-expansion-unlock'),
	})}
	{template}
/>

<!-- A full bottom row opens the next one; reaching 5 rows also pays the MAJOR row jackpot. -->
<Story
	name="full row"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playExpansionBook('fullRow', 'pots-expansion-fullrow'),
	})}
	{template}
/>

<!-- Enough held coins (8 / 12 / 16) open rows 4, 5 and 6; this fixture's unlocks do not reset the
     counter. -->
<Story
	name="coin count"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playExpansionBook('coinCount', 'pots-expansion-count'),
	})}
	{template}
/>

<!-- Every row opens, then the whole 6-row board fills and pays the full-board GRAND. -->
<Story
	name="expand to full"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playExpansionBook('expandFull', 'pots-expansion-fullrow'),
	})}
	{template}
/>
