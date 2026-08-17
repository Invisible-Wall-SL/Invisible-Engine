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
		if (first) setActorClip(cast.actorId, first.name);
		save();
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
		save();
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
		save();
		renderPanel();
	}

	/**
	 * Phase 1's stand-in for strip authoring: one strip covering the whole cinematic, looping to
	 * fill. It is a REAL strip in the real schema — Phase 2's editor grows it in place rather
	 * than replacing a bespoke representation.
	 */
	function setActorClip(actorId, clipName) {
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
		save();
		renderPanel();
	}

	function setPlace(actorId, key, value) {
		const cast = castOf(actorId);
		if (!cast) return;
		cast.place[key] = value;
		save();
	}

	function setDuration(secs) {
		doc.duration = Math.max(0.1, Number(secs) || 0);
		// Phase 1's implicit full-length strips follow the cinematic's length.
		for (const track of doc.tracks) for (const strip of track.strips) if (strip.start === 0) strip.length = doc.duration;
		if (time > doc.duration) time = doc.duration;
		save();
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
<div class="cineStatus">${loadingCount ? 'loading rig…' : esc(statusMsg)}</div>
<div id="cineCast">${rows || '<div class="cineEmpty">No actors yet — pick a rig above and press ＋ Cast.</div>'}</div>
<div class="cineNote">Phase 1: cast, place and scrub. Tracks, strips, loops and layering land in Phase 2.</div>`;

		$('#cineAdd').onclick = () => {
			const id = $('#cineAddSel').value;
			const entry = rigs.find((e) => e.id === id);
			if (entry) addActor(entry);
		};
		$('#cineFit').onclick = fitAll;
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
						save();
						renderPanel();
					}
				};
			});
		});
	}

	const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

	// ---- lifecycle ----------------------------------------------------------

	async function init(bridge) {
		ctx = bridge;
		EV = await import('/shared/cinematicEval.mjs');
		doc = restore() || newDoc();
		await rebuildActors();
		renderPanel();
	}

	function activate() {
		renderPanel();
		// Rigs may have been added/removed (or the project switched) since we last rendered.
		rebuildActors();
	}

	function deactivate() {
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
	};
})();
