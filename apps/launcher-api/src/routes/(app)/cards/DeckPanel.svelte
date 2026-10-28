<script lang="ts">
	import {
		AI_DIFFICULTIES,
		AI_WEIGHT_DEFAULTS,
		type AiDifficulty,
		type CardDef,
	} from 'engine-mechanics';
	import { resolveCard, type GameConfigDoc, type GameConfigIssue } from 'game-config';
	import type { ComponentDef } from 'engine-layout';
	import { askConfirm } from '$lib/dialogs.svelte';
	import * as edit from '$lib/cards/cardEdit';
	import CardFrameView from './CardFrameView.svelte';

	/**
	 * The decks of a card game (`docs/design/card-games.md` §8.2): the player decks and the AI decks,
	 * each `{ card, count }` entries checked against `deckSize` and `maxCopies`, its cost curve, and,
	 * for an AI deck, its difficulty and weight overrides. Edits go through the page's `change`.
	 */
	interface Props {
		doc: GameConfigDoc;
		snapshot: GameConfigDoc;
		issues: readonly GameConfigIssue[];
		readOnly: boolean;
		change: (run: (d: GameConfigDoc) => void) => void;
		frameOf: (card: CardDef) => ComponentDef | undefined;
		components: ReadonlyMap<string, ComponentDef>;
	}
	let { doc, snapshot, issues, readOnly, change, frameOf, components }: Props = $props();

	const game = $derived(resolveCard(snapshot));
	const decks = $derived(game.decks);
	let selectedId = $state<string | null>(null);
	$effect(() => {
		if (!decks.some((d) => d.id === selectedId)) selectedId = decks[0]?.id ?? null;
	});
	const index = $derived(decks.findIndex((d) => d.id === selectedId));
	const deck = $derived(index >= 0 ? decks[index] : undefined);
	const mine = $derived(index >= 0 ? edit.deckIssues(issues, index) : []);
	const size = $derived(deck ? edit.deckSizeOf(deck) : 0);
	const curve = $derived(deck ? edit.costCurve(deck, game.library) : []);
	const peak = $derived(Math.max(1, ...curve));
	const playable = $derived(game.library.filter((c) => !c.token));
	/** Entries the pool cannot show: a token, or a card not in the library. Listed to be removed. */
	const strays = $derived(
		(deck?.cards ?? [])
			.filter((e) => !playable.some((c) => c.id === e.card))
			.reduce<{ card: string; count: number }[]>((out, e) => {
				const seen = out.find((x) => x.card === e.card);
				if (seen) seen.count += e.count;
				else out.push({ ...e });
				return out;
			}, []),
	);

	let renameText = $state('');
	let renameError = $state('');
	const deckId = $derived(deck?.id);
	$effect(() => {
		renameText = deckId ?? '';
		renameError = '';
	});
	const did = () => deck?.id ?? '';

	function add(side: 'player' | 'ai'): void {
		change((d) => {
			const id = edit.addDeck(d, side);
			if (id) selectedId = id;
		});
	}
	async function remove(): Promise<void> {
		if (!deck) return;
		const ok = await askConfirm({
			title: `Delete the deck "${deck.id}"?`,
			message: 'Its cards stay in the library. Nothing is saved until you press Save.',
			confirmLabel: 'Delete',
			danger: true,
		});
		if (ok) change((d) => edit.removeDeck(d, did()));
	}
	function rename(): void {
		const from = did();
		let refused: string | null = null;
		change((d) => (refused = edit.renameDeck(d, from, renameText)));
		if (refused) renameError = refused;
		else selectedId = renameText.trim();
	}
	const hasErrors = (i: number) => edit.deckIssues(issues, i).some((x) => x.severity === 'error');
	const presetWeight = (difficulty: AiDifficulty, key: (typeof edit.AI_WEIGHT_KEYS)[number]) =>
		AI_DIFFICULTIES[difficulty].weights[key] ?? AI_WEIGHT_DEFAULTS[key];
	const liveCount = (card: string) => {
		const live = doc.card?.decks?.find((d) => d.id === did());
		return live ? edit.deckCount(live, card) : 0;
	};
</script>

<div class="split">
	<aside class="list">
		{#each ['player', 'ai'] as const as side (side)}
			<h2>{side === 'player' ? 'Player decks' : 'AI decks'}</h2>
			{#each decks.map((d, i) => ({ d, i })).filter((x) => x.d.side === side) as { d, i } (d.id)}
				<button
					type="button"
					class="row"
					class:on={d.id === selectedId}
					onclick={() => (selectedId = d.id)}
				>
					<span class="id">{d.name}</span>
					<span class="meta"
						>{d.id} · {edit.deckSizeOf(d)} / {game.rules.deckSize}{d.ai
							? ` · ${d.ai.difficulty}`
							: ''}</span
					>
					{#if hasErrors(i)}<span class="dot" title="Has errors">●</span>{/if}
				</button>
			{:else}
				<p class="hint">None yet.</p>
			{/each}
			<button type="button" onclick={() => add(side)} disabled={readOnly}
				>＋ {side === 'player' ? 'Player deck' : 'AI deck'}</button
			>
		{/each}
	</aside>

	<main>
		{#if !deck}
			<p class="hint">Add a player deck and an AI deck: a card game needs one of each.</p>
		{:else}
			{#if mine.length}
				<ul class="issues">
					{#each mine as issue (issue.path + issue.message)}<li class={issue.severity}>
							{issue.message}
						</li>{/each}
				</ul>
			{/if}
			<section>
				<h2>Deck</h2>
				<div class="grid">
					<label
						>Id
						<span class="inline">
							<input bind:value={renameText} disabled={readOnly} spellcheck="false" />
							<button
								type="button"
								onclick={rename}
								disabled={readOnly || renameText.trim() === deck.id}>Rename</button
							>
						</span>
						{#if renameError}<span class="err">{renameError}</span>{/if}
					</label>
					<label
						>Name
						<input
							value={deck.name}
							disabled={readOnly}
							onchange={(e) => change((d) => edit.setDeckName(d, did(), e.currentTarget.value))}
						/>
					</label>
					<div class="size" class:bad={size !== game.rules.deckSize}>
						<span class="big">{size} / {game.rules.deckSize}</span> cards, at most {game.rules
							.maxCopies} of each
					</div>
				</div>
				<div class="actions">
					<button
						type="button"
						disabled={readOnly}
						onclick={() =>
							change((d) => {
								const id = edit.duplicateDeck(d, did());
								if (id) selectedId = id;
							})}>Duplicate</button
					>
					<button type="button" class="danger" onclick={remove} disabled={readOnly}>Delete</button>
				</div>
			</section>

			<section>
				<h2>Cost curve</h2>
				<div class="curve" role="img" aria-label="Cards per cost">
					{#each curve as n, cost (cost)}
						<div class="bar">
							<span class="n">{n || ''}</span>
							<span class="fill" style="height:{(n / peak) * 80}px"></span>
							<span class="cost">{cost === 7 ? '7+' : cost}</span>
						</div>
					{/each}
				</div>
			</section>

			{#if deck.side === 'ai'}
				{@const difficulty = deck.ai?.difficulty ?? 'normal'}
				<section>
					<h2>The AI</h2>
					<div class="grid">
						<label
							>Difficulty
							<select
								value={difficulty}
								disabled={readOnly}
								onchange={(e) =>
									change((d) =>
										edit.setDeckDifficulty(d, did(), e.currentTarget.value as AiDifficulty),
									)}
							>
								<option value="easy">easy</option>
								<option value="normal">normal</option>
								<option value="hard">hard</option>
							</select>
						</label>
						{#each edit.AI_WEIGHT_KEYS as key (key)}
							<label
								>Weight: {key}
								<input
									type="number"
									step="any"
									placeholder={String(presetWeight(difficulty, key))}
									value={deck.ai?.weights?.[key] ?? ''}
									disabled={readOnly}
									onchange={(e) =>
										change((d) => edit.setDeckWeight(d, did(), key, e.currentTarget.value))}
								/>
							</label>
						{/each}
					</div>
					<p class="hint">A blank weight is the difficulty's own. Weights give a deck its style.</p>
				</section>
			{/if}

			{#if strays.length}
				<section>
					<h2>Entries no deck should hold</h2>
					{#each strays as e (e.card)}
						<div class="stray">
							{e.count} × <code>{e.card}</code>
							{game.library.some((c) => c.id === e.card) ? '(a token)' : '(not in the library)'}
							<button
								type="button"
								disabled={readOnly}
								onclick={() => change((d) => edit.setDeckCount(d, did(), e.card, 0))}>Remove</button
							>
						</div>
					{/each}
				</section>
			{/if}

			<section>
				<h2>Cards</h2>
				<div class="pool">
					{#each playable as c (c.id)}
						{@const n = edit.deckCount(deck, c.id)}
						<div class="entry" class:in={n > 0}>
							<CardFrameView
								frame={frameOf(c)}
								values={edit.frameValues(c, game.library)}
								{components}
								size={90}
							/>
							<div class="stepper">
								<button
									type="button"
									disabled={readOnly || n === 0}
									onclick={() =>
										change((d) => edit.setDeckCount(d, did(), c.id, liveCount(c.id) - 1))}>−</button
								>
								<span>{n}</span>
								<button
									type="button"
									disabled={readOnly || n >= game.rules.maxCopies}
									onclick={() =>
										change((d) => edit.setDeckCount(d, did(), c.id, liveCount(c.id) + 1))}
									>＋</button
								>
							</div>
						</div>
					{:else}
						<p class="hint">The library has no cards a deck can hold (tokens are summoned only).</p>
					{/each}
				</div>
			</section>
		{/if}
	</main>
</div>

<style>
	.split {
		display: grid;
		grid-template-columns: 240px 1fr;
		gap: 24px;
		align-items: start;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.list h2:not(:first-child) {
		margin-top: 16px;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr auto;
		text-align: left;
	}
	.row.on {
		border-color: #7ee0c0;
	}
	.row .id {
		font-weight: 600;
		font-size: 13px;
	}
	.row .meta {
		grid-column: 1;
		font-size: 11px;
		color: #8b8b98;
	}
	.row .dot {
		grid-row: 1 / span 2;
		grid-column: 2;
		color: #ff7a7a;
		align-self: center;
	}
	section {
		margin-bottom: 24px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: 10px 14px;
		align-items: end;
	}
	.inline {
		display: flex;
		gap: 6px;
	}
	.inline input {
		flex: 1;
		min-width: 0;
	}
	.actions {
		display: flex;
		gap: 8px;
		margin-top: 10px;
	}
	.size {
		font-size: 12px;
		color: #b9b9c4;
	}
	.size .big {
		font-size: 18px;
		font-weight: 700;
		color: #7ee0c0;
	}
	.size.bad .big {
		color: #ff9a9a;
	}
	.curve {
		display: flex;
		gap: 8px;
		align-items: flex-end;
		height: 120px;
	}
	.bar {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-end;
		width: 28px;
		height: 100%;
		font-size: 11px;
		color: #8b8b98;
	}
	.fill {
		width: 100%;
		background: #6ea8ff;
		border-radius: 3px 3px 0 0;
	}
	.cost {
		margin-top: 4px;
	}
	.pool {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	.entry {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 6px;
		border: 1px solid #23232c;
		border-radius: 8px;
		opacity: 0.55;
	}
	.entry.in {
		opacity: 1;
		border-color: #2a8a69;
	}
	.stray {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 12px;
		margin-bottom: 6px;
	}
	.stepper {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
	}
</style>
