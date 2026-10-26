/**
 * Invisible Timeline — ONE timeline panel (a sequencer), mounted by every tool that edits a
 * cinematic. Plan: docs/design/rive-style-editor.md §3.4 · State: docs/status/cinematic.md
 *
 * What it owns: the ruler + scrub, the track rows (animation layers + strips, property / camera /
 * visibility channels, cues, the set's depth row), strip drag / trim / zoom, keys and cues, the
 * strip / key / cue inspector, the camera + cue panel sections, and snapshot undo / redo with the
 * keyboard that drives them.
 *
 * What it does NOT own: the stage. Posing actors, drawing, loading rigs, saving the document and
 * the tool's own panel all belong to the HOST, reached only through `options.host`. Rig-only
 * authoring (Tweak Mode, inline posing, bone masks) plugs in through `options.extensions`, so the
 * core stays free of any one tool's globals and can be mounted from `/rigger`'s static page and
 * from a Svelte component alike.
 *
 * SHIPPING: this file is the SOURCE. `/rigger`'s static page fetches a generated verbatim copy,
 * `static/shared/timeline.mjs` (`node scripts/sync-timeline.mjs`; `--check`
 * fails on drift), exactly as it fetches the evaluator. So it stays plain dependency-free ESM: no
 * imports at all — the evaluator is INJECTED (`options.ev`), because the two hosts reach it by
 * different paths (an HTTP URL on the static page, the `engine-cinematic` package in Svelte).
 *
 * ROWS ARE DATA: `orderedRows` lists what to draw and `ROW_KINDS` says how to draw and wire each
 * kind, so a new track or actor kind is one more entry, not a restructure.
 *
 * OPT-IN SURFACES (Rive plan Phase 9b): `options.interpolation` swaps the key inspector's ease
 * `<select>` for the Interpolation panel (Linear / Cubic with a two-handle curve / Hold, and the
 * doc's default), `options.summaryRows` gives every animated actor a collapsible summary row, and
 * `options.boxSelect` lets a drag over an empty channel lane box-select keys. `/rigger` sets none
 * of them, so its markup and lane clicks are unchanged; Shift/Ctrl-click selection, multi-key
 * drag, Ctrl+C / Ctrl+V and `,` / `.` frame stepping work in both. `options.textRows` (Rive plan
 * Phase 9d) draws a node actor's `text` track as a row; `/rigger` has no text tracks and leaves it
 * off.
 */

const TL_GUTTER = 132;
const TRIM_ZONE = 7; // px at each end of a strip that trims instead of moves
const HISTORY_LIMIT = 100;
const COALESCE_MS = 600;

/**
 * Property channels an actor can key. A channel with keys OWNS its property for the whole
 * cinematic (see the evaluator's note), so the static placement is the value you get until you key
 * it, and the keys take over the moment the first one exists.
 */
export const PROP_CHANNELS = [
	{ key: 'x', label: 'x', color: '#5cc8ff' },
	{ key: 'y', label: 'y', color: '#9b8cff' },
	{ key: 'scale', label: 'scale', color: '#7ee0c0' },
	{ key: 'rotation', label: 'rot', color: '#ff6b6b' },
	{ key: 'alpha', label: 'alpha', color: '#e0a64a' },
];
export const CAM_CHANNELS = [
	{ key: 'x', label: 'x', color: '#5cc8ff' },
	{ key: 'y', label: 'y', color: '#9b8cff' },
	{ key: 'zoom', label: 'zoom', color: '#7ee0c0' },
];

/**
 * Cue namespaces. A cue is a NAMED moment on the timeline that the GAME reacts to — the
 * cinematic never implements the effect itself, it only says when. Keeping the namespace in the
 * string (rather than a separate field) means one flat key list stays sortable, diffable and
 * forward-compatible: a namespace we have not built yet round-trips untouched.
 */
export const CUE_KINDS = [
	{ prefix: 'fx:', label: 'FX', color: '#c98bff', hint: 'an Invisible FX effect id' },
	{ prefix: 'sfx:', label: 'SFX', color: '#e0a64a', hint: 'a sound cue name in the game' },
	{ prefix: 'music:', label: 'Music', color: '#e0a64a', hint: 'a music cue name in the game' },
	{ prefix: 'signal:', label: 'Signal', color: '#7ee0c0', hint: 'broadcast on the game event bus' },
];
const cueColor = (cue) =>
	(CUE_KINDS.find((k) => String(cue || '').startsWith(k.prefix)) || {}).color || '#8b93a1';

/** Only ANIMATION tracks carry `strips`; property / visibility / camera / cue tracks carry keys. */
export const hasStrips = (track) => Array.isArray(track.strips);

export const esc = (s) =>
	String(s == null ? '' : s).replace(
		/[&<>"]/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
	);

/** 0xRRGGBB → `#rrggbb`. */
const hexColor = (n) => '#' + (Math.round(n) & 0xffffff).toString(16).padStart(6, '0');

const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 9);

/** A cubic ease's four numbers, or null. Mirrors the evaluator's `isCubicEase`. */
const cubicOf = (ease) =>
	Array.isArray(ease) && ease.length === 4 && ease.every((n) => Number.isFinite(n)) ? ease : null;
/** The `ease: 'ease'` smoothstep is exactly this cubic (x(s) = s, y(s) = 3s² − 2s³). */
const SMOOTH_CUBIC = [1 / 3, 0, 2 / 3, 1];
/** Where the Cubic button starts a key that is not cubic yet: CSS `ease-in-out`. */
const DEFAULT_CUBIC = [0.42, 0, 0.58, 1];
/** The named eases the Interpolation panel offers beside Cubic (the evaluator draws them). */
const NAMED_KINDS = ['linear', 'hold', 'elastic', 'bounce'];
/** Linear / Cubic / Hold / Elastic / Bounce — how the Interpolation panel names a key's `ease`. */
const easeKind = (ease) =>
	cubicOf(ease) || ease === 'ease' ? 'cubic' : NAMED_KINDS.includes(ease) ? ease : 'linear';
const cubicValues = (ease) => cubicOf(ease) || (ease === 'ease' ? SMOOTH_CUBIC : DEFAULT_CUBIC);
const n3 = (n) => +(+n).toFixed(3);
const cubicText = (c) => c.map(n3).join(', ');
/** `x1, y1, x2, y2` typed by an author, x clamped to [0, 1]; null when it is not four numbers. */
function parseCubic(text) {
	const parts = String(text || '')
		.split(/[\s,]+/)
		.filter(Boolean)
		.map(Number);
	if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
	const clamp01 = (n) => Math.min(Math.max(n, 0), 1);
	return [clamp01(parts[0]), parts[1], clamp01(parts[2]), parts[3]];
}
const cloneEase = (ease) => (Array.isArray(ease) ? ease.slice() : ease);
const easeLabel = (ease) => (cubicOf(ease) ? 'cubic ' + cubicText(ease) : ease || 'linear');

/**
 * Cubic presets the Interpolation panel offers beside its kinds (Elastic and Bounce are kinds of
 * their own: no cubic can draw them). Each is plain data, so a key keeps only its four numbers.
 */
export const CUBIC_PRESETS = [
	{ id: 'easeIn', label: 'Ease in', cubic: [0.42, 0, 1, 1] },
	{ id: 'easeOut', label: 'Ease out', cubic: [0, 0, 0.58, 1] },
	{ id: 'easeInOut', label: 'Ease in-out', cubic: [0.42, 0, 0.58, 1] },
	{ id: 'overshoot', label: 'Overshoot', cubic: [0.34, 1.56, 0.64, 1] },
	{ id: 'anticipate', label: 'Anticipate', cubic: [0.36, 0, 0.66, -0.56] },
];

// ---- the Graph Editor's geometry (`options.graph`) ---------------------------
//
// Pure, so the gate checks it without a DOM: the curve is the evaluator's own `sampleChannel`
// (the function the game samples a key channel with), and a handle is the cubic's control point
// drawn in time × value, so dragging it writes the same four numbers the curve editor writes.

/** The graph row's height and its inner margin, in px. */
export const GRAPH_H = 140;
const GRAPH_PAD = 12;

/**
 * A channel's value over the timeline, laid out for a `width × GRAPH_H` lane at `pps`: the
 * sampled points (every 2 px, plus every key time), the value range (every sample and key, so an
 * overshoot shows), and `y(v)` / `valueAt(py)` to map between value and pixel. `range` pins the
 * range (a handle drag keeps the frame still under the pointer).
 */
export function graphGeometry(keys, ev, duration, pps, range) {
	const width = Math.max(duration * pps, 1);
	const times = new Set();
	for (let x = 0; x <= width; x += 2) times.add(x / pps);
	for (const k of keys) if (k.time >= 0 && k.time <= duration) times.add(k.time);
	const points = [...times]
		.sort((a, b) => a - b)
		.map((t) => ({ t, v: ev.sampleChannel(keys, t) }))
		.filter((p) => Number.isFinite(p.v));
	let min = Infinity;
	let max = -Infinity;
	for (const p of points) {
		if (p.v < min) min = p.v;
		if (p.v > max) max = p.v;
	}
	for (const k of keys) {
		if (k.value < min) min = k.value;
		if (k.value > max) max = k.value;
	}
	if (range) {
		min = range.min;
		max = range.max;
	}
	if (!Number.isFinite(min)) {
		min = 0;
		max = 1;
	}
	if (max - min < 1e-9) {
		min -= 1;
		max += 1;
	}
	const span = max - min;
	const y = (v) => GRAPH_PAD + ((max - v) / span) * (GRAPH_H - GRAPH_PAD * 2);
	const valueAt = (py) => max - ((py - GRAPH_PAD) / (GRAPH_H - GRAPH_PAD * 2)) * span;
	return { width, points, min, max, y, valueAt };
}

/** A cubic segment's two control points in time × value, from key `a` to key `b`. */
export function cubicHandlePoints(a, b, cubic) {
	const dt = b.time - a.time;
	const dv = b.value - a.value;
	return [
		{ t: a.time + cubic[0] * dt, v: a.value + cubic[1] * dv },
		{ t: a.time + cubic[2] * dt, v: a.value + cubic[3] * dv },
	];
}

/**
 * The cubic after dragging handle `which` (1 or 2) of segment `a → b` to (`t`, `v`): x is the
 * time share, clamped to 0..1 (a cubic must stay a function of time); y is the value share, free
 * to overshoot. Null when the segment has no time or no value change to shape.
 */
export function cubicFromHandle(a, b, cubic, which, t, v) {
	const dt = b.time - a.time;
	const dv = b.value - a.value;
	if (!(dt > 0) || Math.abs(dv) < 1e-9) return null;
	const next = cubic.slice();
	const i = which === 1 ? 0 : 2;
	next[i] = n3(Math.min(Math.max((t - a.time) / dt, 0), 1));
	next[i + 1] = n3((v - a.value) / dv);
	return next;
}

const noop = () => {};
const HOST_DEFAULTS = {
	evaluate: noop,
	seeked: noop,
	changed: noop,
	render: null, // default: re-render the inspector only (see `mount`)
	docReplaced: noop,
	tracksChanged: noop,
	save: noop,
	setDepth: noop,
	actorLabel: (cast) => ({ text: cast.actorId, title: cast.actorId }),
	actorChannels: () => [],
	clips: () => [],
	sceneName: () => null,
	effects: () => [],
	cameraView: () => null,
	selectedActor: () => null,
	togglePlay: null, // Space; a host without a transport leaves it to the page
	pasteTarget: () => null,
	cueSuggestions: () => [],
};

/**
 * Mount the Timeline on `el` (the timeline container). Nothing is drawn until the host calls
 * `renderTimeline()` / `renderInspector()` — the host decides when its own panel is ready.
 *
 * @param {HTMLElement | null} el
 * @param {import('./timeline').TimelineOptions} options
 * @returns {import('./timeline').Timeline}
 */
export function mount(el, options) {
	const EV = options.ev;
	const inspectorEl = options.inspector || null;
	const host = { ...HOST_DEFAULTS, ...(options.host || {}) };
	const extensions = options.extensions || [];
	const propChannels = options.channels || PROP_CHANNELS;
	/** An actor's rows: the shared property channels, then the ones the host adds for that actor. */
	const channelsOf = (cast) =>
		cast ? propChannels.concat(host.actorChannels(cast)) : propChannels;
	const render = () => (host.render ? host.render() : renderInspector());

	let doc = options.doc;
	let time = 0;
	let active = false;
	let selStripId = null;
	let selKey = null; // { trackId, channel, time } — the PRIMARY key (the inspector edits it)
	let selKeys = []; // every selected property / camera key, the primary included
	// [{ trackId, actorId, kind, channel, dt, value, ease }] — Ctrl+C, pasted at the playhead
	let keyClipboard = null;
	const collapsed = new Set(); // actor ids whose summary row is folded
	let onlySelected = false;
	const interpolation = !!options.interpolation;
	const summaryRows = !!options.summaryRows;
	const boxSelect = !!options.boxSelect;
	const textRows = !!options.textRows;
	const graph = !!options.graph;
	/** `<trackId>|<channel>` of every channel whose Graph Editor row is open. */
	const graphOpen = new Set();
	const graphKey = (track, chan) => track.id + '|' + chan.key;
	/** A channel the Graph Editor can draw: a number (a colour has no single value to plot). */
	const graphable = (chan) => graph && chan.input !== 'color';
	let selCueTime = null; // the selected cue key, by time (cues are global, so time identifies one)
	let selVis = null; // the selected visibility key: { actorId, time } — Delete removes it
	let cinePps = null; // px per second; null = fit the whole cinematic to the panel width
	let tlDrag = null;
	let rulerDrag = false;
	let cameraLive = true;

	const castOf = (id) => doc.stage.cast.find((c) => c.actorId === id) || null;
	const isNodeActor = (id) => (castOf(id) || {}).kind === 'node';
	// The ratio whose property keys the rows show and new keys go to (`options.propertyLayout`):
	// its tracks carry that `layout`; absent ⇒ the default keys, the tracks without one.
	const propertyLayout = options.propertyLayout || (() => undefined);
	const layoutOf = (t) => (typeof t.layout === 'string' && t.layout) || undefined;
	const propertyTracksOf = (actorId) =>
		doc.tracks.filter(
			(t) => t.actorId === actorId && t.kind === 'property' && layoutOf(t) === propertyLayout(),
		);
	const visTracksOf = (actorId) =>
		doc.tracks.filter((t) => t.actorId === actorId && t.kind === 'visibility');
	const cameraTrack = () => doc.tracks.find((t) => t.kind === 'camera') || null;
	const cueTrack = () => doc.tracks.find((t) => t.kind === 'cue') || null;
	const textTracksOf = (actorId) =>
		doc.tracks.filter((t) => t.actorId === actorId && t.kind === 'text');

	const stripById = (id) => {
		for (const track of doc.tracks) {
			if (!hasStrips(track)) continue;
			const strip = track.strips.find((s) => s.id === id);
			if (strip) return { strip, track };
		}
		return null;
	};

	// ---- key selection ------------------------------------------------------
	//
	// Several keys can be selected (Shift/Ctrl-click, a box drag over the lanes, a summary key): a
	// drag moves them together, the Interpolation panel sets all of their eases, Delete removes them
	// and Ctrl+C / Ctrl+V copies them to the playhead. `selKey` is the one the inspector shows.

	const sameKey = (a, b) =>
		a.trackId === b.trackId && a.channel === b.channel && Math.abs(a.time - b.time) < 1e-6;
	const isKeySelected = (trackId, channel, t) =>
		selKeys.some((k) => sameKey(k, { trackId, channel, time: t }));
	const isVisSelected = (actorId, t) =>
		!!selVis && selVis.actorId === actorId && Math.abs(selVis.time - t) < 1e-6;
	function selectKeys(list, primary) {
		selKeys = list;
		selKey = primary || list[list.length - 1] || null;
	}
	/** The key objects the selection names, with the arrays that hold them. */
	function selectedKeyRefs() {
		const out = [];
		for (const sel of selKeys) {
			const track = doc.tracks.find((t) => t.id === sel.trackId);
			const keys = track && track.channels && track.channels[sel.channel];
			const key = keys && keys.find((k) => Math.abs(k.time - sel.time) < 1e-6);
			if (key) out.push({ trackId: sel.trackId, channel: sel.channel, keys, key, orig: key.time });
		}
		return out;
	}
	/** Restyle the drawn keys to the selection without rebuilding the rows (mid-gesture safe). */
	function markSelectedKeys() {
		if (!el) return;
		el.querySelectorAll('.cineVisRow .cineVisKey').forEach((dot) => {
			const row = dot.closest('.cineVisRow');
			dot.classList.toggle(
				'sel',
				isVisSelected(row.dataset.actor, parseFloat(dot.dataset.visTime)),
			);
		});
		el.querySelectorAll('.cineChanRow .cineKey').forEach((dot) => {
			const row = dot.closest('.cineChanRow');
			const on = isKeySelected(
				row.dataset.track,
				row.dataset.channel,
				parseFloat(dot.dataset.time),
			);
			dot.classList.toggle('sel', on);
			dot.style.background = on ? '#ffd24a' : chanColor(row.dataset.track, row.dataset.channel);
		});
		refreshGraphRows();
	}

	/**
	 * Redraw every open graph row in place — its curve, its keys' selection and the selected key's
	 * handles — and re-wire it, so a graph never shows (or lets you drag) a selection that changed
	 * without a full re-render.
	 */
	function refreshGraphRows() {
		if (!el || !graph) return;
		const pps = tlPps();
		el.querySelectorAll('.cineGraphRow').forEach((row) => {
			const track = doc.tracks.find((t) => t.id === row.dataset.track);
			if (!track) return;
			const keys = track.channels && track.channels[row.dataset.channel];
			const chans = track.kind === 'camera' ? CAM_CHANNELS : channelsOf(castOf(track.actorId));
			const chan = chans.find((c) => c.key === row.dataset.channel);
			const lane = row.querySelector('.cineGraphLane');
			if (!keys || !chan || !lane) return;
			const geo = graphGeometry(keys, EV, doc.duration, pps);
			lane.innerHTML = graphSvg({ track, chan }, keys, geo, pps, parseFloat(lane.style.width));
		});
		ROW_KINDS.graph.wire(el, pps);
	}
	function chanColor(trackId, channel) {
		const track = doc.tracks.find((t) => t.id === trackId);
		const list = !track
			? []
			: track.kind === 'camera'
				? CAM_CHANNELS
				: channelsOf(castOf(track.actorId));
		return (list.find((c) => c.key === channel) || {}).color || '#8b93a1';
	}

	/** Every time an actor has a property or visibility key at — its summary row's keys. */
	function actorKeyTimes(actorId) {
		const times = [];
		const add = (t) => {
			if (!times.some((x) => Math.abs(x - t) < 1e-6)) times.push(t);
		};
		for (const track of propertyTracksOf(actorId))
			for (const keys of Object.values(track.channels)) for (const k of keys) add(k.time);
		for (const track of visTracksOf(actorId)) for (const k of track.keys) add(k.time);
		return times.sort((a, b) => a - b);
	}
	/** An actor's property and visibility key objects, optionally only those at `at`. */
	function actorKeyRefs(actorId, at) {
		const out = [];
		const near = (k) => at == null || Math.abs(k.time - at) < 1e-6;
		for (const track of propertyTracksOf(actorId))
			for (const [channel, keys] of Object.entries(track.channels))
				for (const key of keys)
					if (near(key)) out.push({ trackId: track.id, channel, keys, key, orig: key.time });
		for (const track of visTracksOf(actorId))
			for (const key of track.keys)
				if (near(key))
					out.push({ trackId: track.id, channel: null, keys: track.keys, key, orig: key.time });
		return out;
	}

	// ---- history (undo / redo) --------------------------------------------
	//
	// SNAPSHOT-based, not command-based. A cinematic doc is a few KB of JSON, so storing whole
	// states costs almost nothing and is correct BY CONSTRUCTION: there is no per-operation undo
	// routine to write, forget, or get subtly wrong when a later phase adds an operation. A command
	// stack only starts paying off when the document is too big to copy — if that ever happens
	// (very long cinematics), this is the seam to change, and only this.
	//
	// It is scoped to the cinematic document so it cannot half-undo anything the host edits (in
	// `/rigger`, the rig) — nothing in it knows what a cinematic is beyond `serialize` /
	// `applySnapshot`.

	const history = { stack: [], index: -1, lastKey: null, lastAt: 0 };

	const serialize = () => JSON.stringify(doc);

	/** Seed the stack with the loaded document. Nothing before this is undoable. */
	function historyReset() {
		history.stack = [{ snap: serialize(), label: 'open' }];
		history.index = 0;
		history.lastKey = null;
	}

	/**
	 * Record the CURRENT document as a new undo step.
	 *
	 * `coalesceKey` merges rapid edits to the same thing into one step — typing in the x field, or
	 * dragging a strip, should undo as ONE action, not forty. Consecutive commits sharing a key
	 * within COALESCE_MS overwrite the top of the stack instead of pushing. Pass no key for discrete
	 * actions (cast, remove, reorder) so each is always its own step.
	 */
	function commit(label, coalesceKey) {
		const snap = serialize();
		const now = Date.now();
		const coalesce =
			coalesceKey != null &&
			coalesceKey === history.lastKey &&
			now - history.lastAt < COALESCE_MS &&
			history.index >= 0;

		if (coalesce) {
			history.stack[history.index] = { snap, label };
		} else {
			// A new action after undoing discards the redo branch — standard linear history.
			history.stack.length = history.index + 1;
			history.stack.push({ snap, label });
			if (history.stack.length > HISTORY_LIMIT) history.stack.shift();
			history.index = history.stack.length - 1;
		}
		history.lastKey = coalesceKey ?? null;
		history.lastAt = now;
		host.changed();
	}

	const canUndo = () => history.index > 0;
	const canRedo = () => history.index < history.stack.length - 1;

	async function applySnapshot(snap) {
		doc = JSON.parse(snap);
		// The host rebuilds whatever it derived from the document (the cast may have gained or lost
		// members) before anything is evaluated against it.
		await host.docReplaced(doc);
		if (time > doc.duration) setTime(doc.duration);
		else host.evaluate(time);
		host.changed();
		render();
		renderTimeline();
	}

	async function undo() {
		if (!canUndo()) return;
		history.index--;
		history.lastKey = null; // never coalesce across an undo
		await applySnapshot(history.stack[history.index].snap);
	}

	async function redo() {
		if (!canRedo()) return;
		history.index++;
		history.lastKey = null;
		await applySnapshot(history.stack[history.index].snap);
	}

	/** Label of the step Ctrl+Z would take back / Ctrl+Shift+Z would reapply (for the buttons). */
	const undoLabel = () => (canUndo() ? history.stack[history.index].label : '');
	const redoLabel = () => (canRedo() ? history.stack[history.index + 1].label : '');

	// ---- time ---------------------------------------------------------------

	function setTime(t) {
		if (!doc) return;
		time = Math.max(0, Math.min(doc.duration, t));
		host.evaluate(time);
		host.seeked(time);
	}

	/** Snap to the fps grid unless Alt is held (the usual "hold to place freely" escape). */
	function snapT(t, noSnap) {
		if (noSnap || !doc.fps) return Math.max(0, t);
		return Math.max(0, Math.round(t * doc.fps) / doc.fps);
	}

	// ---- the set's depth ----------------------------------------------------

	/**
	 * The SET's depth on the same z line as the cast: the set draws above every actor whose z is
	 * ≤ `setZ`. `-1` (the default, and what every pre-2026-08-18 doc means by an absent field) is
	 * "behind the whole cast" — the hardcoded position it used to have — and `cast.length - 1` is
	 * in front of everything. This is what makes `fx:` cues layerable: a cue fires an FX node that
	 * lives IN the set, so the set's depth IS the cue's depth.
	 */
	const stageSetZ = () => (doc.stage.setZ == null ? -1 : doc.stage.setZ);

	/** Does anything in this cinematic fire an FX effect? That alone earns the depth row. */
	const hasFxCue = () => {
		const t = cueTrack();
		return !!(t && t.keys && t.keys.some((k) => String(k.cue || '').startsWith('fx:')));
	};
	/** True when the set is above every actor — the only band the rigs-in-one-canvas preview can show. */
	const setInFront = () => stageSetZ() >= doc.stage.cast.length - 1;

	function moveSet(dir) {
		const next = Math.max(-1, Math.min(doc.stage.cast.length - 1, stageSetZ() + dir));
		if (next === stageSetZ()) return;
		doc.stage.setZ = next;
		commit('reorder set');
		renderTimeline();
	}

	// ---- timeline -----------------------------------------------------------
	//
	// DOM rows, not a canvas — same shape as the rigger's dopesheet (sticky gutter on the left, a
	// lane scrolled at `pps` pixels per second), so hit-testing is free and the two timelines look
	// like one tool. A strip is a div; moving/trimming it writes the doc LIVE (so the stage follows
	// the drag) but records a SINGLE history step on pointerup.

	function tlPps() {
		if (cinePps) return cinePps;
		const w = (el ? el.clientWidth : 900) - TL_GUTTER - 12;
		return Math.max(4, w / Math.max(doc.duration, 0.001));
	}

	function zoom(factor) {
		cinePps = Math.max(4, Math.min(4000, tlPps() * factor));
		renderTimeline();
	}

	/**
	 * Rows in cast order: each actor's animation layers, then its property channels; the camera
	 * track last, so global rows sit at the bottom where a sequencer usually puts them.
	 */
	function orderedRows() {
		const out = [];
		// The SET is a layer among the actors, not a fixed backdrop. Its row is emitted where its z
		// puts it, so the timeline reads top-to-bottom as back-to-front exactly like the cast rows
		// already do (▲ = move behind, the cast list's own wording).
		// The row is the DEPTH BAND, and a bound Scene is only one of the two things that draw in it —
		// an `fx:` cue draws there too, with or without a set. Gating the row on `sceneId` alone left
		// the common case with no control at all: fire an FX cue, no Scene bound, and the effect is
		// nailed behind every rig while the cue inspector cheerfully says "move its 🎬 row in the
		// timeline" — a row that was never rendered (owner: "I can only move FX up and down on the
		// cue and not in the timeline").
		const wantSet = !!doc.stage.sceneId || hasFxCue();
		let setDone = false;
		const emitSetBefore = (z) => {
			if (wantSet && !setDone && z > stageSetZ()) {
				out.push({ kind: 'set', cast: null, track: null });
				setDone = true;
			}
		};
		const focus = onlySelected ? host.selectedActor() : undefined;
		for (const cast of doc.stage.cast.slice().sort((a, b) => (a.z || 0) - (b.z || 0))) {
			emitSetBefore(cast.z || 0);
			if (onlySelected && cast.actorId !== focus) continue;
			const keyed = summaryRows && actorKeyTimes(cast.actorId).length > 0;
			if (keyed) out.push({ kind: 'summary', cast, track: null });
			const folded = keyed && collapsed.has(cast.actorId);
			const anim = doc.tracks
				.filter((t) => t.actorId === cast.actorId && t.kind === 'animation')
				.sort((a, b) => (a.layer || 0) - (b.layer || 0));
			anim.forEach((track, i) =>
				out.push({ kind: 'animation', cast, track, first: i === 0, count: anim.length }),
			);
			if (folded) continue;
			for (const track of visTracksOf(cast.actorId)) {
				if (track.keys.length) out.push({ kind: 'visibility', cast, track });
			}
			if (textRows) {
				for (const track of textTracksOf(cast.actorId)) {
					if (Array.isArray(track.keys) && track.keys.length)
						out.push({ kind: 'text', cast, track });
				}
			}
			const chans = channelsOf(cast);
			for (const track of propertyTracksOf(cast.actorId)) {
				for (const chan of chans) {
					if (!track.channels[chan.key]) continue;
					out.push({ kind: 'channel', cast, track, chan });
					if (graphable(chan) && graphOpen.has(graphKey(track, chan)))
						out.push({ kind: 'graph', cast, track, chan });
				}
			}
		}
		emitSetBefore(Infinity); // in front of the whole cast (or the only row, with no cast yet)
		const cues = cueTrack();
		if (cues && cues.keys.length) out.push({ kind: 'cues', track: cues, cast: null });
		const cam = cameraTrack();
		if (cam) {
			for (const chan of CAM_CHANNELS) {
				if (!cam.channels[chan.key]) continue;
				out.push({ kind: 'channel', cast: null, track: cam, chan, camera: true });
				if (graphable(chan) && graphOpen.has(graphKey(cam, chan)))
					out.push({ kind: 'graph', cast: null, track: cam, chan, camera: true });
			}
		}
		return out;
	}

	const gutter = (html) => {
		const g = document.createElement('div');
		g.className = 'cineGutter';
		g.innerHTML = html;
		return g;
	};
	const lane = (contentW) => {
		const l = document.createElement('div');
		l.className = 'cineLane';
		l.style.width = contentW + 'px';
		return l;
	};

	// ---- the Graph Editor's drawing (`options.graph`) ----------------------

	/** The primary selected key's index on this channel, or -1. */
	function selectedGraphKey(trackId, channel, keys) {
		if (!selKey || selKey.trackId !== trackId || selKey.channel !== channel) return -1;
		return keys.findIndex((k) => Math.abs(k.time - selKey.time) < 1e-6);
	}

	const graphPathD = (geo, pps) =>
		geo.points
			.map((p, i) => (i ? 'L' : 'M') + (p.t * pps).toFixed(1) + ',' + geo.y(p.v).toFixed(1))
			.join(' ');

	/** The segment `i → i + 1`'s handles, or null when it is not a cubic with a value to shape. */
	function graphHandles(keys, i) {
		const a = keys[i];
		const b = keys[i + 1];
		const c = cubicOf(a && a.ease);
		if (!a || !b || !c || !(b.time > a.time) || Math.abs(b.value - a.value) < 1e-9) return null;
		return { a, b, points: cubicHandlePoints(a, b, c) };
	}

	function graphSvg(entry, keys, geo, pps, w) {
		const color = entry.chan.color;
		const sel = selectedGraphKey(entry.track.id, entry.chan.key, keys);
		const X = (t) => (t * pps).toFixed(1);
		const Y = (v) => geo.y(v).toFixed(1);
		const dots = keys
			.map(
				(k, i) =>
					`<circle class="cineGraphKey${isKeySelected(entry.track.id, entry.chan.key, k.time) ? ' sel' : ''}" data-gkey="${i}" cx="${X(k.time)}" cy="${Y(k.value)}" r="5" fill="${color}"><title>${esc(entry.chan.label)} = ${+k.value.toFixed(3)} @ ${+k.time.toFixed(3)}s (${esc(easeLabel(k.ease))})</title></circle>`,
			)
			.join('');
		const hs = sel >= 0 ? graphHandles(keys, sel) : null;
		const handles = hs
			? `<line class="cineCurveArm" data-garm="1" x1="${X(hs.a.time)}" y1="${Y(hs.a.value)}" x2="${X(hs.points[0].t)}" y2="${Y(hs.points[0].v)}"/>
<line class="cineCurveArm" data-garm="2" x1="${X(hs.b.time)}" y1="${Y(hs.b.value)}" x2="${X(hs.points[1].t)}" y2="${Y(hs.points[1].v)}"/>
<circle class="cineCurveHandle" data-ghandle="1" data-seg="${sel}" cx="${X(hs.points[0].t)}" cy="${Y(hs.points[0].v)}" r="6"/>
<circle class="cineCurveHandle" data-ghandle="2" data-seg="${sel}" cx="${X(hs.points[1].t)}" cy="${Y(hs.points[1].v)}" r="6"/>`
			: '';
		return `<svg class="cineGraph" width="${w}" height="${GRAPH_H}" viewBox="0 0 ${w} ${GRAPH_H}" overflow="visible" role="img" aria-label="${esc(entry.chan.label)} over time">
<path class="cineGraphPath" d="${graphPathD(geo, pps)}" stroke="${color}"/>
${dots}${handles}</svg>`;
	}

	/** Mid-drag: move the curve, the arms and the handles in place (a handle keeps its capture). */
	function redrawGraph(svg, keys, geo, pps, i) {
		const path = svg.querySelector('.cineGraphPath');
		if (path) path.setAttribute('d', graphPathD(geo, pps));
		const hs = graphHandles(keys, i);
		if (!hs) return;
		const set = (sel, attrs) => {
			const n = svg.querySelector(sel);
			if (n) for (const [a, v] of Object.entries(attrs)) n.setAttribute(a, v.toFixed(1));
		};
		const [p1, p2] = hs.points;
		set('[data-garm="1"]', { x2: p1.t * pps, y2: geo.y(p1.v) });
		set('[data-garm="2"]', { x2: p2.t * pps, y2: geo.y(p2.v) });
		set('[data-ghandle="1"]', { cx: p1.t * pps, cy: geo.y(p1.v) });
		set('[data-ghandle="2"]', { cx: p2.t * pps, cy: geo.y(p2.v) });
	}

	/**
	 * How each row kind draws (`render` fills the row element) and takes input (`wire`, run over the
	 * whole timeline once it is built). Add a kind here, and emit it from `orderedRows`.
	 */
	const ROW_KINDS = {
		// A VISIBILITY row: stepped on/off. A filled marker means "on screen from here", hollow means
		// "hidden from here" — the shape carries the state, so the row reads without a legend.
		visibility: {
			render(row, entry, pps, contentW) {
				row.classList.add('cineChanRow', 'cineVisRow');
				row.dataset.actor = entry.cast.actorId;
				row.appendChild(gutter('<span class="cineTrackName cineChanName">↳ visible</span>'));
				const l = lane(contentW);
				for (const k of entry.track.keys) {
					const dot = document.createElement('span');
					dot.className =
						'cineVisKey' +
						(k.visible === false ? ' off' : '') +
						(isVisSelected(entry.cast.actorId, k.time) ? ' sel' : '');
					dot.style.left = (k.time * pps).toFixed(1) + 'px';
					dot.dataset.visTime = k.time;
					dot.title =
						(k.visible === false ? 'hidden' : 'visible') +
						' from ' +
						+k.time.toFixed(3) +
						's — click to select (Delete removes it), drag to move';
					l.appendChild(dot);
				}
				row.appendChild(l);
			},
			// Visibility keys: click to select (Delete removes it, as it does a selected key), drag to
			// retime, double-click to delete. There is nothing else to edit: the VALUE is the marker
			// shape, flipped from the panel toggle.
			wire(root, pps) {
				root.querySelectorAll('.cineVisRow .cineVisKey').forEach((dot) => {
					const actorId = dot.closest('.cineVisRow').dataset.actor;
					const keyTime = parseFloat(dot.dataset.visTime);
					dot.onpointerdown = (e) => {
						e.preventDefault();
						e.stopPropagation();
						const track = visTracksOf(actorId)[0];
						const key = track && track.keys.find((x) => Math.abs(x.time - keyTime) < 1e-6);
						if (!key) return;
						selectVisKey(actorId, keyTime);
						tlDrag = {
							kind: 'vis',
							key,
							actorId,
							time: keyTime,
							startX: e.clientX,
							pps,
							el: dot,
							moved: false,
						};
						try {
							dot.setPointerCapture(e.pointerId);
						} catch {
							/* uncaptured drag still works */
						}
					};
					dot.onpointermove = (e) => {
						if (!tlDrag || tlDrag.kind !== 'vis' || tlDrag.el !== dot) return;
						// From where the drag began, on the key itself, so it is not lost once it leaves
						// its starting frame.
						const k = tlDrag.key;
						k.time = snapT(tlDrag.time + (e.clientX - tlDrag.startX) / tlDrag.pps, e.altKey);
						if (Math.abs(k.time - tlDrag.time) > 1e-9) tlDrag.moved = true;
						dot.style.left = (k.time * tlDrag.pps).toFixed(1) + 'px';
					};
					const endVis = () => {
						if (!tlDrag || tlDrag.kind !== 'vis' || tlDrag.el !== dot) return;
						const { moved, key } = tlDrag;
						const track = visTracksOf(actorId)[0];
						if (track) track.keys.sort((a, b) => a.time - b.time);
						tlDrag = null;
						// A click that moved nothing must not redraw: the second click of a double-click
						// would land on a new marker, and the browser would never send this one its dblclick.
						if (!moved) return;
						selVis = { actorId, time: key.time };
						commit('move visibility key', 'vis:' + actorId + ':' + keyTime);
						renderTimeline();
					};
					dot.onpointerup = endVis;
					dot.onpointercancel = endVis;
					dot.ondblclick = (e) => {
						e.stopPropagation();
						deleteVisKey(actorId, keyTime);
					};
				});
			},
		},

		// A TEXT row (`options.textRows`): one marker per key of a node actor's `text` track, labelled
		// with what it shows from there — the count-up number or the switched-to string. Drag to
		// retime, double-click to delete; the value is edited from the host's panel.
		text: {
			render(row, entry, pps, contentW) {
				row.classList.add('cineChanRow', 'cineTextRow');
				row.dataset.actor = entry.cast.actorId;
				row.dataset.track = entry.track.id;
				const mode = entry.track.mode === 'switchKey' ? 'switch' : 'count';
				row.appendChild(
					gutter('<span class="cineTrackName cineChanName">↳ text (' + mode + ')</span>'),
				);
				const l = lane(contentW);
				for (const k of entry.track.keys) {
					const dot = document.createElement('span');
					const shown =
						entry.track.mode === 'switchKey' ? String(k.key ?? '') : String(+(k.value ?? 0));
					dot.className = 'cineTextKey';
					dot.style.left = (k.time * pps).toFixed(1) + 'px';
					dot.dataset.textTime = k.time;
					dot.textContent = shown;
					dot.title = '"' + shown + '" from ' + +k.time.toFixed(3) + 's — double-click to delete';
					l.appendChild(dot);
				}
				row.appendChild(l);
			},
			wire(root, pps) {
				root.querySelectorAll('.cineTextRow .cineTextKey').forEach((dot) => {
					const trackId = dot.closest('.cineTextRow').dataset.track;
					const keyTime = parseFloat(dot.dataset.textTime);
					dot.onpointerdown = (e) => {
						e.preventDefault();
						e.stopPropagation();
						const track = doc.tracks.find((x) => x.id === trackId);
						const key = track && track.keys.find((x) => Math.abs(x.time - keyTime) < 1e-6);
						if (!key) return;
						tlDrag = {
							kind: 'text',
							key,
							time: keyTime,
							startX: e.clientX,
							pps,
							el: dot,
							moved: false,
						};
						try {
							dot.setPointerCapture(e.pointerId);
						} catch {
							/* uncaptured drag still works */
						}
					};
					dot.onpointermove = (e) => {
						if (!tlDrag || tlDrag.kind !== 'text' || tlDrag.el !== dot) return;
						// From where the drag began, so a slow drag adds up instead of snapping back.
						const k = tlDrag.key;
						k.time = snapT(tlDrag.time + (e.clientX - tlDrag.startX) / tlDrag.pps, e.altKey);
						if (Math.abs(k.time - tlDrag.time) > 1e-9) tlDrag.moved = true;
						dot.style.left = (k.time * tlDrag.pps).toFixed(1) + 'px';
					};
					const endText = () => {
						if (!tlDrag || tlDrag.kind !== 'text' || tlDrag.el !== dot) return;
						const moved = tlDrag.moved;
						const track = doc.tracks.find((x) => x.id === trackId);
						if (track) track.keys.sort((a, b) => a.time - b.time);
						const pps = tlDrag.pps;
						tlDrag = null;
						if (moved) {
							commit('move text key', 'text:' + trackId + ':' + keyTime);
							renderTimeline();
							return;
						}
						// A click seeks to the key and moves only the playhead, so the marker survives for
						// the second click of a double-click (see the visibility row).
						setTime(keyTime);
						positionPlayhead(pps);
					};
					dot.onpointerup = endText;
					dot.onpointercancel = endText;
					dot.ondblclick = (e) => {
						e.stopPropagation();
						deleteTextKey(trackId, keyTime);
					};
				});
			},
		},

		// The SET row: the bound Scene as a LAYER. It holds the sprites, text and FX nodes, so it is
		// also where an `fx:` cue's effect draws — moving this row is how a cue gets in front of a
		// rig. No keys: a set has no timing of its own, only a depth.
		set: {
			render(row, entry, pps, contentW) {
				row.classList.add('cineChanRow', 'cineSetRow');
				const scName = doc.stage.sceneId ? host.sceneName(doc.stage.sceneId) : null;
				// With a Scene bound this row is the SET; with only cues it is purely the FX depth.
				// Calling it "set" in the second case names something the author never created.
				const bound = !!doc.stage.sceneId;
				row.appendChild(
					gutter(
						'<span class="cineTrackName cineChanName" title="' +
							(bound
								? "The bound set draws here — everything in it, including an fx: cue's effect"
								: 'Where fx: cues draw. Bind a Scene above and its sprites, text and FX draw here too.') +
							'">' +
							(bound ? '🎬 set' : '⚡ fx') +
							'</span>' +
							'<button data-setz="-1" title="Move behind"' +
							(stageSetZ() <= -1 ? ' disabled' : '') +
							'>▲</button>' +
							'<button data-setz="1" title="Move in front"' +
							(setInFront() ? ' disabled' : '') +
							'>▼</button>',
					),
				);
				const l = lane(contentW);
				const where = doc.stage.cast.length
					? stageSetZ() < 0
						? 'behind every rig'
						: setInFront()
							? 'in front of every rig'
							: 'in front of ' + (stageSetZ() + 1) + ' of ' + doc.stage.cast.length + ' rigs'
					: 'no rigs cast yet';
				// The preview draws every rig into ONE canvas and FX into another, so it can only put the
				// overlay above or below the WHOLE cast — never between two rigs. At an in-between depth
				// the stage therefore cannot show what the game will do, and saying nothing here makes
				// a correct authored depth look like a broken control.
				const banded = doc.stage.cast.length > 1 && stageSetZ() >= 0 && !setInFront();
				l.innerHTML =
					'<span class="cineSetNote">' +
					(bound
						? esc(scName || doc.stage.sceneId) + ' — sprites, text and FX'
						: 'fx: cues draw here') +
					' · ' +
					where +
					(banded
						? ' · the preview can only show it behind or in front of EVERY rig — the game honours this depth'
						: '') +
					'</span>';
				row.appendChild(l);
			},
			wire(root) {
				root.querySelectorAll('.cineGutter [data-setz]').forEach((btn) => {
					btn.onclick = (e) => {
						e.stopPropagation();
						moveSet(parseInt(btn.dataset.setz, 10));
					};
				});
			},
		},

		// A CUE row: one marker per cue, coloured by namespace. Global (not per-actor) — a cue is a
		// moment in the cinematic, not something an actor owns.
		cues: {
			render(row, entry, pps, contentW) {
				row.classList.add('cineChanRow', 'cineCueRow');
				row.appendChild(gutter('<span class="cineTrackName cineChanName">⚡ cues</span>'));
				const l = lane(contentW);
				for (const k of entry.track.keys) {
					const dot = document.createElement('span');
					const isSel = selCueTime !== null && Math.abs(selCueTime - k.time) < 1e-6;
					dot.className = 'cineCue' + (isSel ? ' sel' : '');
					dot.style.left = (k.time * pps).toFixed(1) + 'px';
					dot.style.color = isSel ? '#ffd24a' : cueColor(k.cue);
					dot.dataset.cueTime = k.time;
					dot.title = (k.cue || '(empty)') + ' @ ' + +k.time.toFixed(3) + 's';
					l.appendChild(dot);
				}
				row.appendChild(l);
			},
			// Cue markers: click to select (the inspector edits it), drag to retime.
			wire(root, pps) {
				root.querySelectorAll('.cineCueRow .cineCue').forEach((dot) => {
					const keyTime = parseFloat(dot.dataset.cueTime);
					dot.onpointerdown = (e) => {
						e.preventDefault();
						e.stopPropagation();
						selCueTime = keyTime;
						tlDrag = { kind: 'cue', time: keyTime, startX: e.clientX, pps, el: dot, moved: false };
						try {
							dot.setPointerCapture(e.pointerId);
						} catch {
							/* uncaptured drag still works */
						}
						root.querySelectorAll('.cineCue.sel').forEach((n) => n.classList.remove('sel'));
						dot.classList.add('sel');
						render();
					};
					dot.onpointermove = (e) => {
						if (!tlDrag || tlDrag.kind !== 'cue' || tlDrag.el !== dot) return;
						const track = cueTrack();
						const k = track && track.keys.find((x) => Math.abs(x.time - tlDrag.time) < 1e-6);
						if (!k) return;
						if (Math.abs(e.clientX - tlDrag.startX) > 2) tlDrag.moved = true;
						k.time = snapT(tlDrag.time + (e.clientX - tlDrag.startX) / tlDrag.pps, e.altKey);
						dot.style.left = (k.time * tlDrag.pps).toFixed(1) + 'px';
					};
					const endCue = () => {
						if (!tlDrag || tlDrag.kind !== 'cue' || tlDrag.el !== dot) return;
						const moved = tlDrag.moved;
						const track = cueTrack();
						if (track) track.keys.sort((a, b) => a.time - b.time);
						tlDrag = null;
						if (moved) commit('move cue', 'cue:' + keyTime);
						renderTimeline();
						render();
					};
					dot.onpointerup = endCue;
					dot.onpointercancel = endCue;
				});
			},
		},

		// A CHANNEL row: keys as diamonds, coloured per channel. Its own shape, not a lane of strips
		// — property/camera animation is keyframes, not clips.
		channel: {
			render(row, entry, pps, contentW) {
				const track = entry.track;
				row.classList.add('cineChanRow');
				row.dataset.channel = entry.chan.key;
				row.appendChild(
					gutter(
						'<span class="cineTrackName cineChanName" style="color:' +
							entry.chan.color +
							';">' +
							(entry.camera ? '🎥 ' : '↳ ') +
							esc(entry.chan.label) +
							'</span>' +
							(graphable(entry.chan)
								? '<button class="cineGraphBtn' +
									(graphOpen.has(graphKey(track, entry.chan)) ? ' on' : '') +
									'" data-graph="' +
									esc(graphKey(track, entry.chan)) +
									'" title="Graph Editor: this channel\'s value over time, and its curves">📈</button>'
								: ''),
					),
				);
				const l = lane(contentW);
				for (const k of track.channels[entry.chan.key]) {
					const dot = document.createElement('span');
					const isSel = isKeySelected(track.id, entry.chan.key, k.time);
					dot.className = 'cineKey' + (isSel ? ' sel' : '') + (k.ease === 'hold' ? ' hold' : '');
					dot.style.left = (k.time * pps).toFixed(1) + 'px';
					dot.style.background = isSel ? '#ffd24a' : entry.chan.color;
					dot.dataset.time = k.time;
					dot.title =
						entry.chan.label +
						' = ' +
						(entry.chan.input === 'color' ? hexColor(k.value) : +k.value.toFixed(3)) +
						' @ ' +
						+k.time.toFixed(3) +
						's (' +
						easeLabel(k.ease) +
						')';
					l.appendChild(dot);
				}
				row.appendChild(l);
			},
			// Channel keys: click to select (Shift / Ctrl adds or removes), drag to retime — every
			// selected key moves by the same snapped amount. 📈 opens / closes the channel's graph.
			wire(root, pps) {
				root.querySelectorAll('.cineChanRow [data-graph]').forEach((b) => {
					b.onclick = (e) => {
						e.stopPropagation();
						const id = b.dataset.graph;
						if (graphOpen.has(id)) graphOpen.delete(id);
						else graphOpen.add(id);
						renderTimeline();
					};
				});
				root.querySelectorAll('.cineChanRow .cineKey').forEach((dot) => {
					const row = dot.closest('.cineChanRow');
					const trackId = row.dataset.track;
					const channel = row.dataset.channel;
					dot.onpointerdown = (e) => {
						e.preventDefault();
						e.stopPropagation();
						const keyTime = parseFloat(dot.dataset.time);
						const me = { trackId, channel, time: keyTime };
						if (e.shiftKey || e.ctrlKey || e.metaKey) {
							if (isKeySelected(trackId, channel, keyTime)) {
								selectKeys(selKeys.filter((k) => !sameKey(k, me)));
								markSelectedKeys();
								render();
								return;
							}
							selectKeys([...selKeys, me], me);
						} else if (isKeySelected(trackId, channel, keyTime)) selKey = me;
						else selectKeys([me], me);
						const refs = selectedKeyRefs();
						tlDrag = {
							kind: 'key',
							refs,
							primary: refs.find((r) => sameKey(r, me)) || refs[0],
							startX: e.clientX,
							pps,
							el: dot,
							moved: false,
						};
						try {
							dot.setPointerCapture(e.pointerId);
						} catch {
							/* uncaptured drag still works */
						}
						if (refs.length > 1) markSelectedKeys();
						else {
							row.querySelectorAll('.cineKey.sel').forEach((n) => n.classList.remove('sel'));
							dot.classList.add('sel');
						}
						render();
					};
					dot.onpointermove = (e) => {
						if (!tlDrag || tlDrag.kind !== 'key' || tlDrag.el !== dot || !tlDrag.primary) return;
						if (Math.abs(e.clientX - tlDrag.startX) > 2) tlDrag.moved = true;
						const p = tlDrag.primary;
						const earliest = Math.min(...tlDrag.refs.map((r) => r.orig));
						const to = snapT(p.orig + (e.clientX - tlDrag.startX) / tlDrag.pps, e.altKey);
						const delta = Math.max(to - p.orig, -earliest);
						// The grabbed key lands exactly on the snapped time (`orig + delta` can be an ulp
						// off it); the others keep their distance from it.
						for (const r of tlDrag.refs)
							r.key.time = r === p && delta === to - p.orig ? to : r.orig + delta;
						if (tlDrag.refs.length === 1)
							dot.style.left = (p.key.time * tlDrag.pps).toFixed(1) + 'px';
						else moveDrawnKeys(tlDrag.refs, tlDrag.pps);
						host.evaluate(time);
					};
					const endKey = () => {
						if (!tlDrag || tlDrag.kind !== 'key' || tlDrag.el !== dot) return;
						const { moved, refs, primary } = tlDrag;
						for (const r of refs) r.keys.sort((a, b) => a.time - b.time);
						if (moved) {
							selectKeys(
								refs.map((r) => ({ trackId: r.trackId, channel: r.channel, time: r.key.time })),
								primary && {
									trackId: primary.trackId,
									channel: primary.channel,
									time: primary.key.time,
								},
							);
						}
						tlDrag = null;
						if (moved)
							commit(
								refs.length > 1 ? 'move keys' : 'move key',
								refs.length > 1 ? 'keys' : 'key:' + trackId + ':' + channel,
							);
						renderTimeline();
						render();
					};
					dot.onpointerup = endKey;
					dot.onpointercancel = endKey;
				});
			},
		},

		// A channel's GRAPH (`options.graph`, opened by the 📈 in its row): the value over time through
		// the evaluator the game samples with, the keys on the curve and, for the selected key's
		// outgoing cubic, its two handles in time × value. Click a key to select it (the
		// Interpolation panel then shows it); drag a handle to shape that segment.
		graph: {
			render(row, entry, pps, contentW) {
				const keys = entry.track.channels[entry.chan.key];
				const geo = graphGeometry(keys, EV, doc.duration, pps);
				row.classList.add('cineGraphRow');
				row.dataset.channel = entry.chan.key;
				row.style.height = GRAPH_H + 'px';
				row.appendChild(
					gutter(
						'<span class="cineGraphRange" style="color:' +
							entry.chan.color +
							';"><span>' +
							+geo.max.toFixed(2) +
							'</span><span>' +
							esc(entry.chan.label) +
							'</span><span>' +
							+geo.min.toFixed(2) +
							'</span></span>',
					),
				);
				const l = lane(contentW);
				l.classList.add('cineGraphLane');
				l.innerHTML = graphSvg(entry, keys, geo, pps, contentW);
				row.appendChild(l);
			},
			wire(root, pps) {
				root.querySelectorAll('.cineGraphRow').forEach((row) => {
					const trackId = row.dataset.track;
					const channel = row.dataset.channel;
					const track = doc.tracks.find((t) => t.id === trackId);
					const keys = track && track.channels && track.channels[channel];
					const svg = row.querySelector('svg');
					if (!keys || !svg) return;
					svg.querySelectorAll('[data-gkey]').forEach((dot) => {
						dot.onpointerdown = (e) => {
							e.preventDefault();
							e.stopPropagation();
							const k = keys[+dot.dataset.gkey];
							if (!k) return;
							const me = { trackId, channel, time: k.time };
							if (e.shiftKey || e.ctrlKey || e.metaKey) {
								if (isKeySelected(trackId, channel, k.time))
									selectKeys(selKeys.filter((x) => !sameKey(x, me)));
								else selectKeys([...selKeys, me], me);
							} else selectKeys([me], me);
							render();
							renderTimeline();
						};
					});
					svg.querySelectorAll('[data-ghandle]').forEach((h) => {
						h.onpointerdown = (e) => {
							e.preventDefault();
							e.stopPropagation();
							const i = +h.dataset.seg;
							const a = keys[i];
							const b = keys[i + 1];
							const start = cubicOf(a && a.ease);
							if (!a || !b || !start) return;
							const which = h.dataset.ghandle === '2' ? 2 : 1;
							// The frame stays still under the pointer for the whole drag.
							const frame = graphGeometry(keys, EV, doc.duration, pps);
							const range = { min: frame.min, max: frame.max };
							try {
								h.setPointerCapture(e.pointerId);
							} catch {
								/* uncaptured drag still works */
							}
							let moved = false;
							h.onpointermove = (ev) => {
								const r = svg.getBoundingClientRect();
								const next = cubicFromHandle(
									a,
									b,
									cubicOf(a.ease) || start,
									which,
									(ev.clientX - r.left) / pps,
									frame.valueAt(ev.clientY - r.top),
								);
								if (!next) return;
								a.ease = next;
								moved = true;
								const geo = graphGeometry(keys, EV, doc.duration, pps, range);
								redrawGraph(svg, keys, geo, pps, i);
								host.evaluate(time);
							};
							const up = () => {
								h.onpointermove = null;
								h.onpointerup = null;
								h.onpointercancel = null;
								if (!moved) return;
								commit('interpolation');
								render();
								renderTimeline();
							};
							h.onpointerup = up;
							h.onpointercancel = up;
						};
					});
				});
			},
		},

		// An actor's SUMMARY row (`options.summaryRows`): one grey key per time any of its channels
		// (or its visibility) is keyed. ▸/▾ folds its rows. Drag a summary key to move every key at
		// that time; drag the row's empty lane to move ALL of this actor's keys; click a summary
		// key to select its keys (the Interpolation panel then sets all of them).
		summary: {
			render(row, entry, pps, contentW) {
				const id = entry.cast.actorId;
				const label = host.actorLabel(entry.cast);
				row.classList.add('cineSumRow');
				row.dataset.actor = id;
				row.appendChild(
					gutter(
						'<button data-fold="' +
							esc(id) +
							'" title="' +
							(collapsed.has(id) ? 'Show its rows' : 'Fold its rows') +
							'">' +
							(collapsed.has(id) ? '▸' : '▾') +
							'</button><span class="cineTrackName" title="' +
							esc(label.title) +
							'">' +
							esc(label.text) +
							'</span>',
					),
				);
				const l = lane(contentW);
				for (const t of actorKeyTimes(id)) {
					const dot = document.createElement('span');
					const keys = actorKeyRefs(id, t).filter((r) => r.channel);
					const allSel =
						keys.length > 0 && keys.every((r) => isKeySelected(r.trackId, r.channel, r.key.time));
					dot.className = 'cineSumKey' + (allSel ? ' sel' : '');
					dot.style.left = (t * pps).toFixed(1) + 'px';
					dot.dataset.time = t;
					dot.title = 'Every key of ' + label.text + ' at ' + +t.toFixed(3) + 's';
					l.appendChild(dot);
				}
				row.appendChild(l);
			},
			wire(root, pps) {
				root.querySelectorAll('.cineSumRow [data-fold]').forEach((btn) => {
					btn.onclick = (e) => {
						e.stopPropagation();
						const id = btn.dataset.fold;
						if (collapsed.has(id)) collapsed.delete(id);
						else collapsed.add(id);
						renderTimeline();
					};
				});
				root.querySelectorAll('.cineSumRow').forEach((row) => {
					const id = row.dataset.actor;
					const laneEl = row.querySelector('.cineLane');
					const begin = (e, at, handle) => {
						e.preventDefault();
						e.stopPropagation();
						const refs = actorKeyRefs(id, at);
						if (!refs.length) return;
						const channelKeys = refs
							.filter((r) => r.channel)
							.map((r) => ({ trackId: r.trackId, channel: r.channel, time: r.key.time }));
						if (at != null) selectKeys(channelKeys);
						tlDrag = {
							kind: 'summary',
							refs,
							at,
							startX: e.clientX,
							pps,
							el: handle,
							moved: false,
						};
						try {
							handle.setPointerCapture(e.pointerId);
						} catch {
							/* uncaptured drag still works */
						}
						render();
					};
					const move = (e) => {
						if (!tlDrag || tlDrag.kind !== 'summary' || tlDrag.el !== e.currentTarget) return;
						if (Math.abs(e.clientX - tlDrag.startX) > 2) tlDrag.moved = true;
						const earliest = Math.min(...tlDrag.refs.map((r) => r.orig));
						const first = tlDrag.refs[0];
						const to = snapT(first.orig + (e.clientX - tlDrag.startX) / tlDrag.pps, e.altKey);
						const delta = Math.max(to - first.orig, -earliest);
						for (const r of tlDrag.refs)
							r.key.time = r === first && delta === to - first.orig ? to : r.orig + delta;
						moveDrawnKeys(tlDrag.refs, tlDrag.pps);
						row.querySelectorAll('.cineSumKey').forEach((dot) => {
							const t = parseFloat(dot.dataset.time);
							if (tlDrag.at == null || Math.abs(t - tlDrag.at) < 1e-6)
								dot.style.left = ((t + delta) * tlDrag.pps).toFixed(1) + 'px';
						});
						host.evaluate(time);
					};
					const end = (e) => {
						if (!tlDrag || tlDrag.kind !== 'summary' || tlDrag.el !== e.currentTarget) return;
						const { moved, refs } = tlDrag;
						for (const r of refs) r.keys.sort((a, b) => a.time - b.time);
						tlDrag = null;
						if (moved) {
							selectKeys(
								selKeys.length
									? refs
											.filter((r) => r.channel)
											.map((r) => ({ trackId: r.trackId, channel: r.channel, time: r.key.time }))
									: [],
							);
							commit(
								'move ' + host.actorLabel(castOf(id) || { actorId: id }).text + ' keys',
								'sum:' + id,
							);
						}
						renderTimeline();
						render();
					};
					row.querySelectorAll('.cineSumKey').forEach((dot) => {
						dot.onpointerdown = (e) => begin(e, parseFloat(dot.dataset.time), dot);
						dot.onpointermove = move;
						dot.onpointerup = end;
						dot.onpointercancel = end;
					});
					if (laneEl) {
						laneEl.onpointerdown = (e) => {
							if (e.target !== laneEl || e.button !== 0) return;
							begin(e, null, laneEl);
						};
						laneEl.onpointermove = move;
						laneEl.onpointerup = end;
						laneEl.onpointercancel = end;
					}
				});
			},
		},

		// An ANIMATION row: one layer of one actor, a lane of strips.
		animation: {
			render(row, entry, pps, contentW) {
				const { cast, track, first, count } = entry;
				const label = host.actorLabel(cast);
				row.appendChild(
					gutter(
						'<span class="cineTrackName" title="' +
							esc(label.title) +
							'">' +
							(first ? esc(label.text) : '<i>layer ' + (track.layer || 0) + '</i>') +
							'</span>' +
							'<button data-tact="addStrip" title="Add a strip at the playhead">＋</button>' +
							'<button data-tact="addLayer" title="Add a layer above this actor (layers blend bottom-up)">⧉</button>' +
							(count > 1
								? '<button data-tact="delLayer" title="Delete this layer">🗑</button>'
								: ''),
					),
				);
				const l = lane(contentW);
				for (const strip of track.strips.slice().sort((a, b) => a.start - b.start)) {
					const d = document.createElement('div');
					d.className =
						'cineStrip' +
						(strip.id === selStripId ? ' sel' : '') +
						(strip.blend === 'add' ? ' add' : '');
					d.style.left = (strip.start * pps).toFixed(1) + 'px';
					d.style.width = Math.max(strip.length * pps, 3).toFixed(1) + 'px';
					d.dataset.strip = strip.id;
					const loop = strip.loop && strip.loop.mode !== 'once' ? ' ↻' : '';
					// An extension may badge a strip (a bone mask poses only part of the skeleton —
					// invisible on the stage if those bones happen to be still, so the strip says so).
					const badges = extensions
						.map((x) => (x.stripBadge && x.stripBadge(strip)) || '')
						.join('');
					d.innerHTML =
						'<span class="cineStripLabel">' +
						esc(strip.clip ? strip.clip.name : '—') +
						loop +
						badges +
						'</span>' +
						blendRampMarkup(strip, pps);
					l.appendChild(d);
				}
				row.appendChild(l);
			},
			wire(root, pps) {
				root.querySelectorAll('.cineGutter [data-tact]').forEach((btn) => {
					btn.onclick = (e) => {
						e.stopPropagation();
						const trackId = btn.closest('.cineTrack').dataset.track;
						const act = btn.dataset.tact;
						if (act === 'addStrip') addStripAtPlayhead(trackId);
						else if (act === 'addLayer') addLayer(trackId);
						else if (act === 'delLayer') removeLayer(trackId);
					};
				});
				root.querySelectorAll('.cineStrip').forEach((d) => wireStrip(d, pps));
			},
		},
	};

	function wireStrip(d, pps) {
		d.onpointerdown = (e) => {
			e.preventDefault();
			const found = stripById(d.dataset.strip);
			if (!found) return;
			selStripId = d.dataset.strip;
			const rect = d.getBoundingClientRect();
			const offX = e.clientX - rect.left;
			const zone = offX <= TRIM_ZONE ? 'trimL' : offX >= rect.width - TRIM_ZONE ? 'trimR' : 'move';
			tlDrag = {
				id: d.dataset.strip,
				zone,
				el: d,
				pps,
				startX: e.clientX,
				origStart: found.strip.start,
				origLength: found.strip.length,
				origClipIn: found.strip.clipIn || 0,
				moved: false,
			};
			// Capture is an optimisation (the drag keeps tracking outside the element), never a
			// requirement — and it THROWS for a pointer id the browser does not know. Losing it must
			// not abort the gesture.
			try {
				d.setPointerCapture(e.pointerId);
			} catch {
				/* drag still works uncaptured */
			}
			// Update the selection IN PLACE. Re-rendering the timeline here would replace `d`
			// mid-gesture, dropping the pointer capture and killing the drag before it starts.
			el.querySelectorAll('.cineStrip.sel').forEach((n) => n.classList.remove('sel'));
			d.classList.add('sel');
			render(); // a different element — safe to rebuild
		};
		d.onpointermove = (e) => {
			if (!tlDrag || tlDrag.id !== d.dataset.strip) return;
			const found = stripById(tlDrag.id);
			if (!found) return;
			const dT = (e.clientX - tlDrag.startX) / tlDrag.pps;
			if (Math.abs(e.clientX - tlDrag.startX) > 2) tlDrag.moved = true;
			const s = found.strip;
			const frame = 1 / (doc.fps || 30);
			if (tlDrag.zone === 'move') {
				s.start = snapT(tlDrag.origStart + dT, e.altKey);
			} else if (tlDrag.zone === 'trimL') {
				// Trimming the left edge moves the start AND the clip offset together, so the art under
				// the cursor stays put instead of sliding — the standard NLE behaviour.
				const ns = Math.min(
					snapT(tlDrag.origStart + dT, e.altKey),
					tlDrag.origStart + tlDrag.origLength - frame,
				);
				const delta = ns - tlDrag.origStart;
				s.start = ns;
				s.length = Math.max(tlDrag.origLength - delta, frame);
				s.clipIn = Math.max(0, tlDrag.origClipIn + delta * (s.speed || 1));
			} else {
				s.length = Math.max(snapT(tlDrag.origLength + dT, e.altKey), frame);
			}
			// Restyle only the dragged element — a full re-render per pointermove is jank.
			d.style.left = (s.start * tlDrag.pps).toFixed(1) + 'px';
			d.style.width = Math.max(s.length * tlDrag.pps, 3).toFixed(1) + 'px';
			host.evaluate(time);
		};
		const end = () => {
			if (!tlDrag || tlDrag.id !== d.dataset.strip) return;
			const label = tlDrag.zone === 'move' ? 'move strip' : 'trim strip';
			const moved = tlDrag.moved;
			tlDrag = null;
			if (moved) commit(label, 'strip:' + d.dataset.strip); // ONE step per drag
			renderTimeline();
			render();
		};
		d.onpointerup = end;
		d.onpointercancel = end;
	}

	/** Mid-drag: put every drawn key the drag holds where its key now is (the rows stay built). */
	function moveDrawnKeys(refs, pps) {
		if (!el) return;
		const place = (dot, trackId, channel, t) => {
			const r = refs.find(
				(x) => x.trackId === trackId && x.channel === channel && Math.abs(x.orig - t) < 1e-6,
			);
			if (r) dot.style.left = (r.key.time * pps).toFixed(1) + 'px';
		};
		el.querySelectorAll('.cineChanRow .cineKey').forEach((dot) => {
			const row = dot.closest('.cineTrack');
			place(dot, row.dataset.track, row.dataset.channel, parseFloat(dot.dataset.time));
		});
		el.querySelectorAll('.cineVisRow .cineVisKey').forEach((dot) => {
			place(dot, dot.closest('.cineTrack').dataset.track, null, parseFloat(dot.dataset.visTime));
		});
	}

	/**
	 * BOX SELECT: a drag that starts on an empty channel lane draws a marquee and selects every key
	 * under it (Shift adds to the selection). A click there without a drag clears the selection.
	 */
	function wireMarquee() {
		el.onpointerdown = (e) => {
			if (e.button !== 0 || tlDrag) return;
			const laneEl = e.target.closest && e.target.closest('.cineChanRow .cineLane');
			if (!laneEl || e.target !== laneEl) return;
			e.preventDefault();
			const box = el.getBoundingClientRect();
			const at = (ev) => ({
				x: ev.clientX - box.left + el.scrollLeft,
				y: ev.clientY - box.top + el.scrollTop,
			});
			const start = at(e);
			const mark = document.createElement('div');
			mark.className = 'cineMarquee';
			mark.style.cssText =
				'position:absolute;z-index:7;pointer-events:none;border:1px dashed #5db0ff;background:rgba(93,176,255,.12);';
			el.appendChild(mark);
			const base = e.shiftKey ? selKeys.slice() : [];
			let moved = false;
			const draw = (ev) => {
				const p = at(ev);
				if (Math.abs(p.x - start.x) + Math.abs(p.y - start.y) > 3) moved = true;
				mark.style.left = Math.min(p.x, start.x) + 'px';
				mark.style.top = Math.min(p.y, start.y) + 'px';
				mark.style.width = Math.abs(p.x - start.x) + 'px';
				mark.style.height = Math.abs(p.y - start.y) + 'px';
			};
			const pick = () => {
				const r = mark.getBoundingClientRect();
				const hits = [];
				el.querySelectorAll('.cineChanRow .cineKey').forEach((dot) => {
					const d = dot.getBoundingClientRect();
					const cx = d.left + d.width / 2;
					const cy = d.top + d.height / 2;
					if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return;
					const row = dot.closest('.cineTrack');
					const k = {
						trackId: row.dataset.track,
						channel: row.dataset.channel,
						time: parseFloat(dot.dataset.time),
					};
					if (!base.some((b) => sameKey(b, k))) hits.push(k);
				});
				return base.concat(hits);
			};
			draw(e);
			try {
				el.setPointerCapture(e.pointerId);
			} catch {
				/* uncaptured drag still works */
			}
			el.onpointermove = (ev) => {
				draw(ev);
				if (moved) {
					selectKeys(pick());
					markSelectedKeys();
				}
			};
			const end = () => {
				el.onpointermove = null;
				el.onpointerup = null;
				el.onpointercancel = null;
				const next = moved ? pick() : base;
				mark.remove();
				selectKeys(next);
				renderTimeline();
				render();
			};
			el.onpointerup = end;
			el.onpointercancel = end;
		};
	}

	const suspended = () => extensions.some((x) => x.timelineSuspended && x.timelineSuspended());

	function renderTimeline() {
		// An extension can hand `el` to something else for a while (Tweak Mode puts the rig
		// animator's dopesheet there) — rebuilding the strips over it would wipe that mid-edit.
		if (suspended()) return;
		if (!el || !doc) return;
		const keepScroll = el.scrollLeft;
		const pps = tlPps();
		const contentW = Math.max(doc.duration * pps, 1);
		el.innerHTML = '';

		const rows = orderedRows();
		if (!rows.length) {
			el.innerHTML = '<div class="cineEmpty">Cast an actor to start building the timeline.</div>';
			return;
		}

		// ruler — click or drag anywhere on it to scrub
		const ruler = document.createElement('div');
		ruler.className = 'cineRuler';
		ruler.style.width = TL_GUTTER + contentW + 'px';
		const step = tickStep(pps);
		let ticks =
			'<div class="cineGutter cineRulerGutter">' +
			doc.fps +
			' fps · ' +
			doc.duration.toFixed(2) +
			's</div>';
		ticks += '<div class="cineLane" style="width:' + contentW + 'px;">';
		for (let t = 0; t <= doc.duration + 1e-6; t += step) {
			ticks +=
				'<span class="cineTick" style="left:' +
				(t * pps).toFixed(1) +
				'px;">' +
				+t.toFixed(3) +
				's</span>';
		}
		ticks += '</div>';
		ruler.innerHTML = ticks;
		ruler.onpointerdown = (e) => {
			if (e.target.closest('.cineGutter')) return;
			rulerDrag = true;
			try {
				ruler.setPointerCapture(e.pointerId);
			} catch {
				/* scrub still works uncaptured */
			}
			scrubFromEvent(e, pps);
		};
		ruler.onpointermove = (e) => {
			if (rulerDrag) scrubFromEvent(e, pps);
		};
		ruler.onpointerup = () => {
			rulerDrag = false;
		};
		el.appendChild(ruler);

		for (const entry of rows) {
			const row = document.createElement('div');
			row.className = 'cineTrack';
			row.style.width = TL_GUTTER + contentW + 'px';
			if (entry.track) row.dataset.track = entry.track.id; // the SET row is a layer, not a track
			ROW_KINDS[entry.kind].render(row, entry, pps, contentW);
			el.appendChild(row);
		}

		// playhead — one element over everything, repositioned per frame by `positionPlayhead`
		const ph = document.createElement('div');
		ph.className = 'cinePlayhead';
		ph.id = 'cinePlayhead';
		el.appendChild(ph);
		positionPlayhead(pps);

		el.scrollLeft = keepScroll;
		wireTimeline(pps);
		host.setDepth(setInFront());
	}

	/** A tick every 1/2/5/10… seconds, whichever keeps labels ~70px apart. */
	function tickStep(pps) {
		const targets = [1 / 30, 1 / 10, 0.25, 0.5, 1, 2, 5, 10, 30, 60];
		for (const t of targets) if (t * pps >= 70) return t;
		return 60;
	}

	/** Blend-in / blend-out ramps drawn as triangles inside the strip, so alpha is visible. */
	function blendRampMarkup(strip, pps) {
		let out = '';
		if (strip.blendIn > 0)
			out +=
				'<span class="cineRamp in" style="width:' +
				Math.min(strip.blendIn * pps, strip.length * pps).toFixed(1) +
				'px;"></span>';
		if (strip.blendOut > 0)
			out +=
				'<span class="cineRamp out" style="width:' +
				Math.min(strip.blendOut * pps, strip.length * pps).toFixed(1) +
				'px;"></span>';
		return out;
	}

	function scrubFromEvent(e, pps) {
		const rulerLane = el.querySelector('.cineRuler .cineLane');
		if (!rulerLane) return;
		const x = e.clientX - rulerLane.getBoundingClientRect().left;
		setTime(x / pps);
		positionPlayhead(pps);
	}

	/**
	 * Cheap: moves one element — call it per frame, never re-render the timeline per frame.
	 * The playhead sits INSIDE the scrolling `el` (every host makes it `position: relative`), so it
	 * already scrolls with the lanes: `left` is a content coordinate, never offset by `scrollLeft`.
	 * `top: 0; bottom: 0` would only span the visible box, so it is sized to the full scroll height.
	 * Scrolled under the sticky name gutter it is hidden, or it would draw over the track names.
	 */
	function positionPlayhead(pps) {
		const ph = el && el.querySelector('#cinePlayhead');
		if (!ph) return;
		const x = time * (pps || tlPps());
		const h = el.scrollHeight;
		const underGutter = x < el.scrollLeft;
		ph.style.left = TL_GUTTER + x + 'px';
		ph.style.height = h + 'px';
		ph.style.visibility = underGutter ? 'hidden' : '';
	}

	function wireTimeline(pps) {
		el.onscroll = () => positionPlayhead(pps);

		// Double-click a strip = hand it to the extensions (Tweak Mode). Bound on the CONTAINER, not
		// on each strip: the pointerup that ends a click re-renders the timeline, so the second click
		// of the pair lands on a brand-new element and the browser reports the dblclick against the
		// nearest common ancestor. A per-strip handler would simply never fire.
		el.ondblclick = (e) => {
			const d = e.target.closest('.cineStrip');
			if (d && d.dataset.strip)
				for (const x of extensions) if (x.onStripActivate) x.onStripActivate(d.dataset.strip);
		};

		for (const kind of Object.values(ROW_KINDS)) kind.wire(el, pps);
		if (boxSelect) wireMarquee();
	}

	// ---- strip + layer operations -----------------------------------------

	function addStripAtPlayhead(trackId) {
		const track = doc.tracks.find((t) => t.id === trackId);
		if (!track) return;
		const clip = host.clips(track.actorId)[0];
		if (!clip) return;
		const strip = {
			id: uid('strip'),
			clip: { src: 'rig', name: clip.name },
			start: snapT(time),
			length: Math.max(clip.duration, 1 / (doc.fps || 30)),
			clipIn: 0,
			speed: 1,
			loop: { mode: 'once' },
			alpha: 1,
			blend: 'replace',
			blendIn: 0,
			blendOut: 0,
		};
		if (isNodeActor(track.actorId)) strip.clipLength = clip.duration;
		track.strips.push(strip);
		selStripId = strip.id;
		commit('add strip');
		renderTimeline();
		render();
	}

	function deleteStrip(stripId) {
		const found = stripById(stripId);
		if (!found) return;
		found.track.strips = found.track.strips.filter((s) => s.id !== stripId);
		if (selStripId === stripId) selStripId = null;
		commit('delete strip');
		renderTimeline();
		render();
	}

	function duplicateStrip(stripId) {
		const found = stripById(stripId);
		if (!found) return;
		const copy = JSON.parse(JSON.stringify(found.strip));
		copy.id = uid('strip');
		copy.start = snapT(found.strip.start + found.strip.length);
		found.track.strips.push(copy);
		selStripId = copy.id;
		commit('duplicate strip');
		renderTimeline();
		render();
	}

	function setStripField(stripId, path, value) {
		const found = stripById(stripId);
		if (!found) return;
		const s = found.strip;
		if (path === 'clip') {
			s.clip = value ? { src: 'rig', name: value } : null;
			// A rig node in game has no skeleton to read the clip's length from, so a looping strip
			// wraps by this. A cast actor's strips never read it.
			const known =
				value &&
				isNodeActor(found.track.actorId) &&
				host.clips(found.track.actorId).find((a) => a.name === value);
			if (known) s.clipLength = known.duration;
		} else if (path === 'loop.mode') s.loop = { mode: value, n: (s.loop && s.loop.n) || 2 };
		else if (path === 'loop.n')
			s.loop = { mode: (s.loop && s.loop.mode) || 'count', n: Math.max(1, value) };
		else s[path] = value;
		commit('edit strip', 'strip:' + stripId + ':' + path);
		renderTimeline();
		render();
	}

	/** A new layer for the same actor — layers blend bottom-up (design §4.3). */
	function addLayer(trackId) {
		const track = doc.tracks.find((t) => t.id === trackId);
		if (!track) return;
		const layers = doc.tracks.filter((t) => t.actorId === track.actorId).map((t) => t.layer || 0);
		doc.tracks.push({
			id: uid('track'),
			actorId: track.actorId,
			kind: 'animation',
			layer: Math.max(...layers) + 1,
			strips: [],
		});
		host.tracksChanged();
		commit('add layer');
		renderTimeline();
	}

	function removeLayer(trackId) {
		const track = doc.tracks.find((t) => t.id === trackId);
		if (!track) return;
		// never leave an actor track-less
		if (doc.tracks.filter((t) => t.actorId === track.actorId).length <= 1) return;
		doc.tracks = doc.tracks.filter((t) => t.id !== trackId);
		if (selStripId && !stripById(selStripId)) selStripId = null;
		host.tracksChanged();
		commit('remove layer');
		renderTimeline();
		render();
	}

	// ---- property, camera, visibility + cue keys ----------------------------
	//
	// A channel with keys OWNS its property for the whole cinematic, which is why the ◆ button reads
	// the CURRENT effective value: keying never makes the actor jump at the instant you key it.

	function ensureCueTrack() {
		let track = cueTrack();
		if (!track) {
			track = { id: uid('cue'), actorId: null, kind: 'cue', keys: [] };
			doc.tracks.push(track);
		}
		return track;
	}

	/** A cue at the playhead; `cue` seeds its name (default: an empty `fx:`). */
	function addCue(cue) {
		const track = ensureCueTrack();
		const at = snapT(time);
		track.keys.push({ time: at, cue: typeof cue === 'string' ? cue : 'fx:' });
		track.keys.sort((a, b) => a.time - b.time);
		selCueTime = at;
		commit('add cue');
		render();
		renderTimeline();
	}

	function setCueField(keyTime, field, value) {
		const track = cueTrack();
		if (!track) return;
		const k = track.keys.find((x) => Math.abs(x.time - keyTime) < 1e-6);
		if (!k) return;
		if (field === 'time') {
			k.time = Math.max(0, value);
			track.keys.sort((a, b) => a.time - b.time);
			selCueTime = k.time;
		} else k.cue = value;
		commit('edit cue', 'cue:' + keyTime + ':' + field);
		render();
		renderTimeline();
	}

	function deleteCue(keyTime) {
		const track = cueTrack();
		if (!track) return;
		track.keys = track.keys.filter((k) => Math.abs(k.time - keyTime) > 1e-6);
		// An empty cue track is noise — drop it so "never had cues" and "had cues, removed them"
		// look identical in the doc.
		if (!track.keys.length) doc.tracks = doc.tracks.filter((t) => t.kind !== 'cue');
		selCueTime = null;
		commit('delete cue');
		render();
		renderTimeline();
	}

	/** The actor's property track, created on first use so an un-animated actor carries no track. */
	function ensurePropertyTrack(actorId) {
		let track = propertyTracksOf(actorId)[0];
		if (!track) {
			const layout = propertyLayout();
			track = {
				id: uid('prop'),
				actorId,
				kind: 'property',
				channels: {},
				...(layout && { layout }),
			};
			doc.tracks.push(track);
		}
		return track;
	}

	function ensureVisTrack(actorId) {
		let track = visTracksOf(actorId)[0];
		if (!track) {
			track = { id: uid('vis'), actorId, kind: 'visibility', keys: [] };
			doc.tracks.push(track);
		}
		return track;
	}

	/** Whether the actor is on screen right now — the keyed track when it has keys, else static. */
	function effectiveVisible(actorId) {
		const cast = castOf(actorId);
		if (!cast) return true;
		if (!EV) return cast.visible !== false;
		return EV.resolveVisible(cast.visible, visTracksOf(actorId), time);
	}

	function keyVisibility(actorId, visible) {
		const track = ensureVisTrack(actorId);
		const at = snapT(time);
		const existing = track.keys.find((k) => Math.abs(k.time - at) < 1e-6);
		if (existing) existing.visible = visible;
		else {
			track.keys.push({ time: at, visible });
			track.keys.sort((a, b) => a.time - b.time);
		}
		commit('key visibility');
		render();
		renderTimeline();
	}

	function deleteTextKey(trackId, keyTime) {
		const track = doc.tracks.find((t) => t.id === trackId);
		if (!track || !Array.isArray(track.keys)) return;
		track.keys = track.keys.filter((k) => Math.abs(k.time - keyTime) > 1e-6);
		if (!track.keys.length) doc.tracks = doc.tracks.filter((t) => t.id !== trackId);
		commit('delete text key');
		render();
		renderTimeline();
	}

	/** Select one visibility key and restyle the markers in place (the rows stay, mid-click). */
	function selectVisKey(actorId, t) {
		selectKeys([]);
		selVis = { actorId, time: t };
		markSelectedKeys();
	}
	// Any press in the Timeline off a visibility key drops that key's selection, so Delete never
	// reaches a key the author has since clicked away from.
	function dropVisSelection(e) {
		if (!selVis || (e.target.closest && e.target.closest('.cineVisKey'))) return;
		selVis = null;
		markSelectedKeys();
	}

	function deleteVisKey(actorId, keyTime) {
		const track = visTracksOf(actorId)[0];
		if (!track || !track.keys.some((k) => Math.abs(k.time - keyTime) < 1e-6)) return;
		if (isVisSelected(actorId, keyTime)) selVis = null;
		track.keys = track.keys.filter((k) => Math.abs(k.time - keyTime) > 1e-6);
		// An empty track is noise — drop it so "never keyed" and "keyed then cleared" look the same.
		if (!track.keys.length) doc.tracks = doc.tracks.filter((t) => t.id !== track.id);
		commit('delete visibility key');
		render();
		renderTimeline();
	}

	function ensureCameraTrack() {
		let track = cameraTrack();
		if (!track) {
			track = { id: uid('cam'), actorId: null, kind: 'camera', channels: {} };
			doc.tracks.push(track);
		}
		return track;
	}

	/** Effective value of one actor property right now — static placement or the sampled channel. */
	function effectivePlaceValue(actorId, channel) {
		const cast = castOf(actorId);
		if (!cast) return 0;
		const resolved = EV.resolvePlace(cast.place, propertyTracksOf(actorId), time);
		return resolved[channel] == null
			? channel === 'scale' || channel === 'alpha'
				? 1
				: 0
			: resolved[channel];
	}

	function keyProperty(actorId, channel, value, ease) {
		const track = ensurePropertyTrack(actorId);
		track.channels[channel] = track.channels[channel] || [];
		EV.putKey(
			track.channels[channel],
			snapT(time),
			value == null ? effectivePlaceValue(actorId, channel) : value,
			ease == null && doc.defaultEase != null ? cloneEase(doc.defaultEase) : ease,
		);
		commit('key ' + channel);
		render();
		renderTimeline();
	}

	/** Key the camera from wherever the HOST's view is — frame the shot, then press ◆. */
	function keyCamera(channel) {
		const view = host.cameraView();
		if (!view) return;
		const track = ensureCameraTrack();
		track.channels[channel] = track.channels[channel] || [];
		EV.putKey(track.channels[channel], snapT(time), view[channel]);
		commit('key camera ' + channel);
		render();
		renderTimeline();
	}

	function deleteKey(trackId, channel, keyTime) {
		const track = doc.tracks.find((t) => t.id === trackId);
		if (!track || !track.channels[channel]) return;
		track.channels[channel] = track.channels[channel].filter(
			(k) => Math.abs(k.time - keyTime) > 1e-6,
		);
		if (!track.channels[channel].length) delete track.channels[channel];
		// A property/camera track with no channels left is noise — drop it so an actor that was
		// animated and then un-animated is indistinguishable from one that never was.
		if (!Object.keys(track.channels).length)
			doc.tracks = doc.tracks.filter((t) => t.id !== trackId);
		selectKeys([]);
		commit('delete key');
		render();
		renderTimeline();
	}

	/** Delete every selected key (one undo step), pruning channels and tracks left empty. */
	function deleteSelectedKeys() {
		if (selKeys.length <= 1) {
			if (selKey) deleteKey(selKey.trackId, selKey.channel, selKey.time);
			return;
		}
		for (const r of selectedKeyRefs()) {
			const track = doc.tracks.find((t) => t.id === r.trackId);
			if (!track || !track.channels[r.channel]) continue;
			track.channels[r.channel] = track.channels[r.channel].filter((k) => k !== r.key);
			if (!track.channels[r.channel].length) delete track.channels[r.channel];
			if (!Object.keys(track.channels).length) doc.tracks = doc.tracks.filter((t) => t !== track);
		}
		selectKeys([]);
		commit('delete keys');
		render();
		renderTimeline();
	}

	/** Ctrl+C: the selected keys, timed from the earliest. False when nothing is selected. */
	function copyKeys() {
		const refs = selectedKeyRefs();
		if (!refs.length) return false;
		const t0 = Math.min(...refs.map((r) => r.key.time));
		keyClipboard = refs.map((r) => {
			const track = doc.tracks.find((t) => t.id === r.trackId);
			return {
				trackId: r.trackId,
				actorId: track && track.actorId,
				kind: track && track.kind,
				channel: r.channel,
				dt: r.key.time - t0,
				value: r.key.value,
				ease: cloneEase(r.key.ease),
			};
		});
		return true;
	}

	/** A copied key `c` into `keys` at `t`, replacing a key already there. */
	function putPastedKey(keys, t, c) {
		const i = keys.findIndex((k) => Math.abs(k.time - t) < 1e-6);
		const key = { time: t, value: c.value, ease: cloneEase(c.ease) };
		if (key.ease === undefined) delete key.ease;
		if (i >= 0) keys[i] = key;
		else keys.push(key);
		keys.sort((a, b) => a.time - b.time);
	}

	/**
	 * Where copied keys land when they are all property keys of ONE actor and the host names another
	 * actor (`host.pasteTarget`, the node selected on the stage): that actor's track in the ratio
	 * being edited, field to the same field, a field it cannot key skipped. Null ⇒ the copied
	 * channels (a camera key in the clipboard keeps the whole paste there).
	 */
	function pasteRetarget() {
		const from = keyClipboard[0].actorId;
		if (!from || keyClipboard.some((c) => c.kind !== 'property' || c.actorId !== from)) return null;
		const target = host.pasteTarget(from);
		if (!target) return null;
		const fields = new Set(target.channels);
		if (!keyClipboard.some((c) => fields.has(c.channel))) return null;
		return { fields, track: () => ensurePropertyTrack(target.actor()) };
	}

	/**
	 * Ctrl+V: the copied keys onto the SAME channels, the earliest at the playhead — or, copied from
	 * one node with another selected (`pasteRetarget`), onto that node's same fields. A key already at
	 * a pasted time is replaced; a channel whose track is gone is skipped. The pasted keys end up
	 * selected.
	 */
	function pasteKeys() {
		if (!keyClipboard || !keyClipboard.length) return false;
		const retarget = pasteRetarget();
		if (!retarget) return pasteOntoCopied();
		const at = snapT(time);
		const fits = keyClipboard.filter(
			(c) => retarget.fields.has(c.channel) && at + c.dt <= doc.duration + 1e-6,
		);
		if (!fits.length) return false;
		const track = retarget.track();
		const pasted = [];
		for (const c of fits) {
			const t = at + c.dt;
			const keys = (track.channels[c.channel] = track.channels[c.channel] || []);
			putPastedKey(keys, t, c);
			pasted.push({ trackId: track.id, channel: c.channel, time: t });
		}
		selectKeys(pasted);
		commit(pasted.length > 1 ? 'paste keys' : 'paste key');
		render();
		renderTimeline();
		return true;
	}

	/** Today's paste: each copied key onto its own channel (this ratio's track for its actor). */
	function pasteOntoCopied() {
		const at = snapT(time);
		const pasted = [];
		for (const c of keyClipboard) {
			let track = doc.tracks.find((t) => t.id === c.trackId);
			// Copied from another ratio's keys (`propertyLayout` changed since): onto this ratio's track
			// for the same actor, never into keys the rows do not show.
			if (track && track.kind === 'property' && layoutOf(track) !== propertyLayout())
				track = ensurePropertyTrack(track.actorId);
			if (!track || !track.channels) continue;
			const keys = (track.channels[c.channel] = track.channels[c.channel] || []);
			const t = at + c.dt;
			if (t > doc.duration + 1e-6) continue;
			putPastedKey(keys, t, c);
			pasted.push({ trackId: track.id, channel: c.channel, time: t });
		}
		if (!pasted.length) return false;
		selectKeys(pasted);
		commit(pasted.length > 1 ? 'paste keys' : 'paste key');
		render();
		renderTimeline();
		return true;
	}

	/** Set the outgoing `ease` of every selected key. `live` = mid-drag: no undo step yet. */
	function setSelectedEase(ease, live) {
		const refs = selectedKeyRefs();
		if (!refs.length) return;
		for (const r of refs) r.key.ease = cloneEase(ease);
		host.evaluate(time);
		if (live) {
			refreshGraphRows();
			return;
		}
		commit('interpolation', 'ease:' + selKeys.length);
		render();
		renderTimeline();
	}

	/** *Set as default*: what a NEW key's ease is in this doc. Linear is the absent default. */
	function setDefaultEase(ease) {
		if (ease == null || ease === 'linear') delete doc.defaultEase;
		else doc.defaultEase = cloneEase(ease);
		commit('default interpolation');
		render();
	}

	function setKeyField(field, value) {
		if (!selKey) return;
		const track = doc.tracks.find((t) => t.id === selKey.trackId);
		const keys = track && track.channels[selKey.channel];
		if (!keys) return;
		const k = keys.find((x) => Math.abs(x.time - selKey.time) < 1e-6);
		if (!k) return;
		if (field === 'time') {
			const was = selKey;
			k.time = Math.max(0, value);
			keys.sort((a, b) => a.time - b.time);
			selKey = Object.assign({}, selKey, { time: k.time });
			selKeys = selKeys.map((x) => (sameKey(x, was) ? selKey : x));
		} else k[field] = value;
		commit('edit key', 'key:' + selKey.trackId + ':' + selKey.channel + ':' + field);
		render();
		renderTimeline();
	}

	// ---- panel sections (the host places them in its own panel) -------------

	function historyMarkup() {
		return `<div class="cineRow">
	<button id="cineUndo" title="${canUndo() ? 'Undo ' + esc(undoLabel()) + ' (Ctrl+Z)' : 'Nothing to undo'}"${canUndo() ? '' : ' disabled'}>↶ Undo</button>
	<button id="cineRedo" title="${canRedo() ? 'Redo ' + esc(redoLabel()) + ' (Ctrl+Shift+Z)' : 'Nothing to redo'}"${canRedo() ? '' : ' disabled'}>↷ Redo</button>
	<span class="cineZ">${canUndo() ? esc(undoLabel()) : ''}</span>
</div>`;
	}

	/**
	 * Camera section. Keys come from wherever the stage camera IS — frame the shot by panning and
	 * zooming, then press ◆. That is the whole workflow, so there are no numeric camera fields to
	 * type into; the numbers are a consequence of the view, not the other way round.
	 */
	function cameraMarkup() {
		const track = cameraTrack();
		const keyed = (k) => !!(track && track.channels[k]);
		const any = CAM_CHANNELS.some((c) => keyed(c.key));
		return `
<div class="cineHead" style="border-top:1px solid var(--line);"><b>🎥 Camera</b><small>${any ? 'animated' : 'not animated'}</small></div>
<div class="cineRow">
	${CAM_CHANNELS.map((c) => `<button class="cineKeyBtn${keyed(c.key) ? ' on' : ''}" data-camkey="${c.key}" title="Key the camera's ${c.label} at the playhead, from the current view">◆ ${c.label}</button>`).join('')}
	${any ? `<button id="cineCamLive" class="${cameraLive ? 'on' : ''}" title="${cameraLive ? 'The camera track is driving the view — turn off to pan/zoom freely while editing' : 'The camera track is NOT driving the view'}">${cameraLive ? '🎥 live' : '🎥 off'}</button>` : ''}
</div>`;
	}

	/** The Cues section: just the add button + how many exist. */
	function cueMarkup() {
		const track = cueTrack();
		const keys = (track && track.keys) || [];
		return `
<div class="cineHead" style="border-top:1px solid var(--line);"><b>⚡ Cues</b><small>${keys.length || 'none'} · ${host.effects().length} fx available</small></div>
<div class="cineRow">
	<button id="cineAddCue" title="Add a cue at the playhead — a named moment the GAME reacts to">＋ Cue at playhead</button>
</div>
${keys.length ? '' : '<div class="cineNote">Cues fire as the playhead crosses them — an FX burst, a sound, or a signal the flow can react to. Scrubbing never fires them.</div>'}`;
	}

	/** Wire the sections above, once the host has put them into `root`. */
	function wirePanel(root) {
		const q = (sel) => root.querySelector(sel);
		const undoBtn = q('#cineUndo');
		if (undoBtn) undoBtn.onclick = undo;
		const redoBtn = q('#cineRedo');
		if (redoBtn) redoBtn.onclick = redo;
		const addCueBtn = q('#cineAddCue');
		if (addCueBtn) addCueBtn.onclick = () => addCue();
		root.querySelectorAll('[data-camkey]').forEach((b) => {
			b.onclick = () => keyCamera(b.dataset.camkey);
		});
		const live = q('#cineCamLive');
		if (live)
			live.onclick = () => {
				cameraLive = !cameraLive;
				render();
			};
	}

	// ---- inspector (the selected strip / key / cue) --------------------------

	/**
	 * The SELECTED cue's editor.
	 *
	 * TWO controls, deliberately. A lone `<input list=…>` is NOT enough: a datalist filters its
	 * options against what the field already holds, so the moment a cue reads `fx:f_bottle` the
	 * dropdown collapses to that one entry and the cue looks unchangeable. So the PICKER — which
	 * never filters — always offers every effect the project has, and the text field stays, because
	 * `sfx:` / `music:` / `signal:` resolve inside the GAME, not here: they are not listable, and
	 * typing them is the only way to author them.
	 */
	function cueInspectorMarkup() {
		const track = cueTrack();
		const keys = (track && track.keys) || [];
		const sel = selCueTime !== null ? keys.find((k) => Math.abs(k.time - selCueTime) < 1e-6) : null;
		if (!sel) return '';
		const fxEffects = host.effects();
		const suggested = host.cueSuggestions();
		const cur = sel.cue || '';
		const known =
			fxEffects.some((e) => 'fx:' + e.id === cur) || suggested.some((x) => x.cue === cur);
		const typed = !!cur && !known && !CUE_KINDS.some((k) => k.prefix === cur);
		const head = known
			? '— change to —'
			: typed
				? '✎ ' + esc(cur) + ' (typed)'
				: '— pick an effect or a kind —';
		const fxOpts = fxEffects
			.map(
				(e) =>
					`<option value="fx:${esc(e.id)}"${'fx:' + e.id === cur ? ' selected' : ''}>${esc(e.name || e.id)}</option>`,
			)
			.join('');
		const suggestOpts = suggested
			.map(
				(x) =>
					`<option value="${esc(x.cue)}"${x.cue === cur ? ' selected' : ''}>${esc(x.cue)} — ${esc(x.label)}</option>`,
			)
			.join('');
		const kindOpts = CUE_KINDS.filter((k) => k.prefix !== 'fx:')
			.map((k) => `<option value="${k.prefix}">${k.label} — ${k.hint}</option>`)
			.join('');
		return `
<div class="cineHead" style="border-top:1px solid var(--line);"><b>⚡ Cue</b><small>${esc(cur || '(empty)')}</small></div>
<div class="cineStripInsp">
	<label class="wide">pick<select id="cineCuePick" title="Every FX effect in this project — picking one replaces this cue. The other kinds only seed their prefix, since their names live in the game.">
		<option value="">${head}</option>
		${fxOpts ? `<optgroup label="FX effects">${fxOpts}</optgroup>` : ''}${suggestOpts ? `<optgroup label="Element FX (On cue)">${suggestOpts}</optgroup>` : ''}
		<optgroup label="other kinds">${kindOpts}</optgroup>
	</select></label>
	<label class="wide">cue<input type="text" data-cueact="cue" value="${esc(cur)}" placeholder="fx:my_effect"></label>
	<label>time<input type="number" step="0.05" min="0" data-cueact="time" value="${+sel.time.toFixed(3)}"></label>
</div>
<div class="cineRow"><button id="cineDelCue" title="Delete this cue">🗑 Delete cue</button></div>
<div class="cineNote">${fxEffects.length ? 'Pick an FX effect from the list — it stays complete however the cue is already set — or type an <code>sfx:</code> / <code>music:</code> / <code>signal:</code> name the game knows.' : 'This project has no authored FX effects yet — author them in /fx, or type a sound or signal name.'} An <code>fx:</code> cue draws on the <b>⚡ fx</b> row in the timeline (it appears as soon as one <code>fx:</code> cue exists, and becomes the <b>🎬 set</b> row once a Scene is bound) — move that row with ▲▼ to put the effect in front of a rig.</div>${
			suggested.length
				? `<div class="cineNote">A <code>signal:</code> cue plays every <b>Element FX</b> on this screen and its nodes whose trigger is <i>On cue</i> with that name (without <code>signal:</code>): ${suggested.map((x) => `<code>${esc(x.cue)}</code>`).join(', ')}.</div>`
				: ''
		}`;
	}

	/** Inspector for a selected property/camera key — time, value and its outgoing interpolation. */
	function keyInspectorMarkup() {
		if (!selKey) return '';
		const track = doc.tracks.find((t) => t.id === selKey.trackId);
		const keys = track && track.channels[selKey.channel];
		const k = keys && keys.find((x) => Math.abs(x.time - selKey.time) < 1e-6);
		if (!k) return '';
		if (interpolation) return interpolationMarkup(track, k);
		const ease = k.ease || 'linear';
		const chan =
			track.kind === 'camera'
				? null
				: channelsOf(castOf(track.actorId)).find((c) => c.key === selKey.channel);
		const valueField =
			chan && chan.input === 'color'
				? `<input type="color" data-kact="value" value="${hexColor(k.value)}">`
				: `<input type="number" step="0.1" data-kact="value" value="${+k.value.toFixed(3)}">`;
		const opt = (v, label) =>
			`<option value="${v}"${ease === v ? ' selected' : ''}>${label}</option>`;
		// A cubic (authored in /editor's Interpolation panel) shows as itself; picking a named ease
		// replaces it.
		const cubicOpt = cubicOf(k.ease)
			? `<option value="" selected disabled>cubic ${esc(cubicText(k.ease))}</option>`
			: '';
		return `
<div class="cineHead" style="border-top:1px solid var(--line);"><b>Key</b><small>${esc(selKey.channel)}${track.kind === 'camera' ? ' (camera)' : ''}</small></div>
<div class="cineStripInsp">
	<label>time<input type="number" step="0.05" min="0" data-kact="time" value="${+k.time.toFixed(3)}"></label>
	<label>value${valueField}</label>
	<label class="wide">out<select data-kact="ease">
		${cubicOpt}${opt('linear', 'linear')}${opt('ease', 'ease in-out')}${opt('hold', 'hold (stepped)')}${opt('elastic', 'elastic')}${opt('bounce', 'bounce')}
	</select></label>
</div>
<div class="cineRow"><button id="cineDelKey" title="Delete this key">🗑 Delete key</button></div>`;
	}

	// ---- the Interpolation panel (`options.interpolation`) ---------------------
	//
	// Linear / Cubic / Hold / Elastic / Bounce for the segment LEAVING the selected keys (all of
	// them, when several are selected), a curve editor with two draggable handles plus the typed
	// `x1, y1, x2, y2`, and *Set as default* (the ease a new key gets in this doc). The cubic is drawn
	// as an SVG cubic and Elastic / Bounce from the evaluator's own `easeShape`, so each is the very
	// curve the evaluator samples.

	/** Curve-editor geometry: x 0..1 → 20..140, y 0..1 → 160..40 (room to overshoot both ways). */
	const CURVE = { x0: 20, w: 120, y0: 160, h: 120, vw: 160, vh: 200 };
	const cx = (x) => CURVE.x0 + CURVE.w * x;
	const cy = (y) => CURVE.y0 - CURVE.h * y;

	function curveMarkup(c) {
		const [x1, y1, x2, y2] = c;
		const p = (x, y) => `${cx(x).toFixed(1)},${cy(y).toFixed(1)}`;
		return `<svg class="cineCurve" viewBox="0 0 ${CURVE.vw} ${CURVE.vh}" width="${CURVE.vw}" height="${CURVE.vh}" role="img" aria-label="Cubic curve ${esc(cubicText(c))}">
	<rect x="${CURVE.x0}" y="${cy(1)}" width="${CURVE.w}" height="${CURVE.h}" class="cineCurveBox"/>
	<line class="cineCurveArm" data-arm="1" x1="${cx(0)}" y1="${cy(0)}" x2="${cx(x1).toFixed(1)}" y2="${cy(y1).toFixed(1)}"/>
	<line class="cineCurveArm" data-arm="2" x1="${cx(1)}" y1="${cy(1)}" x2="${cx(x2).toFixed(1)}" y2="${cy(y2).toFixed(1)}"/>
	<path class="cineCurvePath" d="M${p(0, 0)} C${p(x1, y1)} ${p(x2, y2)} ${p(1, 1)}"/>
	<circle class="cineCurveHandle" data-handle="1" cx="${cx(x1).toFixed(1)}" cy="${cy(y1).toFixed(1)}" r="6"/>
	<circle class="cineCurveHandle" data-handle="2" cx="${cx(x2).toFixed(1)}" cy="${cy(y2).toFixed(1)}" r="6"/>
</svg>`;
	}

	/** A named ease's shape (Linear, Hold, Elastic, Bounce), drawn in the curve editor's frame. */
	function shapeMarkup(kind) {
		const p = (x, y) => `${cx(x).toFixed(1)},${cy(y).toFixed(1)}`;
		let d = `M${p(0, 0)} L${p(1, 1)}`;
		if (kind === 'hold') d = `M${p(0, 0)} H${cx(1).toFixed(1)} V${cy(1).toFixed(1)}`;
		else if ((kind === 'elastic' || kind === 'bounce') && EV && EV.easeShape) {
			const shape = EV.easeShape(kind);
			const steps = 96;
			d = `M${p(0, 0)}`;
			for (let i = 1; i <= steps; i++) d += ` L${p(i / steps, shape(i / steps))}`;
		}
		const label = kind.charAt(0).toUpperCase() + kind.slice(1);
		// Elastic's peak (1.37) rises past the frame's headroom; let it show rather than clip it.
		return `<svg class="cineCurve" viewBox="0 0 ${CURVE.vw} ${CURVE.vh}" width="${CURVE.vw}" height="${CURVE.vh}"${kind === 'elastic' ? ' overflow="visible"' : ''} role="img" aria-label="${label}">
	<rect x="${CURVE.x0}" y="${cy(1)}" width="${CURVE.w}" height="${CURVE.h}" class="cineCurveBox"/>
	<path class="cineCurvePath" d="${d}"/>
</svg>`;
	}

	/** Redraw the curve editor's arms, path and handles in place (a handle keeps its capture). */
	function moveCurve(svg, c) {
		const [x1, y1, x2, y2] = c;
		const set = (node, attrs) => {
			if (node) for (const [a, v] of Object.entries(attrs)) node.setAttribute(a, v.toFixed(1));
		};
		set(svg.querySelector('[data-arm="1"]'), { x2: cx(x1), y2: cy(y1) });
		set(svg.querySelector('[data-arm="2"]'), { x2: cx(x2), y2: cy(y2) });
		set(svg.querySelector('[data-handle="1"]'), { cx: cx(x1), cy: cy(y1) });
		set(svg.querySelector('[data-handle="2"]'), { cx: cx(x2), cy: cy(y2) });
		const p = (x, y) => `${cx(x).toFixed(1)},${cy(y).toFixed(1)}`;
		const path = svg.querySelector('.cineCurvePath');
		if (path) path.setAttribute('d', `M${p(0, 0)} C${p(x1, y1)} ${p(x2, y2)} ${p(1, 1)}`);
		svg.setAttribute('aria-label', 'Cubic curve ' + cubicText(c));
	}

	/** The Linear / Cubic / Hold picker + the cubic editor for `ease`; `scope` names what it sets. */
	function easeEditorMarkup(ease, scope) {
		const kind = easeKind(ease);
		const c = cubicValues(ease);
		const btn = (v, label, title) =>
			`<button data-ekind${scope}="${v}" class="${kind === v ? 'on' : ''}" title="${title}">${label}</button>`;
		return `
<div class="cineRow cineEaseKinds">
	${btn('linear', 'Linear', 'A straight line to the next key')}${btn('cubic', 'Cubic', 'A curve with two handles')}${btn('hold', 'Hold', 'Hold this value until the next key (stepped)')}${btn('elastic', 'Elastic', 'Overshoot the next key and spring back onto it')}${btn('bounce', 'Bounce', 'Land on the next key and bounce')}
</div>
<div class="cineRow cineEasePresets">${CUBIC_PRESETS.map((p) => `<button data-epreset${scope}="${p.id}" class="${kind === 'cubic' && cubicText(p.cubic) === cubicText(c) ? 'on' : ''}" title="Cubic ${esc(cubicText(p.cubic))}">${esc(p.label)}</button>`).join('')}</div>
${
	kind === 'cubic'
		? `<div class="cineCurveWrap" data-curve${scope}>${curveMarkup(c)}</div>
<div class="cineStripInsp"><label class="wide">x1, y1, x2, y2<input type="text" data-ecubic${scope} value="${esc(cubicText(c))}" spellcheck="false" title="The cubic-bezier's two handles: x in 0..1, y may overshoot"></label></div>`
		: `<div class="cineCurveWrap">${shapeMarkup(kind)}</div>`
}`;
	}

	function interpolationMarkup(track, k) {
		const many = selKeys.length > 1;
		const chan =
			track.kind === 'camera'
				? null
				: channelsOf(castOf(track.actorId)).find((c) => c.key === selKey.channel);
		const valueField =
			chan && chan.input === 'color'
				? `<input type="color" data-kact="value" value="${hexColor(k.value)}">`
				: `<input type="number" step="0.1" data-kact="value" value="${+k.value.toFixed(3)}">`;
		const isDefault =
			JSON.stringify(k.ease == null ? 'linear' : k.ease) ===
			JSON.stringify(doc.defaultEase == null ? 'linear' : doc.defaultEase);
		return `
<div class="cineHead" style="border-top:1px solid var(--line);"><b>${many ? selKeys.length + ' keys' : 'Key'}</b><small>${many ? 'the panel sets all of them' : esc(selKey.channel) + (track.kind === 'camera' ? ' (camera)' : '')}</small></div>
${
	many
		? ''
		: `<div class="cineStripInsp">
	<label>time<input type="number" step="0.05" min="0" data-kact="time" value="${+k.time.toFixed(3)}"></label>
	<label>value${valueField}</label>
</div>`
}
<div class="cineHead"><b>Interpolation</b><small>out of ${many ? 'each key' : 'this key'}</small></div>
${easeEditorMarkup(k.ease, '')}
<div class="cineRow">
	<button id="cineEaseDefault" title="New keys in this timeline get this interpolation"${isDefault ? ' disabled' : ''}>${isDefault ? '✓ Default' : 'Set as default'}</button>
	<button id="cineDelKey" title="Delete ${many ? 'the selected keys' : 'this key'} (Delete)">🗑 Delete</button>
</div>`;
	}

	/** Nothing selected, with the Interpolation panel on: the doc's default interpolation. */
	function defaultEaseMarkup() {
		if (!interpolation) return '';
		return `
<div class="cineHead" style="border-top:1px solid var(--line);"><b>Default interpolation</b><small>what a new key gets</small></div>
${easeEditorMarkup(doc.defaultEase, '-default')}`;
	}

	/** Wire one ease editor; `apply(ease, live)` writes it (live = a handle mid-drag). */
	function wireEaseEditor(root, scope, current, apply) {
		root.querySelectorAll(`[data-ekind${scope}]`).forEach((b) => {
			b.onclick = () => {
				const v = b.getAttribute(`data-ekind${scope}`);
				if (v === easeKind(current())) return;
				apply(v === 'cubic' ? cubicValues(current()).slice() : v, false);
			};
		});
		root.querySelectorAll(`[data-epreset${scope}]`).forEach((b) => {
			b.onclick = () => {
				const preset = CUBIC_PRESETS.find((p) => p.id === b.getAttribute(`data-epreset${scope}`));
				if (preset) apply(preset.cubic.slice(), false);
			};
		});
		const field = root.querySelector(`[data-ecubic${scope}]`);
		if (field)
			field.onchange = () => {
				const c = parseCubic(field.value);
				if (c) apply(c, false);
				else field.value = cubicText(cubicValues(current()));
			};
		const wrap = root.querySelector(`[data-curve${scope}]`);
		const svg = wrap && wrap.querySelector('svg');
		if (!svg) return;
		svg.querySelectorAll('.cineCurveHandle').forEach((h) => {
			h.onpointerdown = (e) => {
				e.preventDefault();
				e.stopPropagation();
				const which = h.dataset.handle === '1' ? 0 : 2;
				const c = cubicValues(current()).slice();
				try {
					h.setPointerCapture(e.pointerId);
				} catch {
					/* uncaptured drag still works */
				}
				let moved = false;
				h.onpointermove = (ev) => {
					const r = svg.getBoundingClientRect();
					const sx = ((ev.clientX - r.left) / r.width) * CURVE.vw;
					const sy = ((ev.clientY - r.top) / r.height) * CURVE.vh;
					c[which] = n3(Math.min(Math.max((sx - CURVE.x0) / CURVE.w, 0), 1));
					c[which + 1] = n3(
						Math.min(
							Math.max((CURVE.y0 - sy) / CURVE.h, -(CURVE.vh - CURVE.y0) / CURVE.h),
							CURVE.y0 / CURVE.h,
						),
					);
					moved = true;
					moveCurve(svg, c);
					if (field) field.value = cubicText(c);
					apply(c.slice(), true);
				};
				const up = () => {
					h.onpointermove = null;
					h.onpointerup = null;
					h.onpointercancel = null;
					if (moved) apply(c.slice(), false);
				};
				h.onpointerup = up;
				h.onpointercancel = up;
			};
		});
	}

	/**
	 * Inspector for the selected strip — every field the evaluator actually reads (design §4.2).
	 * Extensions add their own sections under the fields (`stripInspector`) and their own buttons
	 * ahead of Duplicate / Delete (`stripActions`, one tab-indented line per button).
	 */
	function stripInspectorMarkup() {
		if (!selStripId) return '';
		const found = stripById(selStripId);
		if (!found) return '';
		const s = found.strip;
		const clips = host.clips(found.track.actorId);
		const cur = s.clip ? s.clip.name : '';
		// A clip the ACTOR does not know about yet — freshly created by ＋ New clip, or renamed on the
		// rig since — must still show as the selection. Without this the <select> falls back to its
		// first option, which reads as "the tool silently changed my clip".
		const missing =
			cur && !clips.some((a) => a.name === cur)
				? `<option value="${esc(cur)}" selected>${esc(cur)} (new — save the rig)</option>`
				: '';
		const clipOpts =
			missing +
			clips
				.map(
					(a) =>
						`<option value="${esc(a.name)}"${a.name === cur ? ' selected' : ''}>${esc(a.name)} (${a.duration.toFixed(2)}s)</option>`,
				)
				.join('');
		const loopMode = (s.loop && s.loop.mode) || 'once';
		const loopOpt = (v, label) =>
			`<option value="${v}"${loopMode === v ? ' selected' : ''}>${label}</option>`;
		const blend = s.blend || 'replace';
		const sections = extensions
			.map((x) => (x.stripInspector && x.stripInspector(s, found.track)) || '')
			.join('');
		const actions = extensions
			.map((x) => (x.stripActions && x.stripActions(s, found.track)) || '')
			.join('');
		return `
<div class="cineHead" style="border-top:1px solid var(--line);"><b>Strip</b><small>${esc(cur || 'no clip')}</small></div>
<div class="cineStripInsp">
	<label class="wide">clip<select data-sact="clip">${clipOpts}</select></label>
	<label>start<input type="number" step="0.05" data-sact="start" value="${+s.start.toFixed(3)}"></label>
	<label>length<input type="number" step="0.05" min="0.01" data-sact="length" value="${+s.length.toFixed(3)}"></label>
	<label>clip in<input type="number" step="0.05" min="0" data-sact="clipIn" value="${+(s.clipIn || 0).toFixed(3)}"></label>
	<label>speed<input type="number" step="0.1" data-sact="speed" value="${s.speed == null ? 1 : s.speed}"></label>
	<label class="wide">loop<select data-sact="loop.mode">
		${loopOpt('once', 'once (hold last)')}${loopOpt('fill', 'loop to fill')}${loopOpt('count', 'loop N times')}${loopOpt('pingPong', 'ping-pong')}
	</select></label>
	${loopMode === 'count' ? `<label>times<input type="number" min="1" step="1" data-sact="loop.n" value="${(s.loop && s.loop.n) || 2}"></label>` : ''}
	<label>blend in<input type="number" step="0.05" min="0" data-sact="blendIn" value="${+(s.blendIn || 0).toFixed(3)}"></label>
	<label>blend out<input type="number" step="0.05" min="0" data-sact="blendOut" value="${+(s.blendOut || 0).toFixed(3)}"></label>
	<label>alpha<input type="number" step="0.05" min="0" max="1" data-sact="alpha" value="${s.alpha == null ? 1 : s.alpha}"></label>
	<label class="wide">mode<select data-sact="blend">
		<option value="replace"${blend === 'replace' ? ' selected' : ''}>replace (over the layers below)</option>
		<option value="add"${blend === 'add' ? ' selected' : ''}>additive (on top of a base)</option>
	</select></label>
</div>
${sections}
<div class="cineRow">
${actions}	<button id="cineDupStrip" title="Copy this strip in right after itself">⧉ Duplicate</button>
	<button id="cineDelStrip" title="Delete this strip">🗑 Delete</button>
</div>`;
	}

	/**
	 * Fill `options.inspector` with the selection's editor. Returns whether anything is selected —
	 * the host names the column from it.
	 */
	function renderInspector() {
		if (!inspectorEl) return false;
		const markup = stripInspectorMarkup() + keyInspectorMarkup() + cueInspectorMarkup();
		inspectorEl.innerHTML =
			markup ||
			'<div class="cineNote">Nothing selected. Click a strip, a keyframe diamond or a cue marker on the timeline.</div>' +
				defaultEaseMarkup();
		wireInspector(inspectorEl);
		return !!markup;
	}

	function wireInspector(root) {
		const q = (sel) => root.querySelector(sel);
		for (const x of extensions) if (x.wireInspector) x.wireInspector(root);
		const dup = q('#cineDupStrip');
		if (dup) dup.onclick = () => duplicateStrip(selStripId);
		const del = q('#cineDelStrip');
		if (del) del.onclick = () => deleteStrip(selStripId);
		root.querySelectorAll('[data-sact]').forEach((node) => {
			const path = node.dataset.sact;
			node.onchange = (e) => {
				const v = node.tagName === 'SELECT' ? e.target.value : parseFloat(e.target.value);
				setStripField(selStripId, path, node.tagName === 'SELECT' ? v : Number.isFinite(v) ? v : 0);
			};
		});

		const delCueBtn = q('#cineDelCue');
		if (delCueBtn) delCueBtn.onclick = () => selCueTime !== null && deleteCue(selCueTime);
		const cuePick = q('#cineCuePick');
		if (cuePick)
			cuePick.onchange = (e) => {
				const v = e.target.value;
				if (!v || selCueTime === null) return;
				if (v.endsWith(':')) {
					// A KIND, not a value. Committing a bare `sfx:` would only make an unfirable cue, so
					// seed the prefix into the field and let the author finish the name.
					const field = q('[data-cueact="cue"]');
					e.target.value = '';
					if (field) {
						field.value = v;
						field.focus();
						field.setSelectionRange(v.length, v.length);
					}
					return;
				}
				setCueField(selCueTime, 'cue', v);
			};
		root.querySelectorAll('[data-cueact]').forEach((node) => {
			node.onchange = (e) => {
				const f = node.dataset.cueact;
				if (selCueTime === null) return;
				setCueField(selCueTime, f, f === 'time' ? parseFloat(e.target.value) || 0 : e.target.value);
			};
		});
		const delKey = q('#cineDelKey');
		if (delKey) delKey.onclick = () => selKey && deleteSelectedKeys();
		if (interpolation) {
			const primaryEase = () => {
				const r = selectedKeyRefs().find(
					(x) =>
						selKey && sameKey({ trackId: x.trackId, channel: x.channel, time: x.key.time }, selKey),
				);
				return r ? r.key.ease : undefined;
			};
			if (selKey) wireEaseEditor(root, '', primaryEase, setSelectedEase);
			else
				wireEaseEditor(
					root,
					'-default',
					() => doc.defaultEase,
					(ease, live) => {
						if (!live) setDefaultEase(ease);
					},
				);
			const def = q('#cineEaseDefault');
			if (def) def.onclick = () => setDefaultEase(primaryEase());
		}
		root.querySelectorAll('[data-kact]').forEach((node) => {
			node.onchange = (e) => {
				const f = node.dataset.kact;
				const v = e.target.value;
				setKeyField(
					f,
					f === 'ease'
						? v
						: node.type === 'color'
							? parseInt(v.slice(1), 16) || 0
							: parseFloat(v) || 0,
				);
			};
		});
	}

	// ---- keyboard -----------------------------------------------------------

	/**
	 * Undo/redo, duplicate, delete and save. Scoped so they can never reach past the Timeline:
	 *  - only while the host says it is active,
	 *  - never while focus is in a field (the browser's own text undo must win there),
	 *  - an extension may claim the keyboard first (Tweak Mode hands it to the rig animator),
	 *  - `preventDefault` only when we actually handle it.
	 */
	function onKeyDown(e) {
		if (!active) return;
		const ae = document.activeElement;
		if (ae && (/^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName) || ae.isContentEditable)) return;
		for (const x of extensions) if (x.keydown && x.keydown(e)) return;
		if (e.ctrlKey || e.metaKey) {
			const key = e.key.toLowerCase();
			if (key === 'c' && !e.shiftKey && !e.altKey) {
				if (copyKeys()) e.preventDefault();
			} else if (key === 'v' && !e.shiftKey && !e.altKey) {
				if (pasteKeys()) e.preventDefault();
			} else if (key === 'z' && !e.shiftKey) {
				e.preventDefault();
				undo();
			} else if ((key === 'z' && e.shiftKey) || key === 'y') {
				e.preventDefault();
				redo();
			} else if (key === 'd' && selStripId) {
				e.preventDefault();
				duplicateStrip(selStripId);
			} else if (key === 's') {
				e.preventDefault(); // never let Ctrl+S save the PAGE
				host.save();
			}
			return;
		}
		// `,` / `.` step a frame (Shift: ten); Space plays / pauses where the host has a transport.
		const step = e.key === ',' || e.key === '<' ? -1 : e.key === '.' || e.key === '>' ? 1 : 0;
		if (step && doc && !e.altKey) {
			e.preventDefault();
			setTime(snapT(time) + (step * (e.shiftKey ? 10 : 1)) / (doc.fps || 30));
			positionPlayhead();
			return;
		}
		// A focused button keeps Space (it presses the button).
		if (e.key === ' ' && host.togglePlay && !e.altKey && !(ae && ae.tagName === 'BUTTON')) {
			e.preventDefault();
			host.togglePlay();
			return;
		}
		// Delete the selected keys (a visibility key or property keys), else the selected strip.
		if (e.key === 'Delete' || e.key === 'Backspace') {
			if (selVis) {
				e.preventDefault();
				deleteVisKey(selVis.actorId, selVis.time);
			} else if (selKey) {
				e.preventDefault();
				deleteSelectedKeys();
			} else if (selStripId) {
				e.preventDefault();
				deleteStrip(selStripId);
			}
		}
	}

	window.addEventListener('keydown', onKeyDown);
	if (el) el.addEventListener('pointerdown', dropVisSelection, true);

	return {
		doc: () => doc,
		setDoc(next) {
			doc = next;
		},
		time: () => time,
		setTime,
		/** Move the playhead WITHOUT posing the stage — for a host that poses on its own clock. */
		setTimeQuiet(t) {
			time = t;
		},
		setActive(on) {
			active = !!on;
		},
		destroy() {
			window.removeEventListener('keydown', onKeyDown);
			if (el) el.removeEventListener('pointerdown', dropVisSelection, true);
			active = false;
		},

		selectedStripId: () => selStripId,
		selectStrip(id) {
			selStripId = id;
		},
		clearSelection() {
			selStripId = null;
			selVis = null;
			selectKeys([]);
		},
		selectedKeys: () => selKeys.slice(),
		selectKeys(list) {
			selectKeys(list.slice());
		},
		setOnlySelected(on) {
			onlySelected = !!on;
			renderTimeline();
		},
		onlySelected: () => onlySelected,
		copyKeys,
		pasteKeys,
		deleteSelectedKeys,
		setSelectedEase,
		setDefaultEase,

		commit,
		historyReset,
		undo,
		redo,
		canUndo,
		canRedo,
		historyDepth: () => ({ index: history.index, size: history.stack.length, label: undoLabel() }),

		renderTimeline,
		renderInspector,
		positionPlayhead: () => positionPlayhead(),
		zoom,
		historyMarkup,
		cameraMarkup,
		cueMarkup,
		wirePanel,

		stripById,
		propertyTracksOf,
		visTracksOf,
		cameraTrack,
		cueTrack,
		effectiveVisible,
		effectivePlaceValue,
		cameraLive: () => cameraLive,

		deleteStrip,
		duplicateStrip,
		keyProperty,
		keyVisibility,
		addCue,
		deleteTextKey,
	};
}
