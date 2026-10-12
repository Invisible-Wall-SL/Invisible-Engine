<script lang="ts">
	import {
		BASE_GAME_MODE,
		HOLD_AND_WIN_MODE,
		HOLD_AND_WIN_PRESET_IDS,
		HOLD_AND_WIN_PRESET_LABELS,
		addRespinMode,
		addSpinsMode,
		freeSpinsModeId,
		gameTypeForMode,
		nextRespinModeId,
		primaryRespinMode,
		removeRespinMode,
		removeSpinsMode,
		renameRespinMode,
		resolveBonusModes,
		respinModeIdProblem,
		spinsModeIdProblem,
		startRespinRules,
		type AddOnResult,
		type BonusRoute,
		type GameConfigDoc,
		type GameConfigIssue,
		type GameModeDecl,
		type HoldAndWinPresetId,
		type SpinsGame,
	} from 'game-config';
	import { askConfirm } from '$lib/dialogs.svelte';
	import HoldAndWinRules from './HoldAndWinRules.svelte';
	import SpinsModeEditor from './SpinsModeEditor.svelte';

	/**
	 * The Bonus modes block of `/config` (`docs/design/bonus-games.md` §2.4, Phase 5a): every mode a
	 * bonus switches into, with what starts it. A RESPIN mode is a Hold and Win game of its own — its
	 * rules live on its declaration (`modes[i].holdAndWin`) and are edited here, one editor per mode;
	 * adding, renaming and removing one goes through the `game-config` split-form writers, so its
	 * strips, symbols and routes move with it. What starts a mode is the Coin overlay's.
	 */
	let {
		doc = $bindable(),
		view,
		issuesFor,
		readOnly,
		spinsRefusal,
	}: {
		doc: GameConfigDoc;
		/** The live doc with its compat mirror — what the validators and the game read. */
		view: GameConfigDoc;
		issuesFor: (prefix: string) => GameConfigIssue[];
		readOnly: boolean;
		/** Why this project's kind plays no spins mode (Book-of, Hold and Win), or `undefined`. */
		spinsRefusal?: string;
	} = $props();

	const snapshot = (): GameConfigDoc => $state.snapshot(doc) as GameConfigDoc;

	const bonusModes = $derived(resolveBonusModes(view));
	const primaryId = $derived(primaryRespinMode(doc.modes)?.id);
	const reelsBonusModes = $derived(bonusModes.filter((b) => b.mode.board !== 'respinBoard'));
	const isSpinsMode = (mode: GameModeDecl): mode is GameModeDecl & { spins: SpinsGame } =>
		mode.board === 'reels' && Boolean(mode.spins);
	const routesOf = (id: string): BonusRoute[] =>
		bonusModes.find((b) => b.mode.id === id)?.routes ?? [];

	const ROUTE_LABELS: Record<Exclude<BonusRoute['kind'], 'pot' | 'buy' | 'meter'>, string> = {
		count: 'the coin count',
		pattern: 'the pattern',
		randomMetre: 'the random metre',
		luckySpin: 'Lucky Spin',
		scatters: 'the scatters',
	};
	function routeLabel(route: BonusRoute): string {
		if (route.kind === 'pot') return `pot ${route.pot}`;
		if (route.kind === 'buy') return `buying (${route.betMode})`;
		if (route.kind === 'meter') return `meter ${route.meter}`;
		return ROUTE_LABELS[route.kind];
	}

	/** The validator reports the mirrored mode's rules under `holdAndWin`, every other one's under
	 *  its own `modes.<id>.holdAndWin`. */
	const rulesPrefix = (id: string) => (id === primaryId ? 'holdAndWin' : `modes.${id}.holdAndWin`);
	/** The card's own issues, and what (not) starts the mode — its rules editor shows the rest. */
	const cardIssues = (id: string) => [
		...issuesFor(`modes.${id}`).filter((i) => !i.path.startsWith(`${rulesPrefix(id)}.`)),
		...issuesFor(`${rulesPrefix(id)}.trigger`),
	];

	/** A base-game coin names a tier by name; it follows a rename unless another mode keeps the name. */
	function renameJackpot(id: string, from: string, to: string) {
		const kept = doc.modes?.some(
			(m) => m.id !== id && m.holdAndWin?.jackpots.some((j) => j.name === from),
		);
		if (kept) return;
		for (const coin of doc.coinOverlay?.coins ?? []) {
			if (coin.kind === 'jackpot' && coin.jackpot === from) coin.jackpot = to;
		}
	}

	/** Which rules editors are folded shut — local UI state only, never saved. */
	let folded = $state<Record<string, boolean>>({});
	/** What the last change did beyond the obvious — a rename, a re-route or a refusal. Never saved. */
	let notice = $state<{ kind: 'info' | 'error'; text: string } | null>(null);

	function apply(result: AddOnResult) {
		if (!result.ok) {
			notice = { kind: 'error', text: result.reason };
			return false;
		}
		doc = result.doc;
		const renames = Object.entries(result.renamed.symbols).map(
			([from, to]) => `symbol ${from} → ${to}`,
		);
		const said = [
			...(renames.length
				? [`These names were already taken, so they were renamed: ${renames.join(', ')}.`]
				: []),
			...(result.notes ?? []),
		];
		notice = said.length ? { kind: 'info', text: said.join(' ') } : null;
		return true;
	}

	// ── add ────────────────────────────────────────────────────────────────────────────────────
	let newId = $state('');
	let newPreset = $state<HoldAndWinPresetId | ''>('classic');
	const addId = $derived(newId.trim() || nextRespinModeId(view));
	const addProblem = $derived(respinModeIdProblem(view, addId));

	function add() {
		if (apply(addRespinMode(snapshot(), addId, newPreset || undefined))) newId = '';
	}

	// ── rename / remove / rules ────────────────────────────────────────────────────────────────
	function rename(input: HTMLInputElement, from: string) {
		const to = input.value.trim();
		if (to === from) return;
		if (!apply(renameRespinMode(snapshot(), from, to))) input.value = from;
	}

	async function remove(id: string) {
		const routes = routesOf(id);
		const ok = await askConfirm({
			title: `Remove the respin mode "${id}"?`,
			message: `This removes its rules, its respin strips and the Hold and Win symbols only they deal${routes.length ? `, and what starts it (${routes.map(routeLabel).join(', ')}) — a pot is re-routed to free spins, or removed when they are off` : ''}. The rest of the config is kept. Nothing is saved until you press Save.`,
			confirmLabel: 'Remove',
			danger: true,
		});
		if (ok) apply(removeRespinMode(snapshot(), id));
	}

	function startRules(id: string) {
		apply(startRespinRules(snapshot(), id));
	}

	// ── spins modes (`GameModeDecl.spins`, bonus-games Phase 8b) ──────────────────────────────
	let newSpinsId = $state('');
	const addSpinsId = $derived(newSpinsId.trim() || freeSpinsModeId(view));
	const addSpinsProblem = $derived(spinsModeIdProblem(view, addSpinsId));

	function addSpins() {
		if (apply(addSpinsMode(snapshot(), addSpinsId))) newSpinsId = '';
	}

	async function removeSpins(id: string) {
		const routes = routesOf(id);
		const ok = await askConfirm({
			title: `Remove the spins mode "${id}"?`,
			message: `This removes its game, its strips${routes.length ? `, and what starts it (${routes.map(routeLabel).join(', ')}) — a pot is re-routed to free spins, or removed when they are off` : ''}. The rest of the config is kept. Nothing is saved until you press Save.`,
			confirmLabel: 'Remove',
			danger: true,
		});
		if (ok) apply(removeSpinsMode(snapshot(), id));
	}
</script>

{#snippet issueLines(list: GameConfigIssue[])}
	{#each list as issue (issue.path + issue.message)}
		<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
	{/each}
{/snippet}

<section class="bonus">
	<h2>Bonus modes</h2>
	<p class="hint">
		The games a bonus switches into. A <strong>respin mode</strong> is a Hold and Win game of its
		own, with its own rules, respin strips and symbols; a project can have several. What starts each
		one — a coin count, a pot, a buy, Lucky Spin — is set in <strong>Coin overlay</strong>. A symbol
		joins a respin game by its <strong>special properties</strong> in Symbols below (<code
			>coin</code
		>,
		<code>jackpot</code>, <code>collector</code>, <code>coinMultiplier</code>, <code>payer</code>,
		<code>mystery</code>, <code>addRespins</code>, <code>upgrade</code>, <code>meterSpecial</code>,
		<code>blank</code>, <code>unlock</code>). The server stays the authority on outcomes — these
		weights drive the test mock and the readouts.
	</p>
	{#if notice}
		<p class="inline-issue {notice.kind === 'error' ? 'error' : 'info'}">{notice.text}</p>
	{/if}

	{#if reelsBonusModes.length}
		<table class="tbl">
			<thead><tr><th>On the reels</th><th>Started by</th></tr></thead>
			<tbody>
				{#each reelsBonusModes as b (b.mode.id)}
					<tr>
						<td><code>{b.mode.id}</code> {b.mode.label ?? ''}</td>
						<td class="note">{b.routes.map(routeLabel).join(', ') || 'nothing yet'}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<p class="note">
			Free spins are set in <strong>Free spins</strong>, other reels modes in
			<strong>Game modes</strong>.
		</p>
	{/if}

	{#each doc.modes ?? [] as mode (mode.id)}
		{#if mode.board === 'respinBoard'}
			{@const routes = routesOf(mode.id)}
			{@const gameType = gameTypeForMode(mode)}
			{@const strips = doc.paddingReels[gameType]?.length ?? 0}
			<fieldset class="panel" disabled={readOnly}>
				<div class="row tight">
					<h3>{mode.label ?? mode.id}</h3>
					{#if mode.holdAndWin}
						<button
							class="small push"
							aria-expanded={!folded[mode.id]}
							onclick={() => (folded[mode.id] = !folded[mode.id])}
							>{folded[mode.id] ? 'Show rules' : 'Hide rules'}</button
						>
					{/if}
					<button class="small danger" class:push={!mode.holdAndWin} onclick={() => remove(mode.id)}
						>Remove</button
					>
				</div>
				<div class="row">
					<label
						><span>Id</span><input
							class="id"
							value={mode.id}
							disabled={mode.id === HOLD_AND_WIN_MODE}
							title={mode.id === HOLD_AND_WIN_MODE
								? 'Its screens and its Flow tab know this mode by "holdAndWin".'
								: 'Renaming carries its routes along; re-tag its screens and Flow tab.'}
							onchange={(e) => rename(e.currentTarget, mode.id)}
						/></label
					>
					<span class="note"
						>respin strips <code>{gameType}</code>: {strips ? `${strips} reels` : 'none yet'} · started
						by {routes.map(routeLabel).join(', ') ||
							'nothing yet — route a trigger or a pot to it in Coin overlay'}</span
					>
				</div>
				{@render issueLines(cardIssues(mode.id))}
				{#if !mode.holdAndWin}
					<p class="hint">
						This respin mode has no Hold and Win rules yet, so nothing can play it.
					</p>
					<button class="small" onclick={() => startRules(mode.id)}>Start empty rules</button>
				{:else if !folded[mode.id]}
					<HoldAndWinRules
						bind:rules={mode.holdAndWin}
						{doc}
						prefix={rulesPrefix(mode.id)}
						{issuesFor}
						{readOnly}
						onRenameJackpot={(from, to) => renameJackpot(mode.id, from, to)}
					/>
				{/if}
			</fieldset>
		{/if}
	{/each}

	{#each doc.modes ?? [] as mode (mode.id)}
		{#if isSpinsMode(mode)}
			{@const routes = routesOf(mode.id)}
			<fieldset class="panel" disabled={readOnly}>
				<div class="row tight">
					<h3>{mode.label ?? mode.id}</h3>
					<span class="note"
						><code>{mode.id}</code> · N spins of a game, then back · started by {routes
							.map(routeLabel)
							.join(', ') ||
							'nothing yet — route a pot, a buy, Lucky Spin or the random metre to it in Coin overlay'}</span
					>
					<button class="small danger push" onclick={() => removeSpins(mode.id)}>Remove</button>
				</div>
				<SpinsModeEditor bind:doc {mode} {issuesFor} {readOnly} />
			</fieldset>
		{/if}
	{/each}

	<fieldset class="row tight add" disabled={readOnly}>
		<span class="legend">Add a respin mode</span>
		<input class="id" placeholder={nextRespinModeId(view)} bind:value={newId} />
		<select bind:value={newPreset}>
			{#each HOLD_AND_WIN_PRESET_IDS as id (id)}
				<option value={id}>{HOLD_AND_WIN_PRESET_LABELS[id]}</option>
			{/each}
			<option value="">Empty rules (no strips)</option>
		</select>
		<button class="small" onclick={add} disabled={Boolean(addProblem)}>＋ Respin mode</button>
		{#if addProblem}<span class="inline-issue error">{addProblem}</span>{/if}
		<span class="note"
			>a preset brings its rules, respin strips and symbols; then route something to it in Coin
			overlay</span
		>
	</fieldset>
	<fieldset class="row tight add" disabled={readOnly || Boolean(spinsRefusal)}>
		<span class="legend">Add a spins mode</span>
		<input class="id" placeholder={freeSpinsModeId(view)} bind:value={newSpinsId} />
		<button class="small" onclick={addSpins} disabled={Boolean(addSpinsProblem)}
			>＋ Spins mode</button
		>
		{#if spinsRefusal}<span class="note">{spinsRefusal}</span>
		{:else if addSpinsProblem}<span class="inline-issue error">{addSpinsProblem}</span>
		{:else}<span class="note"
				>N spins of a lines, ways, cluster or scatter game on its own strips, then back to the base
				game; it starts as the base game, then pick its game, grid and pays</span
			>{/if}
	</fieldset>
	{#if !bonusModes.some((b) => b.mode.id !== BASE_GAME_MODE)}
		<p class="note">This project has no bonus mode.</p>
	{/if}
</section>

<style>
	.bonus {
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
	h3 {
		margin: 0;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: #e0b878;
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
	.legend {
		font-size: 11px;
		font-weight: 600;
		color: #b8b8c4;
	}
	.panel {
		margin: 0 0 14px;
		padding: 12px 14px;
		border: 1px solid #2a2a36;
		border-radius: 8px;
		background: #15151c;
		min-width: 0;
	}
	.add {
		border: none;
		padding: 0;
		margin: 0 0 8px;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 16px;
		align-items: flex-end;
		margin: 8px 0;
	}
	.row.tight {
		align-items: center;
		gap: 8px;
	}
	.push {
		margin-left: auto;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11px;
		color: #8b8b98;
	}
	input.id {
		width: 140px;
	}
	.tbl {
		border-collapse: collapse;
		margin: 0 0 6px;
		font-size: 12px;
	}
	.tbl th,
	.tbl td {
		padding: 4px 10px 4px 0;
		text-align: left;
	}
	.tbl th {
		color: #8b8b98;
		font-weight: 600;
	}
	.inline-issue {
		margin: 4px 0;
		font-size: 12px;
	}
	.inline-issue.error {
		color: #ff8a8a;
	}
	.inline-issue.warning {
		color: #e0b878;
	}
	.inline-issue.info {
		color: #8fc7ff;
	}
	button.danger {
		color: #ff8a8a;
	}
</style>
