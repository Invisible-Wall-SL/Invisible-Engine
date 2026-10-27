<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import {
		ARCADE_BEHAVIOURS,
		ARCADE_BODY_EDGES,
		ARCADE_CONDITIONS,
		ARCADE_CONTROLLER_ACTIONS,
		ARCADE_JUMP_ACTION,
		ARCADE_POINTER_AXES,
		ARCADE_VARIABLE_OPS,
		resolveArcade,
		resolveFamily,
		validateGameConfigDoc,
		type ArcadeAnimSource,
		type ArcadeBehaviourKind,
		type ArcadeBodyEdges,
		type ArcadeCondition,
		type GameConfigDoc,
		type GameConfigIssue,
	} from 'game-config';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import PresenceBanner from '$lib/PresenceBanner.svelte';
	import { SaveState } from '$lib/saveState.svelte';
	import { LeaseState } from '$lib/leaseState.svelte';
	import { guardUnsavedWork } from '$lib/unsavedGuard';
	import { askConfirm } from '$lib/dialogs.svelte';
	import { writeDrag } from '$lib/graph/dnd';
	import type { BrainSelection } from '$lib/characters/brainGraph';
	import * as edit from '$lib/characters/characterEdit';
	import * as body from '../config/familyDoc';
	import { adoptSaved, bodyFor, openDoc } from '../config/pageDoc';
	import BrainCanvas from './BrainCanvas.svelte';
	import CharacterSandbox from './CharacterSandbox.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** The whole game config, as `/config` holds it (the characters live in it, §9 #14), PUT back
	 *  whole through the same endpoint under the same lease. */
	const initial = openDoc((data.doc ?? data.templateDefault ?? {}) as GameConfigDoc);
	let doc = $state<GameConfigDoc>(JSON.parse(JSON.stringify(initial)) as GameConfigDoc);
	let baseline = $state(JSON.stringify(initial));
	const dirty = $derived(JSON.stringify($state.snapshot(doc)) !== baseline);
	const snapshot = $derived($state.snapshot(doc) as GameConfigDoc);
	let savedAt = $state<string | null>(null);

	const arcade = $derived(resolveFamily(snapshot) === 'arcade');
	const issues = $derived(validateGameConfigDoc(snapshot));
	const errors = $derived(issues.filter((i) => i.severity === 'error'));
	const otherErrors = $derived(errors.filter((i) => !i.path.startsWith('arcade.characters')));
	const resolved = $derived(resolveArcade(snapshot));
	/** The field the sandbox plays on: the config's, or a 1280 × 720 stand-in for the screen's. */
	const field = $derived(resolved.field ?? { w: 1280, h: 720 });

	const characters = $derived(snapshot.arcade?.characters ?? []);
	let selectedId = $state<string | null>(initial.arcade?.characters?.[0]?.id ?? null);
	const index = $derived(characters.findIndex((c) => c.id === selectedId));
	const character = $derived(index >= 0 ? characters[index] : undefined);
	const mine = $derived(index >= 0 ? edit.characterIssues(issues, index) : []);
	const look = $derived(data.components.find((c) => c.id === character?.component));
	const lookBody = $derived(character ? resolved.bodies[character.component] : undefined);

	/** Bumped on every brain edit, so the canvas rebuilds. */
	let brainVersion = $state(0);
	let selection = $state<BrainSelection>(null);
	let liveState = $state<string | undefined>(undefined);
	let renameText = $state('');
	let renameError = $state('');
	let stateRename = $state('');
	let stateRenameError = $state('');
	let newLook = $state('');

	const lease = new LeaseState({
		toolId: 'gameConfig',
		clientKey: data.clientKey,
		projectKey: data.projectKey,
		docKey: 'gameConfig',
		enabled: data.projectKey.length > 0,
	});
	const readOnly = $derived(lease.readOnly || !arcade);

	const saveState = new SaveState({
		initialEtag: data.etag,
		conflictMessage: 'Someone else saved this game config while you were editing.',
		blockWhen: () => lease.readOnly,
		save: async ({ baseEtag, force }) => {
			const res = await fetch(`/api/game-config?project=${encodeURIComponent(data.projectKey)}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					doc: bodyFor($state.snapshot(doc) as GameConfigDoc),
					baseEtag,
					force,
				}),
			});
			if (res.status === 409) {
				const c = (await res.json()) as { message?: string };
				return { ok: false, reason: 'conflict', message: c.message };
			}
			if (res.status === 400) {
				const c = (await res.json()) as { issues?: GameConfigIssue[] };
				const n = c.issues?.length ?? 0;
				return {
					ok: false,
					reason: 'error',
					message: n
						? `Can't save: ${n} blocking ${n === 1 ? 'issue' : 'issues'}.`
						: "This config can't be saved.",
				};
			}
			if (!res.ok) {
				return { ok: false, reason: 'error', message: (await res.text()) || `HTTP ${res.status}` };
			}
			const saved = (await res.json()) as { doc: GameConfigDoc; etag: string | null };
			doc = adoptSaved(saved.doc);
			baseline = JSON.stringify($state.snapshot(doc));
			savedAt = new Date().toLocaleTimeString();
			brainVersion += 1;
			return { ok: true, etag: saved.etag };
		},
	});
	const save = (force = false) => void saveState.save({ force });

	onMount(() => {
		void lease.start();
		const onUnload = () => lease.release();
		window.addEventListener('pagehide', onUnload);
		return () => {
			window.removeEventListener('pagehide', onUnload);
			lease.release();
		};
	});

	guardUnsavedWork(() =>
		dirty
			? {
					title: 'The characters have unsaved changes',
					message: 'Leaving this page discards them.',
					confirmLabel: 'Leave anyway',
					danger: true,
				}
			: null,
	);

	$effect(() => {
		renameText = character?.id ?? '';
		renameError = '';
	});
	$effect(() => {
		stateRename = selection?.kind === 'state' ? selection.id : '';
		stateRenameError = '';
	});

	/** Run one edit against the live doc; a brain edit rebuilds the canvas. */
	function change(run: (d: GameConfigDoc) => void, brain = false): void {
		if (readOnly) return;
		run(doc);
		if (brain) brainVersion += 1;
	}
	const cid = () => character?.id ?? '';

	const usedLooks = $derived(new Set(characters.map((c) => c.component)));
	const freeLooks = $derived(data.components.filter((c) => !usedLooks.has(c.id)));
	$effect(() => {
		if (!newLook || !freeLooks.some((c) => c.id === newLook)) newLook = freeLooks[0]?.id ?? '';
	});

	function addCharacter(): void {
		change((d) => {
			const id = edit.addCharacter(d, newLook);
			if (id) selectedId = id;
		});
		selection = null;
	}
	function duplicate(): void {
		change((d) => {
			const id = edit.duplicateCharacter(d, cid());
			if (id) selectedId = id;
		});
	}
	async function remove(): Promise<void> {
		if (!character) return;
		const ok = await askConfirm({
			title: `Delete "${character.id}"?`,
			message:
				'Its brain, controller, movement and anim inputs go with it. Its component and its body stay. Nothing is saved until you press Save.',
			confirmLabel: 'Delete',
			danger: true,
		});
		if (!ok) return;
		change((d) => edit.removeCharacter(d, cid()));
		selectedId = characters[0]?.id ?? null;
		selection = null;
	}
	function rename(): void {
		const from = cid();
		let refused: string | null = null;
		change((d) => (refused = edit.renameCharacter(d, from, renameText)));
		if (refused) renameError = refused;
		else selectedId = renameText.trim() || from;
	}

	// ── brain ──
	const BRAIN_MIME = 'application/x-iw-brain-behaviour';
	const brain = $derived(character?.brain);
	const selectedState = $derived(
		selection?.kind === 'state' ? brain?.states.find((s) => s.id === selection!.id) : undefined,
	);
	const selectedTransition = $derived(
		selection?.kind === 'transition'
			? brain?.transitions.find((t) => t.id === selection!.id)
			: undefined,
	);
	const brokenIds = $derived(
		new Set(
			index < 0
				? []
				: [
						...(brain?.states ?? [])
							.filter((_, k) => edit.brainItemIssues(issues, index, 'states', k).length)
							.map((s) => s.id),
						...(brain?.transitions ?? [])
							.filter((_, k) => edit.brainItemIssues(issues, index, 'transitions', k).length)
							.map((t) => t.id),
					],
		),
	);
	const stateIndex = $derived(
		selectedState && brain ? brain.states.findIndex((s) => s.id === selectedState.id) : -1,
	);
	const transitionIndex = $derived(
		selectedTransition && brain
			? brain.transitions.findIndex((t) => t.id === selectedTransition.id)
			: -1,
	);

	function addState(behaviour: ArcadeBehaviourKind, pos?: { x: number; y: number }): void {
		change((d) => {
			const id = edit.addState(d, cid(), behaviour, pos);
			if (id) selection = { kind: 'state', id };
		}, true);
	}
	function renameSelectedState(): void {
		if (!selectedState) return;
		const from = selectedState.id;
		let refused: string | null = null;
		change((d) => (refused = edit.renameState(d, cid(), from, stateRename)), true);
		if (refused) stateRenameError = refused;
		else selection = { kind: 'state', id: stateRename.trim() || from };
	}
	const paramValue = (key: string): string | boolean | undefined => {
		const v = selectedState?.params?.[key];
		return typeof v === 'number' ? String(v) : v;
	};

	// ── anim inputs ──
	const mappedInputs = $derived(Object.keys(character?.animInputs ?? {}));
	const lookInputs = $derived(look?.inputs ?? []);
	const strayInputs = $derived(mappedInputs.filter((id) => !lookInputs.some((i) => i.id === id)));
	const sources = $derived(character ? edit.animSourcesFor(character) : []);
	const sourceFits = (kind: 'bool' | 'number', source: ArcadeAnimSource): boolean =>
		edit.animSourceIsBool(source) === (kind === 'bool');

	// ── jump ──
	const jump = $derived(edit.jumpOf(character));
	const jumpKind = $derived(
		character?.controller ? edit.JUMP_KIND_FOR[character.controller.kind] : undefined,
	);
	const profile = $derived(jump ? edit.jumpHint(jump) : undefined);
	const JUMP_FIELDS: { key: edit.JumpField; label: string; hint: string }[] = [
		{ key: 'height', label: 'Height px', hint: 'to the apex' },
		{ key: 'time', label: 'Time s', hint: 'from take-off to the apex' },
		{ key: 'minHeight', label: 'Tap height px', hint: 'empty ⇒ every jump is full height' },
		{ key: 'coyoteMs', label: 'Coyote ms', hint: 'a press this late after a ledge still jumps' },
		{ key: 'bufferMs', label: 'Buffer ms', hint: 'a press this early before landing jumps' },
		{ key: 'airControl', label: 'Air control 0–1', hint: 'how much you steer in the air' },
	];

	/**
	 * After an edit, show what the doc holds: a value an edit refused leaves the doc unchanged, so
	 * Svelte would not re-render the input and the refused text would stay on screen.
	 */
	function settle(el: HTMLInputElement | HTMLSelectElement, stored: unknown): void {
		const text = stored === undefined ? '' : String(stored);
		if (el.value !== text) el.value = text;
	}
	const liveCharacter = () => edit.findCharacter(doc, cid());
	const liveBrainState = (sid: string) => liveCharacter()?.brain?.states.find((s) => s.id === sid);
	function conditionValue(tid: string, ci: number, field: edit.ConditionField): unknown {
		const c = liveCharacter()?.brain?.transitions.find((t) => t.id === tid)?.when[ci];
		return c ? (c as Record<string, unknown>)[field] : undefined;
	}

	const issueText = (list: GameConfigIssue[]) => list.map((i) => i.message).join(' ');
	const num = (v: number | undefined) => (v === undefined ? '' : String(v));
</script>

<svelte:head><title>Invisible Characters — {data.projectKey}</title></svelte:head>

<div class="page">
	<ToolTopBar
		current="characters"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.projectKey}
	>
		{#snippet meta()}
			{#if lease.readOnly}
				<PresenceBanner {lease} />
			{:else}
				{#if errors.length}<span class="pill err"
						>{errors.length} error{errors.length === 1 ? '' : 's'}</span
					>{/if}
				{#if saveState.status === 'error'}<span class="err">{saveState.message}</span>{/if}
				{#if dirty}<span class="pill dirty">Unsaved</span>{:else if savedAt}<span class="pill"
						>Saved {savedAt}</span
					>{/if}
			{/if}
			<button
				class="save"
				onclick={() => save()}
				disabled={readOnly || saveState.busy || !dirty || errors.length > 0}
			>
				{saveState.busy ? 'Saving…' : 'Save'}
			</button>
		{/snippet}
	</ToolTopBar>

	<div class="body">
		{#if saveState.status === 'conflict'}
			<div class="conflict">
				<p>{saveState.message}</p>
				<p class="sub">
					Your edits are still on this page. Reload to take their version (your unsaved edits go),
					or overwrite with yours.
				</p>
				<button onclick={() => location.reload()}>Reload theirs</button>
				<button class="danger" onclick={() => save(true)}>Overwrite with mine</button>
			</div>
		{/if}
		<p class="intro">
			The things on <b>{data.projectName ?? data.projectKey}</b>'s play field that move by
			themselves: a <b>look</b> (a component), a <b>body</b>, <b>movement</b>, a <b>controller</b>
			when the player drives it and a <b>brain</b> when it acts on its own. They are saved in the
			game config, so
			<a href={resolve('/config')}>Invisible Game Config</a> and this tool share one edit lease.
		</p>
		{#if !arcade}
			<p class="warn">
				This project's config is not an arcade config, so it has no characters. Set its family in
				Invisible Game Config first.
			</p>
		{/if}
		{#if otherErrors.length}
			<p class="warn">
				The config has {otherErrors.length} other error{otherErrors.length === 1 ? '' : 's'} outside the
				characters, which block Save: fix {otherErrors.length === 1 ? 'it' : 'them'} in Invisible Game
				Config. ({issueText(otherErrors)})
			</p>
		{/if}

		<div class="split">
			<aside class="list">
				<h2>Characters</h2>
				{#each characters as c, i (c.id)}
					<button
						type="button"
						class="row"
						class:on={c.id === selectedId}
						onclick={() => {
							selectedId = c.id;
							selection = null;
						}}
					>
						<span class="id">{c.name ?? c.id}</span>
						<span class="meta"
							>{c.component}{c.controller ? ' · played' : ''}{c.brain ? ' · brain' : ''}</span
						>
						{#if edit.characterIssues(issues, i).some((x) => x.severity === 'error')}<span
								class="dot"
								title="Has errors">●</span
							>{/if}
					</button>
				{:else}
					<p class="hint">No characters yet.</p>
				{/each}
				<div class="add">
					<select bind:value={newLook} disabled={readOnly || !freeLooks.length}>
						{#each freeLooks as c (c.id)}<option value={c.id}>{c.name || c.id}</option>{/each}
					</select>
					<button
						type="button"
						onclick={addCharacter}
						disabled={readOnly || !newLook}
						title="A character whose look is this component">＋ Add</button
					>
				</div>
				<p class="hint">A component is the look of one character at most.</p>
			</aside>

			<main class="detail">
				{#if !character}
					<p class="hint">Pick a character on the left, or add one.</p>
				{:else}
					{#if mine.length}
						<ul class="issues">
							{#each mine as issue (issue.path + issue.message)}
								<li class={issue.severity}>{issue.message}</li>
							{/each}
						</ul>
					{/if}

					<section>
						<h2>Character</h2>
						<div class="grid">
							<label
								>Id
								<span class="inline">
									<input bind:value={renameText} disabled={readOnly} spellcheck="false" />
									<button
										type="button"
										onclick={rename}
										disabled={readOnly || renameText.trim() === character.id}>Rename</button
									>
								</span>
								{#if renameError}<span class="err">{renameError}</span>{/if}
							</label>
							<label
								>Name
								<input
									value={character.name ?? ''}
									placeholder={character.id}
									disabled={readOnly}
									onchange={(e) =>
										change((d) => edit.setCharacterName(d, cid(), e.currentTarget.value))}
								/>
							</label>
							<label
								>Look (component)
								<select
									value={character.component}
									disabled={readOnly}
									onchange={(e) => change((d) => edit.setLook(d, cid(), e.currentTarget.value))}
								>
									{#if !look}<option value={character.component}
											>{character.component} (not found)</option
										>{/if}
									{#each data.components as c (c.id)}<option value={c.id}>{c.name || c.id}</option
										>{/each}
								</select>
							</label>
						</div>
						<div class="actions">
							<button type="button" onclick={duplicate} disabled={readOnly}>Duplicate</button>
							<button type="button" class="danger" onclick={remove} disabled={readOnly}
								>Delete</button
							>
						</div>
					</section>

					<section>
						<h2>Body</h2>
						<p class="hint">
							The body of <code>{character.component}</code> — the same entry as Game Config's Arcade
							bodies table: what it collides as.
						</p>
						{#if lookBody}
							{@const comp = character.component}
							<div class="grid">
								<label
									>Shape
									<select
										value={lookBody.shape}
										disabled={readOnly}
										onchange={(e) =>
											change((d) =>
												body.setBodyShape(d, comp, e.currentTarget.value as 'box' | 'circle'),
											)}
									>
										<option value="box">box</option>
										<option value="circle">circle</option>
									</select>
								</label>
								{#if lookBody.shape === 'box'}
									<label
										>Width <input
											type="number"
											value={lookBody.w}
											disabled={readOnly}
											onchange={(e) => {
												change((d) => body.setBodySize(d, comp, 'w', e.currentTarget.value));
												const stored = doc.arcade?.bodies?.[comp];
												settle(e.currentTarget, stored && 'w' in stored ? stored['w'] : undefined);
											}}
										/></label
									>
									<label
										>Height <input
											type="number"
											value={lookBody.h}
											disabled={readOnly}
											onchange={(e) => {
												change((d) => body.setBodySize(d, comp, 'h', e.currentTarget.value));
												const stored = doc.arcade?.bodies?.[comp];
												settle(e.currentTarget, stored && 'h' in stored ? stored['h'] : undefined);
											}}
										/></label
									>
								{:else}
									<label
										>Radius <input
											type="number"
											value={lookBody.r}
											disabled={readOnly}
											onchange={(e) => {
												change((d) => body.setBodySize(d, comp, 'r', e.currentTarget.value));
												const stored = doc.arcade?.bodies?.[comp];
												settle(e.currentTarget, stored && 'r' in stored ? stored['r'] : undefined);
											}}
										/></label
									>
								{/if}
								<label
									>Tags
									<input
										value={(lookBody.tags ?? []).join(', ')}
										placeholder="enemy, hazard"
										disabled={readOnly}
										onchange={(e) =>
											change((d) => body.setBodyTags(d, comp, e.currentTarget.value))}
									/>
								</label>
								<label
									>Edges
									<select
										value={lookBody.edges ?? 'clamp'}
										disabled={readOnly}
										onchange={(e) =>
											change((d) =>
												body.setBodyEdges(d, comp, e.currentTarget.value as ArcadeBodyEdges),
											)}
									>
										{#each ARCADE_BODY_EDGES as edge (edge)}<option value={edge}>{edge}</option
											>{/each}
									</select>
								</label>
								<label class="check"
									><input
										type="checkbox"
										checked={lookBody.solid === true}
										disabled={readOnly}
										onchange={(e) =>
											change((d) => body.setBodySolid(d, comp, e.currentTarget.checked))}
									/> Solid</label
								>
								<label class="check" title="A hopping character in the air passes over it"
									><input
										type="checkbox"
										checked={lookBody.ground === true}
										disabled={readOnly}
										onchange={(e) =>
											change((d) => body.setBodyGround(d, comp, e.currentTarget.checked))}
									/> Ground</label
								>
								<label class="check" title="Stops a falling character from above only"
									><input
										type="checkbox"
										checked={lookBody.oneWay === true}
										disabled={readOnly || lookBody.solid === true}
										onchange={(e) =>
											change((d) => body.setBodyOneWay(d, comp, e.currentTarget.checked))}
									/> One-way</label
								>
							</div>
						{:else}
							<p class="hint">
								No body: it touches nothing.
								<button
									type="button"
									disabled={readOnly}
									onclick={() => {
										const comp = character!.component;
										change((d) => body.addBody(d, comp));
									}}>Add a body</button
								>
							</p>
						{/if}
					</section>

					<section>
						<h2>Movement</h2>
						<p class="hint">
							Empty is instant (accel, decel, turn rate), uncapped (max speed, max fall) or no pull
							(gravity). With gravity the character falls, and only its left / right is steered.
							With a side-scroll jump, gravity is the pull while falling (the jump's height and time
							set the rise; empty ⇒ the jump's own); a flap needs it.
						</p>
						<div class="grid">
							{#each edit.MOVEMENT_KEYS as key (key)}
								<label
									>{edit.MOVEMENT_LABELS[key]}
									<input
										type="number"
										min="0"
										value={num(character.movement?.[key])}
										placeholder={key === 'decel' ? 'accel' : '—'}
										disabled={readOnly}
										onchange={(e) => {
											change((d) => edit.setMovement(d, cid(), key, e.currentTarget.value));
											settle(e.currentTarget, liveCharacter()?.movement?.[key]);
										}}
									/>
								</label>
							{/each}
						</div>
					</section>

					<section>
						<h2>Controller</h2>
						<div class="grid">
							<label
								>Played with
								<select
									value={character.controller?.kind ?? 'none'}
									disabled={readOnly}
									onchange={(e) =>
										change((d) =>
											edit.setController(d, cid(), e.currentTarget.value as edit.ControllerChoice),
										)}
								>
									<option value="none">none (not playable)</option>
									<option value="topDown">top-down (8-way)</option>
									<option value="sideScroll">side-scroll (left / right)</option>
									<option value="flap">flap (tap to kick up)</option>
									<option value="pointer">pointer (follow it)</option>
								</select>
							</label>
							{#if character.controller}
								<label
									>Speed px/s
									<input
										type="number"
										min="0"
										value={num(character.controller.speed)}
										placeholder={character.controller.kind === 'pointer'
											? 'max speed'
											: character.controller.kind === 'flap'
												? 'none'
												: ''}
										disabled={readOnly}
										onchange={(e) => {
											change((d) => edit.setControllerSpeed(d, cid(), e.currentTarget.value));
											settle(e.currentTarget, liveCharacter()?.controller?.speed);
										}}
									/>
								</label>
							{/if}
							{#if character.controller?.kind === 'flap'}
								<label
									>Kick px/s
									<input
										type="number"
										min="1"
										value={num(character.controller.kick)}
										disabled={readOnly}
										onchange={(e) => {
											change((d) => edit.setFlapKick(d, cid(), e.currentTarget.value));
											const stored = liveCharacter()?.controller;
											settle(e.currentTarget, stored?.kind === 'flap' ? stored.kick : undefined);
										}}
									/>
								</label>
							{/if}
							{#if character.controller?.kind === 'pointer'}
								<label
									>Axes
									<select
										value={character.controller.axes}
										disabled={readOnly}
										onchange={(e) =>
											change((d) =>
												edit.setPointerAxes(d, cid(), e.currentTarget.value as 'x' | 'y' | 'xy'),
											)}
									>
										{#each ARCADE_POINTER_AXES as axes (axes)}<option value={axes}>{axes}</option
											>{/each}
									</select>
								</label>
							{/if}
						</div>
						{#if jumpKind}
							<div class="grid">
								<label class="check"
									><input
										type="checkbox"
										checked={!!jump}
										disabled={readOnly}
										onchange={(e) => change((d) => edit.setJump(d, cid(), e.currentTarget.checked))}
									/>
									Jump ({jumpKind === 'gravity' ? 'a side-view jump' : 'a top-down hop'})</label
								>
							</div>
							{#if jump}
								<div class="grid">
									{#each JUMP_FIELDS as f (f.key)}
										<label title={f.hint}
											>{f.label}
											<input
												type="number"
												min="0"
												step={f.key === 'time' || f.key === 'airControl' ? '0.05' : '1'}
												value={num(jump[f.key])}
												placeholder={edit.JUMP_FIELD_DEFAULTS[f.key] !== undefined
													? String(edit.JUMP_FIELD_DEFAULTS[f.key])
													: f.key === 'minHeight'
														? 'height'
														: ''}
												disabled={readOnly}
												onchange={(e) => {
													const key = f.key;
													change((d) => edit.setJumpField(d, cid(), key, e.currentTarget.value));
													settle(e.currentTarget, edit.jumpOf(liveCharacter())?.[key]);
												}}
											/>
										</label>
									{/each}
								</div>
								{#if profile}
									<p class="hint">
										Launches at <b>{profile.launch.toFixed(0)} px/s</b> and rises under a pull of
										<b>{profile.gravity.toFixed(0)} px/s²</b>{#if profile.cut}; letting go early
											cuts the climb to {profile.cut.toFixed(0)} px/s{/if}.
										{#if jump.kind === 'hop'}
											In the air it passes over <i>ground</i> bodies.
										{/if}
									</p>
								{/if}
							{/if}
						{/if}
						{#if character.controller && character.controller.kind !== 'pointer'}
							<p class="hint">
								The keyboard controllers read the Flow input map's actions
								{#each ARCADE_CONTROLLER_ACTIONS as a, i (a)}{i ? ', ' : ''}<code>{a}</code>{/each}
								(map the keys in Invisible Flow); with none held, a pressed pointer or touch steers.
								{#if jump || character.controller.kind === 'flap'}
									A {character.controller.kind === 'flap' ? 'flap' : 'jump'} reads
									<code>{ARCADE_JUMP_ACTION}</code
									>{#if character.controller.kind !== 'topDown'}&nbsp;or <code>up</code
										>{/if}{#if character.controller.kind === 'topDown'}
										(a hop has no touch gesture: a touch steers).{:else}, or a pointer pressed
										{character.controller.kind === 'flap'
											? 'anywhere'
											: 'above the character'}.{/if}
								{/if}
							</p>
						{/if}
					</section>

					<section>
						<h2>Brain</h2>
						<p class="hint">
							States are behaviours, arrows are transitions: the first whose conditions all hold
							fires (Any's first, then the current state's, in order). Drag a behaviour onto the
							canvas, or click it, to add a state.
						</p>
						<div class="palette">
							{#each ARCADE_BEHAVIOURS as b (b)}
								<button
									type="button"
									draggable={!readOnly}
									disabled={readOnly}
									ondragstart={(e) => writeDrag(e, BRAIN_MIME, b)}
									onclick={() => addState(b)}>{b}</button
								>
							{/each}
						</div>
						{#key character.id}
							<BrainCanvas
								{brain}
								version={brainVersion}
								selected={selection}
								activeState={liveState}
								broken={brokenIds}
								{readOnly}
								dropMime={BRAIN_MIME}
								onconnect={(c) =>
									change((d) => {
										if (c.kind === 'initial') edit.setInitial(d, cid(), c.state);
										else {
											const t = edit.addTransition(d, cid(), c.from, c.to);
											if (t) selection = { kind: 'transition', id: t };
										}
									}, true)}
								ondelete={(states, transitions) =>
									change((d) => {
										for (const t of transitions) edit.removeTransition(d, cid(), t);
										for (const s of states) edit.removeState(d, cid(), s);
										selection = null;
									}, true)}
								onmove={(s, pos) => change((d) => edit.setStatePos(d, cid(), s, pos))}
								onselect={(s) => (selection = s)}
								ondropbehaviour={(b, pos) => addState(b, pos)}
							/>
						{/key}

						{#if selectedState}
							{@const sid = selectedState.id}
							<div class="inspector">
								<h3>State <code>{sid}</code></h3>
								{#if stateIndex >= 0 && edit.brainItemIssues(issues, index, 'states', stateIndex).length}
									<p class="err">
										{issueText(edit.brainItemIssues(issues, index, 'states', stateIndex))}
									</p>
								{/if}
								<div class="grid">
									<label
										>Id
										<span class="inline">
											<input bind:value={stateRename} disabled={readOnly} spellcheck="false" />
											<button
												type="button"
												onclick={renameSelectedState}
												disabled={readOnly || stateRename.trim() === sid}>Rename</button
											>
										</span>
										{#if stateRenameError}<span class="err">{stateRenameError}</span>{/if}
									</label>
									<label
										>Behaviour
										<select
											value={selectedState.behaviour}
											disabled={readOnly}
											onchange={(e) =>
												change(
													(d) =>
														edit.setBehaviour(
															d,
															cid(),
															sid,
															e.currentTarget.value as ArcadeBehaviourKind,
														),
													true,
												)}
										>
											{#each ARCADE_BEHAVIOURS as b (b)}<option value={b}>{b}</option>{/each}
										</select>
									</label>
									{#each edit.behaviourParams(selectedState.behaviour) as p (p.key)}
										{#if p.kind === 'bool'}
											<label class="check" title={p.hint}
												><input
													type="checkbox"
													checked={(paramValue(p.key) ?? p.fallback) === true}
													disabled={readOnly}
													onchange={(e) =>
														change(
															(d) => edit.setParam(d, cid(), sid, p.key, e.currentTarget.checked),
															true,
														)}
												/>
												{p.key}</label
											>
										{:else if p.kind === 'axis'}
											<label
												>{p.key}
												<select
													value={String(paramValue(p.key) ?? p.fallback)}
													disabled={readOnly}
													onchange={(e) =>
														change(
															(d) => edit.setParam(d, cid(), sid, p.key, e.currentTarget.value),
															true,
														)}
												>
													<option value="x">x</option>
													<option value="y">y</option>
												</select>
											</label>
										{:else}
											<label title={p.hint}
												>{p.key}
												<input
													type={p.kind === 'number' ? 'number' : 'text'}
													value={String(paramValue(p.key) ?? '')}
													placeholder={p.fallback === undefined
														? (p.hint ?? '')
														: String(p.fallback)}
													disabled={readOnly}
													onchange={(e) => {
														change(
															(d) => edit.setParam(d, cid(), sid, p.key, e.currentTarget.value),
															true,
														);
														settle(e.currentTarget, liveBrainState(sid)?.params?.[p.key]);
													}}
												/>
											</label>
										{/if}
									{/each}
								</div>
								<div class="actions">
									<button
										type="button"
										disabled={readOnly || brain?.initial === sid}
										onclick={() => change((d) => edit.setInitial(d, cid(), sid), true)}
										>{brain?.initial === sid ? 'Starts here' : 'Start here'}</button
									>
									<button
										type="button"
										disabled={readOnly}
										onclick={() =>
											change((d) => {
												const t = edit.addTransition(d, cid(), '*', sid);
												if (t) selection = { kind: 'transition', id: t };
											}, true)}>＋ From any state</button
									>
									<button
										type="button"
										class="danger"
										disabled={readOnly}
										onclick={() => {
											change((d) => edit.removeState(d, cid(), sid), true);
											selection = null;
										}}>Delete state</button
									>
								</div>
							</div>
						{:else if selectedTransition}
							{@const tid = selectedTransition.id}
							<div class="inspector">
								<h3>
									Transition <code
										>{selectedTransition.from === '*' ? 'Any' : selectedTransition.from}</code
									>
									→ <code>{selectedTransition.to}</code>
								</h3>
								{#if transitionIndex >= 0 && edit.brainItemIssues(issues, index, 'transitions', transitionIndex).length}
									<p class="err">
										{issueText(edit.brainItemIssues(issues, index, 'transitions', transitionIndex))}
									</p>
								{/if}
								<p class="hint">
									Fires when ALL of these hold{selectedTransition.when.length
										? ''
										: ' — with none, it fires at once'}.
								</p>
								{#each selectedTransition.when as c, ci (ci)}
									{@const set = (
										field: edit.ConditionField,
										el: HTMLInputElement | HTMLSelectElement,
									) => {
										change((d) => edit.setConditionField(d, cid(), tid, ci, field, el.value), true);
										settle(el, conditionValue(tid, ci, field));
									}}
									<div class="cond">
										<b>{c.kind}</b>
										{#if 'tag' in c}
											<label
												>tag <input
													value={c.tag}
													disabled={readOnly}
													onchange={(e) => set('tag', e.currentTarget)}
												/></label
											>
										{/if}
										{#if 'px' in c}
											<label
												>px <input
													type="number"
													value={c.px}
													disabled={readOnly}
													onchange={(e) => set('px', e.currentTarget)}
												/></label
											>
										{/if}
										{#if c.kind === 'timer'}
											<label
												>ms <input
													type="number"
													value={c.ms}
													disabled={readOnly}
													onchange={(e) => set('ms', e.currentTarget)}
												/></label
											>
										{:else if c.kind === 'variable'}
											<label
												>variable <input
													value={c.id}
													disabled={readOnly}
													onchange={(e) => set('id', e.currentTarget)}
												/></label
											>
											<select
												value={c.op}
												disabled={readOnly}
												onchange={(e) => set('op', e.currentTarget)}
											>
												{#each ARCADE_VARIABLE_OPS as op (op)}<option value={op}>{op}</option
													>{/each}
											</select>
											<input
												value={String(c.value)}
												disabled={readOnly}
												title="true, false, a number or text"
												onchange={(e) => set('value', e.currentTarget)}
											/>
										{:else if c.kind === 'random'}
											<label
												>chance 0–1 <input
													type="number"
													step="0.05"
													min="0"
													max="1"
													value={c.chance}
													disabled={readOnly}
													onchange={(e) => set('chance', e.currentTarget)}
												/></label
											>
											<label
												>every ms <input
													type="number"
													value={c.every ?? ''}
													placeholder="1000"
													disabled={readOnly}
													onchange={(e) => set('every', e.currentTarget)}
												/></label
											>
										{/if}
										<button
											type="button"
											class="x"
											disabled={readOnly}
											title="Remove this condition"
											onclick={() => change((d) => edit.removeCondition(d, cid(), tid, ci), true)}
											>×</button
										>
									</div>
								{/each}
								<div class="actions">
									<select
										disabled={readOnly}
										value=""
										onchange={(e) => {
											const kind = e.currentTarget.value as ArcadeCondition['kind'];
											e.currentTarget.value = '';
											if (kind) change((d) => edit.addCondition(d, cid(), tid, kind), true);
										}}
									>
										<option value="">＋ Condition…</option>
										{#each ARCADE_CONDITIONS as k (k)}<option value={k}>{k}</option>{/each}
									</select>
									<button
										type="button"
										disabled={readOnly}
										title="Checked earlier"
										onclick={() => change((d) => edit.moveTransition(d, cid(), tid, -1), true)}
										>↑</button
									>
									<button
										type="button"
										disabled={readOnly}
										title="Checked later"
										onclick={() => change((d) => edit.moveTransition(d, cid(), tid, 1), true)}
										>↓</button
									>
									<button
										type="button"
										class="danger"
										disabled={readOnly}
										onclick={() => {
											change((d) => edit.removeTransition(d, cid(), tid), true);
											selection = null;
										}}>Delete transition</button
									>
								</div>
							</div>
						{/if}
					</section>

					<section>
						<h2>Anim inputs</h2>
						<p class="hint">
							What drives the look's state machine inputs: <code>speed</code>, <code>vx</code>,
							<code>vy</code>, <code>facing</code> (1 or -1) are numbers; <code>moving</code> and
							<code>state:&lt;id&gt;</code> (in that brain state) are true / false.
						</p>
						{#if !lookInputs.length && !strayInputs.length}
							<p class="hint">
								<code>{character.component}</code> has no number or bool inputs. Add them in its state
								machine (Invisible Component Editor).
							</p>
						{/if}
						<div class="grid">
							{#each lookInputs as input (input.id)}
								<label
									>{input.id} <span class="dim">({input.kind})</span>
									<select
										value={character.animInputs?.[input.id] ?? ''}
										disabled={readOnly}
										onchange={(e) =>
											change((d) =>
												edit.setAnimInput(
													d,
													cid(),
													input.id,
													e.currentTarget.value as ArcadeAnimSource | '',
												),
											)}
									>
										<option value="">— not driven</option>
										{#each sources.filter((s) => sourceFits(input.kind, s)) as s (s)}<option
												value={s}>{s}</option
											>{/each}
									</select>
								</label>
							{/each}
							{#each strayInputs as input (input)}
								<label
									>{input} <span class="err">(not an input of the look)</span>
									<button
										type="button"
										disabled={readOnly}
										onclick={() => change((d) => edit.setAnimInput(d, cid(), input, ''))}
										>Remove</button
									>
								</label>
							{/each}
						</div>
					</section>

					<section>
						<h2>Sandbox</h2>
						<p class="hint">
							Placeholder shapes, the real <code>engine-mechanics</code> at {resolved.fixedHz} steps a
							second. Nothing here is saved.
						</p>
						{#key character.id}
							<CharacterSandbox
								{character}
								body={lookBody}
								{field}
								hz={resolved.fixedHz}
								onstate={(s) => {
									if (s !== liveState) {
										liveState = s;
										brainVersion += 1;
									}
								}}
							/>
						{/key}
					</section>
				{/if}
			</main>
		</div>
	</div>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: #0b0b0f;
		color: #e8e8ee;
	}
	.body {
		flex: 1;
		overflow: auto;
		padding: 24px;
		max-width: 1400px;
		width: 100%;
		margin: 0 auto;
		box-sizing: border-box;
	}
	.intro {
		margin: 0 0 16px;
		font-size: 13px;
		color: #b9b9c4;
		line-height: 1.6;
		max-width: 900px;
	}
	.intro a {
		color: #7ee0c0;
	}
	.warn {
		margin: 0 0 16px;
		padding: 10px 14px;
		border: 1px solid #5a4520;
		border-radius: 8px;
		background: #1e1810;
		color: #d3b483;
		font-size: 12px;
		line-height: 1.6;
	}
	.conflict {
		margin: 0 0 16px;
		padding: 12px 14px;
		border: 1px solid #6a2727;
		border-radius: 8px;
		background: #1e1010;
		font-size: 13px;
	}
	.conflict .sub {
		color: #b9b9c4;
		font-size: 12px;
	}
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
		position: sticky;
		top: 0;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr auto;
		text-align: left;
		padding: 8px 10px;
		border: 1px solid #23232c;
		border-radius: 6px;
		background: #14141a;
		color: inherit;
		cursor: pointer;
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
	.add {
		display: flex;
		gap: 6px;
		margin-top: 8px;
	}
	.add select {
		flex: 1;
		min-width: 0;
	}
	section {
		margin-bottom: 28px;
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
		margin: 0 0 8px;
		font-size: 13px;
	}
	.hint {
		margin: 0 0 10px;
		font-size: 12px;
		color: #8b8b98;
		line-height: 1.6;
		max-width: 900px;
	}
	.dim {
		color: #8b8b98;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 10px 14px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: #b9b9c4;
	}
	label.check {
		flex-direction: row;
		align-items: center;
		gap: 6px;
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
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 10px;
	}
	input,
	select,
	button {
		font: inherit;
		font-size: 12px;
		background: #14141a;
		color: #e8e8ee;
		border: 1px solid #2a2a35;
		border-radius: 6px;
		padding: 5px 8px;
	}
	button {
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button.danger {
		border-color: #6a2727;
		color: #ff9a9a;
	}
	.save {
		background: #1f6f54;
		border-color: #2a8a69;
	}
	.pill {
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid #2a2a35;
		color: #b9b9c4;
	}
	.pill.dirty {
		border-color: #5a4520;
		color: #d3b483;
	}
	.pill.err,
	.err {
		color: #ff9a9a;
		font-size: 12px;
	}
	.issues {
		margin: 0 0 16px;
		padding: 8px 12px 8px 28px;
		border: 1px solid #3a2a2a;
		border-radius: 8px;
		background: #171113;
		font-size: 12px;
		line-height: 1.6;
	}
	.issues .error {
		color: #ff9a9a;
	}
	.issues .warning {
		color: #d3b483;
	}
	.palette {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}
	.palette button {
		cursor: grab;
	}
	.inspector {
		margin-top: 12px;
		padding: 12px;
		border: 1px solid #23232c;
		border-radius: 8px;
		background: #111117;
	}
	.cond {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 8px;
		padding: 6px 0;
		border-bottom: 1px solid #1d1d25;
		font-size: 12px;
	}
	.cond label {
		flex-direction: row;
		align-items: center;
	}
	.cond input {
		width: 90px;
	}
	.cond .x {
		margin-left: auto;
	}
	code {
		font-size: 11px;
		color: #c9d1dc;
	}
</style>
