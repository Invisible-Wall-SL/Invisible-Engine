/**
 * Invisible Cinematic — the `/rigger` CINEMATIC MODE (Phase 1: set + cast).
 * Plan: docs/design/invisible-cinematic.md · State: docs/status/cinematic.md
 *
 * A cinematic is a non-linear SEQUENCER over several actors, not a bigger animation: the
 * animator edits one clip on one skeleton, this edits many rigs on one timeline. Phase 1
 * delivers the multi-actor stage — cast a rig, place it, give it a clip, scrub — and Phase 2
 * turns the single implicit strip each actor gets here into a real track/strip editor.
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
<div class="cineNote">Phase 1: cast, place and scrub. Tracks, strips, loops and layering land in Phase 2.</div>`;

		$('#cineAdd').onclick = () => {
			const id = $('#cineAddSel').value;
			const entry = rigs.find((e) => e.id === id);
			if (entry) addActor(entry);
		};
		$('#cineFit').onclick = fitAll;
		$('#cineUndo').onclick = undo;
		$('#cineRedo').onclick = redo;
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
		if (!active || !(e.ctrlKey || e.metaKey)) return;
		const ae = document.activeElement;
		if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
		const key = e.key.toLowerCase();
		if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
		else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo(); }
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
	}

	function activate() {
		active = true;
		renderPanel();
		// Rigs may have been added/removed (or the project switched) since we last rendered.
		rebuildActors();
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
		// history — exposed for the buttons, the keys, and live verification
		undo,
		redo,
		canUndo,
		canRedo,
		historyDepth: () => ({ index: history.index, size: history.stack.length, label: undoLabel() }),
	};
})();
