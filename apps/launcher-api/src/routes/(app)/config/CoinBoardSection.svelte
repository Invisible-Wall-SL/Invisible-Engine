<script lang="ts">
	import {
		COIN_BOARD_PAY_RULES,
		activePaylineIds,
		coinBoardDefaultLineCount,
		coinBoardLineCounts,
		coinBoardLineFillMin,
		coinBoardOverlay,
		defaultCoinBoard,
		defaultCoinBoardTriggerMin,
		payingCellCount,
		payingCells,
		type CoinBoard,
		type CoinBoardPayRule,
		type GameConfigDoc,
		type GameConfigIssue,
	} from 'game-config';
	import ColorField from '$lib/ColorField.svelte';
	import { num } from './bonusLabels';

	/**
	 * The COIN BOARD of `/config` (`docs/design/hold-and-win-coin-board.md`): a Hold and Win with no
	 * line game. Switching it on writes a `coinBoard` block (every payline active, every held coin
	 * paying once); switching it off deletes the block, so the base game is a lines game again. Every
	 * other input writes straight into `doc.coinBoard`, and the trigger minimums follow the line
	 * choices — one per choice, a new one starting at a minimum its paying cells can reach. The page's
	 * validator is the only judge of what is wrong; its `coinBoard` issues are listed here.
	 */
	let {
		doc = $bindable(),
		issuesFor,
		readOnly,
	}: {
		doc: GameConfigDoc;
		issuesFor: (prefix: string) => GameConfigIssue[];
		readOnly: boolean;
	} = $props();

	type NumberInput = Event & { currentTarget: HTMLInputElement };

	const PAY_RULE_LABELS: Record<CoinBoardPayRule, { label: string; hint: string }> = {
		coinsOnLines: {
			label: 'Coins on lines',
			hint: 'Every held coin pays its value once — a classic Hold and Win.',
		},
		lineFill: {
			label: 'Line fill',
			hint: 'A paying line pays the sum of its coins in a run from the left, at least the run length long.',
		},
		perLine: {
			label: 'Per line',
			hint: 'Every held coin pays its value × the number of paying lines through its cell.',
		},
	};

	const lineIds = $derived(Object.keys(doc.paylines));

	/** Each line count keeps its minimum; a new one starts at the default its paying cells reach;
	 *  a count no longer offered loses its entry. */
	function syncTriggerMin(board: CoinBoard) {
		const next: Record<string, number> = {};
		for (const count of new Set(coinBoardLineCounts(board))) {
			next[String(count)] =
				board.triggerMin[String(count)] ?? defaultCoinBoardTriggerMin(doc, board, count);
		}
		board.triggerMin = next;
	}

	function setBase(coinBoardOn: boolean) {
		if (coinBoardOn) doc.coinBoard = defaultCoinBoard(doc);
		else delete doc.coinBoard;
	}

	function setSelection(board: CoinBoard, selection: string) {
		const lines = board.lines;
		if (selection === 'player' && lines.selection === 'fixed') {
			const order = [...lines.active, ...lineIds.filter((id) => !lines.active.includes(id))];
			const choices = [...new Set([1, lines.active.length || 1, lineIds.length])]
				.filter((n) => n >= 1 && n <= lineIds.length)
				.sort((a, b) => a - b);
			board.lines = {
				selection: 'player',
				choices,
				default: choices[choices.length - 1] ?? 1,
				order,
			};
		} else if (selection === 'fixed' && lines.selection === 'player') {
			board.lines = { selection: 'fixed', active: lines.order.slice(0, lines.default) };
		}
		syncTriggerMin(board);
	}

	function toggleActive(board: CoinBoard, id: string, on: boolean) {
		if (board.lines.selection !== 'fixed') return;
		const active = board.lines.active;
		board.lines.active = lineIds.filter((line) => (line === id ? on : active.includes(line)));
		syncTriggerMin(board);
	}

	function setChoices(board: CoinBoard, raw: string) {
		if (board.lines.selection !== 'player') return;
		const choices = [
			...new Set(
				raw
					.split(/[\s,]+/)
					.map(Number)
					.filter((n) => Number.isInteger(n) && n > 0),
			),
		].sort((a, b) => a - b);
		board.lines.choices = choices;
		if (!choices.includes(board.lines.default) && choices.length) {
			board.lines.default = choices[choices.length - 1];
		}
		syncTriggerMin(board);
	}

	function moveInOrder(board: CoinBoard, at: number, by: number) {
		if (board.lines.selection !== 'player') return;
		const order = board.lines.order;
		const to = at + by;
		if (to < 0 || to >= order.length) return;
		[order[at], order[to]] = [order[to], order[at]];
	}

	function setPayRule(board: CoinBoard, rule: CoinBoardPayRule) {
		board.payRule = rule;
		if (rule !== 'lineFill') delete board.lineFill;
	}

	function setOverlay(board: CoinBoard, patch: Partial<{ color: string; alpha: number }>) {
		board.inactiveOverlay = { ...coinBoardOverlay(board), ...patch };
	}

	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
</script>

{#snippet preview(board: CoinBoard)}
	{@const count = coinBoardDefaultLineCount(board)}
	{@const cells = payingCells(doc.paylines, activePaylineIds(board, doc.paylines), doc)}
	{@const overlay = coinBoardOverlay(board)}
	<div class="preview" title="The board at {plural(count, 'line', 'lines')}">
		{#each cells as column, reel (reel)}
			<div class="col">
				{#each column as paying, row (row)}
					<span
						class="cell"
						class:paying
						style={paying
							? ''
							: `background:color-mix(in srgb, ${overlay.color} ${overlay.alpha * 100}%, #3a3a48)`}
					></span>
				{/each}
			</div>
		{/each}
		<span class="note"
			>{plural(payingCellCount(doc, board), 'paying cell', 'paying cells')} at {plural(
				count,
				'line',
				'lines',
			)}</span
		>
	</div>
{/snippet}

<section class="coin-board">
	<h2>Coin board</h2>
	<p class="hint">
		<strong>Lines game</strong>: the base game spins the reels, and enough coins start the Hold and
		Win. <strong>Coin board only</strong>: there is no line game — every spin deals coins and blanks
		onto the board, and only the cells an active payline passes through deal, trigger and pay. The
		other cells sit under the overlay. The base strips should then deal only coins, jackpots and
		blanks.
	</p>
	<fieldset class="panel" disabled={readOnly}>
		<div class="row tight">
			<label class="check"
				><input
					type="radio"
					name="coin-board-base"
					checked={!doc.coinBoard}
					onchange={() => setBase(false)}
				/><span>Lines game</span></label
			>
			<label class="check"
				><input
					type="radio"
					name="coin-board-base"
					checked={Boolean(doc.coinBoard)}
					onchange={() => setBase(true)}
				/><span>Coin board only</span></label
			>
		</div>
		{#if doc.coinBoard}
			{@const board = doc.coinBoard}
			{@const lines = board.lines}
			<span class="legend">Who picks the lines</span>
			<div class="row tight">
				<label class="check"
					><input
						type="radio"
						name="coin-board-selection"
						checked={lines.selection === 'fixed'}
						onchange={() => setSelection(board, 'fixed')}
					/><span>Designer (fixed) <em>the player never sees a line control</em></span></label
				>
				<label class="check"
					><input
						type="radio"
						name="coin-board-selection"
						checked={lines.selection === 'player'}
						onchange={() => setSelection(board, 'player')}
					/><span>Player <em>total bet = lines × bet per line</em></span></label
				>
			</div>
			{#if lines.selection === 'fixed'}
				<span class="legend">Active lines</span>
				<div class="checks">
					{#each lineIds as id (id)}
						<label class="check"
							><input
								type="checkbox"
								checked={lines.active.includes(id)}
								onchange={(e) => toggleActive(board, id, e.currentTarget.checked)}
							/><span>Line {id}</span></label
						>
					{/each}
				</div>
			{:else}
				<div class="row">
					<label
						>Line choices<input
							class="wide"
							value={lines.choices.join(', ')}
							placeholder="1, 3, 5"
							onchange={(e) => setChoices(board, e.currentTarget.value)}
						/></label
					>
					<label
						>Default<select
							value={lines.default}
							onchange={(e) => (lines.default = Number(e.currentTarget.value))}
						>
							{#each lines.choices as n (n)}
								<option value={n}>{n}</option>
							{/each}
							{#if !lines.choices.includes(lines.default)}
								<option value={lines.default}>{lines.default} — not a choice</option>
							{/if}
						</select></label
					>
				</div>
				<span class="legend">Order <em>N lines are the first N</em></span>
				<ol class="order">
					{#each lines.order as id, i (id + i)}
						<li>
							<span class="chip">Line {id}</span>
							<button class="del" title="Earlier" onclick={() => moveInOrder(board, i, -1)}
								>↑</button
							>
							<button class="del" title="Later" onclick={() => moveInOrder(board, i, 1)}>↓</button>
						</li>
					{/each}
				</ol>
			{/if}

			<span class="legend">Pay rule <em>how the held coins pay when the feature ends</em></span>
			{#each COIN_BOARD_PAY_RULES as rule (rule)}
				<label class="check"
					><input
						type="radio"
						name="coin-board-pay-rule"
						checked={board.payRule === rule}
						onchange={() => setPayRule(board, rule)}
					/><span>{PAY_RULE_LABELS[rule].label} <em>{PAY_RULE_LABELS[rule].hint}</em></span></label
				>
			{/each}
			{#if board.payRule === 'lineFill'}
				<div class="row">
					<label
						>Run length<input
							type="number"
							min="1"
							max={doc.numReels}
							step="1"
							value={coinBoardLineFillMin(board)}
							oninput={num((n) => (board.lineFill = { min: n }), true)}
						/></label
					>
				</div>
			{/if}

			<span class="legend"
				>Trigger minimum <em>coins on paying cells that start the respins</em></span
			>
			<table class="tbl">
				<thead>
					<tr><th>Lines</th><th>Paying cells</th><th>Minimum</th></tr>
				</thead>
				<tbody>
					{#each [...new Set(coinBoardLineCounts(board))] as count (count)}
						<tr>
							<td>{count}</td>
							<td>{payingCellCount(doc, board, count)}</td>
							<td
								><input
									type="number"
									min="1"
									max={payingCellCount(doc, board, count)}
									step="1"
									value={board.triggerMin[String(count)] ?? ''}
									oninput={num((n) => (board.triggerMin[String(count)] = n), true)}
								/></td
							>
						</tr>
					{/each}
				</tbody>
			</table>

			<span class="legend"
				>Inactive overlay <em>over the cells no active line passes through</em></span
			>
			<div class="row tight">
				<ColorField
					value={coinBoardOverlay(board).color}
					oninput={(hex) => setOverlay(board, { color: hex })}
					title="Overlay colour"
					disabled={readOnly}
				/>
				<label class="inline"
					><span>Alpha</span><input
						type="number"
						min="0"
						max="1"
						step="0.05"
						value={coinBoardOverlay(board).alpha}
						oninput={num((n) => setOverlay(board, { alpha: n }))}
					/></label
				>
				{#if board.inactiveOverlay}
					<button class="small" onclick={() => delete board.inactiveOverlay}>Use the default</button
					>
				{:else}
					<span class="note">the default</span>
				{/if}
			</div>
			{@render preview(board)}
		{/if}
		{#each issuesFor('coinBoard') as issue (issue.path + issue.message)}
			<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
		{/each}
	</fieldset>
</section>

<style>
	.coin-board {
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
	.legend em,
	label span em {
		font-style: normal;
		font-weight: 400;
		text-transform: none;
		letter-spacing: 0;
		color: #6f6f7d;
	}
	.hint {
		margin: 0 0 12px;
		font-size: 12px;
		color: #8b8b98;
		line-height: 1.6;
		max-width: 900px;
	}
	.note {
		font-size: 11px;
		color: #6f6f7d;
	}
	.panel {
		min-width: 0;
		margin: 0 0 12px;
		border: 1px solid #1c1c24;
		border-left: 3px solid #e0b878;
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
		gap: 8px 16px;
		align-items: center;
	}
	.checks {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
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
	label.inline {
		flex-direction: row;
		align-items: center;
		gap: 6px;
		text-transform: none;
	}
	label.check {
		flex-direction: row;
		align-items: center;
		gap: 6px;
		text-transform: none;
		letter-spacing: 0;
		font-size: 12px;
		color: #b9b9c4;
		margin-bottom: 4px;
	}
	input,
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
	input:focus,
	select:focus {
		outline: none;
		border-color: #7ee0c0;
	}
	input[type='number'] {
		width: 90px;
	}
	input.wide {
		width: 160px;
	}
	input[type='checkbox'],
	input[type='radio'] {
		width: auto;
		margin: 0;
	}
	.order {
		margin: 0 0 6px;
		padding-left: 22px;
		font-size: 12px;
		color: #8b8b98;
	}
	.order li {
		margin-bottom: 2px;
	}
	.tbl {
		border-collapse: collapse;
		margin-bottom: 6px;
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
		white-space: nowrap;
	}
	.tbl td {
		padding: 4px 8px;
		border-bottom: 1px solid #16161d;
		vertical-align: middle;
		font-size: 12px;
		color: #b9b9c4;
	}
	button.small {
		background: #1b2a24;
		border: 1px solid #2f4a3f;
		color: #7ee0c0;
		border-radius: 6px;
		padding: 4px 10px;
		font-size: 11px;
		cursor: pointer;
	}
	.del {
		background: none;
		border: none;
		color: #8b8b98;
		font-size: 14px;
		line-height: 1;
		cursor: pointer;
		padding: 0 4px;
	}
	.del:hover:not(:disabled) {
		color: #7ee0c0;
	}
	.chip {
		font-family: ui-monospace, monospace;
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid #26262f;
		background: #14141b;
		color: #7ee0c0;
		white-space: nowrap;
	}
	.preview {
		display: flex;
		gap: 3px;
		align-items: flex-end;
		margin-top: 10px;
	}
	.preview .col {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.preview .cell {
		width: 18px;
		height: 18px;
		border-radius: 3px;
		border: 1px solid #26262f;
	}
	.preview .cell.paying {
		background: #2f4a3f;
		border-color: #7ee0c0;
	}
	.preview .note {
		margin-left: 10px;
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
