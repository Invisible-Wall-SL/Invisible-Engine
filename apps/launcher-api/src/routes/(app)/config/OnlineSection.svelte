<script lang="ts">
	import {
		ARCADE_NETCODES,
		ARCADE_ONLINE_BOT_DEFAULTS,
		ARCADE_ONLINE_DEFAULTS,
		ARCADE_ONLINE_LIMITS,
		ARCADE_ONLINE_RULE_DEFAULTS,
		ONLINE_GENERATOR_IDS,
		ONLINE_RULES_MODULE_IDS,
		type ArcadeNetcode,
		type ArcadeOnline,
		type GameConfigDoc,
		type GameConfigIssue,
	} from 'game-config';
	import { setNetcode } from './familyDoc';
	import {
		addAbility,
		addBot,
		addOnlineCharacter,
		addZoneRule,
		pointsText,
		removeAbility,
		removeBot,
		removeOnlineCharacter,
		removeZoneRule,
		setAbilityField,
		setBotField,
		setBotsField,
		setNearby,
		setOnlineCharacterField,
		setRoomInt,
		setRoomLayer,
		setRoomSpawn,
		setRoundField,
		setRulesModule,
		setZoneRuleField,
	} from './onlineDoc';

	/**
	 * An online arcade game's three `/config` sections (`arcade.online`, its `rules`, its `bots`;
	 * `docs/design/realtime-multiplayer.md` §7, §9). Rendered by `FamilySection` only for an arcade
	 * game played online. Every input goes through `./onlineDoc`; the validator judges.
	 */
	let {
		doc = $bindable(),
		online,
		issuesFor,
		readOnly,
	}: {
		doc: GameConfigDoc;
		online: ArcadeOnline;
		issuesFor: (prefix: string) => GameConfigIssue[];
		readOnly: boolean;
	} = $props();

	const NETCODE_LABELS: Record<ArcadeNetcode, string> = {
		engine: 'Engine — our own prediction (default)',
		colyseus: "Colyseus — the SDK's own prediction",
	};
	const ROOM_INTS = [
		['maxPlayers', 'Players a room holds', ARCADE_ONLINE_LIMITS.maxPlayers],
		['tickHz', 'Steps per second', ARCADE_ONLINE_LIMITS.tickHz],
		['subSteps', 'Sub-steps', ARCADE_ONLINE_LIMITS.subSteps],
		['patchHz', 'States per second', ARCADE_ONLINE_LIMITS.patchHz],
		['rejoinSeconds', 'Rejoin seconds', ARCADE_ONLINE_LIMITS.rejoinSeconds],
	] as const;

	const bodies = $derived(Object.keys(doc.arcade?.bodies ?? {}));
	const zones = $derived((doc.arcade?.zones ?? []).map((z) => z.id));
	const characters = $derived(online.characters.map((c) => c.id));
	const brains = $derived((doc.arcade?.characters ?? []).map((c) => c.id));
	const rules = $derived(online.rules);
	const bots = $derived(online.bots);
	/** A generator the room knows (the validator flags any other). */
	const generator = $derived(
		online.generator && ONLINE_GENERATOR_IDS.includes(online.generator)
			? online.generator
			: undefined,
	);
	let newBody = $state('');
	let newZone = $state('');
	let newBotCharacter = $state('');
	let newBotBrain = $state('');
</script>

{#snippet issueList(prefix: string)}
	{#each issuesFor(prefix) as issue (issue.path + issue.message)}
		<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
	{/each}
{/snippet}

{#snippet generated(what: string)}
	{#if generator}
		<p class="generated">
			Each room's generator (<code>{generator}</code>) replaces {what}; these are the authored ones.
		</p>
	{/if}
{/snippet}

{#snippet options(ids: string[], current: string)}
	{#if current && !ids.includes(current)}<option value={current}>{current}</option>{/if}
	{#each ids as id (id)}
		<option value={id}>{id}</option>
	{/each}
{/snippet}

<section>
	<h2>Online room</h2>
	<p class="hint">
		The game is played in rooms on the <strong>Invisible Game Server</strong>: the server steps
		every player and sends each device the room; a device sends its inputs only. Publish writes the
		server's address into the game's launch. A <strong>character</strong> is what a player can be: a body
		from the Arcade section and a speed. Empty numbers are the defaults.
	</p>
	<fieldset class="panel" disabled={readOnly}>
		<div class="row">
			{#each ROOM_INTS as [key, label, range] (key)}
				<label
					>{label}<input
						type="number"
						min={range.min}
						max={range.max}
						value={online[key] ?? ''}
						placeholder={String(ARCADE_ONLINE_DEFAULTS[key])}
						onchange={(e) => setRoomInt(doc, key, e.currentTarget.value)}
					/></label
				>
			{/each}
		</div>
		<div class="row">
			<label
				>Netcode<select
					value={online.netcode ?? ARCADE_ONLINE_DEFAULTS.netcode}
					onchange={(e) => setNetcode(doc, e.currentTarget.value)}
				>
					{#each ARCADE_NETCODES as netcode (netcode)}
						<option value={netcode}>{NETCODE_LABELS[netcode]}</option>
					{/each}
				</select></label
			>
			<label
				>Spawn x<input
					type="number"
					value={online.spawn?.x ?? ''}
					placeholder="centre"
					onchange={(e) => setRoomSpawn(doc, e.currentTarget.value, String(online.spawn?.y ?? ''))}
				/></label
			>
			<label
				>Spawn y<input
					type="number"
					value={online.spawn?.y ?? ''}
					placeholder="centre"
					onchange={(e) => setRoomSpawn(doc, String(online.spawn?.x ?? ''), e.currentTarget.value)}
				/></label
			>
			<label
				>Layer<input
					value={online.layer ?? ''}
					placeholder={ARCADE_ONLINE_DEFAULTS.layer}
					onchange={(e) => setRoomLayer(doc, e.currentTarget.value)}
				/></label
			>
			<label title="Send each device only the players inside this box around its own player"
				>Nearby width<input
					type="number"
					min={ARCADE_ONLINE_LIMITS.nearby.min}
					value={online.nearby?.w ?? ''}
					placeholder="everyone"
					onchange={(e) => setNearby(doc, e.currentTarget.value, String(online.nearby?.h ?? ''))}
				/></label
			>
			<label
				>Nearby height<input
					type="number"
					min={ARCADE_ONLINE_LIMITS.nearby.min}
					value={online.nearby?.h ?? ''}
					placeholder="everyone"
					onchange={(e) => setNearby(doc, String(online.nearby?.w ?? ''), e.currentTarget.value)}
				/></label
			>
		</div>
		{@render generated('the spawn')}
		<span class="legend">Characters <em>what a player can be</em></span>
		{@render generated("the characters' spawns")}
		{#if online.characters.length}
			<table class="tbl">
				<thead>
					<tr>
						<th>Character</th>
						<th>Body</th>
						<th>Speed</th>
						<th>Most</th>
						<th>Spawns <em>x, y; x, y</em></th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each online.characters as character, i (i)}
						<tr>
							<td
								><input
									value={character.id}
									onchange={(e) => setOnlineCharacterField(doc, i, 'id', e.currentTarget.value)}
								/></td
							>
							<td
								><select
									value={character.body}
									onchange={(e) => setOnlineCharacterField(doc, i, 'body', e.currentTarget.value)}
									>{@render options(bodies, character.body)}</select
								></td
							>
							<td
								><input
									type="number"
									min="1"
									value={character.speed}
									onchange={(e) => setOnlineCharacterField(doc, i, 'speed', e.currentTarget.value)}
								/></td
							>
							<td
								><input
									type="number"
									min="1"
									value={character.max ?? ''}
									placeholder="any"
									onchange={(e) => setOnlineCharacterField(doc, i, 'max', e.currentTarget.value)}
								/></td
							>
							<td
								><input
									class="wide"
									value={pointsText(character.spawns)}
									placeholder="room spawn"
									onchange={(e) => setOnlineCharacterField(doc, i, 'spawns', e.currentTarget.value)}
								/></td
							>
							<td
								><button class="del" title="Remove" onclick={() => removeOnlineCharacter(doc, i)}
									>×</button
								></td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
		<div class="row tight">
			{#if bodies.length}
				<select bind:value={newBody}>
					{#each bodies as id (id)}<option value={id}>{id}</option>{/each}
				</select>
				<button class="small" onclick={() => addOnlineCharacter(doc, newBody || bodies[0])}
					>Add character</button
				>
			{:else}
				<span class="hint">Add a body in the Arcade section first.</span>
			{/if}
		</div>
	</fieldset>
	{@render issueList('arcade.online.characters')}
	{@render issueList('arcade.online.maxPlayers')}
	{@render issueList('arcade.online.patchHz')}
	{@render issueList('arcade.online.spawn')}
	{@render issueList('arcade.online.nearby')}
</section>

<section>
	<h2>Online rules</h2>
	<p class="hint">
		What decides the game, run by the server. A <strong>zone rule</strong> makes a zone a current
		that pushes players (px/s), or the round's <strong>goal</strong>. An <strong>ability</strong> is a
		button that catches or stuns players of its target characters within its reach. A round ends at the
		goal or on its clock, and the next starts after a pause.
	</p>
	<fieldset class="panel" disabled={readOnly}>
		<div class="row">
			<label
				>Round seconds<input
					type="number"
					min={ARCADE_ONLINE_LIMITS.roundSeconds.min}
					value={rules?.round?.seconds ?? ''}
					placeholder="until the goal"
					onchange={(e) => setRoundField(doc, 'seconds', e.currentTarget.value)}
				/></label
			>
			<label
				>Pause between rounds<input
					type="number"
					min="0"
					value={rules?.round?.nextRoundSeconds ?? ''}
					placeholder={String(ARCADE_ONLINE_RULE_DEFAULTS.nextRoundSeconds)}
					onchange={(e) => setRoundField(doc, 'nextRoundSeconds', e.currentTarget.value)}
				/></label
			>
			<label
				>Goal score<input
					type="number"
					value={rules?.round?.goalScore ?? ''}
					placeholder={String(ARCADE_ONLINE_RULE_DEFAULTS.goalScore)}
					onchange={(e) => setRoundField(doc, 'goalScore', e.currentTarget.value)}
				/></label
			>
			<label
				>Rules module<select
					value={rules?.module ?? ''}
					onchange={(e) => setRulesModule(doc, e.currentTarget.value)}
				>
					<option value="">None</option>
					{@render options([...ONLINE_RULES_MODULE_IDS], rules?.module ?? '')}
				</select></label
			>
		</div>
		<span class="legend">Zone rules</span>
		{@render generated('the zone rules')}
		{#if rules?.zones?.length}
			<table class="tbl">
				<thead>
					<tr>
						<th>Zone</th>
						<th>Push x</th>
						<th>Push y</th>
						<th>Goal</th>
						<th>Characters</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each rules.zones as rule, i (i)}
						<tr>
							<td
								><select
									value={rule.zone}
									onchange={(e) => setZoneRuleField(doc, i, 'zone', e.currentTarget.value)}
									>{@render options(zones, rule.zone)}</select
								></td
							>
							<td
								><input
									type="number"
									value={rule.force?.x ?? 0}
									onchange={(e) => setZoneRuleField(doc, i, 'forceX', e.currentTarget.value)}
								/></td
							>
							<td
								><input
									type="number"
									value={rule.force?.y ?? 0}
									onchange={(e) => setZoneRuleField(doc, i, 'forceY', e.currentTarget.value)}
								/></td
							>
							<td
								><input
									type="checkbox"
									checked={rule.goal === true}
									onchange={(e) => setZoneRuleField(doc, i, 'goal', e.currentTarget.checked)}
								/></td
							>
							<td
								><input
									value={(rule.characters ?? []).join(', ')}
									placeholder="every one"
									onchange={(e) => setZoneRuleField(doc, i, 'characters', e.currentTarget.value)}
								/></td
							>
							<td
								><button class="del" title="Remove" onclick={() => removeZoneRule(doc, i)}>×</button
								></td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
		<div class="row tight">
			{#if zones.length}
				<select bind:value={newZone}>
					{#each zones as id (id)}<option value={id}>{id}</option>{/each}
				</select>
				<button class="small" onclick={() => addZoneRule(doc, newZone || zones[0])}
					>Add zone rule</button
				>
			{:else}
				<span class="hint">Add a zone in the Arcade section first.</span>
			{/if}
		</div>
		<span class="legend">Abilities</span>
		{#if rules?.abilities?.length}
			<table class="tbl">
				<thead>
					<tr>
						<th>Character</th>
						<th>Button</th>
						<th>Reach</th>
						<th>Targets</th>
						<th>Effect</th>
						<th>Holds ms</th>
						<th>Score</th>
						<th>Cooldown ms</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each rules.abilities as ability, i (i)}
						<tr>
							<td
								><select
									value={ability.character}
									onchange={(e) => setAbilityField(doc, i, 'character', e.currentTarget.value)}
									>{@render options(characters, ability.character)}</select
								></td
							>
							<td
								><select
									value={ability.button}
									onchange={(e) => setAbilityField(doc, i, 'button', e.currentTarget.value)}
								>
									<option value="ability1">ability1</option>
									<option value="ability2">ability2</option>
								</select></td
							>
							<td
								><input
									type="number"
									min="1"
									value={ability.reach}
									onchange={(e) => setAbilityField(doc, i, 'reach', e.currentTarget.value)}
								/></td
							>
							<td
								><input
									value={ability.targets.join(', ')}
									onchange={(e) => setAbilityField(doc, i, 'targets', e.currentTarget.value)}
								/></td
							>
							<td
								><select
									value={ability.effect}
									onchange={(e) => setAbilityField(doc, i, 'effect', e.currentTarget.value)}
								>
									<option value="catch">catch</option>
									<option value="stun">stun</option>
								</select></td
							>
							<td
								><input
									type="number"
									min="0"
									value={ability.ms ?? ''}
									placeholder={String(ARCADE_ONLINE_RULE_DEFAULTS.effectMs)}
									onchange={(e) => setAbilityField(doc, i, 'ms', e.currentTarget.value)}
								/></td
							>
							<td
								><input
									type="number"
									value={ability.score ?? ''}
									placeholder="0"
									onchange={(e) => setAbilityField(doc, i, 'score', e.currentTarget.value)}
								/></td
							>
							<td
								><input
									type="number"
									min={ARCADE_ONLINE_LIMITS.cooldownMs.min}
									value={ability.cooldownMs ?? ''}
									placeholder={String(ARCADE_ONLINE_RULE_DEFAULTS.cooldownMs)}
									onchange={(e) => setAbilityField(doc, i, 'cooldownMs', e.currentTarget.value)}
								/></td
							>
							<td
								><button class="del" title="Remove" onclick={() => removeAbility(doc, i)}>×</button
								></td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
		<div class="row tight">
			{#if characters.length}
				<button class="small" onclick={() => addAbility(doc)}>Add ability</button>
			{:else}
				<span class="hint">Add a character in Online room first.</span>
			{/if}
		</div>
	</fieldset>
	{@render issueList('arcade.online.rules')}
</section>

<section>
	<h2>Bots</h2>
	<p class="hint">
		Bots fill a room's empty places while anyone is in it, each playing an online character with a
		brain from Invisible Characters. A joining player takes a bot's place.
	</p>
	<fieldset class="panel" disabled={readOnly}>
		{#if bots}
			{@render generated("the bots' spawns")}
			<div class="row">
				<label
					>Fill room to<input
						type="number"
						min="0"
						max={ARCADE_ONLINE_LIMITS.fillTo.max}
						value={bots.fillTo ?? ''}
						placeholder={String(ARCADE_ONLINE_BOT_DEFAULTS.fillTo)}
						onchange={(e) => setBotsField(doc, 'fillTo', e.currentTarget.value)}
					/></label
				>
				<label class="inline"
					><input
						type="checkbox"
						checked={bots.canWin === true}
						onchange={(e) => setBotsField(doc, 'canWin', e.currentTarget.checked)}
					/>A bot can win</label
				>
				<label
					>Bot spawns <em>x, y; x, y</em><input
						class="wide"
						value={pointsText(bots.spawns)}
						placeholder="players' spawn"
						onchange={(e) => setBotsField(doc, 'spawns', e.currentTarget.value)}
					/></label
				>
			</div>
			<table class="tbl">
				<thead>
					<tr>
						<th>Plays</th>
						<th>Brain</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each bots.characters as bot, i (i)}
						<tr>
							<td
								><select
									value={bot.character}
									onchange={(e) => setBotField(doc, i, 'character', e.currentTarget.value)}
									>{@render options(characters, bot.character)}</select
								></td
							>
							<td
								><select
									value={bot.brain}
									onchange={(e) => setBotField(doc, i, 'brain', e.currentTarget.value)}
									>{@render options(brains, bot.brain)}</select
								></td
							>
							<td
								><button class="del" title="Remove" onclick={() => removeBot(doc, i)}>×</button></td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<p class="hint">No bots: a room holds only people.</p>
		{/if}
		<div class="row tight">
			{#if characters.length && brains.length}
				<select bind:value={newBotCharacter}>
					{#each characters as id (id)}<option value={id}>{id}</option>{/each}
				</select>
				<select bind:value={newBotBrain}>
					{#each brains as id (id)}<option value={id}>{id}</option>{/each}
				</select>
				<button
					class="small"
					onclick={() => addBot(doc, newBotCharacter || characters[0], newBotBrain || brains[0])}
					>Add bot</button
				>
			{:else}
				<span class="hint"
					>A bot needs an online character and a character with a brain in Invisible Characters.</span
				>
			{/if}
		</div>
	</fieldset>
	{@render issueList('arcade.online.bots')}
</section>

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
	em {
		font-style: normal;
		text-transform: none;
		letter-spacing: 0;
		color: #6f6f7d;
	}
	.generated {
		margin: 0 0 6px;
		font-size: 11px;
		color: #d3b483;
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
