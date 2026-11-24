<script lang="ts">
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import MenuButton, { type MenuGroup } from '$lib/MenuButton.svelte';
	import TouchSchemeSelect from '$lib/touch/TouchSchemeSelect.svelte';
	import { askConfirm } from '$lib/dialogs.svelte';
	import {
		TOUCH_ABILITY_LABELS,
		TOUCH_AIM_LABELS,
		TOUCH_CARD_ANCHOR,
		TOUCH_CARD_ID,
		TOUCH_GESTURE_LABELS,
		TOUCH_STEER_LABELS,
		classesUsingTouchScheme,
		gamePointerOf,
		touchChoicesOf,
		touchSchemeNames,
	} from '$lib/touch/touchSchemeText';
	import { resolve } from '$app/paths';
	import { withProject } from '$lib/toolLinks';
	import {
		ARCADE_NETCODES,
		ARCADE_ONLINE_BOT_DEFAULTS,
		ARCADE_ONLINE_DEFAULTS,
		ARCADE_ONLINE_LIMITS,
		ARCADE_ONLINE_RULE_DEFAULTS,
		ARCADE_POINTER_DEFAULTS,
		ARCADE_POINTER_LIMITS,
		ARCADE_POINTER_MOUSE_MODES,
		ARCADE_POINTER_TAP_BUTTONS,
		ARCADE_TOUCH_ABILITY_PRESSES,
		ARCADE_TOUCH_AIMS,
		ARCADE_TOUCH_DEFAULTS,
		ARCADE_TOUCH_GESTURES,
		ARCADE_TOUCH_LIMITS,
		ARCADE_TOUCH_PRESETS,
		ARCADE_TOUCH_STEERS,
		ONLINE_GENERATOR_IDS,
		ONLINE_RULES_MODULE_IDS,
		ONLINE_ZONE_KINDS,
		type ArcadeNetcode,
		type ArcadeOnline,
		type GameConfigDoc,
		type GameConfigIssue,
		botsByShares,
		onlineTestSizeRange,
	} from 'game-config';
	import { typed } from './bonusLabels';
	import { setNetcode } from './familyDoc';
	import {
		addAbility,
		addBot,
		addOnlineCharacter,
		addZoneRule,
		botShareRows,
		botShareSizes,
		classSheet,
		onlineClassIssues,
		pointsText,
		removeAbility,
		removeBot,
		removeOnlineCharacter,
		removeZoneRule,
		setAbilityField,
		setBotField,
		setBotShare,
		setBotsByShares,
		setBotsField,
		setNearby,
		setNearbyMax,
		setOnlineCharacterField,
		setPointerField,
		setPointerOn,
		setPointerTap,
		setRoomInt,
		setRoomLayer,
		setRoomSpawn,
		setLobbyField,
		setLobbyOn,
		setRoundField,
		setRulesModule,
		setZoneRuleField,
		sheetUnlinkedNote,
		testSizeParam,
		type SheetUnlinked,
	} from './onlineDoc';
	import {
		addTouchScheme,
		canAddTouchScheme,
		duplicateTouchScheme,
		removeTouchScheme,
		renameTouchScheme,
		setClassTouchScheme,
		setTouchSchemeField,
	} from './touchDoc';
	import PagedRows from './PagedRows.svelte';
	import SnapshotRows from './SnapshotRows.svelte';
	import {
		SOLID_CHOICES,
		ruleGroups,
		ruleText,
		ruleWhat,
		solidChoice,
		type GeneratedZones,
	} from './zones';
	import type { ArcadeOnlineZoneRule } from 'game-config';

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
		projectKey,
		level,
		editorHref,
	}: {
		doc: GameConfigDoc;
		online: ArcadeOnline;
		issuesFor: (prefix: string) => GameConfigIssue[];
		readOnly: boolean;
		/** The project the page edits: a sheet's link opens Invisible Characters on it. */
		projectKey: string;
		/** A generated game's level, as the Arcade section's zone map shows it: its zone rules are
		 *  the room's, and the config's are a snapshot. */
		level?: GeneratedZones;
		/** The Scene Editor on this project, where a generated game's levels are edited. */
		editorHref: string;
	} = $props();

	const NETCODE_LABELS: Record<ArcadeNetcode, string> = {
		engine: 'Engine — our own prediction (default)',
		colyseus: "Colyseus — the SDK's own prediction",
	};
	const MOUSE_LABELS: Record<(typeof ARCADE_POINTER_MOUSE_MODES)[number], string> = {
		hover: 'Follows the cursor (no button)',
		press: 'Only while the button is held',
	};
	const TAP_LABELS: Record<(typeof ARCADE_POINTER_TAP_BUTTONS)[number], string> = {
		jump: 'Jump (Space)',
		ability1: 'Ability 1 (J)',
		ability2: 'Ability 2 (K)',
	};
	const ROOM_INTS = [
		['maxPlayers', 'Room size', ARCADE_ONLINE_LIMITS.maxPlayers],
		['tickHz', 'Steps per second', ARCADE_ONLINE_LIMITS.tickHz],
		['subSteps', 'Sub-steps', ARCADE_ONLINE_LIMITS.subSteps],
		['patchHz', 'States per second', ARCADE_ONLINE_LIMITS.patchHz],
		['rejoinSeconds', 'Rejoin seconds', ARCADE_ONLINE_LIMITS.rejoinSeconds],
	] as const;

	const bodies = $derived(Object.keys(doc.arcade?.bodies ?? {}));
	const zones = $derived((doc.arcade?.zones ?? []).map((z) => z.id));
	const zoneIds = $derived(new Set(zones));
	/** The one list every zone picker reads (`<input list>`): a `<select>` of every id per rule
	 *  row was rows × zones options. */
	const uid = $props.id();
	const zoneList = `zones-${uid}`;
	const characters = $derived(online.characters.map((c) => c.id));
	const brains = $derived((doc.arcade?.characters ?? []).map((c) => c.id));
	const rules = $derived(online.rules);
	const pointer = $derived(online.pointer);
	const bots = $derived(online.bots);
	const byShares = $derived(botsByShares(bots));
	/** The room's own size, then the sample sizes the shares are shown at. */
	const shareSizes = $derived(botShareSizes(online));
	const shareRows = $derived(botShareRows(online, shareSizes));
	/** Each class's places at the room's size, where its share decides them. */
	const sharePlaces = $derived(
		Object.fromEntries(shareRows.map((row) => [row.character, row.counts[0]])),
	);
	const testSizes = $derived(onlineTestSizeRange(online));
	let testSize = $state('');
	const testParam = $derived(testSizeParam(online, testSize));
	let copied = $state(false);
	async function copyTestParam() {
		copied = await navigator.clipboard.writeText(testParam).then(
			() => true,
			() => false,
		);
	}
	/** A generator the room knows (the validator flags any other). */
	const generator = $derived(
		online.generator && ONLINE_GENERATOR_IDS.includes(online.generator)
			? online.generator
			: undefined,
	);
	/** Each class's character sheet (`sheet`, made in Invisible Characters), by row. */
	const sheets = $derived(online.characters.map((_, i) => classSheet(doc, i)));
	/** Invisible Characters, on this project, opened at a character. */
	const sheetHref = (id: string): string =>
		withProject(`${resolve('/characters')}?character=${encodeURIComponent(id)}`, projectKey);
	/** What the last change of a class's body did to its sheet link, said under the table. */
	let unlinked = $state<SheetUnlinked>();
	const sheetNote = $derived(
		unlinked &&
			online.characters.some((c) => c.id === unlinked?.classId && c.body === unlinked?.body)
			? sheetUnlinkedNote(unlinked)
			: '',
	);
	function setClassBody(index: number, value: string) {
		unlinked = setOnlineCharacterField(doc, index, 'body', value);
	}
	/** The touch schemes (`arcade.online.touch`): the one the panel edits is the picked one, or the
	 *  first. */
	const schemeNames = $derived(touchSchemeNames(doc));
	let pickedScheme = $state('');
	const schemeName = $derived(
		schemeNames.includes(pickedScheme) ? pickedScheme : (schemeNames[0] ?? ''),
	);
	const scheme = $derived(schemeName ? online.touch?.schemes[schemeName] : undefined);
	const schemeUsers = $derived(classesUsingTouchScheme(doc, schemeName));
	const gamePointer = $derived(gamePointerOf(doc));
	const presetMenu = $derived<MenuGroup[]>([
		{
			items: Object.entries(ARCADE_TOUCH_PRESETS).map(([id, preset]) => ({
				label: preset.label,
				title: preset.about,
				onSelect: () => {
					pickedScheme = addTouchScheme(doc, id) ?? pickedScheme;
				},
			})),
		},
	]);
	function renameScheme(field: HTMLInputElement) {
		if (renameTouchScheme(doc, schemeName, field.value)) pickedScheme = field.value.trim();
		else field.value = schemeName;
	}
	async function deleteScheme() {
		const name = schemeName;
		const users = schemeUsers;
		if (
			users.length &&
			!(await askConfirm({
				title: `Delete the touch scheme "${name}"?`,
				message: `${users.join(', ')} ${users.length === 1 ? 'uses' : 'use'} it and will have no touch scheme.`,
				confirmLabel: 'Delete',
				danger: true,
			}))
		)
			return;
		removeTouchScheme(doc, name);
	}
	/** A scheme's number as typed; the field then shows what was stored (a number over its limit
	 *  is held to it, one that cannot be read is cleared). */
	function typeSchemeNumber(
		field: 'deadZone' | 'tapPx' | 'tapMs' | 'targetRadius',
		input: HTMLInputElement,
	) {
		setTouchSchemeField(doc, schemeName, field, input.value);
		const stored = online.touch?.schemes[schemeName]?.[field];
		input.value = stored === undefined ? '' : String(stored);
	}
	let newBody = $state('');
	let newZone = $state('');
	/** A rule's kind is read by a rules module, so its column shows with one (or a kind to clear). */
	const showKind = $derived(!!rules?.module || !!rules?.zones?.some((r) => r.kind));
	type ZoneRuleField = Parameters<typeof setZoneRuleField>[2];
	/** The last zone-rule edit was refused (it would leave the rule doing nothing). */
	let ruleRefused = $state(false);
	const ruleFieldText = (rule: ArcadeOnlineZoneRule, field: ZoneRuleField): string =>
		({
			zone: rule.zone,
			forceX: String(rule.force?.x ?? 0),
			forceY: String(rule.force?.y ?? 0),
			goal: '',
			solid: solidChoice(rule.solid),
			kind: rule.kind ?? '',
			characters: (rule.characters ?? []).join(', '),
		})[field];
	/** A zone rule's field as set; a refused edit puts the control back to what is stored. */
	function editRule(
		index: number,
		field: ZoneRuleField,
		control: HTMLInputElement | HTMLSelectElement,
	) {
		const box =
			control instanceof HTMLInputElement && control.type === 'checkbox' ? control : undefined;
		ruleRefused = !setZoneRuleField(doc, index, field, box ? box.checked : control.value);
		const rule = online.rules?.zones?.[index];
		if (!ruleRefused || !rule) return;
		if (box) box.checked = rule.goal === true;
		else control.value = ruleFieldText(rule, field);
	}
	const ruleCells = (rule: ArcadeOnlineZoneRule): string[] => [
		rule.zone,
		ruleText({ ...rule, characters: undefined }),
		rule.characters?.join(', ') ?? 'every one',
	];
	let newBotCharacter = $state('');
	let newBotBrain = $state('');
	/** The spawn, the nearby box and its max are stored a pair at a time, so a field's change reads
	 *  both fields: the doc holds nothing of a pair half typed. */
	let spawnX = $state<HTMLInputElement>();
	let spawnY = $state<HTMLInputElement>();
	let nearbyW = $state<HTMLInputElement>();
	let nearbyH = $state<HTMLInputElement>();
	let nearbyMaxW = $state<HTMLInputElement>();
	let nearbyMaxH = $state<HTMLInputElement>();
	const typeSpawn = () => setRoomSpawn(doc, typed(spawnX), typed(spawnY));
	const typeNearby = () => setNearby(doc, typed(nearbyW), typed(nearbyH));
	const typeNearbyMax = () => setNearbyMax(doc, typed(nearbyMaxW), typed(nearbyMaxH));
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

<SectionCard scope="config" id="onlineRoom" title="Online room">
	{#snippet info()}
		<p>
			The game is played in rooms on the <strong>Invisible Game Server</strong>: the server steps
			every player and sends each device the room; a device sends its inputs only. Publish writes
			the server's address into the game's launch. A <strong>character</strong> is what a player can be:
			a body from the Arcade section and a speed. Empty numbers are the defaults.
		</p>
	{/snippet}
	<fieldset class="panel" disabled={readOnly}>
		<div class="row">
			{#each ROOM_INTS as [key, label, range] (key)}
				<label
					>{label}{#if key === 'maxPlayers'}<InfoTip
							>How many players a room holds, people and bots together: the one number the room's
							size is set by. With bots by shares the room is kept full, and each class's places
							follow from its share of this size. The game server holds a room to {range.min}–{range.max}
							players.</InfoTip
						>{/if}<input
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
					bind:this={spawnX}
					value={online.spawn?.x ?? ''}
					placeholder="centre"
					onchange={typeSpawn}
				/></label
			>
			<label
				>Spawn y<input
					type="number"
					bind:this={spawnY}
					value={online.spawn?.y ?? ''}
					placeholder="centre"
					onchange={typeSpawn}
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
					bind:this={nearbyW}
					value={online.nearby?.w ?? ''}
					placeholder="everyone"
					onchange={typeNearby}
				/></label
			>
			<label
				>Nearby height<input
					type="number"
					min={ARCADE_ONLINE_LIMITS.nearby.min}
					bind:this={nearbyH}
					value={online.nearby?.h ?? ''}
					placeholder="everyone"
					onchange={typeNearby}
				/></label
			>
			<label
				>Nearby max width<InfoTip
					>With a max, a device that says how much of the world its screen shows is also sent the
					players in that view: a window larger than the box was made for is sent more than the box,
					and no device is sent less. A player comes in as far as this size and, once sent, stays
					until a quarter past it, as with the box. A device that says nothing (a game not updated
					yet) and every bot have the box alone. Empty: every device has the box alone. It needs the
					box, and is not smaller than it.</InfoTip
				><input
					type="number"
					min={online.nearby?.w ?? ARCADE_ONLINE_LIMITS.nearby.min}
					max={ARCADE_ONLINE_LIMITS.nearby.max}
					bind:this={nearbyMaxW}
					value={online.nearby?.max?.w ?? ''}
					placeholder="the box"
					disabled={!online.nearby}
					onchange={typeNearbyMax}
				/></label
			>
			<label
				>Nearby max height<input
					type="number"
					min={online.nearby?.h ?? ARCADE_ONLINE_LIMITS.nearby.min}
					max={ARCADE_ONLINE_LIMITS.nearby.max}
					bind:this={nearbyMaxH}
					value={online.nearby?.max?.h ?? ''}
					placeholder="the box"
					disabled={!online.nearby}
					onchange={typeNearbyMax}
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
						<th
							>Sheet<InfoTip
								>The character whose sheet draws this class: its view, its animation source (frame
								clips, a rig or still images), its draw box and its actions. It is chosen in
								Invisible Characters and only shown here. The class and that character use the same
								component, so changing the body to another one removes the link.</InfoTip
							></th
						>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each online.characters as character, i (i)}
						{@const sheet = sheets[i]}
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
									onchange={(e) => setClassBody(i, e.currentTarget.value)}
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
								>{#if sharePlaces[character.id] !== undefined}<input
										type="number"
										value={sharePlaces[character.id]}
										title="Follows from its share of the room (Bots)"
										disabled
									/>{:else}<input
										type="number"
										min="1"
										value={character.max ?? ''}
										placeholder="any"
										onchange={(e) => setOnlineCharacterField(doc, i, 'max', e.currentTarget.value)}
									/>{/if}</td
							>
							<td
								><input
									class="wide"
									value={pointsText(character.spawns)}
									placeholder="room spawn"
									onchange={(e) => setOnlineCharacterField(doc, i, 'spawns', e.currentTarget.value)}
								/></td
							>
							<td class="sheet">
								{#if sheet}
									<!-- `sheetHref` resolves the route; the rule cannot see through the project scope. -->
									<!-- eslint-disable svelte/no-navigation-without-resolve -->
									<a
										href={sheetHref(sheet.id)}
										class:unused={!sheet.inForce}
										title={sheet.inForce
											? `Open "${sheet.id}" in Invisible Characters`
											: `Not in use: see the warning below. Open "${sheet.id}" in Invisible Characters`}
										>{sheet.id}</a
									>
									<!-- eslint-enable svelte/no-navigation-without-resolve -->
								{:else}
									<span class="none">none</span>
								{/if}
							</td>
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
	<div class="row test-size">
		<label
			>Test size<InfoTip
				>Plays a room of this many players instead of the room size, to try the game small. A test
				room is a room of its own: never the public one, and never bigger than the room size. Bots
				by shares are worked out for the test size. Add the parameter to the game's address.</InfoTip
			><input
				type="number"
				min={testSizes.min}
				max={testSizes.max}
				value={testSize}
				placeholder="{testSizes.min}–{testSizes.max}"
				oninput={(e) => {
					testSize = e.currentTarget.value;
					copied = false;
				}}
			/></label
		>
		{#if testParam}
			<code class="param">{testParam}</code>
			<button class="small" onclick={copyTestParam}>{copied ? 'Copied' : 'Copy'}</button>
		{/if}
	</div>
	{#if sheetNote}
		<p class="sheet-note" role="status">{sheetNote}</p>
	{/if}
	{@render issueList('arcade.online.characters')}
	{#each onlineClassIssues(issuesFor('arcade.online')) as issue (issue.path + issue.message)}
		<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
	{/each}
	{@render issueList('arcade.online.maxPlayers')}
	{@render issueList('arcade.online.patchHz')}
	{@render issueList('arcade.online.spawn')}
	{@render issueList('arcade.online.nearby')}
</SectionCard>

<div id={TOUCH_CARD_ANCHOR}>
	<SectionCard scope="config" id={TOUCH_CARD_ID} title="Mouse and touch">
		{#snippet info()}
			<p>
				Lets a player steer with the mouse or a finger, as well as the keys: the player heads for
				the point under the finger (or the cursor) at full speed and stops near it. A
				<strong>tap</strong> (or a click) presses the character's button there. The device turns the pointer
				into the same inputs as the keys, so the server still decides every move. Off, the game reads
				the keyboard only. Held keys win over the pointer.
			</p>
			<p>
				A <strong>touch scheme</strong> says what a finger's hold, tap and drag do on a phone. A scheme
				has a name and is given to a character; characters given the same scheme share it. A character
				with no scheme, and the mouse always, play as above.
			</p>
		{/snippet}
		<fieldset class="panel" disabled={readOnly}>
			<div class="row">
				<label class="check"
					><input
						type="checkbox"
						checked={!!pointer}
						onchange={(e) => setPointerOn(doc, e.currentTarget.checked)}
					/>Mouse and touch control</label
				>
				{#if pointer}
					<label
						>Mouse<select
							value={pointer.mouse ?? ARCADE_POINTER_DEFAULTS.mouse}
							onchange={(e) => setPointerField(doc, 'mouse', e.currentTarget.value)}
						>
							{#each ARCADE_POINTER_MOUSE_MODES as mode (mode)}
								<option value={mode}>{MOUSE_LABELS[mode]}</option>
							{/each}
						</select></label
					>
					<label
						>Stop within (px)<InfoTip
							>The player stops when it is this close to the pointer, so it does not jitter on it.</InfoTip
						><input
							type="number"
							min={ARCADE_POINTER_LIMITS.deadZone.min}
							max={ARCADE_POINTER_LIMITS.deadZone.max}
							value={pointer.deadZone ?? ''}
							placeholder={String(ARCADE_POINTER_DEFAULTS.deadZone)}
							onchange={(e) => setPointerField(doc, 'deadZone', e.currentTarget.value)}
						/></label
					>
					<label
						>Tap within (px)<InfoTip
							>A press that moves no further than this on the screen before it lifts is a tap;
							further, it only steered.</InfoTip
						><input
							type="number"
							min={ARCADE_POINTER_LIMITS.tapPx.min}
							max={ARCADE_POINTER_LIMITS.tapPx.max}
							value={pointer.tapPx ?? ''}
							placeholder={String(ARCADE_POINTER_DEFAULTS.tapPx)}
							onchange={(e) => setPointerField(doc, 'tapPx', e.currentTarget.value)}
						/></label
					>
				{/if}
			</div>
			{#if pointer && characters.length}
				<table class="tbl">
					<thead>
						<tr
							><th>Character</th><th>A tap presses</th><th
								>Touch scheme<InfoTip
									>What a finger does for this character on a phone: one of the schemes below.
									Characters given the same scheme share it, so a change to it changes them all.
									None: a finger plays as the mouse does.</InfoTip
								></th
							></tr
						>
					</thead>
					<tbody>
						{#each characters as id (id)}
							<tr>
								<td>{id}</td>
								<td
									><select
										value={pointer.taps?.[id] ?? ''}
										onchange={(e) => setPointerTap(doc, id, e.currentTarget.value)}
									>
										<option value="">Nothing (it only steers)</option>
										{#each ARCADE_POINTER_TAP_BUTTONS as button (button)}
											<option value={button}>{TAP_LABELS[button]}</option>
										{/each}
									</select></td
								>
								<td
									><TouchSchemeSelect
										{doc}
										classId={id}
										disabled={!schemeNames.length}
										onpick={(name) => setClassTouchScheme(doc, id, name)}
									/></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
			{#if pointer}
				<span class="legend"
					>Touch schemes<InfoTip
						>The project's touch schemes. Add one from a built-in preset (its settings are copied,
						so changing the scheme never changes the preset), then tune it and give it to a
						character in the table above.</InfoTip
					></span
				>
				<div class="row tight" data-touch-schemes>
					{#each schemeNames as name (name)}
						{@const users = classesUsingTouchScheme(doc, name)}
						<button
							type="button"
							class="scheme"
							class:on={name === schemeName}
							aria-pressed={name === schemeName}
							title={users.length ? `Used by ${users.join(', ')}` : 'No character uses it'}
							onclick={() => (pickedScheme = name)}>{name}<em>{users.length}</em></button
						>
					{/each}
					{#if canAddTouchScheme(doc)}
						<MenuButton label="Add a touch scheme from a preset" groups={presetMenu}
							>＋ Add scheme ▾</MenuButton
						>
					{:else}
						<span class="readonly">A project holds {ARCADE_TOUCH_LIMITS.schemes} schemes.</span>
					{/if}
				</div>
				{#if scheme}
					{#key schemeName}
						{@const choices = touchChoicesOf(scheme)}
						<div class="scheme-panel" data-touch-scheme={schemeName}>
							<div class="row">
								<label
									>Name<input
										class="wide"
										value={schemeName}
										onchange={(e) => renameScheme(e.currentTarget)}
									/></label
								>
								<button
									class="small"
									type="button"
									disabled={!canAddTouchScheme(doc)}
									onclick={() =>
										(pickedScheme = duplicateTouchScheme(doc, schemeName) ?? pickedScheme)}
									>Duplicate</button
								>
								<IconButton
									icon="trash"
									danger
									label="Delete this scheme"
									disabled={readOnly}
									onclick={deleteScheme}
								/>
								<span class="readonly" data-touch-users
									>{schemeUsers.length
										? `Used by ${schemeUsers.join(', ')}`
										: 'No character uses it'}</span
								>
							</div>
							<div class="row">
								<label
									>Gestures<InfoTip
										>What a finger does. Hold to steer: the player goes where a held finger says,
										for as long as it is down. Tap to head: a tap sets a heading the player keeps
										until the next tap, a tap on itself, a key or a wall. Both: either. Default:
										Hold to steer.</InfoTip
									><select
										value={choices.gestures}
										onchange={(e) =>
											setTouchSchemeField(doc, schemeName, 'gestures', e.currentTarget.value)}
									>
										{#each ARCADE_TOUCH_GESTURES as value (value)}
											<option {value}>{TOUCH_GESTURE_LABELS[value]}</option>
										{/each}
									</select></label
								>
								<label
									>Hold steers<InfoTip
										>Where a held finger sends the player. Towards the finger: to the point under
										it. Virtual stick: the way the finger was dragged from where it went down, like
										a stick. Default: Towards the finger.</InfoTip
									><select
										value={choices.steer}
										onchange={(e) =>
											setTouchSchemeField(doc, schemeName, 'steer', e.currentTarget.value)}
									>
										{#each ARCADE_TOUCH_STEERS as value (value)}
											<option {value}>{TOUCH_STEER_LABELS[value]}</option>
										{/each}
									</select></label
								>
								<label class="check"
									><input
										type="checkbox"
										checked={scheme.releaseStops !== false}
										onchange={(e) =>
											setTouchSchemeField(doc, schemeName, 'releaseStops', e.currentTarget.checked)}
									/>Lifting the finger stops<InfoTip
										>On: the player stops when a held finger lifts. Off: it keeps going the way it
										was headed. Default: on.</InfoTip
									></label
								>
							</div>
							<div class="row">
								<label
									>Dead zone around the player (field px)<InfoTip
										>A held finger this close to the player keeps the heading it has, and a tap this
										close stops the player. Empty: the game's ("Stop within" above).</InfoTip
									><input
										type="number"
										min={ARCADE_TOUCH_LIMITS.deadZone.min}
										max={ARCADE_TOUCH_LIMITS.deadZone.max}
										value={scheme.deadZone ?? ''}
										placeholder="the game's ({gamePointer.deadZone})"
										onchange={(e) => typeSchemeNumber('deadZone', e.currentTarget)}
									/></label
								>
								<label
									>Tap length (ms)<InfoTip
										>How long a press may last and still be a tap. 0: any length. Default: {ARCADE_TOUCH_DEFAULTS.tapMs}.</InfoTip
									><input
										type="number"
										min={ARCADE_TOUCH_LIMITS.tapMs.min}
										max={ARCADE_TOUCH_LIMITS.tapMs.max}
										value={scheme.tapMs ?? ''}
										placeholder={String(ARCADE_TOUCH_DEFAULTS.tapMs)}
										onchange={(e) => typeSchemeNumber('tapMs', e.currentTarget)}
									/></label
								>
								<label
									>Tap distance (px)<InfoTip
										>How far a press may move on the screen and still be a tap. Empty: the game's
										("Tap within" above).</InfoTip
									><input
										type="number"
										min={ARCADE_TOUCH_LIMITS.tapPx.min}
										max={ARCADE_TOUCH_LIMITS.tapPx.max}
										value={scheme.tapPx ?? ''}
										placeholder="the game's ({gamePointer.tapPx})"
										onchange={(e) => typeSchemeNumber('tapPx', e.currentTarget)}
									/></label
								>
							</div>
							<div class="row">
								<label
									>The ability is pressed by<InfoTip
										>How a finger presses the character's button ("A tap presses" above). Any tap:
										every tap presses it, and heads too where taps head. A tap on a target: only a
										tap on a target of the ability, which acts there and does not move the player. A
										second finger: a tap of another finger while one is held. An on-screen button:
										only its button on the screen. Default: Any tap.</InfoTip
									><select
										value={choices.ability}
										onchange={(e) =>
											setTouchSchemeField(doc, schemeName, 'ability', e.currentTarget.value)}
									>
										{#each ARCADE_TOUCH_ABILITY_PRESSES as value (value)}
											<option {value}>{TOUCH_ABILITY_LABELS[value]}</option>
										{/each}
									</select></label
								>
								<label
									>The ability is aimed<InfoTip
										>Where tapped: at the point the finger tapped. As a key press: the way a press
										of its key is aimed. Default: Where tapped.</InfoTip
									><select
										value={choices.aim}
										onchange={(e) =>
											setTouchSchemeField(doc, schemeName, 'aim', e.currentTarget.value)}
									>
										{#each ARCADE_TOUCH_AIMS as value (value)}
											<option {value}>{TOUCH_AIM_LABELS[value]}</option>
										{/each}
									</select></label
								>
								{#if scheme.ability === 'target'}
									<label
										>Target radius (field px)<InfoTip
											>How near a target a tap must land to count as on it. Default: {ARCADE_TOUCH_DEFAULTS.targetRadius}.</InfoTip
										><input
											type="number"
											min={ARCADE_TOUCH_LIMITS.targetRadius.min}
											max={ARCADE_TOUCH_LIMITS.targetRadius.max}
											value={scheme.targetRadius ?? ''}
											placeholder={String(ARCADE_TOUCH_DEFAULTS.targetRadius)}
											onchange={(e) => typeSchemeNumber('targetRadius', e.currentTarget)}
										/></label
									>
								{/if}
							</div>
						</div>
					{/key}
				{/if}
			{/if}
		</fieldset>
		{@render issueList('arcade.online.pointer')}
		{@render issueList('arcade.online.touch')}
	</SectionCard>
</div>

<SectionCard scope="config" id="onlineRules" title="Online rules">
	{#snippet info()}
		<p>
			What decides the game, run by the server. A <strong>zone rule</strong> makes a zone a current
			that pushes players (px/s), a wall (<strong>solid</strong> from every side or from one), a
			<strong>kind</strong> the rules module acts on, or the round's <strong>goal</strong>. An
			<strong>ability</strong> is a button that catches, stuns or hooks players of its target characters
			within its reach. A round ends at the goal or on its clock, and the next starts after a pause.
		</p>
	{/snippet}
	<div class="panel">
		<fieldset class="group" disabled={readOnly}>
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
			<div class="row">
				<label class="check"
					><input
						type="checkbox"
						checked={!!rules?.lobby}
						onchange={(e) => setLobbyOn(doc, e.currentTarget.checked)}
					/>Lobby<InfoTip
						>Players wait on the lobby screen before the first round, until the lobby has its
						players or has waited long enough, then a countdown runs. Unticked, the first player to
						join starts the round.</InfoTip
					></label
				>
				{#if rules?.lobby}
					<label
						>Players to start<input
							type="number"
							min="1"
							value={rules.lobby.minPlayers ?? ''}
							placeholder={String(ARCADE_ONLINE_RULE_DEFAULTS.lobbyMinPlayers)}
							onchange={(e) => setLobbyField(doc, 'minPlayers', e.currentTarget.value)}
						/></label
					>
					<label
						>Longest wait (s)<input
							type="number"
							min="0"
							value={rules.lobby.maxWaitSeconds ?? ''}
							placeholder={String(ARCADE_ONLINE_RULE_DEFAULTS.lobbyMaxWaitSeconds)}
							onchange={(e) => setLobbyField(doc, 'maxWaitSeconds', e.currentTarget.value)}
						/></label
					>
					<label
						>Countdown (s)<input
							type="number"
							min="0"
							value={rules.lobby.countdownSeconds ?? ''}
							placeholder={String(ARCADE_ONLINE_RULE_DEFAULTS.lobbyCountdownSeconds)}
							onchange={(e) => setLobbyField(doc, 'countdownSeconds', e.currentTarget.value)}
						/></label
					>
				{/if}
			</div>
			{@render issueList('arcade.online.rules.lobby')}
			{@render issueList('arcade.online.rules.lobby.minPlayers')}
		</fieldset>
		{#if level}
			<span class="legend"
				>Zone rules<InfoTip label="Made per room"
					>Each room's generator makes the zone rules with its zones, from the room's seed: the
					currents, the walls, the kinds its rules module acts on and the goal. No zone rule stored
					in the config is played. The counts are the level the Arcade section's zone map shows.</InfoTip
				></span
			>
			<p class="status">
				Each room's <code>{generator}</code> makes its zone rules from its seed: seed {level.seed}
				makes {level.rules.length.toLocaleString('en')}.
				<!-- `editorHref` resolves the route; the rule cannot see through the project scope. -->
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={editorHref}>Levels in the Scene Editor</a>
			</p>
			<div class="chips">
				{#each ruleGroups(level.rules) as group (group.label)}
					<span class="chip">{group.label} × {group.count}</span>
				{/each}
			</div>
			{#if rules?.zones?.length}
				<SnapshotRows
					items={rules.zones}
					noun="zone rules"
					columns={['Zone', 'Does', 'Characters']}
					cells={ruleCells}
				/>
			{/if}
		{:else}
			<span class="legend">Zone rules</span>
			<datalist id={zoneList}>
				{#each zones as id (id)}<option value={id}></option>{/each}
			</datalist>
			{#if rules?.zones?.length}
				<PagedRows
					items={rules.zones}
					noun="zone rules"
					text={(rule) => `${rule.zone} ${ruleWhat(rule)} ${(rule.characters ?? []).join(' ')}`}
				>
					{#snippet rows(page)}
						<fieldset class="group" disabled={readOnly}>
							<table class="tbl">
								<thead>
									<tr>
										<th>Zone</th>
										<th>Push x</th>
										<th>Push y</th>
										<th
											title="Stops a moving player: from every side, or only one coming from that side"
											>Solid</th
										>
										{#if showKind}<th title="What the rules module makes of the zone">Kind</th>{/if}
										<th>Goal</th>
										<th>Characters</th>
										<th></th>
									</tr>
								</thead>
								<tbody>
									{#each page as { item: rule, index: i } (i)}
										<tr>
											<td
												><input
													list={zoneList}
													value={rule.zone}
													onchange={(e) => editRule(i, 'zone', e.currentTarget)}
												/></td
											>
											<td
												><input
													type="number"
													value={rule.force?.x ?? 0}
													onchange={(e) => editRule(i, 'forceX', e.currentTarget)}
												/></td
											>
											<td
												><input
													type="number"
													value={rule.force?.y ?? 0}
													onchange={(e) => editRule(i, 'forceY', e.currentTarget)}
												/></td
											>
											<td
												><select
													value={solidChoice(rule.solid)}
													onchange={(e) => editRule(i, 'solid', e.currentTarget)}
												>
													{#each SOLID_CHOICES as [value, label] (value)}
														<option {value}>{label}</option>
													{/each}
												</select></td
											>
											{#if showKind}
												<td
													><select
														value={rule.kind ?? ''}
														onchange={(e) => editRule(i, 'kind', e.currentTarget)}
													>
														<option value="">—</option>
														{@render options([...ONLINE_ZONE_KINDS], rule.kind ?? '')}
													</select></td
												>
											{/if}
											<td
												><input
													type="checkbox"
													checked={rule.goal === true}
													onchange={(e) => editRule(i, 'goal', e.currentTarget)}
												/></td
											>
											<td
												><input
													value={(rule.characters ?? []).join(', ')}
													placeholder="every one"
													onchange={(e) => editRule(i, 'characters', e.currentTarget)}
												/></td
											>
											<td
												><button class="del" title="Remove" onclick={() => removeZoneRule(doc, i)}
													>×</button
												></td
											>
										</tr>
									{/each}
								</tbody>
							</table>
						</fieldset>
					{/snippet}
				</PagedRows>
			{/if}
			{#if ruleRefused}
				<p class="sheet-note" role="status">
					A zone rule must push, be the goal, be solid or have a kind: that change was not taken.
				</p>
			{/if}
			<fieldset class="group" disabled={readOnly}>
				<div class="row tight">
					{#if zones.length}
						<input
							class="wide"
							list={zoneList}
							placeholder="zone id"
							aria-label="The zone of a new rule"
							bind:value={newZone}
						/>
						<button
							class="small"
							disabled={!zoneIds.has(newZone.trim())}
							onclick={() => {
								addZoneRule(doc, newZone);
								newZone = '';
							}}>Add zone rule</button
						>
					{:else}
						<span class="hint">Add a zone in the Arcade section first.</span>
					{/if}
				</div>
			</fieldset>
		{/if}
		<fieldset class="group" disabled={readOnly}>
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
										<option value="hook">hook</option>
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
									><button class="del" title="Remove" onclick={() => removeAbility(doc, i)}
										>×</button
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
	</div>
	{@render issueList('arcade.online.rules')}
</SectionCard>

<SectionCard scope="config" id="bots" title="Bots">
	{#snippet info()}
		<p>
			Bots fill a room's empty places while anyone is in it, each playing an online character with a
			brain from Invisible Characters. A joining player takes a bot's place.
		</p>
	{/snippet}
	<fieldset class="panel" disabled={readOnly}>
		{#if bots}
			{@render generated("the bots' spawns")}
			<div class="row">
				<label class="inline"
					><input
						type="checkbox"
						checked={byShares}
						onchange={(e) => setBotsByShares(doc, e.currentTarget.checked)}
					/>By shares<InfoTip
						>Ticked, each bot is a class with a share of the room: the room is kept full, and a
						class's places are its share of the room size (Online room), rounded so they add up to
						it and no class has none. Shares are relative: 60 / 25 / 15 and 12 / 5 / 3 are the same.
						Ticking it turns each class's Most into its share and removes Fill room to; unticking it
						writes the places back as each class's Most and fills the room to its size.</InfoTip
					></label
				>
				{#if byShares}
					<span class="derived">Room kept full: {shareSizes[0]}</span>
				{:else}
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
				{/if}
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
						{#if byShares}
							<th>Share</th>
							<th>Of the room</th>
							{#each shareSizes as size, n (size)}
								<th title="Its bots in an empty room of {size}, and its places"
									>{n ? `At ${size}` : `Places (${size})`}</th
								>
							{/each}
						{/if}
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
							{#if byShares}
								{@const row = shareRows.find((r) => r.character === bot.character)}
								<td
									><input
										type="number"
										min={ARCADE_ONLINE_LIMITS.botShare.min}
										max={ARCADE_ONLINE_LIMITS.botShare.max}
										step="any"
										value={bot.share}
										onchange={(e) => setBotShare(doc, i, e.currentTarget.value)}
									/></td
								>
								<td class="readonly">{row ? `${row.percent}%` : '—'}</td>
								{#each shareSizes as size, n (size)}
									<td class="readonly">{row?.counts[n] ?? '—'}</td>
								{/each}
							{/if}
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
</SectionCard>

<style>
	.readonly {
		font-size: 12px;
		color: #8b8b98;
		white-space: nowrap;
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
	fieldset.group {
		min-width: 0;
		margin: 0;
		border: 0;
		padding: 0;
	}
	.status {
		margin: 0 0 6px;
		font-size: 12px;
		color: #b9b9c4;
	}
	.status a {
		margin-left: 8px;
		color: #7ee0c0;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 6px;
		margin: 0 0 8px;
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
	select,
	.tbl :global(select) {
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
	select:focus,
	.tbl :global(select:focus) {
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
	.scheme {
		background: #101017;
		border: 1px solid #26262f;
		color: #b9b9c4;
		border-radius: 6px;
		padding: 4px 10px;
		font-size: 12px;
		cursor: pointer;
	}
	.scheme.on {
		border-color: #7ee0c0;
		color: #e8e8ee;
	}
	.scheme em {
		margin-left: 6px;
	}
	.scheme-panel {
		margin-top: 8px;
		padding-top: 10px;
		border-top: 1px solid #1c1c24;
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
	.sheet a {
		color: #7ee0c0;
	}
	.sheet a.unused {
		color: #d3b483;
		text-decoration: line-through;
	}
	.sheet .none {
		color: #6f6f7d;
	}
	.row.test-size {
		margin-top: 8px;
		align-items: center;
	}
	.param {
		font-size: 12px;
		color: #e8e8ee;
		user-select: all;
	}
	.derived {
		font-size: 12px;
		color: #8b8b98;
	}
	.sheet-note {
		margin: 8px 0 0;
		font-size: 12px;
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
