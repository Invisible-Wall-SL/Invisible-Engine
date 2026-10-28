<script lang="ts">
	import {
		GROWING_WILD_PATTERNS,
		defaultGrowingReels,
		reelsDealing,
		symbolsInPlay,
		type GameConfigDoc,
		type GameConfigIssue,
		type GrowingWildPattern,
	} from 'game-config';
	import {
		setExpandingWild,
		setExpandingWildsOn,
		setGrowingPattern,
		setGrowingReel,
		setGrowingSymbol,
		setGrowingWildOn,
		setExpandShowAlways,
		wildChoices,
		type GrowingReelsKey,
	} from './wildsDoc';

	/**
	 * EXPANDING WILDS and THE GROWING WILD of `/config`
	 * (`docs/design/expanding-and-growing-wilds.md` §1, §5): two optional blocks, each on while it is
	 * present. Offered on a lines game that does not tumble (not a Book-of kind or a Hold and Win
	 * game); elsewhere a stored block shows only so it can be removed. Every input goes through
	 * `./wildsDoc`; the page's validator is the only judge of what is wrong.
	 */
	let {
		doc = $bindable(),
		issuesFor,
		readOnly,
		offered,
		expanding,
		growing,
		freeSpins,
	}: {
		doc: GameConfigDoc;
		issuesFor: (prefix: string) => GameConfigIssue[];
		readOnly: boolean;
		/** Can this game play a wild that changes the board? */
		offered: boolean;
		/** Does the family show each section? */
		expanding: boolean;
		growing: boolean;
		/** Does the game have free spins, so a growing wild has free-spin reels? */
		freeSpins: boolean;
	} = $props();

	const PATTERN_LABELS: Record<GrowingWildPattern, string> = {
		plus: 'Plus — up, down, left, right',
		vertical: 'Vertical — up and down',
		horizontal: 'Horizontal — left and right',
		all8: 'All 8 around',
	};

	const inPlay = $derived(new Set(symbolsInPlay(doc)));
	const choices = $derived(wildChoices(doc));
	const expandingBlock = $derived(doc.expandingWilds);
	const growingBlock = $derived(doc.growingWild);
	/** Every wild offered, then any stored name that is not one, so it can be unticked. */
	const expandingRows = $derived([
		...choices,
		...(expandingBlock?.symbols ?? []).filter((name) => !choices.includes(name)),
	]);
	const growingRows = $derived(
		growingBlock?.symbol && !choices.includes(growingBlock.symbol)
			? [...choices, growingBlock.symbol]
			: choices,
	);
	const reelIndices = $derived(Array.from({ length: doc.numReels }, (_, i) => i));
	const defaultReels = $derived(defaultGrowingReels(doc.numReels));
	const reelText = (reels: number[]) => reels.map((r) => r + 1).join(', ');
	const dealtText = (name: string) => {
		const reels = reelsDealing(doc, name);
		return reels.length ? reelText(reels) : 'none';
	};
	const firstFree = (taken: readonly string[]) =>
		choices.find((name) => inPlay.has(name) && !taken.includes(name));
</script>

{#snippet issueList(prefix: string)}
	{#each issuesFor(prefix) as issue (issue.path + issue.message)}
		<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
	{/each}
{/snippet}

{#snippet reelToggles(key: GrowingReelsKey, title: string, placeholder: string)}
	{@const ticked = growingBlock?.[key] ?? []}
	<span class="legend">{title}</span>
	<div class="row tight">
		{#each reelIndices as reel (reel)}
			<label class="check"
				><input
					type="checkbox"
					checked={ticked.includes(reel)}
					onchange={(e) => setGrowingReel(doc, key, reel, e.currentTarget.checked)}
				/><span>Reel {reel + 1}</span></label
			>
		{/each}
		{#if !ticked.length}<em class="placeholder">{placeholder}</em>{/if}
	</div>
{/snippet}

{#if expanding && (offered || expandingBlock)}
	<section>
		<h2>Expanding wilds</h2>
		{#if !offered}
			<p class="hint">
				This config has expanding wilds, which this game cannot use: they need a lines game that
				does not tumble.
				<button class="linkish" onclick={() => setExpandingWildsOn(doc, false)} disabled={readOnly}
					>Remove expanding wilds</button
				>
			</p>
		{:else}
			<p class="hint">
				A wild that fills its whole reel when it lands, before any win is counted. Which reels it
				lands on is set by the reel strips.
			</p>
			<fieldset class="panel" disabled={readOnly}>
				<div class="row">
					<label
						>Expanding wilds<select
							value={expandingBlock ? 'on' : 'off'}
							onchange={(e) =>
								setExpandingWildsOn(
									doc,
									e.currentTarget.value === 'on',
									firstFree(growingBlock?.symbol ? [growingBlock.symbol] : []),
								)}
						>
							<option value="off">off — wilds stay where they land</option>
							<option value="on">on — the wilds ticked below fill their reel</option>
						</select></label
					>
				</div>
				{#if expandingBlock}
					{#if expandingRows.length}
						<table class="tbl">
							<thead>
								<tr>
									<th>Expands</th>
									<th>Wild</th>
									<th>Dealt on reels (base game)</th>
								</tr>
							</thead>
							<tbody>
								{#each expandingRows as name (name)}
									<tr>
										<td
											><input
												type="checkbox"
												aria-label="{name} expands"
												checked={expandingBlock.symbols.includes(name)}
												onchange={(e) => setExpandingWild(doc, name, e.currentTarget.checked)}
											/></td
										>
										<td><code>{name}</code></td>
										<td>{dealtText(name)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{:else}
						<p class="note">
							This game has no wild to expand. Give a symbol the <em>wild</em> property in Symbols above.
						</p>
					{/if}
					<label class="check"
						><input
							type="checkbox"
							checked={expandingBlock.show === 'always'}
							onchange={(e) => setExpandShowAlways(doc, e.currentTarget.checked)}
						/><span>Show every expansion</span></label
					>
					<p class="note">
						A wild always expands before the wins are counted. Off, the player sees the expansion
						only when a win uses that reel, as in the reference game. On, every time.
					</p>
				{/if}
			</fieldset>
		{/if}
		{@render issueList('expandingWilds')}
	</section>
{/if}

{#if growing && (offered || growingBlock)}
	<section>
		<h2>Growing wild</h2>
		{#if !offered}
			<p class="hint">
				This config has a growing wild, which this game cannot use: it needs a lines game that does
				not tumble.
				<button class="linkish" onclick={() => setGrowingWildOn(doc, false)} disabled={readOnly}
					>Remove the growing wild</button
				>
			</p>
		{:else}
			<p class="hint">
				A wild that copies itself onto the cells around it when it lands, after any wild has
				expanded and before any win is counted. It never covers a scatter or a Hold and Win symbol.
			</p>
			<fieldset class="panel" disabled={readOnly}>
				<div class="row">
					<label
						>Growing wild<select
							value={growingBlock ? 'on' : 'off'}
							onchange={(e) =>
								setGrowingWildOn(
									doc,
									e.currentTarget.value === 'on',
									firstFree(doc.expandingWilds?.symbols ?? []),
								)}
						>
							<option value="off">off — no wild grows</option>
							<option value="on">on — one wild grows when it lands</option>
						</select></label
					>
					{#if growingBlock}
						<label
							>Wild<select
								value={growingBlock.symbol}
								onchange={(e) => setGrowingSymbol(doc, e.currentTarget.value)}
							>
								<option value="">— pick a wild —</option>
								{#each growingRows as name (name)}
									<option value={name}
										>{name}{inPlay.has(name) ? '' : ' (not on the strips)'}</option
									>
								{/each}
							</select></label
						>
						<label
							>Pattern<select
								value={growingBlock.pattern ?? 'plus'}
								onchange={(e) =>
									setGrowingPattern(doc, e.currentTarget.value as GrowingWildPattern)}
							>
								{#each GROWING_WILD_PATTERNS as pattern (pattern)}
									<option value={pattern}>{PATTERN_LABELS[pattern]}</option>
								{/each}
							</select></label
						>
					{/if}
				</div>
				{#if growingBlock}
					{#if growingBlock.symbol}
						{@const dealt = reelsDealing(doc, growingBlock.symbol)}
						<p class="note">
							<code>{growingBlock.symbol}</code>
							{dealt.length
								? `is dealt on reels ${reelText(dealt)} of the base game.`
								: 'is on no base game strip, so it never lands.'}
						</p>
					{/if}
					{@render reelToggles(
						'reels',
						'Base game reels it grows from',
						`None ticked: reel ${reelText(defaultReels)}, the centre`,
					)}
					{#if freeSpins}
						{@render reelToggles(
							'freeSpinReels',
							'Free spins reels it grows from',
							'None ticked: the same as the base game',
						)}
					{/if}
					<p class="note">
						The reels limit where it may land; the reel strips still decide where it can.
					</p>
				{/if}
			</fieldset>
		{/if}
		{@render issueList('growingWild')}
	</section>
{/if}

<style>
	section {
		margin-bottom: 34px;
	}
	h2 {
		margin: 0 0 6px;
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #7ee0c0;
	}
	.hint {
		margin: 0 0 12px;
		font-size: 12px;
		color: #8b8b98;
		line-height: 1.6;
		max-width: 900px;
	}
	.note {
		margin: 8px 0 0;
		font-size: 11px;
		color: #6f6f7d;
		line-height: 1.5;
		max-width: 900px;
	}
	.panel {
		min-width: 0;
		margin: 0 0 12px;
		border: 1px solid #1c1c24;
		border-left: 3px solid #7ee0c0;
		border-radius: 10px;
		padding: 12px;
		background: #0e0e14;
	}
	.legend {
		display: block;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #8b8b98;
		margin: 12px 0 6px;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 16px;
		align-items: flex-end;
		margin-bottom: 6px;
	}
	.row.tight {
		gap: 8px 12px;
		align-items: center;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #8b8b98;
	}
	label.check {
		flex-direction: row;
		align-items: center;
		gap: 6px;
		margin-top: 8px;
		text-transform: none;
		letter-spacing: 0;
		font-size: 12px;
		color: #b9b9c4;
	}
	.row.tight label.check {
		margin-top: 0;
	}
	.placeholder {
		font-size: 12px;
		color: #55555f;
	}
	select {
		background: #101017;
		border: 1px solid #26262f;
		border-radius: 6px;
		color: #e8e8ee;
		padding: 6px 8px;
		font-size: 13px;
		font-family: inherit;
		box-sizing: border-box;
	}
	select:focus {
		outline: none;
		border-color: #7ee0c0;
	}
	input[type='checkbox'] {
		width: auto;
		margin: 0;
	}
	.tbl {
		border-collapse: collapse;
		margin: 8px 0 6px;
	}
	.tbl th {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #8b8b98;
		padding: 4px 8px;
		text-align: left;
		border-bottom: 1px solid #1c1c24;
	}
	.tbl td {
		padding: 4px 8px;
		border-bottom: 1px solid #16161d;
		vertical-align: middle;
		font-size: 12px;
		color: #b9b9c4;
	}
	code {
		font-family: ui-monospace, monospace;
		background: #16161d;
		padding: 1px 5px;
		border-radius: 4px;
		color: #c8a3ff;
	}
	.linkish {
		background: none;
		border: none;
		padding: 0;
		color: #7ee0c0;
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
	.linkish:disabled {
		color: #55555f;
		cursor: default;
	}
	.inline-issue {
		margin: 8px 0 0;
		font-size: 12px;
	}
	.inline-issue.error {
		color: #e09090;
	}
	.inline-issue.warning {
		color: #d3b483;
	}
</style>
