<script lang="ts">
	/**
	 * Animate mode's bottom panel (Rive plan Phases 3–4, `docs/design/rive-style-editor.md`): the
	 * active SCREEN's timelines, or the open COMPONENT's (`component` set), edited in the shared
	 * Timeline module (`$lib/timeline/timeline.js` — the same sequencer `/rigger` mounts) and
	 * previewed live on the editor canvas. A component timeline also names the instance signal that
	 * plays it in game (`playOn`) and the other components it is reused on (`playOnComponents`).
	 *
	 * - Storage is the cinematic store: `/api/cinematics/*`, the same ETag-conditional save, 409
	 *   conflict flow and project-scope guard as `/rigger`. A timeline is a cinematic whose `host`
	 *   is `{kind:'screen', sceneId}` or `{kind:'component', componentId}`; the endpoints let an
	 *   `editor`-only user reach exactly those.
	 * - Keying: the node selected on the canvas becomes a node actor targeting its NAME
	 *   (`nodeActorTarget` refuses an unnamed or shared name — never an id), and its fields key
	 *   x / y / scale / rotation / alpha / tint at the playhead through the module's `keyProperty`.
	 * - Preview: every seek pushes `timelineDrives()` — the inputs `<LayoutNodeView>` folds in
	 *   game — into the canvas's value-binding preview (`setTimelinePreview`).
	 * - Keys: the module owns Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y (timeline undo), Ctrl+S (save the
	 *   timeline), Ctrl+D (duplicate a strip) and Delete / Backspace (the selected key) while this
	 *   panel is mounted; the page and the canvas stand down on those (see `+page.svelte`).
	 */
	import { onDestroy, onMount, untrack } from 'svelte';
	import { putKey, resolvePlace, resolveVisible } from 'engine-cinematic';
	import {
		findActorNode,
		fxParamRest,
		placedFxParamValues,
		validateNodeActors,
		type CinematicCast,
		type CinematicDoc,
		type LayoutNode,
		type Scene,
	} from 'engine-layout';
	import { askConfirm, askText } from '$lib/dialogs.svelte';
	import { mount, type Timeline, type TimelineEvaluator } from '$lib/timeline/timeline';
	import {
		NODE_IDENTITY,
		SCREEN_CHANNELS,
		addRigClipStrip,
		componentTimelineId,
		componentTimelinesOf,
		ensureNodeActor,
		fxChannelValue,
		isChannelKeyed,
		keyableChannels,
		fxTimelineRows,
		keyableFxChannels,
		newComponentTimeline,
		newScreenTimeline,
		nodeActorOf,
		nodeActorTarget,
		nodeChannelValue,
		screenTimelineId,
		screenTimelinesOf,
		timelineDrives,
		type FxChannelRow,
		type KeyedChannel,
		type RigClip,
	} from '$lib/timeline/screenTimeline';
	import type { TimelineChannel } from '$lib/timeline/timeline';
	import { placedEffect, placedEffectsVersion } from './placedEffects.client.svelte';
	import type { RigMeta } from './rigRuntime.client';
	import { setTimelinePreview } from './valuePreview.client.svelte';

	/** The open component, when the panel animates a component instead of a screen. */
	interface ComponentHost {
		id: string;
		name: string;
		/** The signals `playOn` offers (`componentTimelineSignals`). */
		signals: string[];
		/** Every other component, for reuse (`playOnComponents`) and its validation. */
		others: { id: string; name: string; nodes: LayoutNode[] }[];
	}

	interface Props {
		/** The node list every timeline listed here animates: the active screen, or the open
		 *  component's root (a synthetic scene). */
		scene: Scene | undefined;
		/** Set ⇒ the timelines are the component's (`host: {kind:'component'}`), not the screen's. */
		component?: ComponentHost;
		/** The canvas selection's primary node. */
		selectedId: string | null;
		/** The project this tab loaded — every save posts it, and a mismatch is refused. */
		projectKey: string;
		/** Animate mode is on. The page keeps this panel mounted (hidden) after leaving Animate so
		 *  unsaved edits survive the toggle; inactive, it owns no key and previews nothing. */
		active: boolean;
		/** Open this timeline (the State Machine panel asked: a state card was double-clicked). The
		 *  nonce makes the same id openable again. */
		openRequest?: { id: string; nonce: number };
		/** The canvas's loaded rigs (animation names and lengths), by asset key: a rig node's clips
		 *  for an `animation` strip. */
		rigMeta?: Map<string, RigMeta>;
		/** The open component's resolved preview params (empty on a screen): what a placed effect
		 *  takes a `params.<id>` value from, so an unkeyed parameter shows the value it rests on. */
		componentParams?: Record<string, unknown>;
	}

	let {
		scene,
		component,
		selectedId,
		projectKey,
		active,
		openRequest,
		rigMeta = new Map(),
		componentParams = {},
	}: Props = $props();

	/** The animations a rig node can play on a strip; empty for any other node, or a rig the canvas
	 *  has not loaded yet. */
	function rigClipsOf(node: LayoutNode | undefined): RigClip[] {
		if (node?.kind !== 'spine') return [];
		const meta = rigMeta.get(node.assetKey);
		return (meta?.animations ?? []).map((name) => ({
			name,
			duration: meta?.durations?.[name] ?? 1,
		}));
	}

	/** This panel's claim on the shared canvas preview (a screen's and a component's panel can both
	 *  be mounted). */
	const previewOwner = Symbol('timeline-panel');
	/** What the open host is called in messages. */
	const where = $derived(component ? 'component' : 'screen');

	interface Row {
		id: string;
		name: string;
		duration: number;
		host?: CinematicDoc['host'];
	}

	const EV: TimelineEvaluator = {
		resolvePlace: resolvePlace as TimelineEvaluator['resolvePlace'],
		resolveVisible: resolveVisible as TimelineEvaluator['resolveVisible'],
		putKey: putKey as TimelineEvaluator['putKey'],
	};

	let rows = $state<Row[]>([]);
	let openId = $state<string | null>(null);
	/** The ETag the next save must match; `null` = never saved (create-only). */
	let etag: string | null = null;
	let dirty = $state(false);
	let busy = $state(false);
	let status = $state('');
	let error = $state('');
	let conflict = $state(false);
	let time = $state(0);
	let playing = $state(false);
	/** Bumped whenever the document or the playhead changes — the fields re-read the doc. */
	let docVersion = $state(0);

	let tlEl: HTMLDivElement | undefined = $state();
	let pickerEl: HTMLSelectElement | undefined = $state();
	let inspEl: HTMLDivElement | undefined = $state();
	let tl: Timeline | null = null;
	let raf = 0;

	const sceneId = $derived(scene?.id);
	/** Which host's timelines are listed: a switch closes the open one (`leaveHost`). */
	const hostKey = $derived(component ? `component:${component.id}` : `screen:${sceneId ?? ''}`);
	const screenRows = $derived(
		component ? componentTimelinesOf(rows, component.id) : screenTimelinesOf(rows, sceneId),
	);
	const hostLabel = $derived(
		component ? `◇ ${component.name}` : scene ? scene.name || scene.id : 'no screen',
	);

	/** Does `doc` belong to the host this panel is on? Keys never land on another host's doc. */
	function ownsDoc(doc: CinematicDoc): boolean {
		if (component) return doc.host?.kind === 'component' && doc.host.componentId === component.id;
		return doc.host?.kind === 'screen' && doc.host.sceneId === scene?.id;
	}

	function preview(): void {
		const doc = tl?.doc();
		setTimelinePreview(
			active && doc && scene ? timelineDrives(doc, scene, time) : null,
			previewOwner,
		);
	}

	function mountTimeline(doc: CinematicDoc): void {
		tl?.destroy();
		tl = mount(tlEl ?? null, {
			doc,
			ev: EV,
			inspector: inspEl ?? null,
			channels: SCREEN_CHANNELS,
			host: {
				evaluate(t) {
					time = t;
					preview();
				},
				seeked(t) {
					time = t;
					docVersion++;
				},
				changed() {
					dirty = true;
					docVersion++;
					preview();
				},
				render() {
					tl?.renderInspector();
					docVersion++;
				},
				docReplaced() {
					docVersion++;
				},
				save() {
					void save();
				},
				actorLabel: (cast: CinematicCast) => ({
					text: `◇ ${cast.target ?? cast.actorId}`,
					title: `Node "${cast.target ?? ''}" on this ${where}`,
				}),
				sceneName: (id: string) => (id === scene?.id ? (scene?.name ?? id) : id),
				actorChannels: (cast: CinematicCast) => actorFxRows(cast),
				clips: (actorId: string) => {
					const open = tl?.doc() ?? doc;
					const cast = open.stage.cast.find((c) => c.actorId === actorId);
					return cast?.target && scene
						? rigClipsOf(findActorNode(open, scene.nodes, cast.target))
						: [];
				},
			},
		});
		tl.setActive(active);
		tl.historyReset();
		tl.setTime(0);
		tl.renderTimeline();
		tl.renderInspector();
	}

	function closeTimeline(): void {
		stop();
		tl?.destroy();
		tl = null;
		openId = null;
		etag = null;
		dirty = false;
		conflict = false;
		time = 0;
		// Both elements are the vanilla Timeline module's to fill — Svelte renders no children
		// into them — so clearing what it drew is the module's markup, not Svelte's.
		/* eslint-disable svelte/no-dom-manipulating */
		if (tlEl) tlEl.innerHTML = '';
		if (inspEl) inspEl.innerHTML = '';
		/* eslint-enable svelte/no-dom-manipulating */
		setTimelinePreview(null, previewOwner);
	}

	async function readError(res: Response): Promise<string> {
		const body = (await res.json().catch(() => null)) as { message?: string } | null;
		return body?.message ?? `${res.status} ${res.statusText}`;
	}

	async function refresh(): Promise<void> {
		const res = await fetch(`/api/cinematics/list?projectKey=${encodeURIComponent(projectKey)}`);
		if (!res.ok) {
			error = `Could not list timelines: ${await readError(res)}`;
			return;
		}
		const body = (await res.json()) as { cinematics: Row[] };
		rows = body.cinematics;
	}

	async function guardUnsaved(): Promise<boolean> {
		if (!dirty) return true;
		return askConfirm({
			title: 'Discard unsaved timeline changes?',
			message: `"${tl?.doc().name ?? openId}" has changes that are not saved.`,
			confirmLabel: 'Discard',
			danger: true,
		});
	}

	async function open(id: string): Promise<void> {
		if (id === openId) return;
		if (!(await guardUnsaved())) {
			// The <select> already shows `id`; put it back on the timeline that is still open.
			if (pickerEl) pickerEl.value = openId ?? '';
			return;
		}
		error = '';
		const res = await fetch(
			`/api/cinematics/get?id=${encodeURIComponent(id)}&projectKey=${encodeURIComponent(projectKey)}`,
		);
		if (!res.ok) {
			error = `Could not open "${id}": ${await readError(res)}`;
			return;
		}
		const body = (await res.json()) as { doc: CinematicDoc | null; etag: string | null };
		if (!body.doc) {
			error = `"${id}" is not a readable timeline.`;
			return;
		}
		closeTimeline();
		openId = id;
		etag = body.etag;
		mountTimeline(body.doc);
	}

	async function create(): Promise<void> {
		if (!scene || !(await guardUnsaved())) return;
		const name = await askText({
			title: 'New timeline',
			message: component
				? `A timeline animates the nodes of "${component.name}". Every placed instance plays it when its "Plays on" signal fires there.`
				: `A timeline animates the nodes of "${scene.name || scene.id}". Flow plays it with a playCinematic node.`,
			label: 'Name',
			value: component ? 'Pop in' : 'Intro',
		});
		if (!name?.trim()) return;
		const taken = rows.map((r) => r.id);
		const id = component
			? componentTimelineId(component.id, name, taken)
			: screenTimelineId(scene.id, name, taken);
		closeTimeline();
		openId = id;
		etag = null;
		mountTimeline(
			component
				? newComponentTimeline({
						id,
						name: name.trim(),
						componentId: component.id,
						playOn: component.signals[0],
					})
				: newScreenTimeline({ id, name: name.trim(), sceneId: scene.id }),
		);
		dirty = true;
		await save();
		if (etag === null) {
			// The first save never landed (say the id belongs to a Rigger cinematic this role cannot
			// see, a 403): nothing exists to keep editing, so close it and leave the reason showing.
			const reason = error || 'The new timeline could not be saved.';
			closeTimeline();
			error = reason;
		}
	}

	async function rename(): Promise<void> {
		const doc = tl?.doc();
		if (!doc) return;
		const name = await askText({ title: 'Rename timeline', label: 'Name', value: doc.name });
		if (!name?.trim() || name.trim() === doc.name) return;
		doc.name = name.trim();
		tl?.commit('rename');
		await save();
	}

	async function remove(): Promise<void> {
		const doc = tl?.doc();
		if (!doc) return;
		const ok = await askConfirm({
			title: `Delete the timeline "${doc.name}"?`,
			message: component
				? 'It is removed from the project. Placed instances stop playing it.'
				: 'It is removed from the project. A Flow playCinematic node that plays it will play nothing.',
			confirmLabel: 'Delete',
			danger: true,
		});
		if (!ok) return;
		const res = await fetch('/api/cinematics/delete', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: doc.id, projectKey }),
		});
		if (!res.ok) {
			error = `Delete failed: ${await readError(res)}`;
			return;
		}
		closeTimeline();
		await refresh();
	}

	async function save(force = false): Promise<void> {
		const doc = tl?.doc();
		if (!doc || busy) return;
		busy = true;
		error = '';
		try {
			const res = await fetch('/api/cinematics/save', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(
					force ? { doc, force: true, projectKey } : { doc, baseEtag: etag, projectKey },
				),
			});
			const body = (await res.json().catch(() => null)) as {
				etag?: string | null;
				error?: string;
				message?: string;
			} | null;
			if (res.status === 409 && body?.error === 'conflict') {
				conflict = true;
				error = body.message ?? 'Someone else saved this timeline.';
				return;
			}
			if (!res.ok) {
				error = `Save failed: ${body?.message ?? `${res.status} ${res.statusText}`}`;
				return;
			}
			etag = body?.etag ?? null;
			dirty = false;
			conflict = false;
			status = `Saved ${new Date().toLocaleTimeString()}`;
			await refresh();
		} finally {
			busy = false;
		}
	}

	async function reloadTheirs(): Promise<void> {
		const id = openId;
		if (!id) return;
		dirty = false;
		closeTimeline();
		await open(id);
	}

	// ---- transport -------------------------------------------------------------------------

	function stop(): void {
		playing = false;
		if (raf) cancelAnimationFrame(raf);
		raf = 0;
	}

	function play(): void {
		const doc = tl?.doc();
		if (!doc || !tl) return;
		if (time >= doc.duration) tl.setTime(0);
		playing = true;
		let last = performance.now();
		const tick = (now: number): void => {
			if (!playing || !tl) return;
			const next = time + (now - last) / 1000;
			last = now;
			const end = tl.doc().duration;
			tl.setTime(Math.min(next, end));
			tl.positionPlayhead();
			if (next >= end) stop();
			else raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
	}

	function setDuration(value: number): void {
		const doc = tl?.doc();
		if (!doc || !tl || !Number.isFinite(value) || value <= 0) return;
		doc.duration = Math.round(value * 1000) / 1000;
		tl.commit('duration', 'duration');
		if (time > doc.duration) tl.setTime(doc.duration);
		tl.renderTimeline();
	}

	// ---- keying the selected node ------------------------------------------------------------

	const target = $derived(scene && selectedId ? nodeActorTarget(scene, selectedId, where) : null);
	const channels = $derived(target?.ok ? keyableChannels(target.node.kind) : []);

	/** The selected node's actor in the open timeline, if it has one. */
	function actorId(): string | null {
		void docVersion;
		const doc = tl?.doc();
		return doc && target?.ok ? nodeActorOf(doc, target.target) : null;
	}

	function value(channel: KeyedChannel): number {
		void docVersion;
		const doc = tl?.doc();
		const id = actorId();
		return doc && id ? nodeChannelValue(doc, id, channel, time) : NODE_IDENTITY[channel];
	}

	function keyed(channel: string): boolean {
		void docVersion;
		const doc = tl?.doc();
		const id = actorId();
		return !!doc && !!id && isChannelKeyed(doc, id, channel);
	}

	/** Key `channel` at the playhead to `v` (default: its current value), creating the actor. */
	function key(channel: KeyedChannel, v?: number): void {
		const doc = tl?.doc();
		if (!doc || !tl || !target?.ok) return;
		if (!ownsDoc(doc)) return;
		const id = ensureNodeActor(doc, target.target);
		const next = v ?? value(channel);
		tl.keyProperty(id, channel, Number.isFinite(next) ? next : 0);
		preview();
	}

	/** The selected rig node's animations, offered as a strip at the playhead. */
	const selectedClips = $derived(target?.ok ? rigClipsOf(target.node) : []);

	/** Play `name` on the selected rig node from the playhead: a strip on its animation track. */
	function addClip(name: string): void {
		const doc = tl?.doc();
		const clip = selectedClips.find((c) => c.name === name);
		if (!doc || !tl || !clip || !target?.ok || !ownsDoc(doc)) return;
		addRigClipStrip(doc, ensureNodeActor(doc, target.target), clip, time);
		tl.commit('add animation');
		tl.renderTimeline();
		preview();
	}

	// ---- a placed effect's parameters (Invisible FX Step 2) ------------------------------------

	/** The selected effect node's parameters Animate keys, one `fx:<id>` channel each. */
	const fxRows = $derived.by((): FxChannelRow[] => {
		const node = target?.ok ? target.node : undefined;
		return node?.kind === 'effect'
			? keyableFxChannels(node, placedEffect(node.effectId)?.params)
			: [];
	});

	function fxValue(row: FxChannelRow): number {
		void docVersion;
		const doc = tl?.doc();
		const id = actorId();
		const node = target?.ok ? target.node : undefined;
		const placed = node && placedFxParamValues(node, componentParams, [row.param]);
		return doc && id
			? fxChannelValue(doc, id, row, time, placed)
			: (fxParamRest([row.param], row.channel, placed) ?? 0);
	}

	/** Key a parameter at the playhead; an on/off one steps (`hold`), so it switches on the key. */
	function keyFx(row: FxChannelRow, v?: number): void {
		const doc = tl?.doc();
		if (!doc || !tl || !target?.ok || !ownsDoc(doc)) return;
		const id = ensureNodeActor(doc, target.target);
		const next = v ?? fxValue(row);
		const bool = row.param.kind === 'bool';
		tl.keyProperty(id, row.channel, bool ? +(next >= 0.5) : next, bool ? 'hold' : undefined);
		preview();
	}

	/** The Timeline rows a node actor gets beyond the shared channels (`fxTimelineRows`): on a
	 *  placed effect, its parameters, then any `fx:` channel it keys that is not one (⚠). */
	function actorFxRows(cast: CinematicCast): TimelineChannel[] {
		const doc = tl?.doc();
		const node = doc && scene && cast.target ? findActorNode(doc, scene.nodes, cast.target) : null;
		if (!doc || node?.kind !== 'effect') return [];
		return fxTimelineRows(doc, cast.actorId, node, placedEffect(node.effectId)).map((row) => ({
			key: row.channel,
			label: row.label,
			color: row.stale ? '#8b93a1' : '#c98bff',
		}));
	}

	// A placed effect's doc can land after the Timeline drew its rows: redraw them when it does.
	$effect(() => {
		void placedEffectsVersion();
		untrack(() => tl?.renderTimeline());
	});

	const hex = (n: number): string => '#' + (Math.round(n) & 0xffffff).toString(16).padStart(6, '0');
	const fmt = (n: number): string => String(Math.round(n * 1000) / 1000);
	const CHANNEL_LABEL: Record<KeyedChannel, string> = {
		x: 'x (offset)',
		y: 'y (offset)',
		scale: 'scale (×)',
		rotation: 'rotation (°)',
		alpha: 'alpha (×)',
		tint: 'tint',
	};

	// ---- component trigger + reuse -------------------------------------------------------------

	/** Whether the open component timeline holds its awaited cue (`holdsCue`, Rive plan Phase 8a). */
	function holdsCue(): boolean {
		void docVersion;
		return tl?.doc().holdsCue === true;
	}
	function setHoldsCue(on: boolean): void {
		const doc = tl?.doc();
		if (!doc || !tl || !component) return;
		if (on) doc.holdsCue = true;
		else delete doc.holdsCue;
		tl.commit('holds the cue');
		docVersion++;
	}

	/** The open component timeline's `playOn`, re-read on every doc change. */
	function playOn(): string {
		void docVersion;
		return tl?.doc().playOn ?? '';
	}
	function setPlayOn(signal: string): void {
		const doc = tl?.doc();
		if (!doc || !tl || !component) return;
		if (signal) doc.playOn = signal;
		else {
			delete doc.playOn;
			// Nothing plays it, so nothing can hold a cue for it.
			delete doc.holdsCue;
		}
		tl.commit('plays on');
		docVersion++;
	}
	function reusedOn(id: string): boolean {
		void docVersion;
		return tl?.doc().playOnComponents?.includes(id) ?? false;
	}
	function setReusedOn(id: string, on: boolean): void {
		const doc = tl?.doc();
		if (!doc || !tl || !component) return;
		const rest = (doc.playOnComponents ?? []).filter((other) => other !== id);
		const next = on ? [...rest, id] : rest;
		if (next.length) doc.playOnComponents = next;
		else delete doc.playOnComponents;
		tl.commit('also plays on');
		docVersion++;
	}
	/** What would silently do nothing in game: on this component, and on each it is reused on. */
	function issues(): string[] {
		void docVersion;
		// The placed effects' docs load on demand (`placedEffect` asks for each one a node actor
		// targets, here and on every component in Also on) and re-run this when they land.
		void placedEffectsVersion();
		const doc = tl?.doc();
		if (!doc || !scene) return [];
		const out = validateNodeActors(doc, scene, placedEffect).map((i) => i.message);
		for (const id of doc.playOnComponents ?? []) {
			const other = component?.others.find((o) => o.id === id);
			if (!other) {
				out.push(`Also plays on "${id}", which is not in this project.`);
				continue;
			}
			const host = { id: other.id, name: other.name, nodes: other.nodes };
			for (const issue of validateNodeActors(doc, host, placedEffect)) {
				out.push(`On ${other.name}: ${issue.message}`);
			}
		}
		if (component && !doc.playOn) out.push('No "Plays on" signal: nothing in the game starts it.');
		return out;
	}

	// A different host has different timelines: save the open one, then close it. A failed save
	// (a conflict, say) keeps it open with its error, previewing nothing on the other host.
	async function leaveHost(): Promise<void> {
		if (dirty) await save();
		if (!dirty) closeTimeline();
	}
	let lastHostKey: string | undefined;
	$effect(() => {
		const key = hostKey;
		if (lastHostKey !== undefined && key !== lastHostKey && tl) void untrack(leaveHost);
		lastHostKey = key;
	});

	// Hidden (Design mode): no keys, no preview, no playback — Design draws exactly as before.
	$effect(() => {
		const on = active;
		void openId;
		untrack(() => {
			tl?.setActive(on);
			if (!on) stop();
			preview();
		});
	});

	function onBeforeUnload(e: BeforeUnloadEvent): void {
		if (dirty) e.preventDefault();
	}

	// The scene object is replaced on every node edit (a rename in Properties, say): re-bind the
	// preview so it follows the screen the canvas is drawing.
	$effect(() => {
		void scene;
		untrack(preview);
	});

	let lastOpenRequest = 0;
	$effect(() => {
		const request = openRequest;
		if (!request || request.nonce === lastOpenRequest) return;
		lastOpenRequest = request.nonce;
		untrack(() => void refresh().then(() => open(request.id)));
	});

	onMount(() => {
		void refresh();
		window.addEventListener('beforeunload', onBeforeUnload);
		return () => window.removeEventListener('beforeunload', onBeforeUnload);
	});

	onDestroy(() => {
		stop();
		// Detaches the module's window keydown listener; without it the Timeline would keep
		// answering Ctrl+Z / Delete after Animate mode is left.
		tl?.destroy();
		tl = null;
		setTimelinePreview(null, previewOwner);
	});
</script>

<section class="tl-panel" aria-label="Timeline">
	<div class="tl-bar">
		<b class="tl-title">Timeline</b>
		<span class="tl-host">{hostLabel}</span>
		<select
			bind:this={pickerEl}
			value={openId ?? ''}
			onchange={(e) => {
				const id = e.currentTarget.value;
				if (id) void open(id);
			}}
			aria-label={`Timelines of this ${where}`}
		>
			<option value="" disabled>
				{screenRows.length ? 'Open a timeline…' : `No timelines on this ${where}`}
			</option>
			{#each screenRows as row (row.id)}
				<option value={row.id}>{row.name}</option>
			{/each}
		</select>
		<button type="button" onclick={() => void create()} disabled={!scene}>＋ New</button>
		{#if openId}
			<button type="button" onclick={() => void rename()}>Rename</button>
			<button type="button" class="danger" onclick={() => void remove()}>🗑</button>
			<span class="sep"></span>
			<button type="button" title="Back to the start" onclick={() => tl?.setTime(0)}>⏮</button>
			{#if playing}
				<button type="button" title="Pause" onclick={stop}>⏸</button>
			{:else}
				<button type="button" title="Play" onclick={play}>▶</button>
			{/if}
			{#if component}
				{@const current = playOn()}
				{@const problems = issues()}
				<label
					class="tl-playon"
					title="The instance signal that plays this timeline in game: enter (the instance appears), a signal the component declares, a Flow fireCue name or a rig cue's complete signal. Heard per instance, so two placements play on their own."
				>
					Plays on
					<select value={current} onchange={(e) => setPlayOn(e.currentTarget.value)}>
						<option value="">(nothing — not played)</option>
						{#each component.signals as signal (signal)}
							<option value={signal}>{signal}</option>
						{/each}
						{#if current && !component.signals.includes(current)}
							<option value={current}>{current}</option>
						{/if}
					</select>
				</label>
				<button
					type="button"
					title="Type any signal name — a Flow fireCue name, say"
					onclick={async () => {
						const name = await askText({
							title: 'Plays on signal',
							label: 'Signal name',
							value: playOn(),
						});
						if (name !== null) setPlayOn(name.trim());
					}}>✎</button
				>
				{#if current}
					<label
						class="tl-playon"
						title="An awaited fire of this signal (a Flow fireCue with “wait” ticked) continues only when this timeline has ended on every instance it started on — the way a coded overlay held its cue until its rig completed. Off: the fire returns at once, as before."
					>
						<input
							type="checkbox"
							checked={holdsCue()}
							onchange={(e) => setHoldsCue(e.currentTarget.checked)}
						/>
						Holds the cue
					</label>
				{/if}
				{#if component.others.length}
					<details class="tl-reuse">
						<summary
							title="Play this timeline on other components' instances too. It drives their nodes by name."
						>
							Also on{#if tl?.doc().playOnComponents?.length}
								({tl?.doc().playOnComponents?.length}){/if}
						</summary>
						<div class="tl-reuse-list">
							{#each component.others as other (other.id)}
								<label>
									<input
										type="checkbox"
										checked={reusedOn(other.id)}
										onchange={(e) => setReusedOn(other.id, e.currentTarget.checked)}
									/>
									{other.name}
								</label>
							{/each}
						</div>
					</details>
				{/if}
				{#if problems.length}
					<span class="pill error" title={problems.join('\n')}>
						⚠ {problems.length}
						{problems.length === 1 ? 'issue' : 'issues'}
					</span>
				{/if}
				<span class="sep"></span>
			{/if}
			<span class="tl-time">{time.toFixed(2)}s /</span>
			{#key docVersion}
				<input
					class="tl-dur"
					type="number"
					min="0.1"
					step="0.1"
					value={tl?.doc().duration ?? 1}
					title="Duration (seconds)"
					onchange={(e) => setDuration(Number(e.currentTarget.value))}
				/>
			{/key}
			<span class="sep"></span>
			{#if conflict}
				<span class="pill error" title={error}>⚠ Someone else saved this</span>
				<button type="button" onclick={() => void reloadTheirs()}>Reload theirs</button>
				<button type="button" onclick={() => void save(true)}>Overwrite with mine</button>
			{:else if busy}
				<span class="pill">Saving…</span>
			{:else if dirty}
				<span class="pill dirty">Unsaved</span>
				<button type="button" onclick={() => void save()}>Save</button>
			{:else if status}
				<span class="pill ok">{status}</span>
			{/if}
		{/if}
		{#if error && !conflict}
			<span class="pill error" title={error}>{error}</span>
		{/if}
	</div>

	<div class="tl-body">
		<div class="tl-keys">
			{#if !openId}
				<p class="note">
					Open or create a timeline for this {where}, select a node on the canvas, then key it here.
					Keys are relative to the node's Design pose: x/y add, scale and alpha multiply, rotation
					adds degrees. End an intro on the unchanged pose so the screen settles where you laid it
					out.
				</p>
			{:else if !selectedId}
				<p class="note">Select a node on the canvas to key it.</p>
			{:else if target && !target.ok}
				<p class="note warn">{target.message}</p>
			{:else if target?.ok}
				<div class="keys-head">
					<b>{target.target}</b>
					<small>{target.node.kind}</small>
				</div>
				{#if target.node.kind === 'spine'}
					<label class="keyrow" title="Play one of this rig's animations from the playhead">
						<span>animation</span>
						{#if selectedClips.length}
							<select
								value=""
								onchange={(e) => {
									addClip(e.currentTarget.value);
									e.currentTarget.value = '';
								}}
							>
								<option value="" disabled>＋ play from {time.toFixed(2)}s…</option>
								{#each selectedClips as clip (clip.name)}
									<option value={clip.name}>{clip.name} ({clip.duration.toFixed(2)}s)</option>
								{/each}
							</select>
						{:else}
							<small>loading the rig…</small>
						{/if}
					</label>
				{/if}
				{#if fxRows.length}
					<p class="note">
						⚡ rows key the effect's own parameters: the value itself, not an offset. An on/off one
						switches on its key.
					</p>
				{/if}
				{#each fxRows as row (row.channel)}
					{@const v = fxValue(row)}
					<label
						class="keyrow"
						class:keyed={keyed(row.channel)}
						title={row.param.note ?? `Effect parameter “${row.param.id}”`}
					>
						<span>⚡ {row.param.id}</span>
						{#if row.param.kind === 'bool'}
							<input
								type="checkbox"
								checked={v >= 0.5}
								onchange={(e) => keyFx(row, e.currentTarget.checked ? 1 : 0)}
							/>
						{:else}
							<input
								type="number"
								step="any"
								min={row.param.min}
								max={row.param.max}
								value={fmt(v)}
								onchange={(e) => {
									const raw = e.currentTarget.value.trim();
									const n = Number(raw);
									if (raw === '' || !Number.isFinite(n)) {
										e.currentTarget.value = fmt(fxValue(row));
										return;
									}
									keyFx(row, n);
								}}
							/>
						{/if}
						<button
							type="button"
							class="diamond"
							title={`Key ${row.param.id} at ${time.toFixed(2)}s`}
							onclick={() => keyFx(row)}>◆</button
						>
					</label>
				{/each}
				{#each channels as channel (channel)}
					<label class="keyrow" class:keyed={keyed(channel)}>
						<span>{CHANNEL_LABEL[channel]}</span>
						{#if channel === 'tint'}
							<input
								type="color"
								value={hex(value(channel))}
								onchange={(e) => key(channel, parseInt(e.currentTarget.value.slice(1), 16))}
							/>
						{:else}
							<input
								type="number"
								step={channel === 'x' || channel === 'y' || channel === 'rotation' ? 1 : 0.05}
								value={fmt(value(channel))}
								onchange={(e) => {
									const raw = e.currentTarget.value.trim();
									const v = Number(raw);
									// An emptied or junk field keys nothing — `Number('')` is 0, which would
									// collapse a scale or hide an alpha.
									if (raw === '' || !Number.isFinite(v)) {
										e.currentTarget.value = fmt(value(channel));
										return;
									}
									key(channel, v);
								}}
							/>
						{/if}
						<button
							type="button"
							class="diamond"
							title={`Key ${channel} at ${time.toFixed(2)}s`}
							onclick={() => key(channel)}>◆</button
						>
					</label>
				{/each}
			{/if}
		</div>
		<div class="tl-lanes" bind:this={tlEl}></div>
		<div class="tl-insp" bind:this={inspEl}></div>
	</div>
</section>

<style>
	.tl-panel {
		--bg: #1b1d22;
		--panel: #23262d;
		--panel2: #2b2f38;
		--line: #363b45;
		--txt: #d7dbe2;
		--dim: #8b93a1;
		--accent: #5db0ff;
		--accent2: #7ee0c0;
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
		background: var(--panel);
		color: var(--txt);
		border-top: 1px solid var(--line);
		font-size: 12px;
	}
	.tl-bar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border-bottom: 1px solid var(--line);
		flex-wrap: wrap;
	}
	.tl-title {
		color: var(--accent2);
		letter-spacing: 0.08em;
	}
	.tl-host {
		color: var(--dim);
	}
	.tl-bar select,
	.tl-bar input,
	.tl-bar button,
	.keyrow input {
		background: var(--panel2);
		color: var(--txt);
		border: 1px solid var(--line);
		border-radius: 5px;
		padding: 2px 6px;
		font-size: 12px;
	}
	.tl-bar button {
		cursor: pointer;
	}
	.tl-bar button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.tl-bar .danger:hover {
		color: #ff7a7a;
	}
	.sep {
		width: 1px;
		height: 16px;
		background: var(--line);
	}
	.tl-time {
		color: var(--dim);
		font-variant-numeric: tabular-nums;
	}
	.tl-dur {
		width: 60px;
	}
	.tl-playon {
		display: flex;
		align-items: center;
		gap: 4px;
		color: var(--dim);
	}
	.tl-reuse {
		position: relative;
		color: var(--dim);
	}
	.tl-reuse summary {
		cursor: pointer;
	}
	.tl-reuse-list {
		position: absolute;
		z-index: 5;
		top: 100%;
		left: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 180px;
		max-height: 240px;
		overflow: auto;
		padding: 6px 8px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 6px;
		color: var(--txt);
	}
	.pill {
		padding: 1px 8px;
		border-radius: 10px;
		background: var(--panel2);
		color: var(--dim);
		max-width: 420px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pill.ok {
		color: var(--accent2);
	}
	.pill.dirty {
		color: #ffd24a;
	}
	.pill.error {
		color: #ff7a7a;
	}
	.tl-body {
		display: grid;
		grid-template-columns: 220px minmax(0, 1fr) 240px;
		flex: 1;
		min-height: 0;
	}
	.tl-keys,
	.tl-insp {
		overflow: auto;
		border-right: 1px solid var(--line);
	}
	.tl-insp {
		border-right: none;
		border-left: 1px solid var(--line);
	}
	.tl-lanes {
		position: relative;
		overflow: auto;
		min-width: 0;
		background: var(--panel);
	}
	.note {
		padding: 10px 12px;
		margin: 0;
		color: var(--dim);
		line-height: 1.5;
		font-size: 11px;
	}
	.note.warn {
		color: #ffd24a;
	}
	.keys-head {
		display: flex;
		gap: 8px;
		align-items: baseline;
		padding: 8px 12px;
		border-bottom: 1px solid var(--line);
	}
	.keys-head small {
		color: var(--dim);
	}
	.keyrow {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 3px 12px;
		color: var(--dim);
	}
	.keyrow span {
		flex: 1;
	}
	.keyrow.keyed span {
		color: #ffd24a;
	}
	.keyrow input[type='number'] {
		width: 70px;
	}
	.keyrow input[type='color'] {
		width: 70px;
		height: 22px;
		padding: 0 2px;
	}
	.diamond {
		background: none;
		border: none;
		color: var(--dim);
		cursor: pointer;
		font-size: 11px;
	}
	.keyrow.keyed .diamond,
	.diamond:hover {
		color: #ffd24a;
	}

	/* The shared Timeline module's markup (the same classes `/rigger`'s view.html styles). */
	.tl-panel :global(.cineHead) {
		padding: 8px 12px;
		border-bottom: 1px solid var(--line);
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.tl-panel :global(.cineHead b) {
		color: var(--accent2);
		letter-spacing: 0.08em;
	}
	.tl-panel :global(.cineHead small),
	.tl-panel :global(.cineNote) {
		color: var(--dim);
	}
	.tl-panel :global(.cineNote) {
		padding: 10px 12px;
		font-size: 11px;
		line-height: 1.5;
	}
	.tl-panel :global(.cineRow) {
		padding: 6px 12px;
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.tl-panel :global(.cineStripInsp) {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 8px;
		padding: 8px 12px;
		color: var(--dim);
		font-size: 11px;
	}
	.tl-panel :global(.cineStripInsp label) {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.tl-panel :global(.cineStripInsp label.wide) {
		flex: 1 0 100%;
	}
	.tl-panel :global(.cineStripInsp input),
	.tl-panel :global(.cineStripInsp select),
	.tl-panel :global(.cineRow button),
	.tl-panel :global(.cineGutter button) {
		background: var(--panel2);
		color: var(--txt);
		border: 1px solid var(--line);
		border-radius: 4px;
		font-size: 11px;
	}
	.tl-panel :global(.cineStripInsp input[type='number']) {
		width: 64px;
	}
	.tl-panel :global(.cineRuler),
	.tl-panel :global(.cineTrack) {
		display: flex;
		height: 22px;
		align-items: stretch;
	}
	.tl-panel :global(.cineTrack) {
		height: 28px;
		border-bottom: 1px solid #2a2e36;
	}
	.tl-panel :global(.cineRuler) {
		position: sticky;
		top: 0;
		z-index: 5;
		height: 24px;
		background: var(--panel);
		border-bottom: 1px solid var(--line);
	}
	.tl-panel :global(.cineGutter) {
		width: 132px;
		flex: 0 0 132px;
		position: sticky;
		left: 0;
		z-index: 4;
		background: var(--panel);
		border-right: 1px solid var(--line);
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 0 6px;
		font-size: 11px;
		overflow: hidden;
		box-sizing: border-box;
	}
	.tl-panel :global(.cineRulerGutter) {
		color: var(--dim);
		font-size: 10px;
	}
	.tl-panel :global(.cineTrackName) {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tl-panel :global(.cineLane) {
		position: relative;
		flex: 0 0 auto;
	}
	.tl-panel :global(.cineTick) {
		position: absolute;
		top: 5px;
		font-size: 9px;
		color: var(--dim);
		padding-left: 3px;
		border-left: 1px solid var(--line);
		height: 14px;
	}
	.tl-panel :global(.cineVisRow) {
		background: rgba(126, 224, 192, 0.07);
	}
	.tl-panel :global(.cineVisKey) {
		position: absolute;
		top: 5px;
		width: 10px;
		height: 10px;
		margin-left: -5px;
		cursor: ew-resize;
		background: #7ee0c0;
		border: 1px solid #0c0f14;
		border-radius: 2px;
		z-index: 1;
	}
	.tl-panel :global(.cineVisKey.off) {
		background: transparent;
		border-color: #7ee0c0;
	}
	.tl-panel :global(.cineCueRow) {
		background: rgba(201, 139, 255, 0.07);
	}
	.tl-panel :global(.cineCue) {
		position: absolute;
		top: 4px;
		width: 0;
		height: 0;
		margin-left: -6px;
		cursor: ew-resize;
		border-left: 6px solid transparent;
		border-right: 6px solid transparent;
		border-top: 12px solid currentColor;
		z-index: 1;
	}
	.tl-panel :global(.cinePlayhead) {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: #ffd24a;
		z-index: 6;
		pointer-events: none;
		box-shadow: 0 0 4px rgba(255, 210, 74, 0.6);
	}
	.tl-panel :global(.cineChanRow) {
		height: 20px;
		background: rgba(0, 0, 0, 0.12);
	}
	.tl-panel :global(.cineChanName) {
		font-size: 10px;
		opacity: 0.9;
	}
	.tl-panel :global(.cineKey) {
		position: absolute;
		top: 4px;
		width: 11px;
		height: 11px;
		margin-left: -6px;
		transform: rotate(45deg);
		border: 1px solid #0c0f14;
		cursor: ew-resize;
		z-index: 1;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
	}
	.tl-panel :global(.cineKey.hold) {
		transform: none;
		border-radius: 1px;
	}
	.tl-panel :global(.cineKey.sel),
	.tl-panel :global(.cineCue.sel) {
		outline: 1px solid #fff;
	}
</style>
