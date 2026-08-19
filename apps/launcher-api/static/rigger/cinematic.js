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
	// TWEAK MODE (design §4.4): { stripId, actorId, clip } while the animator is open on one strip.
	// The rig editor holds the matching half (`tweakMode`/`tweak` in view.html); this side owns the
	// clock and the strip→clip-local mapping, because only the sequencer knows either.
	let tweak = null;
	let loadingCount = 0;
	let statusMsg = '';

	const rigCache = new Map(); // rig FOLDER -> SkeletonData (shared across actors of the same rig)
	const $ = (sel) => document.querySelector(sel);

	// ---- document -----------------------------------------------------------

	function newDoc() {
		return {
			schemaVersion: 1,
			id: 'untitled',
			name: 'Untitled cinematic',
			duration: 6,
			fps: 30,
			stage: { sceneId: null, ratio: null, cast: [], setZ: -1 },
			tracks: [],
			markers: [],
		};
	}

	const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 9);
	const castOf = (id) => doc.stage.cast.find((c) => c.actorId === id) || null;
	const tracksOf = (id) => doc.tracks.filter((t) => t.actorId === id);
	const actorOf = (id) => actors.find((a) => a.actorId === id) || null;

	/**
	 * Local draft only. R2 is the source of truth (see `saveToR2`); this is a crash/reload buffer
	 * so a browser refresh mid-session does not lose unsaved work. It is written on every commit,
	 * which is why it must stay cheap and must never be treated as "saved".
	 */
	/** Write the crash/reload draft WITHOUT touching the dirty flag. */
	function writeDraft() {
		try {
			localStorage.setItem(LS_KEY, JSON.stringify({ doc, etag: r2Etag, savedAt: r2SavedAt }));
		} catch {
			/* quota / private mode — the doc is still live in memory */
		}
	}

	function save() {
		writeDraft();
		dirty = true;
		updateSaveState();
	}

	function restore() {
		try {
			const raw = localStorage.getItem(LS_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			// Tolerate the pre-R2 draft shape (a bare doc) as well as the current `{doc, etag}`.
			const d = parsed && parsed.doc ? parsed.doc : parsed;
			if (!d || !d.stage || !Array.isArray(d.stage.cast)) return null;
			if (parsed && parsed.doc) {
				r2Etag = parsed.etag ?? null;
				r2SavedAt = parsed.savedAt ?? null;
			}
			return d;
		} catch {
			return null;
		}
	}

	// ---- R2 persistence -----------------------------------------------------
	//
	// The `.icin` lives at `<client>/<project>/cinematics/<id>.json`. Saves are CONDITIONAL on the
	// etag we loaded (`docs/design/multi-user-concurrency.md` Phase 1) so two authors cannot
	// silently overwrite each other — a stale etag comes back 409 and we ask rather than clobber.

	let r2Etag = null; // etag of the last load/save; null = "no such object yet" (create)
	let r2SavedAt = null;
	let dirty = false;
	let cinematicList = [];
	let busy = false;

	const api = async (path, opts) => {
		const res = await fetch(path, opts);
		const text = await res.text();
		let body = null;
		try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
		return { ok: res.ok, status: res.status, body, text };
	};

	/**
	 * The project's authored FX effects, for the cue picker. Without this an author has to KNOW
	 * the effect ids by heart — the datalist offered prefixes but no actual values, which is the
	 * "I can't select any file from the database" gap. Best-effort: the picker still accepts free
	 * text, so a project with no effects (or a failed list) degrades to typing, never to a block.
	 */
	/**
	 * The project's Scenes, for the SET PICKER (design §12.3). A cinematic stages OVER a Scene:
	 * the Scene owns WHAT is on stage (sprites, text, FX, and their per-ratio placement, authored
	 * in /editor); the cinematic owns WHEN things happen. Binding one is what will let a cinematic
	 * carry text and FX without inventing a second placement model.
	 */
	let scenes = [];
	let mainSizes = {}; // bucket id -> { width, height }: the RESOLVED game canvas boxes
	let layoutSource = ''; // which layer they came from: project override / admin global / default
	async function refreshScenes() {
		const r = await api('/api/editor/scenes');
		scenes = r.ok && r.body && Array.isArray(r.body.scenes) ? r.body.scenes : [];
		mainSizes = (r.ok && r.body && r.body.mainSizesMap) || {};
		layoutSource = (r.ok && r.body && r.body.layoutProfileSource) || '';
		// The fetch is not awaited — the picker must fill in when it lands, and so must the SET
		// row in the timeline, which names the scene (it showed the raw id until this landed).
		if (doc) {
			renderPanel();
			renderTimeline();
		}
		return scenes;
	}

	let fxEffects = [];
	async function refreshEffects() {
		const r = await api('/api/editor/effects');
		fxEffects = r.ok && r.body && Array.isArray(r.body.effects) ? r.body.effects : [];
		if (doc) renderPanel(); // same: the cue picker must fill in when the list arrives
		return fxEffects;
	}

	async function refreshList() {
		const r = await api('/api/cinematics/list');
		cinematicList = r.ok && r.body ? r.body.cinematics || [] : [];
		return cinematicList;
	}

	/**
	 * Save to R2. Returns true on success. On a 409 the author is asked whether to overwrite —
	 * never done silently, because the other side of a conflict is somebody else's work.
	 */
	async function saveToR2(force) {
		if (busy) return false;
		busy = true;
		statusMsg = 'saving…';
		renderPanel();
		try {
			const payload = { doc, projectKey: ctx.projectKey ? ctx.projectKey() : undefined };
			// `force` omits baseEtag entirely — that unconditional write IS the point of force.
			if (force) payload.force = true;
			else payload.baseEtag = r2Etag;

			const r = await api('/api/cinematics/save', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
			});

			if (r.status === 409 && r.body) {
				statusMsg = '';
				renderPanel();
				const overwrite = window.confirm(r.body.message + '\n\nOverwrite with your version?');
				// A scope mismatch is NEVER force-able — that would write into another project.
				if (overwrite && r.body.error === 'conflict') { busy = false; return saveToR2(true); }
				return false;
			}
			if (!r.ok || !r.body || !r.body.ok) {
				// Surface the REAL reason, in the tool's red error bar, not a thin status line: an author
				// who clicks Save and sees the doc still marked unsaved has no way to tell a permission
				// error from a validation one from the endpoint being absent. Include the raw body when
				// the response was not JSON (a SvelteKit error page), which is exactly the case where the
				// friendly message is missing.
				const detail = (r.body && (r.body.message || r.body.error)) || (r.text || '').slice(0, 300) || 'no response body';
				statusMsg = 'save failed (' + r.status + ')';
				console.error('[Cinematic] save failed', r.status, r.text);
				if (ctx.showError) ctx.showError('Cinematic save failed (HTTP ' + r.status + '): ' + detail);
				return false;
			}
			if (ctx.clearError) ctx.clearError();
			r2Etag = r.body.etag ?? null;
			r2SavedAt = r.body.updatedAt || new Date().toISOString();
			dirty = false;
			statusMsg = '';
			try { localStorage.setItem(LS_KEY, JSON.stringify({ doc, etag: r2Etag, savedAt: r2SavedAt })); } catch { /* draft only */ }
			await refreshList();
			return true;
		} finally {
			busy = false;
			updateSaveState();
			renderPanel();
		}
	}

	async function openFromR2(id) {
		if (dirty && !window.confirm('You have unsaved changes. Open a different cinematic anyway?')) return;
		busy = true;
		statusMsg = 'loading…';
		renderPanel();
		try {
			const r = await api('/api/cinematics/get?id=' + encodeURIComponent(id));
			if (!r.ok || !r.body || !r.body.doc) {
				const detail = (r.body && (r.body.message || r.body.error)) || (r.text || '').slice(0, 300);
				statusMsg = 'could not open "' + id + '"';
				console.error('[Cinematic] open failed', r.status, r.text);
				if (ctx.showError) ctx.showError('Could not open "' + id + '" (HTTP ' + r.status + ')' + (r.body && r.body.malformed ? ' — the stored file is corrupt.' : ': ' + detail));
				return;
			}
			doc = r.body.doc;
			r2Etag = r.body.etag ?? null;
			r2SavedAt = null;
			dirty = false;
			selStripId = null;
			selKey = null;
			selActorId = doc.stage.cast.length ? doc.stage.cast[0].actorId : null;
			time = 0;
			historyReset(); // a freshly-opened doc has nothing behind it to undo to
			statusMsg = '';
			writeDraft();
			await rebuildActors();
			renderPanel();
			renderTimeline();
			fitAll();
		} finally {
			busy = false;
			updateSaveState();
			renderPanel();
		}
	}

	async function newCinematic() {
		if (dirty && !window.confirm('You have unsaved changes. Start a new cinematic anyway?')) return;
		const name = (window.prompt('Name for the new cinematic', 'Untitled cinematic') || '').trim();
		if (!name) return;
		doc = newDoc();
		doc.name = name;
		doc.id = slugify(name);
		r2Etag = null; // nothing stored yet → the save creates with ifNoneMatch:'*'
		r2SavedAt = null;
		dirty = false;
		selStripId = null;
		selKey = null;
		selActorId = null;
		time = 0;
		actors = [];
		historyReset();
		writeDraft();
		renderPanel();
		renderTimeline();
	}

	/**
	 * Delete the open cinematic from the project.
	 *
	 * The old guard bailed SILENTLY when the doc was not in `cinematicList` — so pressing 🗑 on a
	 * never-saved cinematic (or one whose list had not been refreshed) did nothing at all, with no
	 * message. A button that can decline must SAY it declined. It also no longer requires the list
	 * to contain the doc: the list is a cache, and being stale is not a reason to refuse a delete
	 * the server can perfectly well decide on.
	 */
	async function deleteCurrent() {
		if (!doc) return;
		const stored = cinematicList.some((c) => c.id === doc.id) || !!r2Etag || !!r2SavedAt;
		if (!stored) {
			statusMsg = 'nothing to delete — this cinematic has never been saved';
			renderPanel();
			return;
		}
		if (!window.confirm('Delete "' + doc.name + '" from this project? This cannot be undone.')) return;
		const r = await api('/api/cinematics/delete', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: doc.id }),
		});
		if (!r.ok) {
			const detail = (r.body && (r.body.message || r.body.error)) || (r.text || '').slice(0, 300);
			console.error('[Cinematic] delete failed', r.status, r.text);
			if (ctx.showError) ctx.showError('Could not delete "' + doc.name + '" (HTTP ' + r.status + '): ' + detail);
			return;
		}
		await refreshList();
		newCinematic0();
	}

	/** A blank doc with no prompt — used after a delete, where asking for a name is noise. */
	function newCinematic0() {
		doc = newDoc();
		r2Etag = null;
		r2SavedAt = null;
		dirty = false;
		actors = [];
		selStripId = null;
		selKey = null;
		historyReset();
		writeDraft();
		renderPanel();
		renderTimeline();
	}

	const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 60) || 'untitled';

	/** Reflect saved/unsaved in the header without rebuilding the whole panel every commit. */
	function updateSaveState() {
		const el = $('#cineSaveState');
		if (!el) return;
		el.textContent = busy ? '…' : dirty ? '● unsaved' : r2SavedAt || r2Etag ? '✓ saved' : 'not saved yet';
		el.className = 'cineSaveState' + (dirty ? ' dirty' : '');
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
		const cacheKey = entry.folder || String(entry.id);
		if (rigCache.has(cacheKey)) return rigCache.get(cacheKey);
		loadingCount++;
		renderPanel();
		try {
			const data = await ctx.loadRigData(entry);
			rigCache.set(cacheKey, data);
			return data;
		} finally {
			loadingCount--;
			renderPanel();
		}
	}

	/**
	 * Resolve a cast member to a rig entry.
	 *
	 * Keyed on `rigFolder`, NOT on the index `id`: `SkeletonIndexEntry.id` is a CONTIGUOUS ARRAY
	 * POSITION reassigned on every scan (`spineIndex.ts` ends with `combined.map((e, id) => …)`),
	 * so adding or renaming any rig renumbers all of them and a stored id would silently re-point
	 * a saved cinematic at a DIFFERENT rig. The folder is the stable identity — and it is also the
	 * spine BUNDLE NAME the game registers, which is what lets the export ship the right rig.
	 *
	 * The `rigId` fallback migrates cinematics saved before this fix; it is a best-effort match
	 * (a positional id only means anything against the list that produced it).
	 */
	function rigEntryFor(cast) {
		const rigs = ctx.listRigs();
		if (cast.rigFolder) return rigs.find((e) => e.folder === cast.rigFolder) || null;
		const legacy = rigs.find((e) => e.id === cast.rigId) || null;
		if (legacy && legacy.folder) cast.rigFolder = legacy.folder; // heal the doc on first load
		return legacy;
	}

	/** Build (or rebuild) the runtime instance for one cast member. */
	async function instantiate(cast) {
		const entry = rigEntryFor(cast);
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
		// `setToSetupPose` does NOT reset skeleton.color, so alpha has to be written every frame
		// or a once-faded actor stays faded forever.
		sk.color.a = place.alpha == null ? 1 : place.alpha;
		// Skeleton has no rotation field in 4.2 — rotate the root bone instead. AFTER the clip
		// posed it (so it composes with the animation) and BEFORE updateWorldTransform.
		if (place.rotation) {
			const root = sk.getRootBone();
			if (root) root.rotation += place.rotation;
		}
	}

	const propertyTracksOf = (actorId) => doc.tracks.filter((t) => t.actorId === actorId && t.kind === 'property');
	const visTracksOf = (actorId) => doc.tracks.filter((t) => t.actorId === actorId && t.kind === 'visibility');
	const cameraTrack = () => doc.tracks.find((t) => t.kind === 'camera') || null;

	/** Pose every actor at cinematic time `t`. Pure in `t` — see the evaluator's header. */
	function evaluate(t) {
		if (!EV) return;
		const spineNs = ctx.SPINE;
		for (const actor of actors) {
			const cast = castOf(actor.actorId);
			if (!cast) continue;
			// The tweaked actor is posed by the ANIMATOR, not by its strips — that is what makes an
			// in-progress edit visible on the stage instead of being overwritten every frame.
			if (tweak && actor.actorId === tweak.actorId) continue;
			EV.evaluateActor(spineNs, actor.evalTarget, t, resolveClip);
			applyPlace(actor, EV.resolvePlace(cast.place, propertyTracksOf(actor.actorId), t));
			if (spineNs.Physics && spineNs.Physics.update !== undefined)
				actor.skeleton.updateWorldTransform(spineNs.Physics.update);
			else actor.skeleton.updateWorldTransform();
		}
		applyCamera(t);
	}

	/**
	 * Drive the stage camera from the camera track.
	 *
	 * Only when it actually has keys AND `cameraLive` is on — an author needs to pan/zoom freely
	 * while building a shot, and a camera track that seized the view every frame would make the
	 * stage impossible to navigate. `cameraLive` is session UI state, deliberately NOT in the doc.
	 */
	function applyCamera(t) {
		if (!cameraLive) return;
		const track = cameraTrack();
		if (!track) return;
		const v = EV.sampleTrack(track, t);
		const cam = ctx.renderer() && ctx.renderer().camera;
		if (!cam) return;
		let touched = false;
		if (v.x !== undefined) { cam.position.x = v.x; touched = true; }
		if (v.y !== undefined) { cam.position.y = v.y; touched = true; }
		if (v.zoom !== undefined) { cam.zoom = Math.max(0.01, v.zoom); touched = true; }
		if (touched) cam.update();
	}

	/**
	 * Fire the cues crossed since the last frame, in the EDITOR preview.
	 *
	 * `cuesCrossed` owns the "did we actually cross it" rule — it refuses to fire when time went
	 * backwards or jumped further than a frame, which is what makes scrubbing silent. So this never
	 * needs its own seek detection, and the editor and the game share one definition of "fired".
	 *
	 * The preview only ROUTES what it can: an `fx:` cue drives the stage FX overlay the Rigger
	 * already vendors. `sfx:`/`music:`/`signal:` name things that live in the GAME, so there is
	 * nothing honest to play here — they surface in the status line instead of silently doing
	 * nothing, so an author can see the cue fired.
	 */
	function fireCuesBetween(prev, next) {
		const track = cueTrack();
		if (!track || !EV) return;
		const crossed = EV.cuesCrossed(track.keys, prev, next);
		for (const k of crossed) {
			const cue = String(k.cue || '');
			if (cue.startsWith('fx:') && ctx.fireFx) ctx.fireFx(cue.slice(3));
			else if (cue) {
				statusMsg = '⚡ ' + cue;
				renderPanel();
			}
		}
	}

	// ---- frame --------------------------------------------------------------

	/**
	 * Called from `view.html`'s `frame()` INSTEAD of the single-skeleton block, so this owns
	 * the whole draw pass for the mode (its own renderer.begin/end).
	 */
	function frame(delta, playing) {
		const prevTime = time;
		if (playing && doc && doc.duration > 0) {
			time += delta * (ctx.playSpeed ? ctx.playSpeed() : 1);
			if (time >= doc.duration) time = ctx.looping && ctx.looping() ? time % doc.duration : doc.duration;
		}
		if (playing) fireCuesBetween(prevTime, time);
		evaluate(time);

		// TWEAK: the open rig is posed by the ANIMATOR at the strip's clip-local time — after
		// `evaluate` (which skips this actor) and before anything is drawn, so an in-progress edit is
		// what the stage shows, with no re-parse per frame.
		const tw = tweak ? tweakSample() : null;
		if (tw) ctx.tweakPose(tw.local, tw.place, delta);

		const renderer = ctx.renderer();
		if (!renderer) return;
		// NOTE: no `actors.length` bail — the screen frame must draw on an EMPTY stage too, which
		// is precisely when an author is deciding where things go.
		renderer.begin();
		// Draw in z order: the cast list IS the z order (top of the list draws first / behind).
		const ordered = doc.stage.cast.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
		for (const cast of ordered) {
			// The tweaked actor draws from the animator's live skeleton, AT ITS PLACE IN THE Z ORDER
			// — the point of tweaking is to see the edit sandwiched in the real shot. It ignores the
			// visibility track while tweaking: a hidden rig would leave its bones and gizmo floating
			// over nothing, which reads as a bug rather than as "this actor is off screen here".
			if (tw && cast.actorId === tweak.actorId) { ctx.tweakDraw(renderer); continue; }
			const actor = actorOf(cast.actorId);
			if (actor && effectiveVisible(cast.actorId)) renderer.drawSkeleton(actor.skeleton, ctx.pma());
		}
		drawScreenFrame(renderer);
		if (tw) ctx.tweakOverlays(); // bones / gizmo / mesh — on top of the whole stage
		renderer.end();
		syncTransport();
		if (tw) ctx.tweakAfter(time, tw.outside);
	}

	// ---- tweak mode (design §4.4) -------------------------------------------
	//
	// Double-click a strip and the animator opens on THAT clip, in cinematic context. This side owns
	// the clock and the time mapping; `view.html` owns the rig document, the pose and the keys (see
	// its `beginTweak` block for the full split). Entering touches the cinematic doc not at all, so a
	// tweak can never corrupt the sequence — it edits the RIG.

	/** Where the tweaked actor is — clip-local time + stage placement — at the cinematic playhead. */
	function tweakSample() {
		const found = stripById(tweak.stripId);
		const cast = castOf(tweak.actorId);
		const place = cast ? EV.resolvePlace(cast.place, propertyTracksOf(tweak.actorId), time) : null;
		if (!found) return { local: 0, place, outside: true };
		const strip = found.strip;
		const outside = time < strip.start - 1e-6 || time > strip.start + strip.length + 1e-6;
		const r = EV.clipLocalTime(strip, time, tweakClipDur());
		return { local: r ? r.local : strip.clipIn || 0, place, outside };
	}

	/**
	 * The clip's WORKING length from the animator, not the parsed duration the actor was built with:
	 * the working length is how far past the last key the animator lets you scrub, so mapping against
	 * it is what makes a NEW last key reachable from inside a tweak.
	 */
	const tweakClipDur = () => (ctx.tweakClipDuration ? ctx.tweakClipDuration() : 0) || 0;

	/** The animator moved its playhead — pull the whole stage to the matching cinematic time. */
	function seekFromLocal(local) {
		if (!tweak) return;
		const found = stripById(tweak.stripId);
		if (!found) return;
		// The inverse mapping is the evaluator's, NOT ours — re-deriving the trim/speed/loop maths
		// here is exactly the drift the shared module exists to prevent.
		setTime(EV.cineTimeForLocal(found.strip, local, tweakClipDur(), time));
	}

	/**
	 * Author a BRAND-NEW override: create an empty animation on the actor's rig, point this strip at
	 * it, and drop straight into the animator.
	 *
	 * This is the step the workflow was missing. An override has to live in a clip, and nothing in
	 * the cinematic could make one — the only route was to leave for ◆ Animate, create an animation
	 * there, come back, and find it in the strip's dropdown. Three mode switches to express "I want
	 * to animate something here", which is why the mask editor read as a dead end (owner: "what am I
	 * supposed to do once I add a bone? I can't edit any bone anywhere, and I can't keyframe it").
	 *
	 * The clip lands on the RIG, so it is the rig that must be saved — the tweak bar says so.
	 */
	async function newClipForStrip(stripId) {
		if (tweak) return;
		const found = stripById(stripId);
		if (!found) return;
		const cast = castOf(found.track.actorId);
		const entry = cast && rigEntryFor(cast);
		if (!entry) return fail('the rig this actor casts is not in this project');
		const suggested = window.prompt('Name the new clip (it is created on the rig “' + entry.name + '”)', 'override');
		if (suggested === null) return; // cancelled — do NOT open the rig behind their back
		const err = await ctx.openRigForTweak(entry);
		if (err) return fail(err);
		const name = ctx.createClip(suggested);
		if (!name) return fail('could not create a clip on that rig (binary .skel rigs are view-only)');
		found.strip.clip = { src: 'rig', name };
		commit('new clip', 'newclip:' + stripId);
		await enterTweak(stripId);
	}

	// ---- mask, from inside a tweak ------------------------------------------
	//
	// The strip inspector is hidden while tweaking, and tweaking is the ONLY place the bones are
	// visible and clickable — so the mask has to be reachable from the tweak bar too, or picking
	// bones means hunting a 73-entry dropdown for something you cannot see.

	/** The expanded mask of the strip being tweaked — what `drawBonesOverlay` tints. */
	function tweakMaskNames() {
		if (!tweak || !EV) return null;
		const found = stripById(tweak.stripId);
		const mask = found && maskOf(found.strip);
		if (!mask || !mask.bones.length) return null;
		const actor = actorOf(tweak.actorId);
		if (!actor) return null;
		return EV.expandBoneMask(actor.skeleton, mask);
	}

	function tweakMaskInfo() {
		if (!tweak) return null;
		const actor = actorOf(tweak.actorId);
		const names = tweakMaskNames();
		return {
			count: names ? names.size : 0,
			total: actor ? actor.skeletonData.bones.length : 0,
			keyed: !!(ctx.keyedBoneNames && ctx.keyedBoneNames().length),
		};
	}

	function tweakMaskAddSelected() {
		if (!tweak) return;
		const name = ctx.selectedBoneName && ctx.selectedBoneName();
		if (name) addMaskBone(tweak.stripId, name);
	}

	/**
	 * Mask to exactly the bones this clip keys — the one-click end of the override workflow: pose
	 * the part you want, key it, then say "only that". `includeChildren` is OFF here on purpose:
	 * the keyed set is already the literal answer, and expanding it would silently take over bones
	 * the author deliberately left to the layer below.
	 */
	function tweakMaskFromKeyed() {
		if (!tweak || !ctx.keyedBoneNames) return;
		const bones = ctx.keyedBoneNames();
		if (!bones.length) return;
		setMask(tweak.stripId, { bones, includeChildren: false }, 'mask to keyed bones');
	}

	function tweakMaskClear() {
		if (tweak) setMask(tweak.stripId, null, 'clear mask');
	}

	async function enterTweak(stripId) {
		if (tweak) return;
		const found = stripById(stripId);
		if (!found) return;
		const { strip, track } = found;
		const clip = strip.clip && strip.clip.src === 'rig' ? strip.clip.name : null;
		if (!clip) return fail('that strip has no rig clip to tweak');
		const cast = castOf(track.actorId);
		const entry = cast && rigEntryFor(cast);
		if (!entry) return fail('the rig this actor casts is not in this project');
		statusMsg = '✎ opening ' + entry.name + '…';
		renderPanel();
		// Opening the rig REPLACES whatever rig the editor had open (and asks first if it was
		// unsaved) — that is the one side effect of tweaking, and it belongs to the rig editor.
		const err = await ctx.openRigForTweak(entry);
		if (err) return fail(err);
		const layers = tracksOf(cast.actorId).filter((t) => t.kind === 'animation').length;
		const label = (cast.rigName || entry.name || '') + (layers > 1 ? ' · layer ' + (track.layer || 0) : '');
		const bad = ctx.beginTweak({ actorId: cast.actorId, clip, label, stripId });
		if (bad) return fail(bad);
		tweak = { stripId, actorId: cast.actorId, clip };
		selStripId = stripId;
		statusMsg = '';
		// Park the playhead inside the strip: opening the animator on a stage where this clip is not
		// even playing shows an author their edit having no effect.
		setTime(time < strip.start || time > strip.start + strip.length ? strip.start : time);
	}

	function fail(msg) {
		statusMsg = '✎ ' + msg;
		renderPanel();
	}

	/**
	 * Back to the sequencer. The rig editor re-parses its document and hands back the fresh
	 * `SkeletonData`, which replaces the cached one — WITHOUT this the strips keep playing the
	 * pre-tweak clip, because the actors were built from the FILE, which a tweak has not touched.
	 * Every actor cast from that rig is rebuilt, since the same rig can be cast more than once.
	 */
	function exitTweak() {
		if (!tweak) return;
		const info = tweak;
		tweak = null;
		const data = ctx.endTweak ? ctx.endTweak() : null;
		const cast = castOf(info.actorId);
		const key = cast && (cast.rigFolder || String(cast.rigId));
		if (data && key) {
			rigCache.set(key, data);
			const stale = doc.stage.cast.filter((c) => (c.rigFolder || String(c.rigId)) === key).map((c) => c.actorId);
			actors = actors.filter((a) => !stale.includes(a.actorId));
			rebuildActors().then(() => {
				evaluate(time);
				renderTimeline();
				renderPanel();
			});
			return;
		}
		evaluate(time);
		renderTimeline();
		renderPanel();
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
		syncPlaceFields();
	}

	/**
	 * Keep the actor's numeric fields showing the value AT THE PLAYHEAD for animated channels —
	 * otherwise scrubbing leaves them displaying whatever they said when the panel was last built,
	 * which reads as "the field is broken". Skips the focused field so it never fights typing.
	 */
	function syncPlaceFields() {
		if (!doc) return;
		document.querySelectorAll('.cineActor').forEach((row) => {
			const actorId = row.dataset.actor;
			const track = propertyTracksOf(actorId)[0];
			if (!track) return;
			for (const chan of PROP_CHANNELS) {
				if (!track.channels[chan.key]) continue;
				const input = row.querySelector('[data-act="' + chan.key + '"]');
				if (!input || document.activeElement === input) continue;
				const v = +effectivePlaceValue(actorId, chan.key).toFixed(3);
				if (parseFloat(input.value) !== v) input.value = v;
			}
		});
	}

	/**
	 * The game-screen box to compose against, in world units, centred on the origin.
	 *
	 * A cinematic is framed for the SCREEN, not for a rig — an actor that reads perfectly on an
	 * unbounded stage can sit half off-canvas in the game. This draws the same box the Scene
	 * Editor composes in (the project's authored `mainSizesMap` for the chosen layout), so what
	 * you frame here is what the player sees. Origin = screen centre, which is also where a
	 * freshly cast actor lands.
	 */
	function screenBox() {
		const key = doc && doc.stage && doc.stage.ratio;
		if (!key) return null;
		const box = mainSizes[key];
		if (!box || !(box.width > 0) || !(box.height > 0)) return null;
		return { w: box.width, h: box.height };
	}

	/** Outline the screen box + its centre cross. Drawn INSIDE the actors' begin/end batch. */
	function drawScreenFrame(renderer) {
		const box = screenBox();
		if (!box || typeof renderer.line !== 'function' || !ctx.SPINE.Color) return;
		const hw = box.w / 2;
		const hh = box.h / 2;
		const col = new ctx.SPINE.Color(0.36, 0.69, 1, 0.75); // the tool accent, so it reads as a guide
		renderer.line(-hw, -hh, hw, -hh, col);
		renderer.line(hw, -hh, hw, hh, col);
		renderer.line(hw, hh, -hw, hh, col);
		renderer.line(-hw, hh, -hw, -hh, col);
		// Centre cross — the anchor a newly cast actor sits on, so placement reads at a glance.
		const tick = Math.min(hw, hh) * 0.04;
		const faint = new ctx.SPINE.Color(0.36, 0.69, 1, 0.35);
		renderer.line(-tick, 0, tick, 0, faint);
		renderer.line(0, -tick, 0, tick, faint);
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
			// The FOLDER is the identity (see `rigEntryFor`) and doubles as the spine bundle name
			// the ship chain needs. `rigId` is kept only so an older client can still read the doc.
			rigFolder: entry.folder || String(entry.id),
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

	/**
	 * The SET's depth on the same z line as the cast: the set draws above every actor whose z is
	 * ≤ `setZ`. `-1` (the default, and what every pre-2026-08-18 doc means by an absent field) is
	 * "behind the whole cast" — the hardcoded position it used to have — and `cast.length - 1` is
	 * in front of everything. This is what makes `fx:` cues layerable: a cue fires an FX node that
	 * lives IN the set, so the set's depth IS the cue's depth.
	 */
	const stageSetZ = () => (doc.stage.setZ == null ? -1 : doc.stage.setZ);
	/** True when the set is above every actor — the only band the rigs-in-one-canvas preview can show. */
	const setInFront = () => stageSetZ() >= doc.stage.cast.length - 1;

	function moveSet(dir) {
		const next = Math.max(-1, Math.min(doc.stage.cast.length - 1, stageSetZ() + dir));
		if (next === stageSetZ()) return;
		doc.stage.setZ = next;
		commit('reorder set');
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
		for (const track of doc.tracks) if (hasStrips(track)) for (const strip of track.strips) if (strip.start === 0) strip.length = doc.duration;
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

	/** Only ANIMATION tracks carry `strips`; property / visibility / camera / cue tracks carry keys. */
	const hasStrips = (track) => Array.isArray(track.strips);

	const stripById = (id) => {
		for (const track of doc.tracks) {
			if (!hasStrips(track)) continue;
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

	/**
	 * Rows in cast order: each actor's animation layers, then its property channels; the camera
	 * track last, so global rows sit at the bottom where a sequencer usually puts them.
	 */
	function orderedTracks() {
		const out = [];
		// The SET is a layer among the actors, not a fixed backdrop. Its row is emitted where its
		// z puts it, so the timeline reads top-to-bottom as back-to-front exactly like the cast
		// rows already do (▲ = move behind, the cast list's own wording).
		const wantSet = !!doc.stage.sceneId;
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
			anim.forEach((track, i) => out.push({ kind: 'animation', cast, track, first: i === 0, count: anim.length }));
			for (const track of visTracksOf(cast.actorId)) {
				if (track.keys.length) out.push({ kind: 'visibility', cast, track });
			}
			for (const track of propertyTracksOf(cast.actorId)) {
				for (const chan of PROP_CHANNELS) {
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
				if (cam.channels[chan.key]) out.push({ kind: 'channel', cast: null, track: cam, chan, camera: true });
			}
		}
		return out;
	}

	function renderTimeline() {
		// While tweaking, `#timeline` holds the rig editor's DOPESHEET — that is what an author keys
		// in. Rebuilding the strip timeline over it would wipe the dopesheet mid-edit.
		if (tweak) return;
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

		for (const entry of rows) {
			const { cast, track, first, count } = entry;
			const row = document.createElement('div');
			row.className = 'cineTrack';
			row.style.width = TL_GUTTER + contentW + 'px';
			if (track) row.dataset.track = track.id; // the SET row is a layer, not a track — it has none

			// A CHANNEL row: keys as diamonds, coloured per channel. Its own shape, not a lane of
			// strips — property/camera animation is keyframes, not clips.
			// A VISIBILITY row: stepped on/off. A filled marker means "on screen from here", hollow
			// means "hidden from here" — the shape carries the state, so the row reads without a legend.
			if (entry.kind === 'visibility') {
				row.classList.add('cineChanRow', 'cineVisRow');
				row.dataset.actor = entry.cast.actorId;
				const g = document.createElement('div');
				g.className = 'cineGutter';
				g.innerHTML = '<span class="cineTrackName cineChanName">↳ visible</span>';
				row.appendChild(g);
				const lane = document.createElement('div');
				lane.className = 'cineLane';
				lane.style.width = contentW + 'px';
				for (const k of entry.track.keys) {
					const dot = document.createElement('span');
					dot.className = 'cineVisKey' + (k.visible === false ? ' off' : '');
					dot.style.left = (k.time * pps).toFixed(1) + 'px';
					dot.dataset.visTime = k.time;
					dot.title = (k.visible === false ? 'hidden' : 'visible') + ' from ' + (+k.time.toFixed(3)) + 's';
					lane.appendChild(dot);
				}
				row.appendChild(lane);
				el.appendChild(row);
				continue;
			}

			// The SET row: the bound Scene as a LAYER. It holds the sprites, text and FX nodes, so it
			// is also where an `fx:` cue's effect draws — moving this row is how a cue gets in front
			// of a rig. No keys: a set has no timing of its own, only a depth.
			if (entry.kind === 'set') {
				row.classList.add('cineChanRow', 'cineSetRow');
				const sc = scenes.find((s) => s.id === doc.stage.sceneId);
				const g = document.createElement('div');
				g.className = 'cineGutter';
				g.innerHTML =
					'<span class="cineTrackName cineChanName" title="The bound set draws here — everything in it, including an fx: cue\'s effect">🎬 set</span>' +
					'<button data-setz="-1" title="Move behind"' + (stageSetZ() <= -1 ? ' disabled' : '') + '>▲</button>' +
					'<button data-setz="1" title="Move in front"' + (setInFront() ? ' disabled' : '') + '>▼</button>';
				row.appendChild(g);
				const lane = document.createElement('div');
				lane.className = 'cineLane';
				lane.style.width = contentW + 'px';
				const where = doc.stage.cast.length
					? stageSetZ() < 0
						? 'behind every rig'
						: setInFront()
							? 'in front of every rig'
							: 'in front of ' + (stageSetZ() + 1) + ' of ' + doc.stage.cast.length + ' rigs'
					: 'no rigs cast yet';
				lane.innerHTML =
					'<span class="cineSetNote">' + esc((sc && (sc.name || sc.id)) || doc.stage.sceneId) +
					' — sprites, text and FX · ' + where + '</span>';
				row.appendChild(lane);
				el.appendChild(row);
				continue;
			}

			// A CUE row: one marker per cue, coloured by namespace. Global (not per-actor) — a cue is a
			// moment in the cinematic, not something an actor owns.
			if (entry.kind === 'cues') {
				row.classList.add('cineChanRow', 'cineCueRow');
				const g = document.createElement('div');
				g.className = 'cineGutter';
				g.innerHTML = '<span class="cineTrackName cineChanName">⚡ cues</span>';
				row.appendChild(g);
				const lane = document.createElement('div');
				lane.className = 'cineLane';
				lane.style.width = contentW + 'px';
				for (const k of entry.track.keys) {
					const dot = document.createElement('span');
					const isSel = selCueTime !== null && Math.abs(selCueTime - k.time) < 1e-6;
					dot.className = 'cineCue' + (isSel ? ' sel' : '');
					dot.style.left = (k.time * pps).toFixed(1) + 'px';
					dot.style.color = isSel ? '#ffd24a' : cueColor(k.cue);
					dot.dataset.cueTime = k.time;
					dot.title = (k.cue || '(empty)') + ' @ ' + (+k.time.toFixed(3)) + 's';
					lane.appendChild(dot);
				}
				row.appendChild(lane);
				el.appendChild(row);
				continue;
			}

			if (entry.kind === 'channel') {
				row.classList.add('cineChanRow');
				row.dataset.channel = entry.chan.key;
				const g = document.createElement('div');
				g.className = 'cineGutter';
				g.innerHTML =
					'<span class="cineTrackName cineChanName" style="color:' + entry.chan.color + ';">' +
					(entry.camera ? '🎥 ' : '↳ ') + esc(entry.chan.label) + '</span>';
				row.appendChild(g);
				const lane = document.createElement('div');
				lane.className = 'cineLane';
				lane.style.width = contentW + 'px';
				for (const k of track.channels[entry.chan.key]) {
					const dot = document.createElement('span');
					const isSel = selKey && selKey.trackId === track.id && selKey.channel === entry.chan.key && Math.abs(selKey.time - k.time) < 1e-6;
					dot.className = 'cineKey' + (isSel ? ' sel' : '') + (k.ease === 'hold' ? ' hold' : '');
					dot.style.left = (k.time * pps).toFixed(1) + 'px';
					dot.style.background = isSel ? '#ffd24a' : entry.chan.color;
					dot.dataset.time = k.time;
					dot.title = entry.chan.label + ' = ' + (+k.value.toFixed(3)) + ' @ ' + (+k.time.toFixed(3)) + 's (' + (k.ease || 'linear') + ')';
					lane.appendChild(dot);
				}
				row.appendChild(lane);
				el.appendChild(row);
				continue;
			}

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
				// A masked strip poses only part of the skeleton — invisible on the stage if the masked
				// bones happen to be still, so the strip has to say so itself.
				const masked = maskOf(strip) && maskOf(strip).bones.length ? ' ◑' : '';
				d.innerHTML =
					'<span class="cineStripLabel">' + esc(strip.clip ? strip.clip.name : '—') + loop + masked + '</span>' +
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
		// The preview draws every rig into ONE raw-WebGL canvas while FX is Pixi in a second one, so
		// an `fx:` cue can only be shown as a BAND — above the whole cast or below it — never
		// sandwiched between two rigs. The game honours the true z; this keeps the preview from
		// contradicting it in the two cases it can actually represent.
		if (ctx.setFxDepth) ctx.setFxDepth(setInFront());
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

		// Double-click a strip = tweak its clip (design §4.4). Bound on the CONTAINER, not on each
		// strip: the pointerup that ends a click re-renders the timeline, so the second click of the
		// pair lands on a brand-new element and the browser reports the dblclick against the nearest
		// common ancestor. A per-strip handler would simply never fire.
		el.ondblclick = (e) => {
			const d = e.target.closest('.cineStrip');
			if (d && d.dataset.strip) enterTweak(d.dataset.strip);
		};

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

		el.querySelectorAll('.cineGutter [data-setz]').forEach((btn) => {
			btn.onclick = (e) => {
				e.stopPropagation();
				moveSet(parseInt(btn.dataset.setz, 10));
			};
		});

		// Visibility keys: drag to retime, double-click to delete (there is nothing else to edit —
		// the VALUE is the marker shape, flipped from the panel toggle).
		el.querySelectorAll('.cineVisRow .cineVisKey').forEach((dot) => {
			const actorId = dot.closest('.cineVisRow').dataset.actor;
			const keyTime = parseFloat(dot.dataset.visTime);
			dot.onpointerdown = (e) => {
				e.preventDefault();
				e.stopPropagation();
				tlDrag = { kind: 'vis', actorId, time: keyTime, startX: e.clientX, pps, el: dot, moved: false };
				try { dot.setPointerCapture(e.pointerId); } catch { /* uncaptured drag still works */ }
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
			dot.ondblclick = (e) => { e.stopPropagation(); deleteVisKey(actorId, keyTime); };
		});

		// Cue markers: click to select (the inspector edits it), drag to retime.
		el.querySelectorAll('.cineCueRow .cineCue').forEach((dot) => {
			const keyTime = parseFloat(dot.dataset.cueTime);
			dot.onpointerdown = (e) => {
				e.preventDefault();
				e.stopPropagation();
				selCueTime = keyTime;
				tlDrag = { kind: 'cue', time: keyTime, startX: e.clientX, pps, el: dot, moved: false };
				try { dot.setPointerCapture(e.pointerId); } catch { /* uncaptured drag still works */ }
				el.querySelectorAll('.cineCue.sel').forEach((n) => n.classList.remove('sel'));
				dot.classList.add('sel');
				renderPanel();
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
				renderPanel();
			};
			dot.onpointerup = endCue;
			dot.onpointercancel = endCue;
		});

		// Channel keys: click to select, drag to retime.
		el.querySelectorAll('.cineChanRow .cineKey').forEach((dot) => {
			const row = dot.closest('.cineChanRow');
			const trackId = row.dataset.track;
			const channel = row.dataset.channel;
			dot.onpointerdown = (e) => {
				e.preventDefault();
				e.stopPropagation();
				const keyTime = parseFloat(dot.dataset.time);
				selKey = { trackId, channel, time: keyTime };
				tlDrag = { kind: 'key', trackId, channel, time: keyTime, startX: e.clientX, pps, el: dot, moved: false };
				try { dot.setPointerCapture(e.pointerId); } catch { /* uncaptured drag still works */ }
				row.querySelectorAll('.cineKey.sel').forEach((n) => n.classList.remove('sel'));
				dot.classList.add('sel');
				renderPanel();
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
				evaluate(time);
			};
			const endKey = () => {
				if (!tlDrag || tlDrag.kind !== 'key' || tlDrag.el !== dot) return;
				const moved = tlDrag.moved;
				const track = doc.tracks.find((t) => t.id === trackId);
				const keys = track && track.channels[channel];
				if (keys) keys.sort((a, b) => a.time - b.time);
				if (moved) {
					const k = keys && keys.find((x) => Math.abs(x.time - parseFloat(dot.style.left) / tlDrag.pps) < 0.01);
					selKey = { trackId, channel, time: k ? k.time : tlDrag.time };
				}
				tlDrag = null;
				if (moved) commit('move key', 'key:' + trackId + ':' + channel);
				renderTimeline();
				renderPanel();
			};
			dot.onpointerup = endKey;
			dot.onpointercancel = endKey;
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

	// ---- strip bone mask (design §4.2 `mask.bones`) -------------------------
	//
	// A mask is what makes a strip an OVERRIDE OF PART of the skeleton: name a bone (or a few) and
	// the strip poses only those, leaving every other bone to whatever the layers below did. It is
	// stored as a set of ROOTS plus `includeChildren`, not as an expanded bone list, because that is
	// what an author means ("everything from `spine` up") and it survives the rig growing new bones.
	//
	// The expansion is the EVALUATOR's `expandBoneMask` — the same call the pose path makes — so the
	// count shown here can never disagree with what the mask actually does.

	const maskOf = (strip) => (strip.mask && Array.isArray(strip.mask.bones) ? strip.mask : null);

	/** How many bones this mask really covers, expanded exactly as the pose path expands it. */
	function maskBoneCount(strip, actor) {
		const mask = maskOf(strip);
		if (!mask || !mask.bones.length || !actor || !EV) return 0;
		return EV.expandBoneMask(actor.skeleton, mask).size;
	}

	/**
	 * Write the mask. An EMPTY bone list deletes the field rather than storing `{bones: []}` —
	 * the evaluator treats an empty mask as "no mask", so keeping one would put a doc in the file
	 * that says something it does not mean.
	 */
	function setMask(stripId, mask, label) {
		const found = stripById(stripId);
		if (!found) return;
		if (!mask || !mask.bones.length) delete found.strip.mask;
		else found.strip.mask = mask;
		commit(label, 'mask:' + stripId);
		renderTimeline();
		renderPanel();
	}

	function addMaskBone(stripId, boneName) {
		const found = stripById(stripId);
		if (!found || !boneName) return;
		const cur = maskOf(found.strip);
		const bones = cur ? cur.bones.slice() : [];
		if (bones.includes(boneName)) return;
		bones.push(boneName);
		// `includeChildren` defaults ON for a NEW mask: naming one bone and getting only that bone
		// is almost never the intent — "from here down" is.
		setMask(stripId, { bones, includeChildren: cur ? !!cur.includeChildren : true }, 'add mask bone');
	}

	function removeMaskBone(stripId, boneName) {
		const found = stripById(stripId);
		const cur = found && maskOf(found.strip);
		if (!cur) return;
		setMask(stripId, { bones: cur.bones.filter((b) => b !== boneName), includeChildren: !!cur.includeChildren }, 'remove mask bone');
	}

	function setMaskChildren(stripId, on) {
		const found = stripById(stripId);
		const cur = found && maskOf(found.strip);
		if (!cur) return;
		setMask(stripId, { bones: cur.bones.slice(), includeChildren: !!on }, 'mask children');
	}

	/** Bone options for the picker, INDENTED BY DEPTH so the hierarchy is readable in a flat list. */
	function boneOptions(actor, taken) {
		if (!actor) return '';
		const depth = new Map();
		return actor.skeletonData.bones
			.map((b) => {
				const d = b.parent ? (depth.get(b.parent.name) ?? 0) + 1 : 0;
				depth.set(b.name, d);
				if (taken.includes(b.name)) return '';
				return `<option value="${esc(b.name)}">${'\u00a0\u00a0'.repeat(d)}${esc(b.name)}</option>`;
			})
			.join('');
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

	// ---- property + camera keys ---------------------------------------------
	//
	// A channel with keys OWNS its property for the whole cinematic (see the evaluator's note), so
	// the static placement is the value you get until you key it, and the keys take over the
	// moment the first one exists. That is why the ◆ button reads the CURRENT effective value:
	// keying never makes the actor jump at the instant you key it.

	const PROP_CHANNELS = [
		{ key: 'x', label: 'x', color: '#5cc8ff' },
		{ key: 'y', label: 'y', color: '#9b8cff' },
		{ key: 'scale', label: 'scale', color: '#7ee0c0' },
		{ key: 'rotation', label: 'rot', color: '#ff6b6b' },
		{ key: 'alpha', label: 'alpha', color: '#e0a64a' },
	];
	const CAM_CHANNELS = [
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
	const CUE_KINDS = [
		{ prefix: 'fx:', label: 'FX', color: '#c98bff', hint: 'an Invisible FX effect id' },
		{ prefix: 'sfx:', label: 'SFX', color: '#e0a64a', hint: 'a sound cue name in the game' },
		{ prefix: 'music:', label: 'Music', color: '#e0a64a', hint: 'a music cue name in the game' },
		{ prefix: 'signal:', label: 'Signal', color: '#7ee0c0', hint: 'broadcast on the game event bus' },
	];
	const cueColor = (cue) => (CUE_KINDS.find((k) => String(cue || '').startsWith(k.prefix)) || {}).color || '#8b93a1';

	const cueTrack = () => doc.tracks.find((t) => t.kind === 'cue') || null;
	let selCueTime = null; // the selected cue key, by time (cues are global, so time identifies one)

	function ensureCueTrack() {
		let track = cueTrack();
		if (!track) {
			track = { id: uid('cue'), actorId: null, kind: 'cue', keys: [] };
			doc.tracks.push(track);
		}
		return track;
	}

	const time_ = () => time;
	function addCue() {
		const track = ensureCueTrack();
		const time = snapT(time_());
		track.keys.push({ time, cue: 'fx:' });
		track.keys.sort((a, b) => a.time - b.time);
		selCueTime = time;
		commit('add cue');
		renderPanel();
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
		renderPanel();
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
		renderPanel();
		renderTimeline();
	}

	let cameraLive = true;
	let selKey = null; // { trackId, channel, time }

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
		renderPanel();
		renderTimeline();
	}

	function deleteVisKey(actorId, keyTime) {
		const track = visTracksOf(actorId)[0];
		if (!track) return;
		track.keys = track.keys.filter((k) => Math.abs(k.time - keyTime) > 1e-6);
		// An empty track is noise — drop it so "never keyed" and "keyed then cleared" look the same.
		if (!track.keys.length) doc.tracks = doc.tracks.filter((t) => t.id !== track.id);
		commit('delete visibility key');
		renderPanel();
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
		return resolved[channel] == null ? (channel === 'scale' || channel === 'alpha' ? 1 : 0) : resolved[channel];
	}

	function keyProperty(actorId, channel, value) {
		const track = ensurePropertyTrack(actorId);
		track.channels[channel] = track.channels[channel] || [];
		EV.putKey(track.channels[channel], snapT(time), value == null ? effectivePlaceValue(actorId, channel) : value);
		commit('key ' + channel);
		renderPanel();
		renderTimeline();
	}

	function keyCamera(channel) {
		const cam = ctx.renderer() && ctx.renderer().camera;
		if (!cam) return;
		const track = ensureCameraTrack();
		track.channels[channel] = track.channels[channel] || [];
		const v = channel === 'zoom' ? cam.zoom : channel === 'x' ? cam.position.x : cam.position.y;
		EV.putKey(track.channels[channel], snapT(time), v);
		commit('key camera ' + channel);
		renderPanel();
		renderTimeline();
	}

	function deleteKey(trackId, channel, keyTime) {
		const track = doc.tracks.find((t) => t.id === trackId);
		if (!track || !track.channels[channel]) return;
		track.channels[channel] = track.channels[channel].filter((k) => Math.abs(k.time - keyTime) > 1e-6);
		if (!track.channels[channel].length) delete track.channels[channel];
		// A property/camera track with no channels left is noise — drop it so an actor that was
		// animated and then un-animated is indistinguishable from one that never was.
		if (!Object.keys(track.channels).length) doc.tracks = doc.tracks.filter((t) => t.id !== trackId);
		selKey = null;
		commit('delete key');
		renderPanel();
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
		renderPanel();
		renderTimeline();
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
				const strip = (tracksOf(cast.actorId).find(hasStrips) || { strips: [] }).strips[0];
				const cur = strip && strip.clip ? strip.clip.name : '';
				const sel = cast.actorId === selActorId;
				const opts = ['<option value="">— no clip —</option>']
					.concat(clips.map((a) => `<option value="${esc(a.name)}"${a.name === cur ? ' selected' : ''}>${esc(a.name)} (${a.duration.toFixed(2)}s)</option>`))
					.join('');
				const p = cast.place;
				return `<div class="cineActor${sel ? ' sel' : ''}" data-actor="${cast.actorId}">
	<div class="cineActorHead">
		<button class="cineVis" data-act="vis" title="Show / hide this actor on stage">${effectiveVisible(cast.actorId) ? '●' : '○'}</button>
		<button class="cineKeyBtn${visTracksOf(cast.actorId).length ? ' on' : ''}" data-viskey="1" title="Animate visibility — keys the current state at the playhead">◆</button>
		<b>${esc(cast.rigName || cast.rigId)}</b>
		<span class="cineZ" title="Draw order — lower draws first (behind)">z${cast.z}</span>
		<button data-act="up" title="Move behind">▲</button>
		<button data-act="down" title="Move in front">▼</button>
		<button data-act="del" title="Remove from the cast">🗑</button>
	</div>
	<select data-act="clip" title="Which of this rig's animations plays">${opts}</select>
	<div class="cinePlace">
		${PROP_CHANNELS.map((c) => {
			const keyed = !!(propertyTracksOf(cast.actorId)[0] || { channels: {} }).channels[c.key];
			const shown = keyed ? +effectivePlaceValue(cast.actorId, c.key).toFixed(3) : (p[c.key] == null ? (c.key === 'scale' || c.key === 'alpha' ? 1 : 0) : p[c.key]);
			const step = c.key === 'scale' || c.key === 'alpha' ? 0.05 : 1;
			return `<label${keyed ? ' class="keyed"' : ''}>${c.label}<input type="number" step="${step}" data-act="${c.key}" value="${shown}">` +
				`<button class="cineKeyBtn${keyed ? ' on' : ''}" data-key="${c.key}" title="${keyed ? 'Key ' + c.label + ' at the playhead (this channel is animated)' : 'Animate ' + c.label + ' — keys it at the playhead'}">◆</button></label>`;
		}).join('')}
		<label class="cineFlip">flip<input type="checkbox" data-act="flipX"${p.flipX ? ' checked' : ''}></label>
	</div>
</div>`;
			})
			.join('');

		// Option values are the rig FOLDER (stable), never the positional index id.
		const rigOpts = rigs
			.map((e) => `<option value="${esc(e.folder || String(e.id))}">${esc(e.name)}</option>`)
			.join('');
		const listOpts = cinematicList.length
			? cinematicList
					.map((c) => `<option value="${esc(c.id)}"${c.id === doc.id ? ' selected' : ''}>${esc(c.name)} · ${c.actors} actor${c.actors === 1 ? '' : 's'}</option>`)
					.join('')
			: '<option value="">— none saved in this project —</option>';
		panel.innerHTML = `
<div class="cineHead"><b>🎬 Cinematic</b><small>${esc(doc.name)}</small><span id="cineSaveState" class="cineSaveState${dirty ? ' dirty' : ''}">${busy ? '…' : dirty ? '● unsaved' : r2SavedAt || r2Etag ? '✓ saved' : 'not saved yet'}</span></div>
<div class="cineRow">
	<select id="cineOpenSel" title="Open a cinematic saved in this project">${listOpts}</select>
	<button id="cineOpen" title="Open the selected cinematic">⤓ Open</button>
</div>
<div class="cineRow">
	<button id="cineSave" title="Save this cinematic to the project (R2)"${busy ? ' disabled' : ''}>💾 Save</button>
	<button id="cineNew" title="Start a new, empty cinematic">＋ New</button>
	<button id="cineDelete" title="Delete this cinematic from the project">🗑</button>
	<input type="text" id="cineName" value="${esc(doc.name)}" title="Cinematic name" style="flex:1;min-width:0;">
</div>
<div class="cineRow">
	<label style="flex:1;min-width:0;">Set
		<select id="cineScene" title="The Scene this cinematic stages over — its sprites, text and FX become part of the stage. Authored in the Scene Editor.">
			<option value=""${doc.stage.sceneId ? '' : ' selected'}>— no set (rigs only) —</option>
			${scenes.map((sc) => `<option value="${esc(sc.id)}"${sc.id === doc.stage.sceneId ? ' selected' : ''}>${esc(sc.name || sc.id)} · ${sc.nodes} node${sc.nodes === 1 ? '' : 's'}</option>`).join('')}
		</select>
	</label>
	<label>Frame
		<select id="cineRatio" title="Draw the game screen box for this layout, so you compose against what the player actually sees. Sizes come from the ${layoutSource === 'project' ? 'project layout override' : layoutSource === 'global' ? 'admin global layout profile' : 'built-in default'}.">
			<option value=""${doc.stage.ratio ? '' : ' selected'}>— none —</option>
			${Object.keys(mainSizes).map((k) => `<option value="${esc(k)}"${k === doc.stage.ratio ? ' selected' : ''}>${esc(k)} ${mainSizes[k] && mainSizes[k].width ? `(${Math.round(mainSizes[k].width)}×${Math.round(mainSizes[k].height)})` : ''}</option>`).join('')}
		</select>
	</label>
</div>
${doc.stage.sceneId && !scenes.some((sc) => sc.id === doc.stage.sceneId) ? '<div class="cineStatus">This cinematic names a set (' + esc(doc.stage.sceneId) + ') that is not in this project.</div>' : ''}
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
${cameraMarkup()}
${cueMarkup()}
<div class="cineNote">Drag a strip to move it · drag its edges to trim · hold Alt to ignore the fps grid · Ctrl+wheel over the timeline to zoom.</div>
<div class="cineNote"><b>Text, sprites and placed FX</b> come from the <b>Set</b> above — author them as a Scene in the Scene Editor, then bind it here. The set is a <b>layer</b>: its 🎬 row in the timeline moves among the rigs with ▲▼, and that is the depth an <code>fx:</code> cue draws at too. They render in the game; the stage preview shows rigs plus the FX band. Adding them from inside the cinematic (and animating them) is not built yet. For a one-off effect or sound at a moment, use a ⚡ cue instead.</div>`;

		$('#cineAdd').onclick = () => {
			const id = $('#cineAddSel').value;
			const entry = rigs.find((e) => (e.folder || String(e.id)) === id);
			if (entry) addActor(entry);
		};
		// The selected strip / key / cue goes in the RIGHT column, where there is room to read it.
		const propsEl = $('#cineProps');
		if (propsEl) {
			const inspectors = stripInspectorMarkup() + keyInspectorMarkup() + cueInspectorMarkup();
			propsEl.innerHTML =
				inspectors ||
				'<div class="cineNote">Nothing selected. Click a strip, a keyframe diamond or a cue marker on the timeline.</div>';
			const sub = $('#propSub');
			if (sub) sub.textContent = inspectors ? 'cinematic' : 'select a strip, key or cue';
		}
		const ratioSel = $('#cineRatio');
		if (ratioSel) {
			ratioSel.onchange = (e) => {
				doc.stage.ratio = e.target.value || null;
				commit('change frame');
				renderPanel();
			};
		}
		const sceneSel = $('#cineScene');
		if (sceneSel) {
			sceneSel.onchange = (e) => {
				doc.stage.sceneId = e.target.value || null;
				commit(doc.stage.sceneId ? 'set the scene' : 'clear the scene');
				renderPanel();
			};
		}
		$('#cineFit').onclick = fitAll;
		$('#cineSave').onclick = () => saveToR2(false);
		$('#cineNew').onclick = newCinematic;
		$('#cineDelete').onclick = deleteCurrent;
		$('#cineOpen').onclick = () => { const id = $('#cineOpenSel').value; if (id) openFromR2(id); };
		$('#cineName').onchange = (e) => {
			const name = e.target.value.trim();
			if (!name) return;
			doc.name = name;
			// The id is the R2 key, so renaming an ALREADY-SAVED cinematic must not re-slug it into
			// a different object (that would fork it into two files). Only an unsaved one takes the
			// new id.
			if (!r2Etag && !r2SavedAt) doc.id = slugify(name);
			commit('rename', 'name');
			renderPanel();
		};
		$('#cineUndo').onclick = undo;
		$('#cineRedo').onclick = redo;
		wireStripInspector();
		wireChannelControls();
		$('#cineDur').onchange = (e) => setDuration(e.target.value);
		$('#cineTime').onchange = (e) => setTime(parseFloat(e.target.value) || 0);

		panel.querySelectorAll('.cineActor').forEach((el) => {
			const actorId = el.dataset.actor;
			el.onclick = (e) => {
				if (e.target.closest('button,select,input,label')) return;
				selActorId = actorId;
				renderPanel();
			};
			el.querySelectorAll('.cineKeyBtn[data-viskey]').forEach((btn) => {
				btn.onclick = (e) => { e.stopPropagation(); keyVisibility(actorId, effectiveVisible(actorId)); };
			});
			el.querySelectorAll('.cineKeyBtn[data-key]').forEach((btn) => {
				btn.onclick = (e) => { e.stopPropagation(); keyProperty(actorId, btn.dataset.key, null); };
			});
			el.querySelectorAll('[data-act]').forEach((node) => {
				const act = node.dataset.act;
				if (act === 'clip') {
					node.onchange = (e) => setActorClip(actorId, e.target.value);
					return;
				}
				if (node.tagName === 'INPUT' && node.type === 'number') {
					node.onchange = (e) => {
						const v = parseFloat(e.target.value) || 0;
						// Once a channel is animated, typing a value KEYS it at the playhead rather than
						// editing the static placement — otherwise the field would appear to do nothing,
						// because the channel overrides the static value on the very next frame.
						const track = propertyTracksOf(actorId)[0];
						if (track && track.channels[act]) keyProperty(actorId, act, v);
						else setPlace(actorId, act, v);
					};
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
						if (!cast) return;
						const next = !effectiveVisible(actorId);
						// Once visibility is ANIMATED, the toggle keys the flipped state at the playhead —
						// same rule as the numeric fields. Editing the static flag would appear to do
						// nothing, because the track overrides it on the very next frame.
						if (visTracksOf(actorId).length) {
							keyVisibility(actorId, next);
							return;
						}
						cast.visible = next;
						commit('toggle visibility');
						renderPanel();
					}
				};
			});
		});
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

	/** The Cues section in the LEFT panel: just the add button + how many exist. */
	function cueMarkup() {
		const track = cueTrack();
		const keys = (track && track.keys) || [];
		return `
<div class="cineHead" style="border-top:1px solid var(--line);"><b>⚡ Cues</b><small>${keys.length || 'none'} · ${fxEffects.length} fx available</small></div>
<div class="cineRow">
	<button id="cineAddCue" title="Add a cue at the playhead — a named moment the GAME reacts to">＋ Cue at playhead</button>
</div>
${keys.length ? '' : '<div class="cineNote">Cues fire as the playhead crosses them — an FX burst, a sound, or a signal the flow can react to. Scrubbing never fires them.</div>'}`;
	}

	/**
	 * The SELECTED cue's editor (right column).
	 *
	 * TWO controls, deliberately. A lone `<input list=…>` is NOT enough: a datalist filters its
	 * options against what the field already holds, so the moment a cue reads `fx:f_bottle` the
	 * dropdown collapses to that one entry and the cue looks unchangeable. So the PICKER — which
	 * never filters — always offers every effect the project has, and the text field stays,
	 * because `sfx:` / `music:` / `signal:` resolve inside the GAME, not here: they are not
	 * listable, and typing them is the only way to author them.
	 */
	function cueInspectorMarkup() {
		const track = cueTrack();
		const keys = (track && track.keys) || [];
		const sel = selCueTime !== null ? keys.find((k) => Math.abs(k.time - selCueTime) < 1e-6) : null;
		if (!sel) return '';
		const cur = sel.cue || '';
		const known = fxEffects.some((e) => 'fx:' + e.id === cur);
		const typed = !!cur && !known && !CUE_KINDS.some((k) => k.prefix === cur);
		const head = known ? '— change to —' : typed ? '✎ ' + esc(cur) + ' (typed)' : '— pick an effect or a kind —';
		const fxOpts = fxEffects
			.map((e) => `<option value="fx:${esc(e.id)}"${'fx:' + e.id === cur ? ' selected' : ''}>${esc(e.name || e.id)}</option>`)
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
<div class="cineNote">${fxEffects.length ? 'Pick an FX effect from the list — it stays complete however the cue is already set — or type an <code>sfx:</code> / <code>music:</code> / <code>signal:</code> name the game knows.' : 'This project has no authored FX effects yet — author them in /fx, or type a sound or signal name.'} An <code>fx:</code> cue draws on the <b>set</b> layer — move its 🎬 row in the timeline to put the effect in front of a rig.</div>`;
	}

	/** Inspector for a selected property/camera key — time, value and its outgoing interpolation. */
	function keyInspectorMarkup() {
		if (!selKey) return '';
		const track = doc.tracks.find((t) => t.id === selKey.trackId);
		const keys = track && track.channels[selKey.channel];
		const k = keys && keys.find((x) => Math.abs(x.time - selKey.time) < 1e-6);
		if (!k) return '';
		const ease = k.ease || 'linear';
		const opt = (v, label) => `<option value="${v}"${ease === v ? ' selected' : ''}>${label}</option>`;
		return `
<div class="cineHead" style="border-top:1px solid var(--line);"><b>Key</b><small>${esc(selKey.channel)}${track.kind === 'camera' ? ' (camera)' : ''}</small></div>
<div class="cineStripInsp">
	<label>time<input type="number" step="0.05" min="0" data-kact="time" value="${+k.time.toFixed(3)}"></label>
	<label>value<input type="number" step="0.1" data-kact="value" value="${+k.value.toFixed(3)}"></label>
	<label class="wide">out<select data-kact="ease">
		${opt('linear', 'linear')}${opt('ease', 'ease in-out')}${opt('hold', 'hold (stepped)')}
	</select></label>
</div>
<div class="cineRow"><button id="cineDelKey" title="Delete this key">🗑 Delete key</button></div>`;
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
		// A clip the ACTOR does not know about yet — freshly created by ＋ New clip, or renamed on the
		// rig since — must still show as the selection. Without this the <select> falls back to its
		// first option, which reads as "the tool silently changed my clip".
		const missing = cur && !clips.some((a) => a.name === cur)
			? `<option value="${esc(cur)}" selected>${esc(cur)} (new — save the rig)</option>`
			: '';
		const clipOpts = missing + clips
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
${maskMarkup(s, actor, found.track)}
<div class="cineRow">
	<button id="cineNewClip" title="Create an empty animation on this actor's rig, point this strip at it, and open it for keyframing">＋ New clip</button>
	<button id="cineTweakStrip" title="Open this clip in the animator with the rest of the stage posed around it (or double-click the strip)">✎ Tweak clip</button>
	<button id="cineDupStrip" title="Copy this strip in right after itself">⧉ Duplicate</button>
	<button id="cineDelStrip" title="Delete this strip">🗑 Delete</button>
</div>`;
	}

	/**
	 * The mask editor. Chips (the authored roots) + a picker + `include children` + a live count of
	 * what it actually covers, so "24 of 73 bones" answers "is this doing anything?" at a glance.
	 */
	function maskMarkup(s, actor, track) {
		const mask = maskOf(s);
		const bones = mask ? mask.bones : [];
		const total = actor ? actor.skeletonData.bones.length : 0;
		const covered = maskBoneCount(s, actor);
		const kids = mask ? !!mask.includeChildren : true;
		const chips = bones.length
			? bones
					.map((b) => `<span class="cineMaskChip"><span>${esc(b)}</span><button data-maskdel="${esc(b)}" title="Remove ${esc(b)} from the mask">✕</button></span>`)
					.join('')
			: '<i>whole skeleton — this strip poses every bone</i>';
		// A mask on the ONLY layer has nothing underneath to show through, so the un-masked bones
		// fall back to the SETUP pose. That reads as "half my rig went limp" unless it is said.
		const layers = doc.tracks.filter((t) => t.actorId === track.actorId && t.kind === 'animation').length;
		const alone = layers < 2 && (track.layer || 0) === 0;
		return `
<div class="cineMask">
	<div class="cineMaskHead">
		<b>mask</b>
		<span class="cineMaskCount">${bones.length ? covered + ' of ' + total + ' bones' : ''}</span>
		${bones.length ? '<button id="cineMaskClear" title="Remove the mask — the strip poses the whole skeleton again">clear</button>' : ''}
	</div>
	<div class="cineMaskChips">${chips}</div>
	<select id="cineMaskAdd" title="Restrict this strip to a bone (and, by default, everything under it)">
		<option value="">＋ add a bone…</option>
		${boneOptions(actor, bones)}
	</select>
	${bones.length ? `<label class="cineMaskKids"><input type="checkbox" id="cineMaskKids"${kids ? ' checked' : ''}> include children</label>` : ''}
	<div class="cineMaskNote">${
		bones.length
			? (alone
					? 'This actor has one layer, so there is nothing underneath: the bones outside the mask hold their <b>setup pose</b>. Add a layer with <b>⧉</b> and put this strip above a base clip to override just this part of it.'
					: 'Bones outside the mask keep whatever the layers below posed.') +
			  ' Masks cover <b>bone transforms only</b> — slot colour, attachment swaps and mesh deform are not masked.'
			: 'A clip only affects the bones it actually keys, so a clip you authored yourself (<b>＋ New clip</b>) usually needs NO mask — it already overrides just what you keyed. Mask a strip when you want only <i>part</i> of a full-body clip: an existing wave used over a walk, say.'
	}</div>
</div>`;
	}

	function wireChannelControls() {
		const addCueBtn = $('#cineAddCue');
		if (addCueBtn) addCueBtn.onclick = addCue;
		const delCueBtn = $('#cineDelCue');
		if (delCueBtn) delCueBtn.onclick = () => selCueTime !== null && deleteCue(selCueTime);
		const cuePick = $('#cineCuePick');
		if (cuePick)
			cuePick.onchange = (e) => {
				const v = e.target.value;
				if (!v || selCueTime === null) return;
				if (v.endsWith(':')) {
					// A KIND, not a value. Committing a bare `sfx:` would only make an unfirable cue,
					// so seed the prefix into the field and let the author finish the name.
					const field = document.querySelector('[data-cueact="cue"]');
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
		document.querySelectorAll('[data-cueact]').forEach((node) => {
			node.onchange = (e) => {
				const f = node.dataset.cueact;
				if (selCueTime === null) return;
				setCueField(selCueTime, f, f === 'time' ? parseFloat(e.target.value) || 0 : e.target.value);
			};
		});
		document.querySelectorAll('[data-camkey]').forEach((b) => {
			b.onclick = () => keyCamera(b.dataset.camkey);
		});
		const live = $('#cineCamLive');
		if (live) live.onclick = () => { cameraLive = !cameraLive; renderPanel(); };
		const delKey = $('#cineDelKey');
		if (delKey) delKey.onclick = () => selKey && deleteKey(selKey.trackId, selKey.channel, selKey.time);
		document.querySelectorAll('[data-kact]').forEach((node) => {
			node.onchange = (e) => {
				const f = node.dataset.kact;
				setKeyField(f, f === 'ease' ? e.target.value : parseFloat(e.target.value) || 0);
			};
		});
	}

	function wireStripInspector() {
		const add = $('#cineMaskAdd');
		if (add) add.onchange = (e) => { const v = e.target.value; e.target.value = ''; addMaskBone(selStripId, v); };
		const kids = $('#cineMaskKids');
		if (kids) kids.onchange = (e) => setMaskChildren(selStripId, e.target.checked);
		const clr = $('#cineMaskClear');
		if (clr) clr.onclick = () => setMask(selStripId, null, 'clear mask');
		document.querySelectorAll('[data-maskdel]').forEach((b) => {
			b.onclick = () => removeMaskBone(selStripId, b.dataset.maskdel);
		});
		const nc = $('#cineNewClip');
		if (nc) nc.onclick = () => newClipForStrip(selStripId);
		const tw = $('#cineTweakStrip');
		if (tw) tw.onclick = () => enterTweak(selStripId);
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
		// While tweaking, the keyboard is the ANIMATOR's — Delete removes a bone key, not a strip,
		// and undoing the cinematic doc under a half-finished rig edit is not something to offer.
		// Esc leaves, but only when the animator did not already CONSUME it: its own handler (which
		// runs first) spends the first Esc clearing a dopesheet/graph selection and marks it via
		// preventDefault. Jumping out from under that would read as the tool ignoring the selection
		// it just cleared.
		if (tweak) {
			if (e.key === 'Escape' && !e.defaultPrevented) {
				e.preventDefault();
				exitTweak();
			}
			return;
		}
		if (e.ctrlKey || e.metaKey) {
			const key = e.key.toLowerCase();
			if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
			else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo(); }
			else if (key === 'd' && selStripId) { e.preventDefault(); duplicateStrip(selStripId); }
			else if (key === 's') { e.preventDefault(); saveToR2(false); } // never let Ctrl+S save the PAGE
			return;
		}
		// Delete the selected key, else the selected strip. The rigger's own Delete handler gates on
		// `animMode`, so it is inert here and the two cannot both fire.
		if (e.key === 'Delete' || e.key === 'Backspace') {
			if (selKey) { e.preventDefault(); deleteKey(selKey.trackId, selKey.channel, selKey.time); }
			else if (selStripId) { e.preventDefault(); deleteStrip(selStripId); }
		}
	}

	async function init(bridge) {
		ctx = bridge;
		EV = await import('/shared/cinematicEval.mjs');
		doc = restore() || newDoc();
		historyReset();
		await refreshList();
		refreshEffects(); // best-effort, not awaited: the picker fills in when it lands
		refreshScenes();
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
		// Leaving cinematic mode with a tweak open would strand the animator on a rig the sequencer
		// no longer draws — and would never re-parse the clip back into the strips.
		if (tweak) exitTweak();
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
		// tweak mode — the entry/exit pair, the animator's seek hook, and the state for live checks
		enterTweak,
		exitTweak,
		newClipForStrip,
		tweakMaskNames,
		tweakMaskInfo,
		tweakMaskAddSelected,
		tweakMaskFromKeyed,
		tweakMaskClear,
		seekFromLocal,
		isTweaking: () => !!tweak,
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
