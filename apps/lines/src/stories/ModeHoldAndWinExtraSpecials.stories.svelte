<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'MODE_HOLD_AND_WIN/extra specials',
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
	import books from './data/hold_and_win_extra_specials_books';

	setContext();

	/**
	 * The Phase 11a specials — add-respins and upgrade — on hand-written books shaped like the facade's
	 * output for the `pots-extra` test fixture. Before `<Game>` mounts, the sample config gets that
	 * fixture's `holdAndWin` block (its jackpot ladder, its specials); each book tags the sample art
	 * standing in for the specials with their roles, so the labels read `+2` and `+$1.00`.
	 */
	const ROLES: Record<string, string[]> = {
		H1: ['addRespins'],
		H2: ['upgrade'],
	};

	const config = getActiveGameConfig();
	const block = primaryHoldAndWin(
		normalizeGameConfigDoc(HOLD_AND_WIN_TEST_FIXTURES['pots-extra'])!,
	);
	if (block) setPrimaryHoldAndWin(config, { ...block, meters: [] });

	/** Tags the specials' roles for this book only, and puts the symbols back afterwards. */
	const playExtraBook = async (name: string) => {
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

<!-- A "+2" lands: it plays where it stands under a "+2 RESPINS" toast, its "+2" flies into the
     counter, which steps 3 → 5 and pulses on the arrival, and the special leaves the board. The
     respin then counts down from 5. A "+1" later does the same. -->
<Story
	name="add respins"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playExtraBook('addRespins'),
	})}
	{template}
/>

<!-- Four upgrades: one with no jackpot to step (it plays and nothing else), one beaming the two cash
     coins around it (+$1.00 each), one stepping the MINI coin to MINOR under "MINOR UPGRADE", and one
     raising every cash coin. -->
<Story
	name="upgrade"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: () => playExtraBook('upgrade'),
	})}
	{template}
/>
