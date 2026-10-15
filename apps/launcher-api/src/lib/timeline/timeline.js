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
	let selKey = null; // { trackId, channel, time }
	let selCueTime = null; // the selected cue key, by time (cues are global, so time identifies one)
	let cinePps = null; // px per second; null = fit the whole cinematic to the panel width
	let tlDrag = null;
	let rulerDrag = false;
	let cameraLive = true;

	const castOf = (id) => doc.stage.cast.find((c) => c.actorId === id) || null;
	const isNodeActor = (id) => (castOf(id) || {}).kind === 'node';
	const propertyTracksOf = (actorId) =>
		doc.tracks.filter((t) => t.actorId === actorId && t.kind === 'property');
	const visTracksOf = (actorId) =>
		doc.tracks.filter((t) => t.actorId === actorId && t.kind === 'visibility');
	const cameraTrack = () => doc.tracks.find((t) => t.kind === 'camera') || null;
	const cueTrack = () => doc.tracks.find((t) => t.kind === 'cue') || null;

	const stripById = (id) => {
		for (const track of doc.tracks) {
			if (!hasStrips(track)) continue;
			const strip = track.strips.find((s) => s.id === id);
			if (strip) return { strip, track };
		}
		return null;
	};

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
		for (const cast of doc.stage.cast.slice().sort((a, b) => (a.z || 0) - (b.z || 0))) {
			emitSetBefore(cast.z || 0);
			const anim = doc.tracks
				.filter((t) => t.actorId === cast.actorId && t.kind === 'animation')
				.sort((a, b) => (a.layer || 0) - (b.layer || 0));
			anim.forEach((track, i) =>
				out.push({ kind: 'animation', cast, track, first: i === 0, count: anim.length }),
			);
			for (const track of visTracksOf(cast.actorId)) {
				if (track.keys.length) out.push({ kind: 'visibility', cast, track });
			}
			const chans = channelsOf(cast);
			for (const track of propertyTracksOf(cast.actorId)) {
				for (const chan of chans) {
					if (track.channels[chan.key]) out.push({ kind: 'channel', cast, track, chan });
				}
			}
		}
		emitSetBefore(Infinity); // in front of the whole cast (or the only row, with no cast yet)
		const cues = cueTrack();
		if (cues && cues.keys.length) out.push({ kind: 'cues', track: cues, cast: null });
		const cam = cameraTrack();
		if (cam) {
			for (const chan of CAM_CHANNELS) {
				if (cam.channels[chan.key])
					out.push({ kind: 'channel', cast: null, track: cam, chan, camera: true });
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
					dot.className = 'cineVisKey' + (k.visible === false ? ' off' : '');
					dot.style.left = (k.time * pps).toFixed(1) + 'px';
					dot.dataset.visTime = k.time;
					dot.title =
						(k.visible === false ? 'hidden' : 'visible') + ' from ' + +k.time.toFixed(3) + 's';
					l.appendChild(dot);
				}
				row.appendChild(l);
			},
			// Visibility keys: drag to retime, double-click to delete (there is nothing else to edit —
			// the VALUE is the marker shape, flipped from the panel toggle).
			wire(root, pps) {
				root.querySelectorAll('.cineVisRow .cineVisKey').forEach((dot) => {
					const actorId = dot.closest('.cineVisRow').dataset.actor;
					const keyTime = parseFloat(dot.dataset.visTime);
					dot.onpointerdown = (e) => {
						e.preventDefault();
						e.stopPropagation();
						tlDrag = {
							kind: 'vis',
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
						const track = visTracksOf(actorId)[0];
						const k = track && track.keys.find((x) => Math.abs(x.time - tlDrag.time) < 1e-6);
						if (!k) return;
						if (Math.abs(e.clientX - tlDrag.startX) > 2) tlDrag.moved = true;
						k.time = snapT(tlDrag.time + (e.clientX - tlDrag.startX) / tlDrag.pps, e.altKey);
						dot.style.left = (k.time * tlDrag.pps).toFixed(1) + 'px';
					};
					const endVis = () => {
						if (!tlDrag || tlDrag.kind !== 'vis' || tlDrag.el !== dot) return;
						const moved = tlDrag.moved;
						const track = visTracksOf(actorId)[0];
						if (track) track.keys.sort((a, b) => a.time - b.time);
						tlDrag = null;
						if (moved) commit('move visibility key', 'vis:' + actorId + ':' + keyTime);
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
							'</span>',
					),
				);
				const l = lane(contentW);
				for (const k of track.channels[entry.chan.key]) {
					const dot = document.createElement('span');
					const isSel =
						selKey &&
						selKey.trackId === track.id &&
						selKey.channel === entry.chan.key &&
						Math.abs(selKey.time - k.time) < 1e-6;
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
						(k.ease || 'linear') +
						')';
					l.appendChild(dot);
				}
				row.appendChild(l);
			},
			// Channel keys: click to select, drag to retime.
			wire(root, pps) {
				root.querySelectorAll('.cineChanRow .cineKey').forEach((dot) => {
					const row = dot.closest('.cineChanRow');
					const trackId = row.dataset.track;
					const channel = row.dataset.channel;
					dot.onpointerdown = (e) => {
						e.preventDefault();
						e.stopPropagation();
						const keyTime = parseFloat(dot.dataset.time);
						selKey = { trackId, channel, time: keyTime };
						tlDrag = {
							kind: 'key',
							trackId,
							channel,
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
						row.querySelectorAll('.cineKey.sel').forEach((n) => n.classList.remove('sel'));
						dot.classList.add('sel');
						render();
					};
					dot.onpointermove = (e) => {
						if (!tlDrag || tlDrag.kind !== 'key' || tlDrag.el !== dot) return;
						const track = doc.tracks.find((t) => t.id === trackId);
						const keys = track && track.channels[channel];
						if (!keys) return;
						const k = keys.find((x) => Math.abs(x.time - tlDrag.time) < 1e-6);
						if (!k) return;
						if (Math.abs(e.clientX - tlDrag.startX) > 2) tlDrag.moved = true;
						k.time = snapT(tlDrag.time + (e.clientX - tlDrag.startX) / tlDrag.pps, e.altKey);
						dot.style.left = (k.time * tlDrag.pps).toFixed(1) + 'px';
						host.evaluate(time);
					};
					const endKey = () => {
						if (!tlDrag || tlDrag.kind !== 'key' || tlDrag.el !== dot) return;
						const moved = tlDrag.moved;
						const track = doc.tracks.find((t) => t.id === trackId);
						const keys = track && track.channels[channel];
						if (keys) keys.sort((a, b) => a.time - b.time);
						if (moved) {
							const k =
								keys &&
								keys.find((x) => Math.abs(x.time - parseFloat(dot.style.left) / tlDrag.pps) < 0.01);
							selKey = { trackId, channel, time: k ? k.time : tlDrag.time };
						}
						tlDrag = null;
						if (moved) commit('move key', 'key:' + trackId + ':' + channel);
						renderTimeline();
						render();
					};
					dot.onpointerup = endKey;
					dot.onpointercancel = endKey;
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

	/** Cheap: moves one element — call it per frame, never re-render the timeline per frame. */
	function positionPlayhead(pps) {
		const ph = el && el.querySelector('#cinePlayhead');
		if (!ph) return;
		ph.style.left = TL_GUTTER + time * (pps || tlPps()) - el.scrollLeft + 'px';
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

	function addCue() {
		const track = ensureCueTrack();
		const at = snapT(time);
		track.keys.push({ time: at, cue: 'fx:' });
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
			track = { id: uid('prop'), actorId, kind: 'property', channels: {} };
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

	function deleteVisKey(actorId, keyTime) {
		const track = visTracksOf(actorId)[0];
		if (!track) return;
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
			ease,
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
		selKey = null;
		commit('delete key');
		render();
		renderTimeline();
	}

	function setKeyField(field, value) {
		if (!selKey) return;
		const track = doc.tracks.find((t) => t.id === selKey.trackId);
		const keys = track && track.channels[selKey.channel];
		if (!keys) return;
		const k = keys.find((x) => Math.abs(x.time - selKey.time) < 1e-6);
		if (!k) return;
		if (field === 'time') {
			k.time = Math.max(0, value);
			keys.sort((a, b) => a.time - b.time);
			selKey = Object.assign({}, selKey, { time: k.time });
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
		if (addCueBtn) addCueBtn.onclick = addCue;
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
		const cur = sel.cue || '';
		const known = fxEffects.some((e) => 'fx:' + e.id === cur);
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
		const kindOpts = CUE_KINDS.filter((k) => k.prefix !== 'fx:')
			.map((k) => `<option value="${k.prefix}">${k.label} — ${k.hint}</option>`)
			.join('');
		return `
<div class="cineHead" style="border-top:1px solid var(--line);"><b>⚡ Cue</b><small>${esc(cur || '(empty)')}</small></div>
<div class="cineStripInsp">
	<label class="wide">pick<select id="cineCuePick" title="Every FX effect in this project — picking one replaces this cue. The other kinds only seed their prefix, since their names live in the game.">
		<option value="">${head}</option>
		${fxOpts ? `<optgroup label="FX effects">${fxOpts}</optgroup>` : ''}
		<optgroup label="other kinds">${kindOpts}</optgroup>
	</select></label>
	<label class="wide">cue<input type="text" data-cueact="cue" value="${esc(cur)}" placeholder="fx:my_effect"></label>
	<label>time<input type="number" step="0.05" min="0" data-cueact="time" value="${+sel.time.toFixed(3)}"></label>
</div>
<div class="cineRow"><button id="cineDelCue" title="Delete this cue">🗑 Delete cue</button></div>
<div class="cineNote">${fxEffects.length ? 'Pick an FX effect from the list — it stays complete however the cue is already set — or type an <code>sfx:</code> / <code>music:</code> / <code>signal:</code> name the game knows.' : 'This project has no authored FX effects yet — author them in /fx, or type a sound or signal name.'} An <code>fx:</code> cue draws on the <b>⚡ fx</b> row in the timeline (it appears as soon as one <code>fx:</code> cue exists, and becomes the <b>🎬 set</b> row once a Scene is bound) — move that row with ▲▼ to put the effect in front of a rig.</div>`;
	}

	/** Inspector for a selected property/camera key — time, value and its outgoing interpolation. */
	function keyInspectorMarkup() {
		if (!selKey) return '';
		const track = doc.tracks.find((t) => t.id === selKey.trackId);
		const keys = track && track.channels[selKey.channel];
		const k = keys && keys.find((x) => Math.abs(x.time - selKey.time) < 1e-6);
		if (!k) return '';
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
		return `
<div class="cineHead" style="border-top:1px solid var(--line);"><b>Key</b><small>${esc(selKey.channel)}${track.kind === 'camera' ? ' (camera)' : ''}</small></div>
<div class="cineStripInsp">
	<label>time<input type="number" step="0.05" min="0" data-kact="time" value="${+k.time.toFixed(3)}"></label>
	<label>value${valueField}</label>
	<label class="wide">out<select data-kact="ease">
		${opt('linear', 'linear')}${opt('ease', 'ease in-out')}${opt('hold', 'hold (stepped)')}
	</select></label>
</div>
<div class="cineRow"><button id="cineDelKey" title="Delete this key">🗑 Delete key</button></div>`;
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
			'<div class="cineNote">Nothing selected. Click a strip, a keyframe diamond or a cue marker on the timeline.</div>';
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
		if (delKey)
			delKey.onclick = () => selKey && deleteKey(selKey.trackId, selKey.channel, selKey.time);
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
		if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
		for (const x of extensions) if (x.keydown && x.keydown(e)) return;
		if (e.ctrlKey || e.metaKey) {
			const key = e.key.toLowerCase();
			if (key === 'z' && !e.shiftKey) {
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
		// Delete the selected key, else the selected strip.
		if (e.key === 'Delete' || e.key === 'Backspace') {
			if (selKey) {
				e.preventDefault();
				deleteKey(selKey.trackId, selKey.channel, selKey.time);
			} else if (selStripId) {
				e.preventDefault();
				deleteStrip(selStripId);
			}
		}
	}

	window.addEventListener('keydown', onKeyDown);

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
			active = false;
		},

		selectedStripId: () => selStripId,
		selectStrip(id) {
			selStripId = id;
		},
		clearSelection() {
			selStripId = null;
			selKey = null;
		},

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
	};
}
