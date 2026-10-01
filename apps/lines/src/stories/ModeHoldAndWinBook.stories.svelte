<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'MODE_HOLD_AND_WIN/book',
	});
</script>

<script lang="ts">
	import {
		StoryGameTemplate,
		StoryLocale,
		type TemplateArgs,
		templateArgs,
	} from 'components-storybook';

	import Game from '../components/Game.svelte';
	import { setContext } from '../game/context';
	import { getActiveGameConfig } from '../game/gameConfig';
	import { playBet } from '../game/utils';
	import books from './data/hold_and_win_books';

	setContext();

	/**
	 * The specials books (3–7) put each special on its own sample symbol. Tag them with the role it
	 * plays, so the labels read as in a real Hold and Win game (`+$4.00`, `×3`) instead of as money.
	 */
	const SPECIAL_ROLES: Record<string, string[]> = {
		H1: ['payer'],
		H2: ['coinMultiplier'],
		H3: ['collector'],
		H4: ['mystery'],
	};

	const playSpecialsBook = async (name: string) => {
		const { symbols } = getActiveGameConfig();
		for (const [symbol, roles] of Object.entries(SPECIAL_ROLES)) {
			if (symbols[symbol]) symbols[symbol] = { ...symbols[symbol], special_properties: roles };
		}
		const book = books.find((candidate) => candidate.name === name);
		if (book) await playBet({ ...book, state: book.events } as never);
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

<!-- A reset on every respin until the board fills up, then three dead respins and the end. -->
<Story
	name="chain"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: async () => {
			await playBet({ ...books[0], state: books[0].events } as never);
		},
	})}
	{template}
/>

<!-- The plain trigger: six coins stick, then the counter runs down. -->
<Story
	name="trigger"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: async () => {
			await playBet({ ...books[1], state: books[1].events } as never);
		},
	})}
	{template}
/>

<!-- A payer lands: it lights, then every coin's label counts up by its value. -->
<Story
	name="payer"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playSpecialsBook('payer'),
	})}
	{template}
/>

<!-- A multiplier lands: it lights, the coins count up ×3, then it becomes a coin. Later a mystery
     reveals a MINOR jackpot and a second multiplier applies. -->
<Story
	name="multiplier"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playSpecialsBook('multiplier'),
	})}
	{template}
/>

<!-- A collector lands: each coin pulses in turn and the collector's label climbs. -->
<Story
	name="collector"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playSpecialsBook('collector'),
	})}
	{template}
/>

<!-- A mystery opens into a MINI jackpot coin; the jackpot coins light at the end. -->
<Story
	name="mystery jackpot"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playSpecialsBook('mysteryJackpot'),
	})}
	{template}
/>

<!-- A mystery reveals a payer that was not active: "UNLOCKED: PAYER", then the payer applies. -->
<Story
	name="unlock payer"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playSpecialsBook('unlockPayer'),
	})}
	{template}
/>
