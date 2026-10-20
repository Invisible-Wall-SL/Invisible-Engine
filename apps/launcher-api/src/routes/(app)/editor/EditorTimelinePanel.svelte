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
	 *   timeline), Ctrl+D (duplicate a strip), Ctrl+C / Ctrl+V (the selected keys), Delete /
	 *   Backspace (the selected keys), `,` / `.` (a frame; Shift ten) and Space (play / pause) while
	 *   this panel is active; the page and the canvas stand down on those (see `+page.svelte`).
	 * - Keying UI (Rive plan Phase 9b): the fields live in PROPERTIES, which reads what this panel
	 *   publishes (`setKeyingPanel`): one key button per keyable field, and a typed value keys it.
	 *   A drag on the stage keys through the same publication (`keyStage`).
	 * - The list (Rive plan Phase 9c): the host's timelines are listed, opened, created,
	 *   duplicated, renamed and deleted in the left column's ANIMATIONS list, which reads what this
	 *   panel publishes while `listed` (`setAnimationsPanel`) and calls back into it.
	 */
	import { onDestroy, onMount, untrack } from 'svelte';
	import {
		playbackTime,
		putKey,
		resolvePlace,
		resolveVisible,
		type CinematicKey,
	} from 'engine-cinematic';
	import {
		findActorNode,
		fxParamRest,
		placedFxParamValues,
		textNodeStrings,
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
		channelKeyState,
		componentTimelineId,
		componentTimelinesOf,
		duplicateTimeline,
		ensureNodeActor,
		fxChannelValue,
		keyableChannels,
		fxTimelineRows,
		keyableFxChannels,
		newComponentTimeline,
		newScreenTimeline,
		nodeActorOf,
		nodeActorTarget,
		nodeChannelValue,
		onionFrames,
		screenTimelineId,
		screenTimelinesOf,
		stageDragKeys,
		timelineDrives,
		type FxChannelRow,
		type KeyedChannel,
		type RigClip,
		type StageTransformDelta,
	} from '$lib/timeline/screenTimeline';
	import type { TimelineChannel } from '$lib/timeline/timeline';
	import {
		STARTER_TARGET,
		contentKey,
		linkStub,
		withPlacement,
		sharedTimelineId,
		updateAvailable,
		type SharedTimelineLink,
		type SharedTimelineSummary,
	} from '$lib/timeline/sharedTimelines';
	import {
		REPORT_EVENT_PREFIX,
		keyText,
		setTextMode,
		textKeyAt,
		textModeOf,
		textTrackOf,
		type TextMode,
	} from '$lib/timeline/timelineRows';
	import { placedEffect, placedEffectsVersion } from './placedEffects.client.svelte';
	import type { RigMeta } from './rigRuntime.client';
	import { setOnionPreview, setTimelinePreview } from './valuePreview.client.svelte';
	import { setKeyingPanel, type KeyField } from './animateKeying.client.svelte';
	import { setAnimationsPanel, type AnimationsPanel } from './animationsList.client.svelte';

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
		/** The Animations list shows this panel's timelines (Animate on this side of the editor, the
		 *  State machine tab included). Defaults to `active`. */
		listed?: boolean;
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
		listed,
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
	const where = $derived<'component' | 'screen'>(component ? 'component' : 'screen');

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
		// A link plays the shared content as it is: nothing keys it here (Detach first).
		if (link) return false;
		if (component) return doc.host?.kind === 'component' && doc.host.componentId === component.id;
		return doc.host?.kind === 'screen' && doc.host.sceneId === scene?.id;
	}

	function preview(): void {
		const doc = tl?.doc();
		setTimelinePreview(
			active && doc && scene ? timelineDrives(doc, scene, time) : null,
			previewOwner,
		);
		setOnionPreview(
			active && onion && doc && scene ? onionFrames(doc, scene, time, onionCount) : null,
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
			interpolation: true,
			summaryRows: true,
			boxSelect: true,
			textRows: true,
			host: {
				selectedActor: () => actorId(),
				togglePlay: () => (playing ? stop() : play()),
				evaluate(t) {
					time = t;
					preview();
				},
				seeked(t) {
					time = t;
					docVersion++;
				},
				changed() {
					if (tl && link && linkedContent !== null && contentKey(tl.doc()) !== linkedContent) {
						keepLinkedContent();
						return;
					}
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
		link = null;
		linkedContent = null;
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
		setOnionPreview(null, previewOwner);
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
		const body = (await res.json()) as {
			doc: CinematicDoc | null;
			etag: string | null;
			link?: LinkInfo;
		};
		if (!body.doc) {
			error = `"${id}" is not a readable timeline.`;
			return;
		}
		closeTimeline();
		openId = id;
		etag = body.etag;
		link = body.link ?? null;
		linkedContent = link ? contentKey(body.doc) : null;
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

	/** The list acts on a row: open it first (the unsaved-edit guard runs), then act on it. False
	 *  when it did not open. */
	async function openForList(id: string): Promise<boolean> {
		if (id !== openId) await open(id);
		return id === openId;
	}

	/** A copy of timeline `id` (any of this host's), saved create-only and opened. */
	async function duplicate(id: string): Promise<void> {
		if (busy || !(await guardUnsaved())) return;
		error = '';
		const res = await fetch(
			`/api/cinematics/get?id=${encodeURIComponent(id)}&projectKey=${encodeURIComponent(projectKey)}`,
		);
		const body = res.ok
			? ((await res.json()) as { doc: CinematicDoc | null })
			: { doc: null as CinematicDoc | null };
		if (!body.doc || !ownsDoc(body.doc)) {
			error = res.ok
				? `"${id}" is not a timeline of this ${where}.`
				: `Could not read "${id}": ${await readError(res)}`;
			return;
		}
		const copy = duplicateTimeline(
			body.doc,
			rows.map((r) => r.id),
			screenRows.map((r) => r.name),
		);
		closeTimeline();
		openId = copy.id;
		etag = null;
		mountTimeline(copy);
		dirty = true;
		await save();
		if (etag === null) {
			const reason = error || 'The copy could not be saved.';
			closeTimeline();
			error = reason;
		}
	}

	async function rename(id?: string): Promise<void> {
		if (id && !(await openForList(id))) return;
		const doc = tl?.doc();
		if (!doc) return;
		const name = await askText({ title: 'Rename timeline', label: 'Name', value: doc.name });
		if (!name?.trim() || name.trim() === doc.name) return;
		doc.name = name.trim();
		tl?.commit('rename');
		await save();
	}

	async function remove(id?: string): Promise<void> {
		if (id && !(await openForList(id))) return;
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

	/** `detach`: this save replaces a stored link with the timeline's own copy (Phase 9d). */
	async function save(force = false, detach = false): Promise<void> {
		const open = tl?.doc();
		if (!open || busy) return;
		// A link saves its placement only (the server drops anything else too).
		const doc = link ? linkStub(open, link) : open;
		const extra = detach ? { detach: true } : {};
		busy = true;
		error = '';
		try {
			const res = await fetch('/api/cinematics/save', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(
					force
						? { doc, force: true, projectKey, ...extra }
						: { doc, baseEtag: etag, projectKey, ...extra },
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

	/** Plays as the game will (the header's loop type): one-shot stops at the end, `loop` wraps
	 *  and `pingPong` comes back, until paused. */
	function play(): void {
		const doc = tl?.doc();
		if (!doc || !tl) return;
		const once = !doc.loop || doc.loop === 'oneShot';
		if (once && time >= doc.duration) tl.setTime(0);
		playing = true;
		let elapsed = time;
		let last = performance.now();
		const tick = (now: number): void => {
			if (!playing || !tl) return;
			elapsed += (now - last) / 1000;
			last = now;
			const open = tl.doc();
			const end = open.duration;
			tl.setTime(playbackTime(open.loop, elapsed, end));
			tl.positionPlayhead();
			if ((!open.loop || open.loop === 'oneShot') && elapsed >= end) stop();
			else raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
	}

	/** The header's loop type; One-shot is the absent default. */
	function setLoop(value: string): void {
		const doc = tl?.doc();
		if (!doc || !tl) return;
		if (value === 'loop' || value === 'pingPong') doc.loop = value;
		else delete doc.loop;
		tl.commit('loop type');
		docVersion++;
	}

	/** The snap grid (frame stepping and key placement); evaluation stays continuous. */
	function setFps(value: number): void {
		const doc = tl?.doc();
		if (!doc || !tl || !Number.isFinite(value) || value < 1 || value > 240) return;
		doc.fps = Math.round(value);
		tl.commit('fps', 'fps');
		tl.renderTimeline();
		docVersion++;
	}

	// ---- onion skin + row filter (editor-only, never saved) ---------------------------------

	let onion = $state(false);
	let onionCount = $state(2);
	let onlySelected = $state(false);
	$effect(() => {
		void onion;
		void onionCount;
		untrack(preview);
	});
	$effect(() => {
		const on = onlySelected;
		untrack(() => tl?.setOnlySelected(on));
	});
	// The filtered rows follow the canvas selection.
	$effect(() => {
		void selectedId;
		untrack(() => {
			if (onlySelected) tl?.renderTimeline();
		});
	});

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

	/** Key what a stage drag changed (`EditorCanvas` measured it on the Design pose), one undo step. */
	function keyStage(deltas: StageTransformDelta[]): number {
		const doc = tl?.doc();
		if (!doc || !tl || !scene || !ownsDoc(doc)) return 0;
		const at = Math.round(time * (doc.fps || 30)) / (doc.fps || 30);
		let keyedNodes = 0;
		for (const delta of deltas) {
			const t = nodeActorTarget(scene, delta.nodeId, where);
			if (!t.ok) continue;
			const values = stageDragKeys(
				doc,
				nodeActorOf(doc, t.target),
				delta,
				at,
				keyableChannels(t.node.kind),
			);
			const entries = Object.entries(values);
			if (!entries.length) continue;
			const id = ensureNodeActor(doc, t.target);
			let track = doc.tracks.find((tr) => tr.actorId === id && tr.kind === 'property');
			if (!track) {
				track = {
					id: 'prop_' + Math.random().toString(36).slice(2, 9),
					actorId: id,
					kind: 'property',
					channels: {},
				};
				doc.tracks.push(track);
			}
			const keyed = track.channels as Record<string, CinematicKey[]>;
			for (const [channel, value] of entries) {
				const ease = Array.isArray(doc.defaultEase) ? [...doc.defaultEase] : doc.defaultEase;
				putKey((keyed[channel] = keyed[channel] ?? []), at, value, ease as CinematicKey['ease']);
			}
			keyedNodes++;
		}
		if (!keyedNodes) return 0;
		tl.commit(keyedNodes > 1 ? 'key drag (' + keyedNodes + ' nodes)' : 'key drag');
		tl.renderTimeline();
		tl.renderInspector();
		preview();
		return keyedNodes;
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

	// ---- shared timelines (Rive plan Phase 9d) ------------------------------------------------

	/** What `/api/cinematics/get` says about a link. */
	interface LinkInfo extends SharedTimelineLink {
		name: string;
		latest: number | null;
		missing: boolean;
	}

	/** The open timeline's link to a shared one; null = it is the project's own. */
	let link = $state<LinkInfo | null>(null);
	/** A link's content as opened ({@link contentKey}): a commit that changes it is taken back. */
	let linkedContent: string | null = null;
	let sharedRows = $state<SharedTimelineSummary[]>([]);
	let canPublish = $state(false);
	let libraryOpen = $state(false);

	/**
	 * A commit changed a link's content (a key dragged in the lanes, say): put the shared content
	 * back under the doc's placement fields, which stay editable (name, Plays on, reuse). The
	 * history restarts there, so no undo can bring the edit back.
	 */
	function keepLinkedContent(): void {
		if (!tl || linkedContent === null) return;
		tl.setDoc(withPlacement(linkedContent, tl.doc()));
		tl.historyReset();
		tl.clearSelection();
		tl.renderTimeline();
		tl.renderInspector();
		docVersion++;
		preview();
		error = `"${link?.name}" is a shared timeline: its keys are edited in the shared library. Detach to edit a copy here.`;
	}

	async function refreshShared(): Promise<void> {
		const res = await fetch('/api/cinematics/shared');
		if (!res.ok) return;
		const body = (await res.json()) as { timelines: SharedTimelineSummary[]; canPublish: boolean };
		sharedRows = body.timelines;
		canPublish = body.canPublish;
	}

	/** Which node of this host each of a shared timeline's actors drives. Null = cancelled. */
	async function bindTargets(row: SharedTimelineSummary): Promise<Record<string, string> | null> {
		if (!scene) return null;
		const names = new Set(scene.nodes.map((n) => n.label ?? n.id));
		const selected = target?.ok ? target.target : '';
		const targets: Record<string, string> = {};
		for (const from of row.targets) {
			const value = await askText({
				title: `Place "${row.name}"`,
				message:
					from === STARTER_TARGET
						? 'Which node does it animate? Type the node’s name (its label).'
						: `It animates a node named "${from}". Which node of this ${where} is that?`,
				label: 'Node name',
				value: names.has(from) ? from : selected || from,
			});
			if (value === null) return null;
			if (value.trim() && value.trim() !== from) targets[from] = value.trim();
		}
		return targets;
	}

	/** Place a shared timeline on this host: a LINK (its own id and trigger, the shared content). */
	async function placeShared(row: SharedTimelineSummary): Promise<void> {
		if (!scene || !(await guardUnsaved())) return;
		libraryOpen = false;
		const targets = await bindTargets(row);
		if (!targets) return;
		const taken = rows.map((r) => r.id);
		const id = component
			? componentTimelineId(component.id, row.name, taken)
			: screenTimelineId(scene.id, row.name, taken);
		const placement = component
			? newComponentTimeline({
					id,
					name: row.name,
					componentId: component.id,
					playOn: component.signals[0],
				})
			: newScreenTimeline({ id, name: row.name, sceneId: scene.id });
		placement.duration = row.duration;
		const stub = linkStub(placement, {
			id: row.id,
			version: row.version,
			...(Object.keys(targets).length ? { targets } : {}),
		});
		error = '';
		const res = await fetch('/api/cinematics/save', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ doc: stub, baseEtag: null, projectKey }),
		});
		if (!res.ok) {
			error = `Could not place "${row.name}": ${await readError(res)}`;
			return;
		}
		dirty = false;
		await refresh();
		await open(id);
	}

	/** Re-pin the open link to the shared copy's latest version. */
	async function updateLink(): Promise<void> {
		if (!link || link.latest === null) return;
		const id = openId;
		const previous = { link, dirty };
		link = { ...link, version: link.latest };
		dirty = true;
		await save();
		if (dirty) {
			link = previous.link;
			dirty = previous.dirty;
			return;
		}
		if (id) {
			closeTimeline();
			await open(id);
		}
	}

	/** Detach: the resolved content becomes the project's own timeline, under the same id. */
	async function detach(): Promise<void> {
		const doc = tl?.doc();
		if (!doc || !link || link.missing) return;
		const ok = await askConfirm({
			title: `Detach "${doc.name}" from the shared library?`,
			message:
				'A copy of what it plays now is saved in this project, and you can edit it here. It no longer follows the shared timeline, and shows no update.',
			confirmLabel: 'Detach',
		});
		if (!ok) return;
		const id = openId;
		const previous = { link, linkedContent, dirty };
		link = null;
		linkedContent = null;
		dirty = true;
		await save(false, true);
		if (dirty) {
			link = previous.link;
			linkedContent = previous.linkedContent;
			dirty = previous.dirty;
			return;
		}
		if (id) {
			closeTimeline();
			await open(id);
		}
	}

	/** Promote the open (own) timeline to `_shared/cinematics/` as its next version. */
	async function promote(): Promise<void> {
		const doc = tl?.doc();
		if (!doc || link || !canPublish) return;
		if (dirty) await save();
		if (dirty) return;
		const name = await askText({
			title: 'Promote to the shared library',
			message:
				'Every project can place it. Its keys bind by node NAME; the host and Plays on stay here. Promoting an existing name adds a new version: placed copies show an update.',
			label: 'Shared name',
			value: doc.name,
		});
		if (!name?.trim()) return;
		const sharedId = sharedTimelineId(name);
		error = '';
		/** The shared copy this would follow: its version and the ETag a promote over it sends. */
		const readShared = async (): Promise<{ version: number; etag: string | null } | null> => {
			const head = await fetch(`/api/cinematics/shared/get?id=${encodeURIComponent(sharedId)}`);
			if (!head.ok) {
				error = `Could not read the shared library: ${await readError(head)}`;
				return null;
			}
			const body = (await head.json()) as {
				doc: { version: number } | null;
				etag: string | null;
			};
			return { version: body.doc?.version ?? 0, etag: body.etag };
		};
		const post = (baseEtag: string | null): Promise<Response> =>
			fetch('/api/cinematics/shared/promote', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ doc: tl?.doc(), name: name.trim(), sharedId, baseEtag }),
			});
		let shared = await readShared();
		if (!shared) return;
		// The name is the id: a name already in the library would make this its NEXT version, which
		// every project placing it is offered as an update. Say so before writing.
		if (shared.etag !== null) {
			const onTop = await askConfirm({
				title: `"${name.trim()}" is already in the shared library (v${shared.version})`,
				message: `Add yours as v${shared.version + 1}? Every project that placed it is offered the update. Cancel, then pick another name, to add a new shared timeline instead.`,
				confirmLabel: `Add v${shared.version + 1}`,
			});
			if (!onTop) return;
		}
		let res = await post(shared.etag);
		const refusal =
			res.status === 409
				? ((await res
						.clone()
						.json()
						.catch(() => null)) as { error?: string; message?: string } | null)
				: null;
		// Only a lost race is worth retrying on top; an unreadable shared copy fails the same way again.
		if (refusal?.error === 'conflict') {
			const again = await askConfirm({
				title: 'Promote yours as a NEW version on top?',
				message: refusal.message ?? 'Someone else promoted it meanwhile.',
				confirmLabel: 'Promote on top',
			});
			if (!again) return;
			shared = await readShared();
			if (!shared) return;
			res = await post(shared.etag);
		}
		if (!res.ok) {
			error = `Promote failed: ${await readError(res)}`;
			return;
		}
		const body = (await res.json()) as { version: number };
		status = `Promoted "${name.trim()}" v${body.version}`;
		await refreshShared();
	}

	// ---- cue, visibility and text rows (Rive plan Phase 9d) ---------------------------------

	/** Rive's Report Event: a `signal:` cue at the playhead, selected so its name can be typed. */
	function reportEvent(): void {
		const doc = tl?.doc();
		if (!doc || !tl || !ownsDoc(doc)) return;
		tl.addCue(REPORT_EVENT_PREFIX);
		docVersion++;
	}

	/** Key the selected node shown or hidden from the playhead (a stepped visibility key). */
	function keyVisible(visible: boolean): void {
		const doc = tl?.doc();
		if (!doc || !tl || !target?.ok || !ownsDoc(doc)) return;
		tl.keyVisibility(ensureNodeActor(doc, target.target), visible);
		preview();
	}

	/** The selected text node's strings, offered by a switch key (its text may repeat a key). */
	const textStrings = $derived(target?.ok ? [...new Set(textNodeStrings(target.node))] : []);

	/** The mode picked for a node with no text track yet: its first key creates the track in it. */
	let pendingTextMode = $state<TextMode>('countUp');
	$effect(() => {
		void selectedId;
		pendingTextMode = 'countUp';
	});

	function textMode(): TextMode {
		void docVersion;
		const doc = tl?.doc();
		const id = actorId();
		return doc && id && textTrackOf(doc, id) ? textModeOf(doc, id) : pendingTextMode;
	}

	/** The text key at the playhead, if any (what the field shows). */
	function textKeyHere(): { value?: number; key?: string } | null {
		void docVersion;
		const doc = tl?.doc();
		const id = actorId();
		return doc && id ? textKeyAt(doc, id, time, 0.5 / (doc.fps || 30)) : null;
	}

	/** Key the selected text node at the playhead: a count-up number or one of its strings. */
	function keyTextAt(mode: TextMode, payload: number | string): void {
		const doc = tl?.doc();
		if (!doc || !tl || !target?.ok || !ownsDoc(doc)) return;
		const id = ensureNodeActor(doc, target.target);
		const at = Math.round(time * (doc.fps || 30)) / (doc.fps || 30);
		keyText(doc, id, at, mode, payload, () => 'text_' + Math.random().toString(36).slice(2, 9));
		tl.commit('key text');
		tl.renderTimeline();
		preview();
	}

	/** The text mode select: a node with no track just remembers it; a track with keys asks first,
	 *  since switching drops them (`picker` is put back on a cancel). */
	async function changeTextMode(mode: TextMode, picker: HTMLSelectElement): Promise<void> {
		const doc = tl?.doc();
		const id = actorId();
		const track = doc && id ? textTrackOf(doc, id) : null;
		if (!doc || !tl || !id || !track) {
			pendingTextMode = mode;
			return;
		}
		if (!ownsDoc(doc) || textMode() === mode) return;
		const keyed = Array.isArray(track.keys) && track.keys.length > 0;
		const ok =
			!keyed ||
			(await askConfirm({
				title: 'Switch the text track?',
				message:
					mode === 'switchKey'
						? 'Its count-up keys are removed: a switch key names one of the node’s own strings.'
						: 'Its switch keys are removed: a count-up key is a number.',
				confirmLabel: 'Switch',
			}));
		if (!ok || !setTextMode(doc, id, mode)) {
			picker.value = textMode();
			return;
		}
		tl.commit('text mode');
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

	const CHANNEL_LABEL: Record<KeyedChannel, string> = {
		x: 'x',
		y: 'y',
		scale: 'scale ×',
		rotation: 'rotation (°)',
		alpha: 'alpha',
		tint: 'tint',
	};

	/** What Properties offers to key on the selected node (`setKeyingPanel`). */
	const keying = $derived.by(() => {
		void docVersion;
		// Published with no selection too: the canvas asks it whether a stage drag can key.
		if (!active) return null;
		const doc = tl?.doc();
		const base = {
			nodeId: selectedId ?? '',
			time,
			timelineOpen: !!doc && !!openId,
			fields: [] as KeyField[],
			key: keyField,
			keyStage,
		};
		if (!doc || !openId)
			return {
				...base,
				message: `Open or create a timeline in the panel below to key this ${where}.`,
			};
		if (link)
			return {
				...base,
				timelineOpen: false,
				message: `"${link.name}" is a shared timeline. Detach it (Timeline panel) to key it here.`,
			};
		if (!target) return base;
		if (!target.ok) return { ...base, message: target.message };
		const id = actorId();
		const fields: KeyField[] = [
			...channels.map((channel): KeyField => ({
				channel,
				label: CHANNEL_LABEL[channel],
				kind: 'node',
				value: value(channel),
				state: channelKeyState(doc, id, channel, time),
			})),
			...fxRows.map((row): KeyField => ({
				channel: row.channel,
				label: `⚡ ${row.param.id}`,
				kind: 'fx',
				value: fxValue(row),
				state: channelKeyState(doc, id, row.channel, time),
				bool: row.param.kind === 'bool',
				min: row.param.kind === 'number' ? row.param.min : undefined,
				max: row.param.kind === 'number' ? row.param.max : undefined,
				note: row.param.note,
			})),
		];
		return { ...base, target: target.target, fields };
	});
	$effect(() => {
		const next = keying;
		untrack(() => setKeyingPanel(next, previewOwner));
	});

	/** What the left column's Animations list shows and does (`setAnimationsPanel`). */
	const listing = $derived<AnimationsPanel | null>(
		(listed ?? active)
			? {
					where,
					hostLabel,
					rows: screenRows.map((r) => ({ id: r.id, name: r.name, duration: r.duration })),
					openId,
					dirty,
					canCreate: !!scene,
					open,
					create,
					duplicate,
					rename,
					remove,
				}
			: null,
	);
	$effect(() => {
		const next = listing;
		untrack(() => setAnimationsPanel(next, previewOwner));
	});

	/** Properties' key button / typed value: route a field to its channel's keyer. */
	function keyField(channel: string, v?: number): void {
		const row = fxRows.find((r) => r.channel === channel);
		if (row) keyFx(row, v);
		else if ((channels as string[]).includes(channel)) key(channel as KeyedChannel, v);
	}

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
		void refreshShared();
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
		setOnionPreview(null, previewOwner);
		setKeyingPanel(null, previewOwner);
		setAnimationsPanel(null, previewOwner);
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
				<button type="button" title="Pause (Space)" onclick={stop}>⏸</button>
			{:else}
				<button type="button" title="Play (Space)" onclick={play}>▶</button>
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
				<select
					class="tl-loop"
					value={tl?.doc().loop ?? 'oneShot'}
					title="Loop type — how the game plays it: once and hold the last frame, wrap to the start, or play there and back. A looping timeline never ends, so it holds no cue."
					onchange={(e) => setLoop(e.currentTarget.value)}
				>
					<option value="oneShot">One-shot</option>
					<option value="loop">Loop</option>
					<option value="pingPong">Ping-pong</option>
				</select>
				<label
					class="tl-fps"
					title="Frames per second: the snap grid keys land on and , / . step by"
				>
					<input
						type="number"
						min="1"
						max="240"
						step="1"
						value={tl?.doc().fps ?? 30}
						onchange={(e) => setFps(Number(e.currentTarget.value))}
					/>
					fps
				</label>
			{/key}
			<span class="sep"></span>
			<label
				class="tl-playon"
				title="Onion skin: outline the keyed nodes a few frames before (red) and after (green) the playhead on the stage. Editor-only."
			>
				<input type="checkbox" bind:checked={onion} />
				Onion
			</label>
			{#if onion}
				<input
					class="tl-onion"
					type="number"
					min="1"
					max="10"
					step="1"
					bind:value={onionCount}
					title="Ghost frames on each side of the playhead"
				/>
			{/if}
			<label class="tl-playon" title="Show only the rows of the node selected on the canvas">
				<input type="checkbox" bind:checked={onlySelected} />
				Only selected
			</label>
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
					Open or create a timeline for this {where} (the picker above, or the Animations list on the
					left), select a node on the canvas, then key it in Properties. Keys are relative to the node's
					Design pose: x/y add, scale and alpha multiply, rotation adds degrees. End an intro on the unchanged
					pose so the screen settles where you laid it out.
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
				{#if !link}
					<div
						class="keyrow"
						title="Show or hide the node from the playhead (stepped, like Rive's visibility key)"
					>
						<span>visible</span>
						<button type="button" onclick={() => keyVisible(true)}>👁 Show</button>
						<button type="button" onclick={() => keyVisible(false)}>Hide</button>
					</div>
					{#if target.node.kind === 'text'}
						{@const mode = textMode()}
						{@const here = textKeyHere()}
						<div
							class="keyrow"
							title="Count up to a number, or switch among this node's own strings"
						>
							<span>text</span>
							<select
								value={mode}
								onchange={(e) =>
									void changeTextMode(e.currentTarget.value as TextMode, e.currentTarget)}
							>
								<option value="countUp">Count up</option>
								<option value="switchKey">Switch</option>
							</select>
						</div>
						<div class="keyrow">
							<span>◆ at {time.toFixed(2)}s</span>
							{#if mode === 'switchKey'}
								<select
									value={here?.key ?? ''}
									onchange={(e) => {
										if (e.currentTarget.value) keyTextAt('switchKey', e.currentTarget.value);
									}}
								>
									<option value="" disabled>pick a string…</option>
									{#each textStrings as str (str)}
										<option value={str}>{str}</option>
									{/each}
								</select>
							{:else}
								<input
									type="number"
									step="1"
									value={here?.value ?? ''}
									placeholder="number"
									onchange={(e) => {
										const v = Number(e.currentTarget.value);
										if (e.currentTarget.value !== '' && Number.isFinite(v)) keyTextAt('countUp', v);
									}}
								/>
							{/if}
						</div>
					{/if}
				{/if}
				<p class="note">
					Key it in <b>Properties</b> →: each field has a key button — grey: not animated; blue outline:
					animated; blue: a key at the playhead. Typing a value keys it, and so does dragging, scaling
					or rotating the node on the stage. Keys stay relative to the Design pose.
				</p>
			{/if}
		</div>
		<div class="tl-track">
			<div class="tl-rowbar">
				<div class="tl-library">
					<button
						type="button"
						disabled={!scene}
						title="Shared timelines and starters: place one on this {where} as a link"
						onclick={() => {
							libraryOpen = !libraryOpen;
							if (libraryOpen) void refreshShared();
						}}>📚 Shared</button
					>
					{#if libraryOpen}
						<div class="tl-library-list" data-esc-owner>
							{#each sharedRows as row (row.id)}
								<div class="tl-library-row">
									<span title={row.targets.length ? `Animates: ${row.targets.join(', ')}` : ''}>
										{row.starter ? '✦' : '📚'}
										{row.name}
										<small>v{row.version} · {row.duration}s</small>
									</span>
									<button type="button" onclick={() => void placeShared(row)}>Place</button>
								</div>
							{:else}
								<small>No shared timelines yet.</small>
							{/each}
						</div>
					{/if}
				</div>
				{#if openId && link}
					<span
						class="pill link"
						title="A link to the shared timeline “{link.name}”: it plays version {link.version}. Its keys are edited in the shared library."
						>🔗 {link.name} v{link.version}</span
					>
					{#if link.missing}
						<span class="pill error">⚠ shared version missing — it ships nothing</span>
					{:else if updateAvailable(link, link.latest)}
						<span class="pill dirty" title="The shared copy has a newer version"
							>Update available (v{link.latest})</span
						>
						<button type="button" onclick={() => void updateLink()}>Update</button>
					{/if}
					<button
						type="button"
						disabled={link.missing}
						title="Copy what it plays into this project, to edit it here"
						onclick={() => void detach()}>Detach</button
					>
				{:else if openId}
					<button
						type="button"
						title="Report event: a signal: cue at the playhead. A component's instances hear it as a signal; Flow reacts to it. Name it in the inspector →"
						onclick={reportEvent}>⚡ Report event</button
					>
					{#if canPublish}
						<button
							type="button"
							title="Save a copy to the shared library (_shared/cinematics) that every project can place"
							onclick={() => void promote()}>Promote to shared</button
						>
					{/if}
					<small
						>Cue, visible and text rows: drag a marker to retime it, double-click a visible or text
						marker to delete it.</small
					>
				{/if}
			</div>
			<div class="tl-lanes" bind:this={tlEl}></div>
		</div>
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
	.tl-fps {
		display: flex;
		align-items: center;
		gap: 3px;
		color: var(--dim);
	}
	.tl-fps input,
	.tl-onion {
		width: 46px;
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
	.tl-track {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	.tl-rowbar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 3px 8px;
		border-bottom: 1px solid var(--line);
		color: var(--dim);
		font-size: 10px;
	}
	.tl-rowbar button,
	.keyrow button,
	.keyrow select {
		background: var(--panel2);
		color: var(--txt);
		border: 1px solid var(--line);
		border-radius: 5px;
		padding: 1px 6px;
		font-size: 11px;
		cursor: pointer;
	}
	.tl-library {
		position: relative;
	}
	.tl-library-list {
		position: absolute;
		z-index: 7;
		top: 100%;
		left: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 240px;
		max-height: 260px;
		overflow: auto;
		padding: 6px 8px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 6px;
		color: var(--txt);
		font-size: 11px;
	}
	.tl-library-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.tl-library-row small {
		color: var(--dim);
	}
	.pill.link {
		color: var(--accent);
	}
	.tl-lanes {
		flex: 1;
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
	.tl-panel :global(.cineTextRow) {
		background: rgba(255, 210, 74, 0.06);
	}
	.tl-panel :global(.cineTextKey) {
		position: absolute;
		top: 3px;
		max-width: 90px;
		padding: 0 4px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 9px;
		line-height: 13px;
		color: #0c0f14;
		background: #ffd24a;
		border-radius: 3px;
		cursor: ew-resize;
		z-index: 1;
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
