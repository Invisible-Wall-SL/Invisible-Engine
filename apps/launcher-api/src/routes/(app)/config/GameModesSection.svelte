<script lang="ts">
	import {
		GAME_MODE_BOARDS,
		builtinGameModes,
		resolveGameModes,
		type GameConfigDoc,
		type GameConfigIssue,
		type GameModeBoard,
		type GameModeDecl,
	} from 'game-config';

	/**
	 * The Game modes block of `/config` (`docs/design/hold-and-win.md` §4.5). The list is
	 * `resolveGameModes(doc)`; every edit writes into `doc.modes` — an override of a built-in holds
	 * only the fields the author typed (blank = the built-in's value), and the save path's
	 * `normalizeGameModes` strips anything that merely restates a built-in.
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

	type TextKey = 'label' | 'gameType' | 'hud' | 'music' | 'counter';
	const TEXT_FIELDS: { key: TextKey; label: string }[] = [
		{ key: 'label', label: 'Label' },
		{ key: 'gameType', label: 'Game type' },
		{ key: 'hud', label: 'HUD' },
		{ key: 'music', label: 'Music' },
		{ key: 'counter', label: 'Counter' },
	];
	const BOARD_LABELS: Record<GameModeBoard, string> = {
		reels: 'reels',
		respinBoard: 'respin board',
		wheel: 'wheel',
		none: 'none',
	};
	const MODE_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;

	const builtins = builtinGameModes();
	const modes = $derived(resolveGameModes(doc));
	const blockIssues = $derived(issuesFor('modes'));

	let newId = $state('');
	const newIdProblem = $derived.by(() => {
		const id = newId.trim();
		if (!id) return '';
		if (!MODE_ID.test(id)) return 'Start with a letter; letters, digits, _ and - only.';
		if (modes.some((m) => m.id === id)) return `A mode "${id}" already exists.`;
		return '';
	});

	const builtinOf = (id: string) => builtins.find((m) => m.id === id);
	const authoredOf = (id: string) => doc.modes?.find((m) => m.id === id);

	/** A respin mode is a bonus mode: it is added, renamed and removed (with its rules, strips and
	 *  routes) in Bonus modes, and stays on the respin board. Its presentation fields are edited here. */
	const isRespinMode = (mode: GameModeDecl) => mode.board === 'respinBoard';
	/** A respin board is chosen by adding a respin mode in Bonus modes, never by switching a board. */
	const boardsFor = (mode: GameModeDecl) =>
		isRespinMode(mode) ? GAME_MODE_BOARDS : GAME_MODE_BOARDS.filter((b) => b !== 'respinBoard');

	/** The authored entry for `id`, created (on the board it resolves to) on first write. */
	function entryFor(id: string): GameModeDecl {
		const found = authoredOf(id);
		if (found) return found;
		const board = builtinOf(id)?.board ?? modes.find((m) => m.id === id)?.board ?? 'reels';
		(doc.modes ??= []).push({ id, board });
		return doc.modes[doc.modes.length - 1];
	}

	/** Drops a built-in override that no longer departs, and `doc.modes` once it is empty. */
	function tidy(id: string) {
		const builtin = builtinOf(id);
		const entry = authoredOf(id);
		if (builtin && entry) {
			const departs = Object.keys(entry).some(
				(k) =>
					k !== 'id' &&
					JSON.stringify(entry[k as keyof GameModeDecl]) !==
						JSON.stringify(builtin[k as keyof GameModeDecl]),
			);
			if (!departs) doc.modes = doc.modes?.filter((m) => m.id !== id);
		}
		if (doc.modes && !doc.modes.length) delete doc.modes;
	}

	function setText(id: string, key: TextKey, raw: string) {
		const value = raw.trim();
		const entry = entryFor(id);
		if (value) entry[key] = value;
		else delete entry[key];
		tidy(id);
	}

	function setBoard(id: string, raw: string) {
		const board = GAME_MODE_BOARDS.find((b) => b === raw);
		if (!board) return;
		entryFor(id).board = board;
		tidy(id);
	}

	function setValues(id: string, raw: string) {
		const values = [
			...new Set(
				raw
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean),
			),
		];
		const entry = entryFor(id);
		if (values.length) entry.values = values;
		else delete entry.values;
		tidy(id);
	}

	function addMode() {
		const id = newId.trim();
		if (!id || newIdProblem) return;
		(doc.modes ??= []).push({ id, board: 'reels' });
		newId = '';
	}

	function removeMode(id: string) {
		doc.modes = doc.modes?.filter((m) => m.id !== id);
		tidy(id);
	}

	/** What a blank field means: the built-in's value, or for an own mode the documented fallback. */
	function placeholderFor(mode: GameModeDecl, key: TextKey | 'values'): string {
		const builtin = builtinOf(mode.id);
		if (builtin)
			return key === 'values' ? (builtin.values?.join(', ') ?? '') : (builtin[key] ?? '');
		if (key === 'label' || key === 'gameType') return mode.id;
		if (key === 'hud') return 'base HUD';
		return '';
	}

	function shownText(mode: GameModeDecl, key: TextKey): string {
		return (builtinOf(mode.id) ? authoredOf(mode.id)?.[key] : mode[key]) ?? '';
	}

	function shownValues(mode: GameModeDecl): string {
		const source = builtinOf(mode.id) ? authoredOf(mode.id) : mode;
		return source?.values?.join(', ') ?? '';
	}
</script>

<section class="modes">
	<h2>Game modes</h2>
	<p class="hint">
		A mode is a different game a bonus switches into (own board, screens, HUD, music). Tag Scene
		Editor screens with the role <strong>game mode</strong> + this id to show them while the mode plays.
		Built-in modes can be overridden field by field — a blank field keeps the built-in value shown greyed.
	</p>
	{#each blockIssues as issue (issue.path + issue.message)}
		<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
	{/each}
	<fieldset disabled={readOnly}>
		<table class="tbl">
			<thead>
				<tr>
					<th>Id</th>
					<th>Board</th>
					{#each TEXT_FIELDS as f (f.key)}<th>{f.label}</th>{/each}
					<th>Values</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each modes as mode (mode.id)}
					{@const builtin = builtinOf(mode.id)}
					{@const overridden = Boolean(builtin && authoredOf(mode.id))}
					<tr>
						<td class="id">
							<code>{mode.id}</code>
							{#if builtin}<span class="chip">built-in{overridden ? ' · edited' : ''}</span>{/if}
							{#if isRespinMode(mode)}<span class="chip">Hold and Win · Bonus modes</span>{/if}
						</td>
						<td
							><select
								value={mode.board}
								disabled={isRespinMode(mode)}
								title={isRespinMode(mode)
									? 'A Hold and Win mode plays on the respin board; add or remove it in Bonus modes.'
									: undefined}
								onchange={(e) => setBoard(mode.id, e.currentTarget.value)}
							>
								{#each boardsFor(mode) as b (b)}
									<option value={b}>{BOARD_LABELS[b]}</option>
								{/each}
							</select></td
						>
						{#each TEXT_FIELDS as f (f.key)}
							<td
								><input
									value={shownText(mode, f.key)}
									placeholder={placeholderFor(mode, f.key)}
									onchange={(e) => setText(mode.id, f.key, e.currentTarget.value)}
								/></td
							>
						{/each}
						<td
							><input
								class="wide"
								value={shownValues(mode)}
								placeholder={placeholderFor(mode, 'values')}
								onchange={(e) => setValues(mode.id, e.currentTarget.value)}
							/></td
						>
						<td>
							{#if !builtin && !isRespinMode(mode)}
								<button class="del" title="Remove mode" onclick={() => removeMode(mode.id)}
									>×</button
								>
							{:else if overridden}
								<button
									class="small"
									title="Back to the built-in values"
									onclick={() => removeMode(mode.id)}>Reset</button
								>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<div class="row">
			<input
				placeholder="newModeId"
				bind:value={newId}
				onkeydown={(e) => e.key === 'Enter' && addMode()}
			/>
			<button class="small" onclick={addMode} disabled={!newId.trim() || Boolean(newIdProblem)}
				>+ mode</button
			>
			{#if newIdProblem}<span class="inline-issue error">{newIdProblem}</span>{/if}
		</div>
	</fieldset>
</section>

<style>
	.modes {
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
	code {
		font-family: ui-monospace, monospace;
		background: #16161d;
		padding: 1px 5px;
		border-radius: 4px;
		color: #c8a3ff;
	}
	fieldset {
		border: none;
		margin: 0;
		padding: 0;
		min-width: 0;
		overflow-x: auto;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 12px;
		align-items: center;
		margin-top: 6px;
	}
	input,
	select {
		background: #101017;
		border: 1px solid #26262f;
		border-radius: 6px;
		color: #e8e8ee;
		padding: 5px 7px;
		font-size: 12px;
		font-family: inherit;
		box-sizing: border-box;
		width: 110px;
	}
	input.wide {
		width: 150px;
	}
	input::placeholder {
		color: #55555f;
	}
	input:focus,
	select:focus {
		outline: none;
		border-color: #7ee0c0;
	}
	.tbl {
		border-collapse: collapse;
	}
	.tbl th {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #8b8b98;
		padding: 4px 6px;
		text-align: left;
		border-bottom: 1px solid #1c1c24;
		white-space: nowrap;
	}
	.tbl td {
		padding: 4px 6px;
		border-bottom: 1px solid #16161d;
		vertical-align: middle;
	}
	.tbl td.id {
		white-space: nowrap;
	}
	.chip {
		font-family: ui-monospace, monospace;
		font-size: 10px;
		padding: 1px 7px;
		margin-left: 4px;
		border-radius: 999px;
		border: 1px solid #26262f;
		background: #14141b;
		color: #7ee0c0;
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
	button.small:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.del {
		background: none;
		border: none;
		color: #8b6b6b;
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		padding: 0 4px;
	}
	.del:hover {
		color: #e07070;
	}
	.inline-issue {
		margin: 0 0 8px;
		font-size: 12px;
	}
	span.inline-issue {
		margin: 0;
	}
	.inline-issue.error {
		color: #e09090;
	}
	.inline-issue.warning {
		color: #d3b483;
	}
</style>
