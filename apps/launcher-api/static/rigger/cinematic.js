/**
 * Invisible Cinematic — the `/rigger` CINEMATIC MODE (Phases 1–2).
 * Plan: docs/design/invisible-cinematic.md · State: docs/status/cinematic.md
 *
 * A cinematic is a non-linear SEQUENCER over several actors, not a bigger animation: the
 * animator edits one clip on one skeleton, this edits many rigs on one timeline.
 * Phase 1 = the multi-actor stage (cast a rig, place it, scrub). Phase 2 = the track/strip
 * editor (tracks + layers, strips you drag/trim/loop/blend, and a strip inspector).
 *
 * WHY A SEPARATE FILE: `view.html` is already ~9.5k lines. Everything cinematic lives here so
 * the rig editor's blast radius stays at four small hooks (a mode button, a `setMode` branch, a
 * `frame()` branch, and the lazy loader). This file NEVER touches the rig-editing document —
 * it only reads skeleton data — so no cinematic bug can corrupt a rig.
 *
 * DEPENDENCY DIRECTION: `view.html` injects everything through `init(bridge)`; this file
 * reaches into no globals of its own. The blend maths is NOT here — it is the single shared
 * `/shared/cinematicEval.mjs`, the same module the headless gates and (Phase 3) the in-game
 * `<Cinematic>` component use. Do not re-implement any of it locally.
 */
window.RiggerCinematic = (function () {
	'use strict';

	const LS_KEY = 'rigger.cinematic.v1';

	let ctx = null; // the bridge from view.html
	let EV = null; // /shared/cinematicEval.mjs
	let doc = null; // the CinematicDoc (design §4.2)
	let actors = []; // runtime instances, parallel to doc.stage.cast
	let selActorId = null;
	let time = 0;
	let loadingCount = 0;
	let statusMsg = '';

	const rigCache = new Map(); // rigId -> SkeletonData (shared across actors of the same rig)
	const $ = (sel) => document.querySelector(sel);

	// ---- document -----------------------------------------------------------

	function newDoc() {
		return {
			schemaVersion: 1,
			id: 'untitled',
			name: 'Untitled cinematic',
			duration: 6,
			fps: 30,
			stage: { sceneId: null, cast: [] },
			tracks: [],
			markers: [],
		};
	}

	const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 9);
	const castOf = (id) => doc.stage.cast.find((c) => c.actorId === id) || null;
	const tracksOf = (id) => doc.tracks.filter((t) => t.actorId === id);
	const actorOf = (id) => actors.find((a) => a.actorId === id) || null;

	function save() {
		try {
			localStorage.setItem(LS_KEY, JSON.stringify(doc));
		} catch {
			/* quota / private mode — the doc is still live in memory */
		}
	}

	function restore() {
		try {
			const raw = localStorage.getItem(LS_KEY);
			if (!raw) return null;
			const d = JSON.parse(raw);
			return d && d.stage && Array.isArray(d.stage.cast) ? d : null;
		} catch {
			return null;
		}
	}

	// ---- history (undo / redo) ----------------------------------------------
	//
	// SNAPSHOT-based, not command-based. A cinematic doc is a few KB of JSON, so storing whole
	// states costs almost nothing and is correct BY CONSTRUCTION: there is no per-operation undo
	// routine to write, forget, or get subtly wrong when a later phase adds an operation. A
	// command stack only starts paying off when the document is too big to copy — if that ever
	// happens (very long cinematics), this is the seam to change, and only this.
	//
	// This is `/rigger`'s FIRST undo of any kind — the rig editor still has none (see
	// docs/status/rigger.md). It is deliberately scoped to the cinematic document so it cannot
	// half-undo a rig edit, but it is written to be liftable: nothing in it knows what a cinematic
	// is beyond `serialize`/`applySnapshot`.

	const HISTORY_LIMIT = 100;
	const COALESCE_MS = 600;
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
	 * (Phase 2) dragging a strip, should undo as ONE action, not forty. Consecutive commits sharing
	 * a key within COALESCE_MS overwrite the top of the stack instead of pushing. Pass no key for
	 * discrete actions (cast, remove, reorder) so each is always its own step.
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
		save();
	}

	const canUndo = () => history.index > 0;
	const canRedo = () => history.index < history.stack.length - 1;

	async function applySnapshot(snap) {
		doc = JSON.parse(snap);
		// The cast may have gained or lost members: rebuild instances (existing ones are reused by
		// actorId, so this is cheap) and drop a selection that no longer exists.
		await rebuildActors();
		if (selActorId && !castOf(selActorId)) selActorId = doc.stage.cast.length ? doc.stage.cast[0].actorId : null;
		if (time > doc.duration) setTime(doc.duration);
		else evaluate(time);
		save();
		renderPanel();
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

	// ---- rig loading --------------------------------------------------------

	async function rigData(entry) {
		if (rigCache.has(entry.id)) return rigCache.get(entry.id);
		loadingCount++;
		renderPanel();
		try {
			const data = await ctx.loadRigData(entry);
			rigCache.set(entry.id, data);
			return data;
		} finally {
			loadingCount--;
			renderPanel();
		}
	}

	/** Build (or rebuild) the runtime instance for one cast member. */
	async function instantiate(cast) {
		const entry = ctx.listRigs().find((e) => e.id === cast.rigId);
		if (!entry) {
			statusMsg = `rig "${cast.rigName || cast.rigId}" is not in this project`;
			return null;
		}
		let data;
		try {
			data = await rigData(entry);
		} catch (e) {
			statusMsg = `could not load ${entry.name}: ${(e && e.message) || e}`;
			return null;
		}
		// One SkeletonData, one Skeleton PER ACTOR — casting the same rig twice must give two
		// independently posable instances (Unreal calls this a spawnable).
		const skeleton = new ctx.SPINE.Skeleton(data);
		if (data.skins.length) {
			const def = data.skins.find((s) => s.name === 'default') || data.skins[0];
			skeleton.setSkinByName(def.name);
		}
		skeleton.setToSetupPose();
		// `evalTarget` is what the evaluator receives, and it is ALSO what it hands back to
		// `resolveClip` — so it must carry `skeletonData`, not just the skeleton. Cached on the
		// actor rather than rebuilt per frame (its `tracks` are refreshed by `refreshTargets`).
		const actor = { actorId: cast.actorId, skeletonData: data, skeleton };
		actor.evalTarget = { actorId: cast.actorId, skeletonData: data, skeleton, tracks: [] };
		return actor;
	}

	/** Re-point every actor's eval target at its current tracks. Call after any doc edit. */
	function refreshTargets() {
		for (const actor of actors) actor.evalTarget.tracks = tracksOf(actor.actorId);
	}

	async function rebuildActors() {
		const built = [];
		for (const cast of doc.stage.cast) {
			const existing = actorOf(cast.actorId);
			built.push(existing || (await instantiate(cast)));
		}
		actors = built.filter(Boolean);
		refreshTargets();
		renderPanel();
	}

	// ---- evaluation ---------------------------------------------------------

	/**
	 * Resolve a strip's clip to a runtime `Animation`.
	 * `src: 'library'` (a linked `_shared/animations` clip) and `'local'` are Phase 2 — they
	 * return null, which the evaluator treats as "skip this strip". Deliberately silent per
	 * strip but surfaced once in the panel, so an unresolvable strip is visible, not mysterious.
	 */
	function resolveClip(strip, actor) {
		const c = strip.clip;
		if (!c) return null;
		if (c.src === 'rig') return actor.skeletonData.findAnimation(c.name) || null;
		return null;
	}

	function applyPlace(actor, place) {
		const sk = actor.skeleton;
		sk.x = place.x || 0;
		sk.y = place.y || 0;
		const s = place.scale == null ? 1 : place.scale;
		sk.scaleX = (place.flipX ? -1 : 1) * s;
		sk.scaleY = s;
		// Skeleton has no rotation field in 4.2 — rotate the root bone instead. AFTER the clip
		// posed it (so it composes with the animation) and BEFORE updateWorldTransform.
		if (place.rotation) {
			const root = sk.getRootBone();
			if (root) root.rotation += place.rotation;
		}
	}

	/** Pose every actor at cinematic time `t`. Pure in `t` — see the evaluator's header. */
	function evaluate(t) {
		if (!EV) return;
		const spineNs = ctx.SPINE;
		for (const actor of actors) {
			const cast = castOf(actor.actorId);
			if (!cast) continue;
			EV.evaluateActor(spineNs, actor.evalTarget, t, resolveClip);
			applyPlace(actor, cast.place);
			if (spineNs.Physics && spineNs.Physics.update !== undefined)
				actor.skeleton.updateWorldTransform(spineNs.Physics.update);
			else actor.skeleton.updateWorldTransform();
		}
	}

	// ---- frame --------------------------------------------------------------

	/**
	 * Called from `view.html`'s `frame()` INSTEAD of the single-skeleton block, so this owns
	 * the whole draw pass for the mode (its own renderer.begin/end).
	 */
	function frame(delta, playing) {
		if (playing && doc && doc.duration > 0) {
			time += delta * (ctx.playSpeed ? ctx.playSpeed() : 1);
			if (time >= doc.duration) time = ctx.looping && ctx.looping() ? time % doc.duration : doc.duration;
		}
		evaluate(time);

		const renderer = ctx.renderer();
		if (!renderer || !actors.length) return;
		renderer.begin();
		// Draw in z order: the cast list IS the z order (top of the list draws first / behind).
		const ordered = doc.stage.cast.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
		for (const cast of ordered) {
			const actor = actorOf(cast.actorId);
			if (actor && cast.visible !== false) renderer.drawSkeleton(actor.skeleton, ctx.pma());
		}
		renderer.end();
		syncTransport();
	}

	function syncTransport() {
		const dur = doc ? doc.duration : 0;
		const scrub = $('#scrub');
		if (scrub && document.activeElement !== scrub) scrub.value = dur > 0 ? Math.round((time / dur) * 1000) : 0;
		const readout = $('#time');
		if (readout) readout.textContent = time.toFixed(2) + 's / ' + dur.toFixed(2) + 's';
		const t = $('#cineTime');
		if (t && document.activeElement !== t) t.value = time.toFixed(2);
		positionPlayhead(); // cheap: move one element, never re-render the timeline per frame
	}

	// ---- camera -------------------------------------------------------------

	/** Frame every actor, not just one — the rigger's own fitView only knows the open rig. */
	function fitAll() {
		if (!actors.length) return;
		const off = new ctx.SPINE.Vector2();
		const size = new ctx.SPINE.Vector2();
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const actor of actors) {
			actor.skeleton.getBounds(off, size, []);
			if (!(size.x > 0 && size.y > 0)) continue;
			minX = Math.min(minX, off.x);
			minY = Math.min(minY, off.y);
			maxX = Math.max(maxX, off.x + size.x);
			maxY = Math.max(maxY, off.y + size.y);
		}
		if (!(maxX > minX && maxY > minY)) return;
		const cam = ctx.renderer().camera;
		const cv = $('#cv');
		cam.position.x = (minX + maxX) / 2;
		cam.position.y = (minY + maxY) / 2;
		cam.zoom = Math.max((maxX - minX) / cv.width, (maxY - minY) / cv.height) * 1.25;
		cam.update();
	}

	// ---- cast operations ----------------------------------------------------

	async function addActor(entry) {
		const cast = {
			actorId: uid('actor'),
			rigId: entry.id,
			rigName: entry.name,
			nodeId: null, // Phase 1 casts rigs directly; a Scene node binding lands with the set picker
			place: { x: 0, y: 0, scale: 1, rotation: 0, flipX: false },
			z: doc.stage.cast.length,
			visible: true,
		};
		doc.stage.cast.push(cast);
		doc.tracks.push({ id: uid('track'), actorId: cast.actorId, kind: 'animation', layer: 0, strips: [] });
		const actor = await instantiate(cast);
		if (!actor) {
			// Instantiation failed — don't leave a phantom in the cast.
			doc.stage.cast = doc.stage.cast.filter((c) => c !== cast);
			doc.tracks = doc.tracks.filter((t) => t.actorId !== cast.actorId);
			renderPanel();
			return;
		}
		actors.push(actor);
		refreshTargets();
		selActorId = cast.actorId;
		// Cast the rig's first clip by default so the actor is visibly alive on the timeline.
		const first = actor.skeletonData.animations[0];
		if (first) setActorClip(cast.actorId, first.name, false); // folded into the one step below
		commit('cast ' + (entry.name || 'rig'));
		renderPanel();
		renderTimeline();
		if (actors.length === 1) fitAll();
	}

	function removeActor(actorId) {
		doc.stage.cast = doc.stage.cast.filter((c) => c.actorId !== actorId);
		doc.tracks = doc.tracks.filter((t) => t.actorId !== actorId);
		actors = actors.filter((a) => a.actorId !== actorId);
		refreshTargets();
		if (selActorId === actorId) selActorId = doc.stage.cast.length ? doc.stage.cast[0].actorId : null;
		normalizeZ();
		commit('remove actor');
		renderPanel();
		renderTimeline();
	}

	function normalizeZ() {
		doc.stage.cast
			.slice()
			.sort((a, b) => (a.z || 0) - (b.z || 0))
			.forEach((c, i) => {
				c.z = i;
			});
	}

	function moveActor(actorId, dir) {
		const ordered = doc.stage.cast.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
		const i = ordered.findIndex((c) => c.actorId === actorId);
		const j = i + dir;
		if (i < 0 || j < 0 || j >= ordered.length) return;
		const z = ordered[i].z;
		ordered[i].z = ordered[j].z;
		ordered[j].z = z;
		normalizeZ();
		commit('reorder actor');
		renderPanel();
		renderTimeline();
	}

	/**
	 * Phase 1's stand-in for strip authoring: one strip covering the whole cinematic, looping to
	 * fill. It is a REAL strip in the real schema — Phase 2's editor grows it in place rather
	 * than replacing a bespoke representation.
	 */
	function setActorClip(actorId, clipName, record = true) {
		const track = tracksOf(actorId)[0];
		if (!track) return;
		track.strips = clipName
			? [
					{
						id: uid('strip'),
						clip: { src: 'rig', name: clipName },
						start: 0,
						length: doc.duration,
						clipIn: 0,
						speed: 1,
						loop: { mode: 'fill' },
						alpha: 1,
						blend: 'replace',
					},
				]
			: [];
		if (record) commit('change clip');
		renderPanel();
		if (record) renderTimeline();
	}

	function setPlace(actorId, key, value) {
		const cast = castOf(actorId);
		if (!cast) return;
		cast.place[key] = value;
		// Coalesced per actor+field: a run of typing (and, in Phase 2, a drag) is ONE undo step.
		commit('move actor', 'place:' + actorId + ':' + key);
	}

	function setDuration(secs) {
		doc.duration = Math.max(0.1, Number(secs) || 0);
		// Phase 1's implicit full-length strips follow the cinematic's length.
		for (const track of doc.tracks) for (const strip of track.strips) if (strip.start === 0) strip.length = doc.duration;
		if (time > doc.duration) time = doc.duration;
		commit('change length', 'duration');
		renderPanel();
		renderTimeline();
	}

	// ---- timeline (Phase 2: tracks + strips) --------------------------------
	//
	// DOM rows, not a canvas — same shape as the rigger's dopesheet (sticky gutter on the left, a
	// lane scrolled at `pps` pixels per second), so hit-testing is free and the two timelines look
	// like one tool. A strip is a div; moving/trimming it writes the doc LIVE (so the stage follows
	// the drag) but records a SINGLE history step on pointerup.

	const TL_GUTTER = 132;
	const TL_ROW = 28;
	const TRIM_ZONE = 7; // px at each end of a strip that trims instead of moves

	let selStripId = null;
	let cinePps = null; // px per second; null = fit the whole cinematic to the panel width
	let tlDrag = null;
	let rulerDrag = false;

	const stripById = (id) => {
		for (const track of doc.tracks) {
			const strip = track.strips.find((s) => s.id === id);
			if (strip) return { strip, track };
		}
		return null;
	};

	/** Snap to the fps grid unless Alt is held (the usual "hold to place freely" escape). */
	function snapT(t, noSnap) {
		if (noSnap || !doc.fps) return Math.max(0, t);
		return Math.max(0, Math.round(t * doc.fps) / doc.fps);
	}

	function tlPps(el) {
		if (cinePps) return cinePps;
		const w = (el ? el.clientWidth : 900) - TL_GUTTER - 12;
		return Math.max(4, w / Math.max(doc.duration, 0.001));
	}

	function zoom(factor) {
		const el = $('#timeline');
		cinePps = Math.max(4, Math.min(4000, tlPps(el) * factor));
		renderTimeline();
	}

	/** Tracks grouped by cast order, so the timeline reads in the same order as the cast list. */
	function orderedTracks() {
		const out = [];
		for (const cast of doc.stage.cast.slice().sort((a, b) => (a.z || 0) - (b.z || 0))) {
			const mine = doc.tracks.filter((t) => t.actorId === cast.actorId).sort((a, b) => (a.layer || 0) - (b.layer || 0));
			mine.forEach((track, i) => out.push({ cast, track, first: i === 0, count: mine.length }));
		}
		return out;
	}

	function renderTimeline() {
		const el = $('#timeline');
		if (!el || !doc) return;
		const keepScroll = el.scrollLeft;
		const pps = tlPps(el);
		const contentW = Math.max(doc.duration * pps, 1);
		el.innerHTML = '';

		const rows = orderedTracks();
		if (!rows.length) {
			el.innerHTML = '<div class="cineEmpty">Cast an actor to start building the timeline.</div>';
			return;
		}

		// ruler — click or drag anywhere on it to scrub
		const ruler = document.createElement('div');
		ruler.className = 'cineRuler';
		ruler.style.width = TL_GUTTER + contentW + 'px';
		const step = tickStep(pps);
		let ticks = '<div class="cineGutter cineRulerGutter">' + doc.fps + ' fps · ' + doc.duration.toFixed(2) + 's</div>';
		ticks += '<div class="cineLane" style="width:' + contentW + 'px;">';
		for (let t = 0; t <= doc.duration + 1e-6; t += step) {
			ticks += '<span class="cineTick" style="left:' + (t * pps).toFixed(1) + 'px;">' + (+t.toFixed(3)) + 's</span>';
		}
		ticks += '</div>';
		ruler.innerHTML = ticks;
		ruler.onpointerdown = (e) => {
			if (e.target.closest('.cineGutter')) return;
			rulerDrag = true;
			try { ruler.setPointerCapture(e.pointerId); } catch { /* scrub still works uncaptured */ }
			scrubFromEvent(e, pps);
		};
		ruler.onpointermove = (e) => { if (rulerDrag) scrubFromEvent(e, pps); };
		ruler.onpointerup = () => { rulerDrag = false; };
		el.appendChild(ruler);

		for (const { cast, track, first, count } of rows) {
			const row = document.createElement('div');
			row.className = 'cineTrack';
			row.style.width = TL_GUTTER + contentW + 'px';
			row.dataset.track = track.id;

			const gutter = document.createElement('div');
			gutter.className = 'cineGutter';
			gutter.innerHTML =
				'<span class="cineTrackName" title="' + esc(cast.rigName || '') + '">' +
				(first ? esc(cast.rigName || cast.rigId) : '<i>layer ' + (track.layer || 0) + '</i>') +
				'</span>' +
				'<button data-tact="addStrip" title="Add a strip at the playhead">＋</button>' +
				'<button data-tact="addLayer" title="Add a layer above this actor (layers blend bottom-up)">⧉</button>' +
				(count > 1 ? '<button data-tact="delLayer" title="Delete this layer">🗑</button>' : '');
			row.appendChild(gutter);

			const lane = document.createElement('div');
			lane.className = 'cineLane';
			lane.style.width = contentW + 'px';
			for (const strip of track.strips.slice().sort((a, b) => a.start - b.start)) {
				const d = document.createElement('div');
				d.className = 'cineStrip' + (strip.id === selStripId ? ' sel' : '') + (strip.blend === 'add' ? ' add' : '');
				d.style.left = (strip.start * pps).toFixed(1) + 'px';
				d.style.width = Math.max(strip.length * pps, 3).toFixed(1) + 'px';
				d.dataset.strip = strip.id;
				const loop = strip.loop && strip.loop.mode !== 'once' ? ' ↻' : '';
				d.innerHTML =
					'<span class="cineStripLabel">' + esc(strip.clip ? strip.clip.name : '—') + loop + '</span>' +
					blendRampMarkup(strip, pps);
				lane.appendChild(d);
			}
			row.appendChild(lane);
			el.appendChild(row);
		}

		// playhead — one element over everything, repositioned per frame by syncTransport()
		const ph = document.createElement('div');
		ph.className = 'cinePlayhead';
		ph.id = 'cinePlayhead';
		el.appendChild(ph);
		positionPlayhead(pps);

		el.scrollLeft = keepScroll;
		wireTimeline(el, pps);
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
		if (strip.blendIn > 0) out += '<span class="cineRamp in" style="width:' + Math.min(strip.blendIn * pps, strip.length * pps).toFixed(1) + 'px;"></span>';
		if (strip.blendOut > 0) out += '<span class="cineRamp out" style="width:' + Math.min(strip.blendOut * pps, strip.length * pps).toFixed(1) + 'px;"></span>';
		return out;
	}

	function scrubFromEvent(e, pps) {
		const lane = $('#timeline').querySelector('.cineRuler .cineLane');
		if (!lane) return;
		const x = e.clientX - lane.getBoundingClientRect().left;
		setTime(x / pps);
		positionPlayhead(pps);
	}

	function positionPlayhead(pps) {
		const ph = $('#cinePlayhead');
		const el = $('#timeline');
		if (!ph || !el) return;
		ph.style.left = TL_GUTTER + time * (pps || tlPps(el)) - el.scrollLeft + 'px';
	}

	function wireTimeline(el, pps) {
		el.onscroll = () => positionPlayhead(pps);

		el.querySelectorAll('.cineGutter [data-tact]').forEach((btn) => {
			btn.onclick = (e) => {
				e.stopPropagation();
				const trackId = btn.closest('.cineTrack').dataset.track;
				const act = btn.dataset.tact;
				if (act === 'addStrip') addStripAtPlayhead(trackId);
				else if (act === 'addLayer') addLayer(trackId);
				else if (act === 'delLayer') removeLayer(trackId);
			};
		});

		el.querySelectorAll('.cineStrip').forEach((d) => {
			d.onpointerdown = (e) => {
				e.preventDefault();
				const found = stripById(d.dataset.strip);
				if (!found) return;
				selStripId = d.dataset.strip;
				const rect = d.getBoundingClientRect();
				const offX = e.clientX - rect.left;
				const zone = offX <= TRIM_ZONE ? 'trimL' : offX >= rect.width - TRIM_ZONE ? 'trimR' : 'move';
				tlDrag = {
					id: d.dataset.strip, zone, el: d, pps,
					startX: e.clientX,
					origStart: found.strip.start,
					origLength: found.strip.length,
					origClipIn: found.strip.clipIn || 0,
					moved: false,
				};
				// Capture is an optimisation (the drag keeps tracking outside the element), never a
				// requirement — and it THROWS for a pointer id the browser does not know. Losing it
				// must not abort the gesture.
				try { d.setPointerCapture(e.pointerId); } catch { /* drag still works uncaptured */ }
				// Update the selection IN PLACE. Re-rendering the timeline here would replace `d`
				// mid-gesture, dropping the pointer capture and killing the drag before it starts.
				el.querySelectorAll('.cineStrip.sel').forEach((n) => n.classList.remove('sel'));
				d.classList.add('sel');
				renderPanel(); // a different element — safe to rebuild
			};
			d.onpointermove = (e) => {
				if (!tlDrag || tlDrag.id !== d.dataset.strip) return;
				const found = stripById(tlDrag.id);
				if (!found) return;
				const dT = (e.clientX - tlDrag.startX) / tlDrag.pps;
				if (Math.abs(e.clientX - tlDrag.startX) > 2) tlDrag.moved = true;
				const s = found.strip;
				if (tlDrag.zone === 'move') {
					s.start = snapT(tlDrag.origStart + dT, e.altKey);
				} else if (tlDrag.zone === 'trimL') {
					// Trimming the left edge moves the start AND the clip offset together, so the art
					// under the cursor stays put instead of sliding — the standard NLE behaviour.
					const ns = Math.min(snapT(tlDrag.origStart + dT, e.altKey), tlDrag.origStart + tlDrag.origLength - 1 / (doc.fps || 30));
					const delta = ns - tlDrag.origStart;
					s.start = ns;
					s.length = Math.max(tlDrag.origLength - delta, 1 / (doc.fps || 30));
					s.clipIn = Math.max(0, tlDrag.origClipIn + delta * (s.speed || 1));
				} else {
					s.length = Math.max(snapT(tlDrag.origLength + dT, e.altKey), 1 / (doc.fps || 30));
				}
				// Restyle only the dragged element — a full re-render per pointermove is jank.
				d.style.left = (s.start * tlDrag.pps).toFixed(1) + 'px';
				d.style.width = Math.max(s.length * tlDrag.pps, 3).toFixed(1) + 'px';
				evaluate(time);
			};
			const end = () => {
				if (!tlDrag || tlDrag.id !== d.dataset.strip) return;
				const label = tlDrag.zone === 'move' ? 'move strip' : 'trim strip';
				const moved = tlDrag.moved;
				tlDrag = null;
				if (moved) commit(label, 'strip:' + d.dataset.strip); // ONE step per drag
				renderTimeline();
				renderPanel();
			};
			d.onpointerup = end;
			d.onpointercancel = end;
		});
	}

	// ---- strip + layer operations -------------------------------------------

	function defaultClipName(actorId) {
		const actor = actorOf(actorId);
		const first = actor && actor.skeletonData.animations[0];
		return first ? first.name : null;
	}

	function addStripAtPlayhead(trackId) {
		const track = doc.tracks.find((t) => t.id === trackId);
		if (!track) return;
		const name = defaultClipName(track.actorId);
		if (!name) return;
		const actor = actorOf(track.actorId);
		const clip = actor.skeletonData.findAnimation(name);
		const strip = {
			id: uid('strip'),
			clip: { src: 'rig', name },
			start: snapT(time),
			length: Math.max(clip ? clip.duration : 1, 1 / (doc.fps || 30)),
			clipIn: 0,
			speed: 1,
			loop: { mode: 'once' },
			alpha: 1,
			blend: 'replace',
			blendIn: 0,
			blendOut: 0,
		};
		track.strips.push(strip);
		selStripId = strip.id;
		commit('add strip');
		renderTimeline();
		renderPanel();
	}

	function deleteStrip(stripId) {
		const found = stripById(stripId);
		if (!found) return;
		found.track.strips = found.track.strips.filter((s) => s.id !== stripId);
		if (selStripId === stripId) selStripId = null;
		commit('delete strip');
		renderTimeline();
		renderPanel();
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
		renderPanel();
	}

	function setStripField(stripId, path, value) {
		const found = stripById(stripId);
		if (!found) return;
		const s = found.strip;
		if (path === 'clip') s.clip = value ? { src: 'rig', name: value } : null;
		else if (path === 'loop.mode') s.loop = { mode: value, n: (s.loop && s.loop.n) || 2 };
		else if (path === 'loop.n') s.loop = { mode: (s.loop && s.loop.mode) || 'count', n: Math.max(1, value) };
		else s[path] = value;
		commit('edit strip', 'strip:' + stripId + ':' + path);
		renderTimeline();
		renderPanel();
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
		refreshTargets();
		commit('add layer');
		renderTimeline();
	}

	function removeLayer(trackId) {
		const track = doc.tracks.find((t) => t.id === trackId);
		if (!track) return;
		if (doc.tracks.filter((t) => t.actorId === track.actorId).length <= 1) return; // never leave an actor track-less
		doc.tracks = doc.tracks.filter((t) => t.id !== trackId);
		if (selStripId && !stripById(selStripId)) selStripId = null;
		refreshTargets();
		commit('remove layer');
		renderTimeline();
		renderPanel();
	}

	// ---- panel --------------------------------------------------------------

	function renderPanel() {
		const panel = $('#cinePanel');
		if (!panel || !doc) return;
		const ordered = doc.stage.cast.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
		const rigs = ctx.listRigs();

		const rows = ordered
			.map((cast) => {
				const actor = actorOf(cast.actorId);
				const clips = actor ? actor.skeletonData.animations : [];
				const strip = (tracksOf(cast.actorId)[0] || { strips: [] }).strips[0];
				const cur = strip && strip.clip ? strip.clip.name : '';
				const sel = cast.actorId === selActorId;
				const opts = ['<option value="">— no clip —</option>']
					.concat(clips.map((a) => `<option value="${esc(a.name)}"${a.name === cur ? ' selected' : ''}>${esc(a.name)} (${a.duration.toFixed(2)}s)</option>`))
					.join('');
				const p = cast.place;
				return `<div class="cineActor${sel ? ' sel' : ''}" data-actor="${cast.actorId}">
	<div class="cineActorHead">
		<button class="cineVis" data-act="vis" title="Show / hide this actor on stage">${cast.visible === false ? '○' : '●'}</button>
		<b>${esc(cast.rigName || cast.rigId)}</b>
		<span class="cineZ" title="Draw order — lower draws first (behind)">z${cast.z}</span>
		<button data-act="up" title="Move behind">▲</button>
		<button data-act="down" title="Move in front">▼</button>
		<button data-act="del" title="Remove from the cast">🗑</button>
	</div>
	<select data-act="clip" title="Which of this rig's animations plays">${opts}</select>
	<div class="cinePlace">
		<label>x<input type="number" step="1" data-act="x" value="${p.x}"></label>
		<label>y<input type="number" step="1" data-act="y" value="${p.y}"></label>
		<label>scale<input type="number" step="0.05" data-act="scale" value="${p.scale}"></label>
		<label>rot<input type="number" step="1" data-act="rotation" value="${p.rotation}"></label>
		<label class="cineFlip">flip<input type="checkbox" data-act="flipX"${p.flipX ? ' checked' : ''}></label>
	</div>
</div>`;
			})
			.join('');

		const rigOpts = rigs.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
		panel.innerHTML = `
<div class="cineHead"><b>🎬 Cinematic</b><small>${esc(doc.name)}</small></div>
<div class="cineRow">
	<label>Length <input type="number" id="cineDur" min="0.1" step="0.5" value="${doc.duration}"> s</label>
	<label>Time <input type="number" id="cineTime" step="0.05" value="${time.toFixed(2)}"> s</label>
</div>
<div class="cineRow">
	<select id="cineAddSel" title="Pick a rig from this project to cast">${rigOpts || '<option value="">no rigs in this project</option>'}</select>
	<button id="cineAdd" title="Cast this rig as a new actor on the stage">＋ Cast</button>
	<button id="cineFit" title="Frame every actor">⤢ Fit</button>
</div>
<div class="cineRow">
	<button id="cineUndo" title="${canUndo() ? 'Undo ' + esc(undoLabel()) + ' (Ctrl+Z)' : 'Nothing to undo'}"${canUndo() ? '' : ' disabled'}>↶ Undo</button>
	<button id="cineRedo" title="${canRedo() ? 'Redo ' + esc(redoLabel()) + ' (Ctrl+Shift+Z)' : 'Nothing to redo'}"${canRedo() ? '' : ' disabled'}>↷ Redo</button>
	<span class="cineZ">${canUndo() ? esc(undoLabel()) : ''}</span>
</div>
<div class="cineStatus">${loadingCount ? 'loading rig…' : esc(statusMsg)}</div>
<div id="cineCast">${rows || '<div class="cineEmpty">No actors yet — pick a rig above and press ＋ Cast.</div>'}</div>
${stripInspectorMarkup()}
<div class="cineNote">Drag a strip to move it · drag its edges to trim · hold Alt to ignore the fps grid · Ctrl+wheel over the timeline to zoom.</div>`;

		$('#cineAdd').onclick = () => {
			const id = $('#cineAddSel').value;
			const entry = rigs.find((e) => e.id === id);
			if (entry) addActor(entry);
		};
		$('#cineFit').onclick = fitAll;
		$('#cineUndo').onclick = undo;
		$('#cineRedo').onclick = redo;
		wireStripInspector();
		$('#cineDur').onchange = (e) => setDuration(e.target.value);
		$('#cineTime').onchange = (e) => setTime(parseFloat(e.target.value) || 0);

		panel.querySelectorAll('.cineActor').forEach((el) => {
			const actorId = el.dataset.actor;
			el.onclick = (e) => {
				if (e.target.closest('button,select,input,label')) return;
				selActorId = actorId;
				renderPanel();
			};
			el.querySelectorAll('[data-act]').forEach((node) => {
				const act = node.dataset.act;
				if (act === 'clip') {
					node.onchange = (e) => setActorClip(actorId, e.target.value);
					return;
				}
				if (node.tagName === 'INPUT' && node.type === 'number') {
					node.onchange = (e) => setPlace(actorId, act, parseFloat(e.target.value) || 0);
					return;
				}
				if (node.tagName === 'INPUT' && node.type === 'checkbox') {
					node.onchange = (e) => setPlace(actorId, act, e.target.checked);
					return;
				}
				node.onclick = () => {
					if (act === 'del') removeActor(actorId);
					else if (act === 'up') moveActor(actorId, -1);
					else if (act === 'down') moveActor(actorId, 1);
					else if (act === 'vis') {
						const cast = castOf(actorId);
						if (cast) cast.visible = cast.visible === false;
						commit('toggle visibility');
						renderPanel();
					}
				};
			});
		});
	}

	/** Inspector for the selected strip — every field the evaluator actually reads (design §4.2). */
	function stripInspectorMarkup() {
		if (!selStripId) return '';
		const found = stripById(selStripId);
		if (!found) return '';
		const s = found.strip;
		const actor = actorOf(found.track.actorId);
		const clips = actor ? actor.skeletonData.animations : [];
		const cur = s.clip ? s.clip.name : '';
		const clipOpts = clips
			.map((a) => `<option value="${esc(a.name)}"${a.name === cur ? ' selected' : ''}>${esc(a.name)} (${a.duration.toFixed(2)}s)</option>`)
			.join('');
		const loopMode = (s.loop && s.loop.mode) || 'once';
		const loopOpt = (v, label) => `<option value="${v}"${loopMode === v ? ' selected' : ''}>${label}</option>`;
		const blend = s.blend || 'replace';
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
<div class="cineRow">
	<button id="cineDupStrip" title="Copy this strip in right after itself">⧉ Duplicate</button>
	<button id="cineDelStrip" title="Delete this strip">🗑 Delete</button>
</div>`;
	}

	function wireStripInspector() {
		const dup = $('#cineDupStrip');
		if (dup) dup.onclick = () => duplicateStrip(selStripId);
		const del = $('#cineDelStrip');
		if (del) del.onclick = () => deleteStrip(selStripId);
		document.querySelectorAll('[data-sact]').forEach((node) => {
			const path = node.dataset.sact;
			node.onchange = (e) => {
				const v = node.tagName === 'SELECT' ? e.target.value : parseFloat(e.target.value);
				setStripField(selStripId, path, node.tagName === 'SELECT' ? v : (Number.isFinite(v) ? v : 0));
			};
		});
	}

	const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

	// ---- lifecycle ----------------------------------------------------------

	let active = false;

	/**
	 * Undo/redo keys. Scoped three ways so they can never reach past this mode:
	 *  - only while cinematic mode is active,
	 *  - never while focus is in a field (the browser's own text undo must win there),
	 *  - `preventDefault` only when we actually handle it.
	 * `/rigger` binds no other Ctrl chord today, and its two global key handlers already gate on
	 * `editMode`/`animMode`, so nothing else fires here.
	 */
	function onKeyDown(e) {
		if (!active) return;
		const ae = document.activeElement;
		if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
		if (e.ctrlKey || e.metaKey) {
			const key = e.key.toLowerCase();
			if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
			else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo(); }
			else if (key === 'd' && selStripId) { e.preventDefault(); duplicateStrip(selStripId); }
			return;
		}
		// Delete the selected strip. The rigger's own Delete handler gates on `animMode`, so it is
		// inert here and the two cannot both fire.
		if ((e.key === 'Delete' || e.key === 'Backspace') && selStripId) {
			e.preventDefault();
			deleteStrip(selStripId);
		}
	}

	async function init(bridge) {
		ctx = bridge;
		EV = await import('/shared/cinematicEval.mjs');
		doc = restore() || newDoc();
		historyReset();
		await rebuildActors();
		window.addEventListener('keydown', onKeyDown);
		active = true;
		renderPanel();
		// `setMode` already ran its own renderTimeline() BEFORE this module finished loading (the
		// script is lazy), so that call found no RiggerCinematic and drew nothing. Render here too,
		// or the timeline is empty on first entry until some other edit happens to refresh it.
		renderTimeline();
	}

	function activate() {
		active = true;
		renderPanel();
		renderTimeline();
		// Rigs may have been added/removed (or the project switched) since we last rendered.
		rebuildActors().then(renderTimeline);
	}

	function deactivate() {
		active = false;
		save();
	}

	function setTime(t) {
		if (!doc) return;
		time = Math.max(0, Math.min(doc.duration, t));
		evaluate(time);
		syncTransport();
	}

	return {
		init,
		activate,
		deactivate,
		frame,
		setTime,
		getTime: () => time,
		duration: () => (doc ? doc.duration : 0),
		hasActors: () => actors.length > 0,
		renderPanel,
		renderTimeline,
		zoom,
		deleteSelectedStrip: () => { if (selStripId) deleteStrip(selStripId); },
		hasSelectedStrip: () => !!selStripId,
		// history — exposed for the buttons, the keys, and live verification
		undo,
		redo,
		canUndo,
		canRedo,
		historyDepth: () => ({ index: history.index, size: history.stack.length, label: undoLabel() }),
	};
})();
