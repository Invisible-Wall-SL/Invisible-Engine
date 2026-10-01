<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'MODE_HOLD_AND_WIN/grand',
	});
</script>

<script lang="ts">
	import {
		StoryGameTemplate,
		StoryLocale,
		type TemplateArgs,
		templateArgs,
	} from 'components-storybook';
	import { HOLD_AND_WIN_PRESETS, normalizeGameConfigDoc } from 'game-config';

	import Game from '../components/Game.svelte';
	import { setContext } from '../game/context';
	import { getActiveGameConfig } from '../game/gameConfig';
	import { playBet } from '../game/utils';
	import books from './data/hold_and_win_grand_hotfire_books';

	setContext();

	/**
	 * Grand (the CLASSIC preset, Phase 4 step 10): column letters, a boost that doubles a jackpot coin
	 * and the base-game instant collect, from books recorded off the classic mock. Before `<Game>`
	 * mounts, the sample config gets the classic preset's `holdAndWin` block (letters "GRAND", the
	 * jackpot table); the boost star (BOOST → H2) is tagged `coinMultiplier` for each book only.
	 */
	const ROLES: Record<string, string[]> = { H2: ['coinMultiplier'] };

	const config = getActiveGameConfig();
	const block = normalizeGameConfigDoc(HOLD_AND_WIN_PRESETS.classic)?.holdAndWin;
	if (block) config.holdAndWin = block;

	const playGrandBook = async (name: string) => {
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

<!-- A column already full at entry: "G" lights, its coins fly into the Total Win bar, which counts
     up, and the column empties; a later respin fills "R" the same way. -->
<Story
	name="letter"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playGrandBook('classicLetter'),
	})}
	{template}
/>

<!-- Respin 1 fills every column: G-R-A-N-D light one after another, each column sweeping into the
     bar, then the GRAND JACKPOT celebration; the end adds the GRAND to the bar. -->
<Story
	name="letters"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playGrandBook('classicLetters'),
	})}
	{template}
/>

<!-- A ×2 boost star lands: every coin counts up, and the MINI coin steps to "MINI ×2" and lights. -->
<Story
	name="multiplier jackpot"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playGrandBook('classicMultiplierJackpot'),
	})}
	{template}
/>

<!-- Base game: a boost star beside two coins — the coins fly into the star, "INSTANT WIN ×2 …",
     then the round's own win presentation. -->
<Story
	name="instant collect"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playGrandBook('classicInstant'),
	})}
	{template}
/>
