<script lang="ts">
	/**
	 * The CHARACTER SHEET of the selected character on `/characters`' Edit view
	 * (`docs/design/character-pipeline.md` §5, step C2b): the Character sheet card, and for a
	 * character that has a sheet (or whose empty cards the person opened) the View, Animation
	 * source, Draw, Actions and Online class cards. It asks for the facts of the rigs the sheet
	 * names (`rigRead.svelte.ts`) and hands the cards the tool's warnings, each on its card.
	 *
	 * It decides nothing: every edit is one of `$lib/characters/characterSheetEdit` or
	 * `characterSheetActions`, run through the page's `change`, and everything shown is read from
	 * `characterSheetCheck` and `characterSheetPage`. A character with no sheet gets only the first
	 * card, and nothing is written until a control is used.
	 */
	import { onMount, tick } from 'svelte';
	import { characterIssues } from '$lib/characters/characterEdit';
	import { sheetCardIssues, sheetWarnings } from '$lib/characters/characterSheetCheck';
	import { sheetOf } from '$lib/characters/characterSheetEdit';
	import {
		castOf,
		flipbookKeyFor,
		sheetCardId,
		type SheetCard,
	} from '$lib/characters/characterSheetPage';
	import { setSourceKind, sheetRigNames } from '$lib/characters/characterSheetSources';
	import type { SourceKind } from '$lib/characters/sheetCore';
	import { unfoldSection } from '$lib/ui/SectionCard.svelte';
	import type { GameConfigDoc, GameConfigIssue } from 'game-config';
	import type { RigRead } from '../rigRead.svelte';
	import type { WholeRead } from '../wholeRead.svelte';
	import ActionsCard from './ActionsCard.svelte';
	import DrawCard from './DrawCard.svelte';
	import OnlineCard from './OnlineCard.svelte';
	import SheetHome from './SheetHome.svelte';
	import SourceCard from './SourceCard.svelte';
	import ViewCard from './ViewCard.svelte';
	import type { SheetEdit } from './sheetEdit';

	interface Props {
		projectKey: string;
		/** The selected character, its index in `arcade.characters` and its component. */
		id: string;
		index: number;
		component: string;
		/** The config as the page holds it, and as it was loaded or last saved. */
		config: GameConfigDoc;
		stored: GameConfigDoc;
		/** The page's issues (the save's) and the view warnings only the page knows. */
		issues: GameConfigIssue[];
		screen: GameConfigIssue[];
		read: WholeRead;
		/** What the page has read of the project's rigs. */
		rigs: RigRead;
		readOnly: boolean;
		edit: SheetEdit;
		/** The card a link asked for (`?card=`): unfolded and scrolled to, once. */
		openCard?: SheetCard;
	}
	let {
		projectKey,
		id,
		index,
		component,
		config,
		stored,
		issues,
		screen,
		read,
		rigs,
		readOnly,
		edit,
		openCard,
	}: Props = $props();

	const sheet = $derived(sheetOf(config, id));
	// A link to a card of a character with no sheet opens the empty cards: it writes nothing.
	let byHand = $state(openCard !== undefined && openCard !== 'sheet');
	const shown = $derived(!!sheet || byHand);
	const cast = $derived(read.read ? castOf(read.components, config) : []);
	const mine = $derived(characterIssues(issues, index));
	// The rigs the sheet names are read as soon as it names them.
	$effect(() => rigs.want(sheetRigNames(sheet)));
	const warnings = $derived(
		sheetWarnings(sheet, {
			...(read.read && !read.rigsError ? { rigNames: read.rigs.map((rig) => rig.name) } : {}),
			rigs: rigs.facts,
		}),
	);
	const on = (card: 'source' | 'draw' | 'actions'): string[] =>
		warnings.filter((w) => w.on === card).map((w) => w.message);
	const flipbookKey = $derived(flipbookKeyFor(cast, config, id));
	const flipbookQuery = $derived(
		flipbookKey === undefined
			? undefined
			: new URLSearchParams({
					mode: 'characters',
					character: flipbookKey,
					...(projectKey ? { project: projectKey } : {}),
				}).toString(),
	);

	const goTo = (card: SheetCard): void =>
		document.getElementById(sheetCardId(card))?.scrollIntoView({ block: 'start' });
	/** A start tile of the Character sheet card: the cards open with the Animation source card on
	 *  that kind. Still images name nothing, so they are chosen at once; frame clips and a rig are
	 *  written when their prefix or rig is given. */
	let startKind = $state<SourceKind | undefined>(undefined);
	let startRefused = $state('');
	function start(kind: SourceKind): void {
		startRefused = (kind === 'stills' ? edit((d) => setSourceKind(d, id, kind).refused) : '') ?? '';
		if (startRefused) return;
		byHand = true;
		startKind = kind;
		unfoldSection('characters', sheetCardId('source'));
		void tick().then(() => goTo('source'));
	}

	if (openCard) unfoldSection('characters', sheetCardId(openCard));
	onMount(() => {
		if (openCard) goTo(openCard);
	});
</script>

<div class="sheet-cards" data-sheet-cards={id}>
	<SheetHome
		{id}
		{config}
		{stored}
		{cast}
		{read}
		bind:byHand
		rigs={rigs.facts}
		onStart={start}
		{readOnly}
		{edit}
	/>
	{#if startRefused}<p class="err" data-start-refused>{startRefused}</p>{/if}
	{#if shown}
		<ViewCard
			{id}
			{sheet}
			issues={[...sheetCardIssues(mine, index, 'view'), ...sheetCardIssues(screen, index, 'view')]}
			{readOnly}
			{edit}
		/>
		<SourceCard
			{id}
			{projectKey}
			{sheet}
			issues={sheetCardIssues(mine, index, 'source')}
			warnings={on('source')}
			{flipbookQuery}
			{read}
			{rigs}
			{startKind}
			onDraw={() => goTo('draw')}
			{readOnly}
			{edit}
		/>
		<DrawCard
			{id}
			{sheet}
			issues={sheetCardIssues(mine, index, 'draw')}
			warnings={on('draw')}
			rigs={rigs.facts}
			{readOnly}
			{edit}
		/>
		<ActionsCard
			{id}
			{sheet}
			issues={sheetCardIssues(mine, index, 'actions')}
			warnings={on('actions')}
			clipIds={read.clipIds}
			clips={read.clipById}
			{read}
			{rigs}
			onDraw={() => goTo('draw')}
			{readOnly}
			{edit}
		/>
		<OnlineCard {id} {component} {config} {issues} {projectKey} {readOnly} {edit} />
	{/if}
</div>

<style>
	.sheet-cards {
		margin-bottom: 28px;
	}
	:global(:where(.sheet-cards) :where(.fields)) {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 10px 14px;
		align-items: end;
	}
	:global(:where(.sheet-cards) :where(label)) {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: #b9b9c4;
	}
	:global(:where(.sheet-cards) :where(label.check)) {
		flex-direction: row;
		align-items: center;
		gap: 6px;
	}
	:global(:where(.sheet-cards) :where(.inline)) {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	:global(:where(.sheet-cards) :where(.inline input)),
	:global(:where(.sheet-cards) :where(.inline select)) {
		flex: 1;
		min-width: 0;
	}
	/* Zero specificity, so Flipbook's grid and preview keep their own controls' look. */
	:global(:where(.sheet-cards) :where(input, select, button.btn)) {
		font: inherit;
		font-size: 12px;
		background: #14141a;
		color: #e8e8ee;
		border: 1px solid #2a2a35;
		border-radius: 6px;
		padding: 5px 8px;
	}
	:global(:where(.sheet-cards) :where(button.btn)) {
		cursor: pointer;
	}
	:global(:where(.sheet-cards) :where(button.btn:disabled)) {
		opacity: 0.5;
		cursor: default;
	}
	:global(:where(.sheet-cards) :where(h3)) {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		margin: 14px 0 8px;
		font-size: 12px;
		color: #b9b9c4;
	}
	:global(:where(.sheet-cards) :where(.btns)) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-top: 10px;
	}
	:global(:where(.sheet-cards) :where(.status)),
	:global(:where(.sheet-cards) :where(.note)) {
		margin: 8px 0;
		font-size: 12px;
		line-height: 1.6;
		color: #8b8b98;
	}
	:global(:where(.sheet-cards) :where(.note)) {
		color: #d3b483;
	}
	:global(:where(.sheet-cards) :where(.err)) {
		margin: 8px 0;
		color: #ff9a9a;
		font-size: 12px;
	}
	:global(:where(.sheet-cards) :where(.maker)) {
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #161b22;
		color: #cbd5e1;
		font-size: 11px;
		padding: 2px 8px;
		text-decoration: none;
	}
	:global(:where(.sheet-cards) :where(.facts)) {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 4px 12px;
		margin: 10px 0 0;
		font-size: 12px;
	}
	:global(:where(.sheet-cards) :where(.facts dt)) {
		color: #8b8b98;
	}
	:global(:where(.sheet-cards) :where(.facts dd)) {
		margin: 0;
		color: #cbd5e1;
	}
	:global(:where(.sheet-cards) :where(table.rows)) {
		border-collapse: collapse;
		font-size: 12px;
	}
	:global(:where(.sheet-cards) :where(table.rows th)),
	:global(:where(.sheet-cards) :where(table.rows td)) {
		text-align: left;
		padding: 4px 8px 4px 0;
		vertical-align: middle;
	}
	:global(:where(.sheet-cards) :where(table.rows th)) {
		color: #8b8b98;
		font-weight: 500;
		white-space: nowrap;
	}
	:global(:where(.sheet-cards) :where(.sheet-issues)) {
		margin: 10px 0 0;
		padding: 8px 12px 8px 28px;
		border: 1px solid #3a2a2a;
		border-radius: 8px;
		background: #171113;
		font-size: 12px;
		line-height: 1.6;
	}
	:global(:where(.sheet-cards) :where(.sheet-issues .error)) {
		color: #ff9a9a;
	}
	:global(:where(.sheet-cards) :where(.sheet-issues .warning)) {
		color: #d3b483;
	}
	:global(:where(.sheet-cards) :where(.pill)) {
		font-size: 11px;
		font-weight: 400;
		padding: 1px 8px;
		border-radius: 999px;
		border: 1px solid #2a2a35;
		color: #b9b9c4;
	}
	:global(:where(.sheet-cards) :where(.pill.ok)) {
		border-color: #1f6f54;
		color: #86efac;
	}
	:global(:where(.sheet-cards) :where(.pill.warn)) {
		border-color: #5a4520;
		color: #d3b483;
	}
	:global(:where(.sheet-cards) :where(code)) {
		font-size: 11px;
		color: #c9d1dc;
	}
</style>
