<script lang="ts">
	import { resolve } from '$app/paths';

	import {
		ARCADE_BODY_EDGES,
		resolveCard,
		ARCADE_FIXED_HZ_RANGE,
		DEFAULT_ARCADE_FIXED_HZ,
		DEFAULT_MATCH3_MIN_RUN,
		resolveFamily,
		resolveOutcome,
		type ConfigFamily,
		type GameConfigDoc,
		type GameConfigIssue,
	} from 'game-config';
	import {
		addBody,
		addGoal,
		addZone,
		pairsText,
		removeBody,
		removeGoal,
		removeZone,
		scoreTableText,
		setBodyEdges,
		setBodyGround,
		setBodyOneWay,
		setBodyShape,
		setBodySize,
		setBodySolid,
		setBodyTags,
		setCardFirst,
		setCardResource,
		setCardRule,
		setFamily,
		setField,
		setFixedHz,
		setGoalField,
		setMinRun,
		setMoves,
		setOutcome,
		setPairs,
		setScoreTable,
		setStrip,
		setZoneField,
		stripText,
	} from './familyDoc';
	import { askConfirm } from '$lib/dialogs.svelte';
	import { setPlayedOnline } from './onlineDoc';
	import OnlineSection from './OnlineSection.svelte';

	/**
	 * THE GAME FAMILY of `/config` (`docs/design/game-families.md` §2.1, §6.2): the family and
	 * outcome pickers, then the family's own block — the match-3 rules or the arcade play field. The
	 * page renders this only for a project that is not a slot, so a slot project's page is unchanged.
	 * Every input goes through `./familyDoc`, which writes what the normalizer stores and nothing
	 * else; the page's validator is the only judge of what is wrong.
	 */
	let {
		doc = $bindable(),
		gems,
		issuesFor,
		readOnly,
	}: {
		doc: GameConfigDoc;
		/** The symbols the strips deal — what a collect goal can name. */
		gems: string[];
		issuesFor: (prefix: string) => GameConfigIssue[];
		readOnly: boolean;
	} = $props();

	const FAMILY_LABELS: Record<ConfigFamily, string> = {
		slot: 'Slot — reels that spin',
		match3: 'Match-3 — swap gems to match runs',
		arcade: 'Arcade — a play field with moving objects',
		card: 'Card — a duel against the device',
	};

	const family = $derived(resolveFamily(doc));
	const outcome = $derived(resolveOutcome(doc));
	const minRun = $derived(doc.match3?.minRun ?? DEFAULT_MATCH3_MIN_RUN);
	const stripSets = $derived(Object.keys(doc.paddingReels));
	const bodies = $derived(Object.entries(doc.arcade?.bodies ?? {}));
	const characterCount = $derived(doc.arcade?.characters?.length ?? 0);
	const cardGame = $derived(resolveCard(doc));
	const CARD_RULE_FIELDS = [
		['startHealth', 'Hero health', 1],
		['openingHand', 'Opening hand', 0],
		['handLimit', 'Hand limit', 1],
		['boardLimit', 'Board limit', 1],
		['deckSize', 'Deck size', 1],
		['maxCopies', 'Copies per deck', 1],
		['turnLimit', 'Turn limit', 1],
	] as const;
	const CARD_RESOURCE_FIELDS = [
		['start', 'Resource at start', 0],
		['perTurn', 'Resource per turn', 0],
		['max', 'Resource cap', 1],
	] as const;
	/** Played online on adds an empty block; off asks first, as it removes the room, its rules and
	 *  its bots. */
	async function togglePlayedOnline(box: HTMLInputElement) {
		if (box.checked) return setPlayedOnline(doc, true);
		const ok = await askConfirm({
			title: 'Stop playing online?',
			message: "The game's online room, its rules and its bots are removed from the config.",
			confirmLabel: 'Stop playing online',
			danger: true,
		});
		if (ok) setPlayedOnline(doc, false);
		else box.checked = true;
	}
	let newBody = $state('');
	let newGoal = $state<'score' | 'collect'>('score');
</script>

{#snippet issueList(prefix: string)}
	{#each issuesFor(prefix) as issue (issue.path + issue.message)}
		<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
	{/each}
{/snippet}

<section>
	<h2>Game family</h2>
	<p class="hint">
		What kind of game this is. A <strong>slot</strong> spins reels. A <strong>match-3</strong>
		board does not spin: the player swaps two gems, runs explode, the rest fall and refill. An
		<strong>arcade</strong> game is a play field of moving objects. A <strong>card</strong> game is a
		duel against the device. The page shows only the sections the family uses.
	</p>
	<fieldset class="panel" disabled={readOnly}>
		<div class="row">
			<label
				>Family<select
					value={family}
					onchange={(e) => setFamily(doc, e.currentTarget.value as ConfigFamily)}
				>
					{#each Object.entries(FAMILY_LABELS) as [id, label] (id)}
						<option value={id}>{label}</option>
					{/each}
				</select></label
			>
			{#if family === 'match3'}
				<label
					>Who decides the result<select
						value={outcome}
						onchange={(e) => setOutcome(doc, e.currentTarget.value === 'rules' ? 'rules' : 'rgs')}
					>
						<option value="rgs">The server (RGS) — real money</option>
						<option value="rules">The game's rules — free play, no money</option>
					</select></label
				>
			{:else if family === 'arcade' || family === 'card'}
				<label
					>Who decides the result<select value="rules" disabled>
						<option value="rules">The game's rules — free play, no money</option>
					</select></label
				>
			{/if}
		</div>
		{#if family !== 'slot'}
			<p class="note">
				{#if outcome === 'rgs'}
					The server decides every gem that falls and every win; the player's moves only reveal
					them. The game has a stake, bet modes and a paytable.
				{:else}
					The game's own rules decide, and it has no wallet: no stake, no balance and no wins in
					money. Score, moves and goals are the game's own.
				{/if}
				{#if family === 'arcade'}
					An arcade game decided by the server is not built yet.
				{:else if family === 'card'}
					A card game is always decided by its own rules.
				{/if}
				It publishes to our test server; it is never built for a real-money delivery.
			</p>
		{/if}
	</fieldset>
	{@render issueList('family')}
	{@render issueList('outcome')}
</section>

{#if family === 'match3'}
	<section>
		<h2>Match-3</h2>
		<p class="hint">
			The board is the <strong>Grid</strong> above — its reels are the columns. A swap that lines up
			at least the <strong>minimum run</strong> of one gem in a row or a column matches. Each
			column's
			<strong>refill strip</strong> is the order new gems fall in from the top.
		</p>
		<fieldset class="panel" disabled={readOnly}>
			<div class="row">
				<label
					>Minimum run<input
						type="number"
						min="2"
						value={minRun}
						oninput={(e) => setMinRun(doc, e.currentTarget.value)}
					/></label
				>
				{#if outcome === 'rules'}
					<label
						>Moves per round<input
							type="number"
							min="1"
							value={doc.match3?.moves ?? ''}
							placeholder="no limit"
							oninput={(e) => setMoves(doc, e.currentTarget.value)}
						/></label
					>
					<label
						>Points per run<input
							class="wide"
							value={scoreTableText(doc)}
							placeholder="3:50, 4:120, 5:300"
							onchange={(e) => setScoreTable(doc, e.currentTarget.value)}
						/></label
					>
				{/if}
			</div>
			{#if outcome === 'rules'}
				<span class="legend">Goals <em>the round is won when every goal is met</em></span>
				{#if doc.match3?.goals?.length}
					<table class="tbl">
						<tbody>
							{#each doc.match3.goals as goal, index (index)}
								<tr>
									{#if goal.type === 'score'}
										<td>Score</td>
										<td
											><input
												type="number"
												min="1"
												value={goal.target}
												oninput={(e) => setGoalField(doc, index, 'target', e.currentTarget.value)}
											/> points</td
										>
									{:else}
										<td>Collect</td>
										<td
											><input
												type="number"
												min="1"
												value={goal.count}
												oninput={(e) => setGoalField(doc, index, 'count', e.currentTarget.value)}
											/>
											<select
												value={goal.symbol}
												onchange={(e) => setGoalField(doc, index, 'symbol', e.currentTarget.value)}
											>
												{#each gems.includes(goal.symbol) ? gems : [goal.symbol, ...gems] as gem (gem)}
													<option value={gem}>{gem}</option>
												{/each}
											</select></td
										>
									{/if}
									<td
										><button class="del" title="Remove" onclick={() => removeGoal(doc, index)}
											>×</button
										></td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
				<div class="row tight">
					<select bind:value={newGoal}>
						<option value="score">a score</option>
						<option value="collect">gems to collect</option>
					</select>
					<button
						class="small"
						disabled={newGoal === 'collect' && !gems.length}
						onclick={() => addGoal(doc, newGoal, gems[0] ?? '')}>Add goal</button
					>
				</div>
			{:else}
				<p class="note">
					The server sends the moves, and the paytable in <strong>Symbols</strong> prices a run, on the
					whole bet.
				</p>
			{/if}
			{#each stripSets as gameType (gameType)}
				<span class="legend">Refill strips <em>{gameType}</em></span>
				<div class="strips">
					{#each doc.paddingReels[gameType] as _strip, column (column)}
						<label class="inline"
							>Column {column + 1}<input
								class="strip"
								value={stripText(doc, gameType, column)}
								placeholder="A, B, C"
								onchange={(e) => setStrip(doc, gameType, column, e.currentTarget.value)}
							/></label
						>
					{/each}
				</div>
			{/each}
		</fieldset>
		{@render issueList('match3')}
		{@render issueList('numRows')}
	</section>
{/if}

{#if family === 'arcade'}
	<section>
		<h2>Arcade</h2>
		<p class="hint">
			The <strong>play field</strong> is where objects move, in design pixels; left empty it is the
			screen. The game steps its motion a fixed number of times a second, so a replay is exact at
			any frame rate. A <strong>body</strong> gives a component a shape to collide with, and
			<strong>tags</strong> say what it is (<code>player</code>, <code>enemy</code>,
			<code>pickup</code>). <strong>Edges</strong> says what a body does at the field's edge: stop (<code
				>clamp</code
			>), come back on the far side (<code>wrap</code>) or leave (<code>pass</code>, which raises
			<em>Leave bounds</em>). Two tags in <strong>Collisions</strong>
			raise <em>Collide</em> when bodies carrying them touch; a <strong>zone</strong> raises
			<em>Enter zone</em> and <em>Leave zone</em>.
		</p>
		<fieldset class="panel" disabled={readOnly}>
			<div class="row">
				<label
					>Field width<input
						type="number"
						min="1"
						value={doc.arcade?.field?.w ?? ''}
						placeholder="screen"
						onchange={(e) =>
							setField(doc, e.currentTarget.value, String(doc.arcade?.field?.h ?? ''))}
					/></label
				>
				<label
					>Field height<input
						type="number"
						min="1"
						value={doc.arcade?.field?.h ?? ''}
						placeholder="screen"
						onchange={(e) =>
							setField(doc, String(doc.arcade?.field?.w ?? ''), e.currentTarget.value)}
					/></label
				>
				<label
					>Steps per second<input
						type="number"
						min={ARCADE_FIXED_HZ_RANGE.min}
						max={ARCADE_FIXED_HZ_RANGE.max}
						value={doc.arcade?.fixedHz ?? DEFAULT_ARCADE_FIXED_HZ}
						oninput={(e) => setFixedHz(doc, e.currentTarget.value)}
					/></label
				>
			</div>
			<span class="legend">Bodies <em>by component id</em></span>
			{#if bodies.length}
				<table class="tbl">
					<thead>
						<tr>
							<th>Component</th>
							<th>Shape</th>
							<th>Size</th>
							<th>Tags</th>
							<th>Edges</th>
							<th>Solid</th>
							<th title="A hopping character in the air passes over it">Ground</th>
							<th title="Stops a falling character from above only">One-way</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each bodies as [id, body] (id)}
							<tr>
								<td><span class="chip">{id}</span></td>
								<td
									><select
										value={body.shape}
										onchange={(e) =>
											setBodyShape(doc, id, e.currentTarget.value === 'circle' ? 'circle' : 'box')}
									>
										<option value="box">box</option>
										<option value="circle">circle</option>
									</select></td
								>
								<td>
									{#if body.shape === 'box'}
										<input
											type="number"
											min="1"
											value={body.w}
											title="width"
											oninput={(e) => setBodySize(doc, id, 'w', e.currentTarget.value)}
										/>
										×
										<input
											type="number"
											min="1"
											value={body.h}
											title="height"
											oninput={(e) => setBodySize(doc, id, 'h', e.currentTarget.value)}
										/>
									{:else}
										r
										<input
											type="number"
											min="1"
											value={body.r}
											title="radius"
											oninput={(e) => setBodySize(doc, id, 'r', e.currentTarget.value)}
										/>
									{/if}
								</td>
								<td
									><input
										class="wide"
										value={(body.tags ?? []).join(', ')}
										placeholder="enemy, pickup"
										onchange={(e) => setBodyTags(doc, id, e.currentTarget.value)}
									/></td
								>
								<td
									><select
										value={body.edges ?? 'clamp'}
										onchange={(e) => {
											const edges = ARCADE_BODY_EDGES.find((v) => v === e.currentTarget.value);
											if (edges) setBodyEdges(doc, id, edges);
										}}
									>
										{#each ARCADE_BODY_EDGES as edges (edges)}
											<option value={edges}>{edges}</option>
										{/each}
									</select></td
								>
								<td
									><input
										type="checkbox"
										checked={body.solid === true}
										onchange={(e) => setBodySolid(doc, id, e.currentTarget.checked)}
									/></td
								>
								<td
									><input
										type="checkbox"
										checked={body.ground === true}
										onchange={(e) => setBodyGround(doc, id, e.currentTarget.checked)}
									/></td
								>
								<td
									><input
										type="checkbox"
										checked={body.oneWay === true}
										disabled={body.solid === true}
										title={body.solid ? 'A solid body blocks from every side' : undefined}
										onchange={(e) => setBodyOneWay(doc, id, e.currentTarget.checked)}
									/></td
								>
								<td
									><button class="del" title="Remove" onclick={() => removeBody(doc, id)}>×</button
									></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
			<div class="row tight">
				<input class="wide" placeholder="component id" bind:value={newBody} />
				<button
					class="small"
					disabled={!newBody.trim()}
					onclick={() => {
						addBody(doc, newBody);
						newBody = '';
					}}>Add body</button
				>
			</div>
			<label class="pairs"
				>Collisions <em>tag + tag, comma separated</em><input
					class="wide"
					value={pairsText(doc)}
					placeholder="player + hazard, player + pickup"
					onchange={(e) => setPairs(doc, e.currentTarget.value)}
				/></label
			>
			<span class="legend">Zones <em>top-left corner and size, design px</em></span>
			{#if doc.arcade?.zones?.length}
				<table class="tbl">
					<thead>
						<tr>
							<th>Zone</th>
							<th>x</th>
							<th>y</th>
							<th>Width</th>
							<th>Height</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each doc.arcade.zones as zone, i (i)}
							<tr>
								<td
									><input
										value={zone.id}
										onchange={(e) => setZoneField(doc, i, 'id', e.currentTarget.value)}
									/></td
								>
								{#each ['x', 'y', 'w', 'h'] as const as field (field)}
									<td
										><input
											type="number"
											value={zone[field]}
											onchange={(e) => setZoneField(doc, i, field, e.currentTarget.value)}
										/></td
									>
								{/each}
								<td
									><button class="del" title="Remove" onclick={() => removeZone(doc, i)}>×</button
									></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
			<div class="row tight">
				<button class="small" onclick={() => addZone(doc)}>Add zone</button>
			</div>
			<span class="legend">Characters <em>what moves by itself, played or run by a brain</em></span>
			<p class="characters">
				{characterCount === 0
					? 'No characters yet.'
					: `${characterCount} character${characterCount === 1 ? '' : 's'}.`}
				<a href={resolve('/characters')}>Edit in Invisible Characters</a>
			</p>
			<span class="legend">Online <em>rooms on the Invisible Game Server</em></span>
			<label class="inline"
				><input
					type="checkbox"
					checked={doc.arcade?.online !== undefined}
					onchange={(e) => void togglePlayedOnline(e.currentTarget)}
				/>Played online</label
			>
		</fieldset>
		{#each issuesFor('arcade').filter((i) => !i.path.startsWith('arcade.online')) as issue (issue.path + issue.message)}
			<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
		{/each}
	</section>
	{#if doc.arcade?.online}
		<OnlineSection bind:doc online={doc.arcade.online} {issuesFor} {readOnly} />
	{/if}
{/if}

{#if family === 'card'}
	<section>
		<h2>Card game</h2>
		<p class="hint">
			One player duels an AI on the device. Each side has a fixed <strong>deck</strong>, a hand, a
			board of units, a hero with <strong>health</strong> and a <strong>resource</strong> that grows each
			turn and pays for cards. The second player draws one card more than the opening hand.
		</p>
		<fieldset class="panel" disabled={readOnly}>
			<div class="row">
				{#each CARD_RULE_FIELDS as [key, label, min] (key)}
					<label
						>{label}<input
							type="number"
							{min}
							value={cardGame.rules[key]}
							oninput={(e) => setCardRule(doc, key, e.currentTarget.value)}
						/></label
					>
				{/each}
			</div>
			<div class="row">
				{#each CARD_RESOURCE_FIELDS as [key, label, min] (key)}
					<label
						>{label}<input
							type="number"
							{min}
							value={cardGame.rules.resource[key]}
							oninput={(e) => setCardResource(doc, key, e.currentTarget.value)}
						/></label
					>
				{/each}
				<label
					>Who goes first<select
						value={cardGame.rules.first}
						onchange={(e) => setCardFirst(doc, e.currentTarget.value as 'player' | 'ai' | 'random')}
					>
						<option value="random">Random</option>
						<option value="player">The player</option>
						<option value="ai">The AI</option>
					</select></label
				>
			</div>
			<span class="legend">Cards and decks</span>
			<p class="characters">
				{cardGame.library.length} card{cardGame.library.length === 1 ? '' : 's'}, {cardGame.decks
					.length} deck{cardGame.decks.length === 1 ? '' : 's'}.
				<a href={resolve('/cards')}>Edit in Invisible Card Library</a>
			</p>
		</fieldset>
		{@render issueList('card')}
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
	.legend em {
		font-style: normal;
		text-transform: none;
		letter-spacing: 0;
		color: #6f6f7d;
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
	.strips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
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
	label.pairs {
		margin-top: 12px;
	}
	.characters {
		margin: 0;
		font-size: 12px;
		color: #c8c8d4;
	}
	.characters a {
		margin-left: 8px;
		color: #7ee0c0;
	}
	label.pairs em {
		font-style: normal;
		text-transform: none;
		letter-spacing: 0;
		color: #6f6f7d;
	}
	label.inline {
		flex-direction: row;
		align-items: center;
		gap: 6px;
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
	input.strip {
		width: 200px;
	}
	input[type='checkbox'] {
		width: auto;
		margin: 0;
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
