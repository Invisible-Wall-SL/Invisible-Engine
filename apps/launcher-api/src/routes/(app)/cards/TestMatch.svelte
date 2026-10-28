<script lang="ts">
	import { onDestroy } from 'svelte';
	import type {
		Action,
		AiDifficulty,
		CardEvent,
		CardInstance,
		Match,
		Side,
		TargetRef,
	} from 'engine-mechanics';
	import { resolveCard, type GameConfigDoc } from 'game-config';
	import {
		addToTotals,
		createTestMatch,
		playAiMatch,
		recordFor,
		seatFor,
		type RunTotals,
		type SeatSetup,
	} from '$lib/cards/testMatch';

	/**
	 * The test match (`docs/design/card-games.md` §8.3), with placeholder table art: two decks and
	 * their difficulties, then watch the AI play both sides or play side A yourself. "Run 100" plays
	 * AI-vs-AI on seeds 1 … 100. Every match runs `cards.js` and `cardAi.js` through
	 * `$lib/cards/testMatch`, on the config as it is on the page (saved or not).
	 */
	let { config, canPlay }: { config: GameConfigDoc; canPlay: boolean } = $props();

	const game = $derived(resolveCard(config));
	const decks = $derived(game.decks);
	const firstOf = (side: 'player' | 'ai') => decks.find((d) => d.side === side) ?? decks[0];

	let deckA = $state(firstOf('player')?.id ?? '');
	let deckB = $state(firstOf('ai')?.id ?? '');
	let diffA = $state<AiDifficulty>(firstOf('player')?.ai?.difficulty ?? 'normal');
	let diffB = $state<AiDifficulty>(firstOf('ai')?.ai?.difficulty ?? 'normal');
	let seed = $state('1');
	let mode = $state<'watch' | 'play'>('watch');
	let speed = $state(300);

	const seats = (): [SeatSetup, SeatSetup] => {
		const a = decks.find((d) => d.id === deckA);
		const b = decks.find((d) => d.id === deckB);
		if (!a || !b) throw new Error('Pick two decks.');
		return [
			{ ...seatFor(a), difficulty: diffA },
			{ ...seatFor(b), difficulty: diffB },
		];
	};

	let run = $state.raw<ReturnType<typeof createTestMatch> | null>(null);
	let match = $state.raw<Match | null>(null);
	let log = $state<string[]>([]);
	let problem = $state('');
	let timer: ReturnType<typeof setTimeout> | null = null;
	let copied = $state(false);

	const stop = () => {
		if (timer) clearTimeout(timer);
		timer = null;
	};
	onDestroy(stop);

	const nameOf = (m: Match, uid: number): string => {
		for (const p of m.players)
			for (const zone of [p.hand, p.board, p.deck, p.discard]) {
				const c = zone.find((x) => x.uid === uid);
				if (c) return m.library[c.cardId]?.name ?? c.cardId;
			}
		return `#${uid}`;
	};
	const targetName = (m: Match, t: TargetRef): string =>
		'hero' in t ? (t.hero === 0 ? 'hero A' : 'hero B') : nameOf(m, t.unit);
	const sideName = (s: Side) => (s === 0 ? 'A' : 'B');

	function describe(m: Match, e: CardEvent): string | null {
		switch (e.type) {
			case 'turnStarted':
				return `— Turn ${e.turn}: ${sideName(e.player)} —`;
			case 'played':
				return `${sideName(e.player)} plays ${nameOf(m, e.uid)}`;
			case 'attacked':
				return `${nameOf(m, e.attacker)} attacks ${targetName(m, e.target)}`;
			case 'damaged':
				return `${targetName(m, e.target)} takes ${e.amount}${e.shieldBroken ? ' (shield breaks)' : ''}`;
			case 'healed':
				return `${targetName(m, e.target)} heals ${e.amount}`;
			case 'summoned':
				return `${sideName(e.player)} summons ${nameOf(m, e.uid)}`;
			case 'died':
				return `${nameOf(m, e.uid)} dies`;
			case 'fatigue':
				return `${sideName(e.player)} takes ${e.amount} fatigue`;
			case 'drawn':
				return e.burned ? `${sideName(e.player)} burns ${nameOf(m, e.uid)} (hand full)` : null;
			case 'matchEnded':
				return e.winner === 'draw'
					? `Draw (${e.reason})`
					: `${sideName(e.winner)} wins (${e.reason})`;
			default:
				return null;
		}
	}
	function note(events: CardEvent[]): void {
		if (!run) return;
		const lines = events.map((e) => describe(run!.match, e)).filter((l): l is string => !!l);
		if (lines.length) log = [...log, ...lines].slice(-200);
		match = run.match;
	}

	function start(): void {
		stop();
		problem = '';
		copied = false;
		try {
			const s = seed.trim();
			const seedValue = /^-?\d+$/.test(s) ? Number(s) : s || 1;
			run = createTestMatch(recordFor(config, seats(), seedValue, mode === 'play' ? 0 : undefined));
			log = [];
			note(run.openingEvents);
			tick();
		} catch (err) {
			run = null;
			match = null;
			problem = err instanceof Error ? err.message : String(err);
		}
	}

	/** Let the AI take its moves, at the chosen pace (0 ⇒ to the end at once). */
	function tick(): void {
		if (!run || run.match.result || !run.aiTurn()) return;
		if (speed === 0) {
			while (run.aiTurn()) note(run.aiStep());
			return;
		}
		timer = setTimeout(() => {
			if (!run) return;
			note(run.aiStep());
			tick();
		}, speed);
	}

	function act(action: Action): void {
		if (!run) return;
		try {
			note(run.act(action));
			tick();
		} catch (err) {
			problem = err instanceof Error ? err.message : String(err);
		}
	}

	const legal = $derived(match && run && mode === 'play' && !run.aiTurn() ? run.legal() : []);
	const plays = (uid: number) =>
		legal.filter(
			(a) => (a.type === 'play' && a.uid === uid) || (a.type === 'attack' && a.attacker === uid),
		);
	const label = (m: Match, a: Action): string =>
		a.type === 'play'
			? a.target
				? `on ${targetName(m, a.target)}`
				: 'Play'
			: a.type === 'attack'
				? `→ ${targetName(m, a.target)}`
				: a.type === 'endPhase'
					? `End ${m.phase}`
					: 'Concede';

	async function copyReplay(): Promise<void> {
		if (!run) return;
		await navigator.clipboard.writeText(JSON.stringify(run.replay(), null, 2));
		copied = true;
	}

	// Run 100: chunked so the page stays live; a new run or leaving the tab drops the old one.
	let totals = $state<RunTotals | null>(null);
	let running = $state(0);
	let runToken = 0;
	function runHundred(): void {
		problem = '';
		let chosen: [SeatSetup, SeatSetup];
		try {
			chosen = seats();
		} catch (err) {
			problem = err instanceof Error ? err.message : String(err);
			return;
		}
		const token = ++runToken;
		totals = null;
		let seedNo = 1;
		running = 1;
		const chunk = () => {
			if (token !== runToken) return;
			try {
				for (let n = 0; n < 5 && seedNo <= 100; n++, seedNo++)
					totals = addToTotals(totals, playAiMatch(recordFor(config, chosen, seedNo)));
			} catch (err) {
				problem = err instanceof Error ? err.message : String(err);
				running = 0;
				return;
			}
			running = seedNo;
			if (seedNo <= 100) setTimeout(chunk, 0);
			else running = 0;
		};
		chunk();
	}
	onDestroy(() => (runToken += 1));

	const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—');
	const deckName = (id: string) => decks.find((d) => d.id === id)?.name ?? id;
	const unitText = (m: Match, c: CardInstance) => {
		const def = m.library[c.cardId];
		const stats = def.type === 'unit' ? ` ${c.attack}/${Math.max(0, c.health - c.damage)}` : '';
		return `${def.name} (${def.cost})${stats}${c.keywords.length ? ` · ${c.keywords.join(', ')}` : ''}`;
	};
</script>

{#if !canPlay}
	<p class="warn">Fix the card and deck errors first: a match needs a valid library and decks.</p>
{:else if decks.length === 0}
	<p class="hint">Add decks first.</p>
{:else}
	<section class="setup">
		{#each [0, 1] as const as side (side)}
			<fieldset>
				<legend>Side {sideName(side)}</legend>
				<label
					>Deck
					{#if side === 0}
						<select bind:value={deckA}
							>{#each decks as d (d.id)}<option value={d.id}>{d.name} ({d.side})</option
								>{/each}</select
						>
					{:else}
						<select bind:value={deckB}
							>{#each decks as d (d.id)}<option value={d.id}>{d.name} ({d.side})</option
								>{/each}</select
						>
					{/if}
				</label>
				<label
					>Difficulty
					{#if side === 0}
						<select bind:value={diffA} disabled={mode === 'play'}>
							<option value="easy">easy</option><option value="normal">normal</option><option
								value="hard">hard</option
							>
						</select>
					{:else}
						<select bind:value={diffB}>
							<option value="easy">easy</option><option value="normal">normal</option><option
								value="hard">hard</option
							>
						</select>
					{/if}
				</label>
			</fieldset>
		{/each}
		<fieldset>
			<legend>Match</legend>
			<label>Seed <input bind:value={seed} spellcheck="false" /></label>
			<label
				>Mode
				<select bind:value={mode}>
					<option value="watch">Watch the AI play both sides</option>
					<option value="play">Play side A yourself</option>
				</select>
			</label>
			<label
				>AI speed
				<select bind:value={speed}>
					<option value={900}>Slow</option>
					<option value={300}>Normal</option>
					<option value={60}>Fast</option>
					<option value={0}>Instant</option>
				</select>
			</label>
		</fieldset>
		<div class="buttons">
			<button type="button" class="go" onclick={start}>Start match</button>
			<button type="button" onclick={runHundred} disabled={running > 0}
				>{running ? `Running… ${running - 1} / 100` : 'Run 100'}</button
			>
			{#if run}<button type="button" onclick={copyReplay}
					>{copied ? 'Copied' : 'Copy replay'}</button
				>{/if}
		</div>
	</section>
	{#if problem}<p class="err">{problem}</p>{/if}

	{#if totals}
		<section>
			<h2>Run 100 — {deckName(deckA)} vs {deckName(deckB)}</h2>
			<div class="totals">
				<div><span class="big">{pct(totals.wins[0], totals.played)}</span> side A wins</div>
				<div><span class="big">{pct(totals.wins[1], totals.played)}</span> side B wins</div>
				<div><span class="big">{totals.draws}</span> draws</div>
				<div><span class="big">{totals.averageTurns.toFixed(1)}</span> turns on average</div>
				<div><span class="big">{totals.played}</span> played (seeds 1 … {totals.played})</div>
			</div>
			<p class="hint">
				Ended by: {Object.entries(totals.reasons)
					.filter(([, n]) => n)
					.map(([r, n]) => `${r} ${n}`)
					.join(', ')}.
			</p>
			<h3>Most often left in hand</h3>
			<ol class="left">
				{#each totals.leftInHand.slice(0, 8) as e (e.card)}
					<li>{game.library.find((c) => c.id === e.card)?.name ?? e.card} — {e.count}</li>
				{/each}
			</ol>
		</section>
	{/if}

	{#if match}
		{@const m = match}
		<section class="table">
			{#each [1, 0] as const as side (side)}
				{@const p = m.players[side]}
				<div class="side" class:active={m.active === side && !m.result}>
					<div class="hero">
						<span class="big">{p.health}</span> / {p.maxHealth} · side {sideName(side)} · resource {p
							.resource.current}/{p.resource.max} · deck {p.deck.length} · hand {p.hand.length}
					</div>
					<div class="zone">
						<span class="zl">Board</span>
						{#each p.board as c (c.uid)}
							<span class="chip unit">
								{unitText(m, c)}
								{#each plays(c.uid) as a, i (i)}<button type="button" onclick={() => act(a)}
										>{label(m, a)}</button
									>{/each}
							</span>
						{:else}<span class="dim">empty</span>{/each}
					</div>
					<div class="zone">
						<span class="zl">Hand</span>
						{#if mode === 'play' && side === 1}
							<span class="dim">{p.hand.length} cards, face down</span>
						{:else}
							{#each p.hand as c (c.uid)}
								<span class="chip">
									{unitText(m, c)}
									{#each plays(c.uid) as a, i (i)}<button type="button" onclick={() => act(a)}
											>{label(m, a)}</button
										>{/each}
								</span>
							{/each}
						{/if}
					</div>
				</div>
			{/each}
			<div class="status">
				{#if m.result}
					<b>{m.result.winner === 'draw' ? 'Draw' : `Side ${sideName(m.result.winner)} wins`}</b>
					({m.result.reason}) on turn {m.turn}.
				{:else}
					Turn {m.turn}, side {sideName(m.active)}, {m.phase}.
					{#each legal.filter((a) => a.type === 'endPhase' || a.type === 'concede') as a, i (i)}
						<button type="button" onclick={() => act(a)}>{label(m, a)}</button>
					{/each}
				{/if}
			</div>
		</section>
		<section>
			<h3>What happened</h3>
			<ol class="log">
				{#each log as line, i (i)}<li>{line}</li>{/each}
			</ol>
		</section>
	{/if}
{/if}

<style>
	.setup {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		align-items: flex-end;
		margin-bottom: 16px;
	}
	fieldset {
		display: flex;
		gap: 10px;
		border: 1px solid #23232c;
		border-radius: 8px;
		padding: 8px 12px;
	}
	legend {
		font-size: 11px;
		color: #8b8b98;
	}
	.buttons {
		display: flex;
		gap: 8px;
	}
	.go {
		border-color: #2a8a69 !important;
	}
	section {
		margin-bottom: 20px;
	}
	.totals {
		display: flex;
		flex-wrap: wrap;
		gap: 24px;
		font-size: 12px;
		color: #b9b9c4;
	}
	.big {
		display: block;
		font-size: 20px;
		font-weight: 700;
		color: #7ee0c0;
	}
	.hero .big {
		display: inline;
	}
	.left,
	.log {
		margin: 0;
		padding-left: 20px;
		font-size: 12px;
		line-height: 1.6;
	}
	.log {
		max-height: 240px;
		overflow: auto;
	}
	.table {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px;
		border: 1px solid #23232c;
		border-radius: 10px;
		background: #10131a;
	}
	.side {
		padding: 8px;
		border: 1px solid #1d1d25;
		border-radius: 8px;
	}
	.side.active {
		border-color: #6ea8ff;
	}
	.hero {
		font-size: 12px;
		color: #b9b9c4;
		margin-bottom: 6px;
	}
	.zone {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		margin-top: 4px;
		font-size: 12px;
	}
	.zl {
		width: 44px;
		color: #8b8b98;
	}
	.chip {
		display: inline-flex;
		gap: 4px;
		align-items: center;
		padding: 3px 8px;
		border: 1px solid #2c3e50;
		border-radius: 6px;
		background: #182230;
	}
	.chip.unit {
		border-color: #4a5d72;
	}
	.chip button {
		padding: 1px 6px;
		font-size: 11px;
	}
	.status {
		font-size: 12px;
		display: flex;
		gap: 8px;
		align-items: center;
	}
</style>
