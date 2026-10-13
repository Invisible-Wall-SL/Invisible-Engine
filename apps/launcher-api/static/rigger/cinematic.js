/**
 * Invisible Cinematic — the `/rigger` CINEMATIC MODE (Phases 1–2).
 * Plan: docs/design/invisible-cinematic.md · State: docs/status/cinematic.md
 *
 * A cinematic is a non-linear SEQUENCER over several actors, not a bigger animation: the
 * animator edits one clip on one skeleton, this edits many rigs on one timeline.
 *
 * THIS FILE IS THE RIG HOST, not the sequencer UI. The timeline panel itself — ruler, tracks,
 * strips, keys, cues, the inspector, undo/redo — is the shared Timeline, `/shared/timeline.mjs`
 * (source: `apps/launcher-api/src/lib/timeline/timeline.js`; plan: docs/design/rive-style-editor.md
 * §3.4), the same module `/editor` mounts. What stays here is everything only a RIG stage has: the
 * cast of rigs and their placement, posing + drawing the stage, the R2 document, and the rig
 * extensions the Timeline accepts — Tweak Mode, inline posing, the underlay and bone masks.
 *
 * WHY A SEPARATE FILE: `view.html` is already ~9.5k lines. Everything cinematic lives here so
 * the rig editor's blast radius stays at four small hooks (a mode button, a `setMode` branch, a
 * `frame()` branch, and the lazy loader). This file NEVER touches the rig-editing document —
 * it only reads skeleton data — so no cinematic bug can corrupt a rig.
 *
 * DEPENDENCY DIRECTION: `view.html` injects everything through `init(bridge)`; this file
 * reaches into no globals of its own. The blend maths is NOT here — it is the single shared
 * `/shared/cinematicEval.mjs`, the same module the headless gates and the in-game `<Cinematic>`
 * component use. Do not re-implement any of it locally.
 */
window.RiggerCinematic = (function () {
	'use strict';

	const LS_KEY = 'rigger.cinematic.v1';

	let ctx = null; // the bridge from view.html
	let EV = null; // /shared/cinematicEval.mjs
	let TL = null; // /shared/timeline.mjs
	let tl = null; // the mounted Timeline — owns the playhead, the selection and the history
	let doc = null; // the CinematicDoc (design §4.2) — the same object the Timeline edits
	let actors = []; // runtime instances, parallel to doc.stage.cast
	let selActorId = null;
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
			tl.renderTimeline();
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
			tl.setDoc(doc);
			r2Etag = r.body.etag ?? null;
			r2SavedAt = null;
			dirty = false;
			tl.clearSelection();
			selActorId = doc.stage.cast.length ? doc.stage.cast[0].actorId : null;
			tl.setTimeQuiet(0);
			tl.historyReset(); // a freshly-opened doc has nothing behind it to undo to
			statusMsg = '';
			writeDraft();
			await rebuildActors();
			renderPanel();
			tl.renderTimeline();
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
		tl.setDoc(doc);
		r2Etag = null; // nothing stored yet → the save creates with ifNoneMatch:'*'
		r2SavedAt = null;
		dirty = false;
		tl.clearSelection();
		selActorId = null;
		tl.setTimeQuiet(0);
		actors = [];
		tl.historyReset();
		writeDraft();
		renderPanel();
		tl.renderTimeline();
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
		tl.setDoc(doc);
		r2Etag = null;
		r2SavedAt = null;
		dirty = false;
		actors = [];
		tl.clearSelection();
		tl.historyReset();
		writeDraft();
		renderPanel();
		tl.renderTimeline();
	}

	const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 60) || 'untitled';

	/** Reflect saved/unsaved in the header without rebuilding the whole panel every commit. */
	function updateSaveState() {
		const el = $('#cineSaveState');
		if (!el) return;
		el.textContent = busy ? '…' : dirty ? '● unsaved' : r2SavedAt || r2Etag ? '✓ saved' : 'not saved yet';
		el.className = 'cineSaveState' + (dirty ? ' dirty' : '');
	}

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
	 * POSITION reassigned on every scan (`rigIndex.ts` ends with `combined.map((e, id) => …)`),
	 * so adding or renaming any rig renumbers all of them and a stored id would silently re-point
	 * a saved cinematic at a DIFFERENT rig. The folder is the stable identity — and it is also the
	 * rig BUNDLE NAME the game registers, which is what lets the export ship the right rig.
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
		const skeleton = new ctx.RIG.Skeleton(data);
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

	const propertyTracksOf = (actorId) => tl.propertyTracksOf(actorId);
	const visTracksOf = (actorId) => tl.visTracksOf(actorId);

	/** Pose every actor at cinematic time `t`. Pure in `t` — see the evaluator's header. */
	function evaluate(t) {
		if (!EV) return;
		const rigNs = ctx.RIG;
		for (const actor of actors) {
			const cast = castOf(actor.actorId);
			if (!cast) continue;
			// The tweaked actor is posed by the ANIMATOR, not by its strips — that is what makes an
			// in-progress edit visible on the stage instead of being overwritten every frame.
			if (tweak && actor.actorId === tweak.actorId) continue;
			EV.evaluateActor(rigNs, actor.evalTarget, t, resolveClip);
			applyPlace(actor, EV.resolvePlace(cast.place, propertyTracksOf(actor.actorId), t));
			if (rigNs.Physics && rigNs.Physics.update !== undefined)
				actor.skeleton.updateWorldTransform(rigNs.Physics.update);
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
		if (!tl.cameraLive()) return;
		const track = tl.cameraTrack();
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
		const track = tl.cueTrack();
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
		// The page draws from the moment this script loads; `init` sets the doc once its imports land.
		if (!doc) return;
		const prevTime = tl.time();
		if (playing && doc.duration > 0) {
			let time = prevTime + delta * (ctx.playSpeed ? ctx.playSpeed() : 1);
			if (time >= doc.duration) time = ctx.looping && ctx.looping() ? time % doc.duration : doc.duration;
			tl.setTimeQuiet(time);
		}
		const time = tl.time();
		if (playing) fireCuesBetween(prevTime, time);
		evaluate(time);

		// TWEAK: the open rig is posed by the ANIMATOR at the strip's clip-local time — after
		// `evaluate` (which skips this actor) and before anything is drawn, so an in-progress edit is
		// what the stage shows, with no re-parse per frame.
		const tw = tweak ? tweakSample() : null;
		if (tw) ctx.tweakPose(tw.local, tw.place, delta, tw.underlay, tw.additive);

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
			if (actor && tl.effectiveVisible(cast.actorId)) renderer.drawSkeleton(actor.skeleton, ctx.pma());
		}
		drawScreenFrame(renderer);
		if (tw) ctx.tweakOverlays(); // bones / gizmo / mesh — on top of the whole stage
		renderer.end();
		syncTransport();
		if (tw) ctx.tweakAfter(tl.time(), tw.outside);
	}

	// ---- tweak mode (design §4.4) -------------------------------------------
	//
	// Double-click a strip and the animator opens on THAT clip, in cinematic context. This side owns
	// the clock and the time mapping; `view.html` owns the rig document, the pose and the keys (see
	// its `beginTweak` block for the full split). Entering touches the cinematic doc not at all, so a
	// tweak can never corrupt the sequence — it edits the RIG.

	/** Where the tweaked actor is — clip-local time + stage placement — at the cinematic playhead. */
	function tweakSample() {
		const time = tl.time();
		const found = tweak.stripId ? tl.stripById(tweak.stripId) : null;
		const cast = castOf(tweak.actorId);
		const place = cast ? EV.resolvePlace(cast.place, propertyTracksOf(tweak.actorId), time) : null;
		// Inline posing before the first key: there is no override yet, so the actor is simply what
		// its existing layers say it is — the author poses ON TOP of exactly that.
		if (!found && tweak.inline) return { local: 0, place, outside: false, underlay: tweakUnderlay(null), additive: false };
		if (!found) return { local: 0, place, outside: true, underlay: null, additive: false };
		const strip = found.strip;
		const outside = time < strip.start - 1e-6 || time > strip.start + strip.length + 1e-6;
		const r = EV.clipLocalTime(strip, time, tweakClipDur());
		return {
			local: r ? r.local : strip.clipIn || 0,
			place,
			outside,
			underlay: tweakUnderlay(found.track),
			additive: strip.blend === 'add',
		};
	}

	/**
	 * Pose the layers BELOW the tweaked strip onto the editor's skeleton, so an override is authored
	 * against the animation it overrides — the walk under the stumble — instead of against the setup
	 * pose. Returns null when there is nothing underneath, and the animator falls back to the setup
	 * pose exactly as before.
	 *
	 * Strictly LOWER layers: the tweaked strip is the thing being authored, and a sibling strip on the
	 * same layer is an alternative at that depth, not a base for it.
	 *
	 * The clips are resolved from the RIG EDITOR's `SkeletonData`, not the actor's: a rig timeline
	 * addresses bones by index, and these are applied to the editor's skeleton, so both have to come
	 * out of the same parse.
	 */
	function tweakUnderlay(track) {
		if (!EV || !ctx.rigSkeletonData) return null;
		const sd = ctx.rigSkeletonData();
		if (!sd) return null;
		// No track = inline posing with no override yet: EVERY layer is underneath.
		const layer = track ? track.layer || 0 : Infinity;
		const lower = tracksOf(tweak.actorId).filter((t) => t.kind === 'animation' && (t.layer || 0) < layer);
		if (!lower.length) return null;
		const resolve = (strip) => (strip.clip && strip.clip.src === 'rig' ? sd.findAnimation(strip.clip.name) : null);
		return (sk) => EV.evaluateActor(ctx.RIG, { skeleton: sk, skeletonData: sd, tracks: lower }, tl.time(), resolve);
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
		const found = tl.stripById(tweak.stripId);
		if (!found) return;
		// The inverse mapping is the evaluator's, NOT ours — re-deriving the trim/speed/loop maths
		// here is exactly the drift the shared module exists to prevent.
		tl.setTime(EV.cineTimeForLocal(found.strip, local, tweakClipDur(), tl.time()));
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
		const found = tl.stripById(stripId);
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
		tl.commit('new clip', 'newclip:' + stripId);
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
		const found = tl.stripById(tweak.stripId);
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

	// ---- inline posing: author an override ON the cinematic stage ----------
	//
	// "I would like to edit my bones straight into cinematic, and not in a new window animate" —
	// so this is the same tweak machinery with no chrome swap: the timeline and cast panel stay, the
	// bones of the posed actor are drawn and draggable, and the layers below keep playing underneath.
	// The difference that matters is that NOTHING has to exist first. There is no clip to pick and no
	// strip to add: the first key creates them (`ensureOverrideClip`), so the sequence grows to fit
	// what the author did rather than the author preparing a place to do it.

	const OVERRIDE_LEN = 2; // seconds — the length a fresh override strip gets; drag its edge to change

	async function startPosing(actorId) {
		if (tweak) { stopPosing(); return; }
		const cast = castOf(actorId);
		const entry = cast && rigEntryFor(cast);
		if (!entry) return fail('the rig this actor casts is not in this project');
		statusMsg = '✎ opening ' + entry.name + '…';
		renderPanel();
		const err = await ctx.openRigForTweak(entry);
		if (err) return fail(err);
		const bad = ctx.beginTweak({ actorId, clip: null, stripId: null, inline: true, label: cast.rigName || entry.name || '' });
		if (bad) return fail(bad);
		tweak = { stripId: null, actorId, clip: null, inline: true };
		selActorId = actorId;
		statusMsg = '✎ drag a bone on the stage — the first key makes the override';
		renderPanel();
		tl.renderTimeline();
	}

	function stopPosing() {
		if (!tweak) return;
		exitTweak();
	}

	/**
	 * Called by the rig editor the moment something is keyed with no clip open — i.e. the first pose.
	 * Creates the whole override in one go and returns the clip name:
	 *   a LAYER above everything this actor already has, a STRIP at the playhead, and a CLIP on the rig.
	 * Returns the existing clip on every later key, so one posing session builds one override.
	 */
	function ensureOverrideClip() {
		if (!tweak || !tweak.inline) return null;
		if (tweak.clip) return tweak.clip;
		const cast = castOf(tweak.actorId);
		if (!cast) return null;
		const name = ctx.createClip('override');
		if (!name) return null;
		const layers = doc.tracks
			.filter((t) => t.actorId === tweak.actorId && t.kind === 'animation')
			.map((t) => t.layer || 0);
		const track = {
			id: uid('track'),
			actorId: tweak.actorId,
			kind: 'animation',
			layer: layers.length ? Math.max(...layers) + 1 : 0,
			strips: [],
		};
		// Clamped to the cinematic, and never shorter than a frame — a zero-length strip would key
		// into something that can never be played back.
		const start = Math.min(tl.time(), Math.max(doc.duration - 1 / (doc.fps || 30), 0));
		const length = Math.max(Math.min(OVERRIDE_LEN, doc.duration - start), 1 / (doc.fps || 30));
		const ramp = Math.min(0.15, length / 4);
		const strip = {
			id: uid('strip'),
			clip: { src: 'rig', name },
			start,
			length,
			clipIn: 0,
			speed: 1,
			loop: { mode: 'once' },
			blend: 'replace',
			// Ramps by DEFAULT, and they are load-bearing rather than decorative. A strip extrapolates
			// `holdForward`, so an override with no blend-out holds its last frame for the rest of the
			// cinematic — the misstep would stick and the character would limp forever. A blend-out
			// takes alpha to 0 at the strip end, which both eases the move and ends it. Drag them to 0
			// in the inspector for a hard cut.
			blendIn: ramp,
			blendOut: ramp,
			alpha: 1,
		};
		track.strips.push(strip);
		doc.tracks.push(track);
		tweak.stripId = strip.id;
		tweak.clip = name;
		tl.selectStrip(strip.id);
		tl.commit('add override', 'override:' + strip.id);
		refreshTargets();
		tl.renderTimeline();
		renderPanel();
		return name;
	}

	async function enterTweak(stripId) {
		if (tweak) return;
		const found = tl.stripById(stripId);
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
		tl.selectStrip(stripId);
		statusMsg = '';
		// Park the playhead inside the strip: opening the animator on a stage where this clip is not
		// even playing shows an author their edit having no effect.
		const time = tl.time();
		tl.setTime(time < strip.start || time > strip.start + strip.length ? strip.start : time);
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
				evaluate(tl.time());
				tl.renderTimeline();
				renderPanel();
			});
			return;
		}
		evaluate(tl.time());
		tl.renderTimeline();
		renderPanel();
	}

	function syncTransport() {
		const dur = doc ? doc.duration : 0;
		const time = tl.time();
		const scrub = $('#scrub');
		if (scrub && document.activeElement !== scrub) scrub.value = dur > 0 ? Math.round((time / dur) * 1000) : 0;
		const readout = $('#time');
		if (readout) readout.textContent = time.toFixed(2) + 's / ' + dur.toFixed(2) + 's';
		const t = $('#cineTime');
		if (t && document.activeElement !== t) t.value = time.toFixed(2);
		tl.positionPlayhead(); // cheap: move one element, never re-render the timeline per frame
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
			for (const chan of TL.PROP_CHANNELS) {
				if (!track.channels[chan.key]) continue;
				const input = row.querySelector('[data-act="' + chan.key + '"]');
				if (!input || document.activeElement === input) continue;
				const v = +tl.effectivePlaceValue(actorId, chan.key).toFixed(3);
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
		if (!box || typeof renderer.line !== 'function' || !ctx.RIG.Color) return;
		const hw = box.w / 2;
		const hh = box.h / 2;
		const col = new ctx.RIG.Color(0.36, 0.69, 1, 0.75); // the tool accent, so it reads as a guide
		renderer.line(-hw, -hh, hw, -hh, col);
		renderer.line(hw, -hh, hw, hh, col);
		renderer.line(hw, hh, -hw, hh, col);
		renderer.line(-hw, hh, -hw, -hh, col);
		// Centre cross — the anchor a newly cast actor sits on, so placement reads at a glance.
		const tick = Math.min(hw, hh) * 0.04;
		const faint = new ctx.RIG.Color(0.36, 0.69, 1, 0.35);
		renderer.line(-tick, 0, tick, 0, faint);
		renderer.line(0, -tick, 0, tick, faint);
	}

	// ---- camera -------------------------------------------------------------

	/** Frame every actor, not just one — the rigger's own fitView only knows the open rig. */
	function fitAll() {
		if (!actors.length) return;
		const off = new ctx.RIG.Vector2();
		const size = new ctx.RIG.Vector2();
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
			// The FOLDER is the identity (see `rigEntryFor`) and doubles as the rig bundle name
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
		tl.commit('cast ' + (entry.name || 'rig'));
		renderPanel();
		tl.renderTimeline();
		if (actors.length === 1) fitAll();
	}

	function removeActor(actorId) {
		doc.stage.cast = doc.stage.cast.filter((c) => c.actorId !== actorId);
		doc.tracks = doc.tracks.filter((t) => t.actorId !== actorId);
		actors = actors.filter((a) => a.actorId !== actorId);
		refreshTargets();
		if (selActorId === actorId) selActorId = doc.stage.cast.length ? doc.stage.cast[0].actorId : null;
		normalizeZ();
		tl.commit('remove actor');
		renderPanel();
		tl.renderTimeline();
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
		tl.commit('reorder actor');
		renderPanel();
		tl.renderTimeline();
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
		if (record) tl.commit('change clip');
		renderPanel();
		if (record) tl.renderTimeline();
	}

	function setPlace(actorId, key, value) {
		const cast = castOf(actorId);
		if (!cast) return;
		cast.place[key] = value;
		// Coalesced per actor+field: a run of typing (and, in Phase 2, a drag) is ONE undo step.
		tl.commit('move actor', 'place:' + actorId + ':' + key);
	}

	function setDuration(secs) {
		doc.duration = Math.max(0.1, Number(secs) || 0);
		// Phase 1's implicit full-length strips follow the cinematic's length.
		for (const track of doc.tracks) if (TL.hasStrips(track)) for (const strip of track.strips) if (strip.start === 0) strip.length = doc.duration;
		if (tl.time() > doc.duration) tl.setTimeQuiet(doc.duration);
		tl.commit('change length', 'duration');
		renderPanel();
		tl.renderTimeline();
	}

	// ---- strip bone mask (design §4.2 `mask.bones`) — a Timeline extension ---
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
		const found = tl.stripById(stripId);
		if (!found) return;
		if (!mask || !mask.bones.length) delete found.strip.mask;
		else found.strip.mask = mask;
		tl.commit(label, 'mask:' + stripId);
		tl.renderTimeline();
		renderPanel();
	}

	function addMaskBone(stripId, boneName) {
		const found = tl.stripById(stripId);
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
		const found = tl.stripById(stripId);
		const cur = found && maskOf(found.strip);
		if (!cur) return;
		setMask(stripId, { bones: cur.bones.filter((b) => b !== boneName), includeChildren: !!cur.includeChildren }, 'remove mask bone');
	}

	function setMaskChildren(stripId, on) {
		const found = tl.stripById(stripId);
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
				const strip = (tracksOf(cast.actorId).find(TL.hasStrips) || { strips: [] }).strips[0];
				const cur = strip && strip.clip ? strip.clip.name : '';
				const sel = cast.actorId === selActorId;
				const opts = ['<option value="">— no clip —</option>']
					.concat(clips.map((a) => `<option value="${esc(a.name)}"${a.name === cur ? ' selected' : ''}>${esc(a.name)} (${a.duration.toFixed(2)}s)</option>`))
					.join('');
				const p = cast.place;
				return `<div class="cineActor${sel ? ' sel' : ''}" data-actor="${cast.actorId}">
	<div class="cineActorHead">
		<button class="cineVis" data-act="vis" title="Show / hide this actor on stage">${tl.effectiveVisible(cast.actorId) ? '●' : '○'}</button>
		<button class="cineKeyBtn${visTracksOf(cast.actorId).length ? ' on' : ''}" data-viskey="1" title="Animate visibility — keys the current state at the playhead">◆</button>
		<b>${esc(cast.rigName || cast.rigId)}</b>
		<span class="cineZ" title="Draw order — lower draws first (behind)">z${cast.z}</span>
		<button data-act="up" title="Move behind">▲</button>
		<button data-act="down" title="Move in front">▼</button>
		<button data-act="pose" class="cinePose${tweak && tweak.inline && tweak.actorId === cast.actorId ? ' on' : ''}" title="Pose this actor's bones on the stage. Drag a bone and the first key creates an override layer on top of whatever it is already playing.">✎</button>
		<button data-act="del" title="Remove from the cast">🗑</button>
	</div>
	<select data-act="clip" title="Which of this rig's animations plays">${opts}</select>
	<div class="cinePlace">
		${TL.PROP_CHANNELS.map((c) => {
			const keyed = !!(propertyTracksOf(cast.actorId)[0] || { channels: {} }).channels[c.key];
			const shown = keyed ? +tl.effectivePlaceValue(cast.actorId, c.key).toFixed(3) : (p[c.key] == null ? (c.key === 'scale' || c.key === 'alpha' ? 1 : 0) : p[c.key]);
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
	<label>Time <input type="number" id="cineTime" step="0.05" value="${tl.time().toFixed(2)}"> s</label>
</div>
<div class="cineRow">
	<select id="cineAddSel" title="Pick a rig from this project to cast">${rigOpts || '<option value="">no rigs in this project</option>'}</select>
	<button id="cineAdd" title="Cast this rig as a new actor on the stage">＋ Cast</button>
	<button id="cineFit" title="Frame every actor">⤢ Fit</button>
</div>
${tl.historyMarkup()}
<div class="cineStatus">${loadingCount ? 'loading rig…' : esc(statusMsg)}</div>
<div id="cineCast">${rows || '<div class="cineEmpty">No actors yet — pick a rig above and press ＋ Cast.</div>'}</div>
${tl.cameraMarkup()}
${tl.cueMarkup()}
<div class="cineNote">Drag a strip to move it · drag its edges to trim · hold Alt to ignore the fps grid · Ctrl+wheel over the timeline to zoom.</div>
<div class="cineNote"><b>Text, sprites and placed FX</b> come from the <b>Set</b> above — author them as a Scene in the Scene Editor, then bind it here. The set is a <b>layer</b>: its 🎬 row in the timeline moves among the rigs with ▲▼, and that is the depth an <code>fx:</code> cue draws at too. They render in the game; the stage preview shows rigs plus the FX band. Adding them from inside the cinematic (and animating them) is not built yet. For a one-off effect or sound at a moment, use a ⚡ cue instead.</div>`;

		$('#cineAdd').onclick = () => {
			const id = $('#cineAddSel').value;
			const entry = rigs.find((e) => (e.folder || String(e.id)) === id);
			if (entry) addActor(entry);
		};
		// The selected strip / key / cue goes in the RIGHT column, where there is room to read it.
		if ($('#cineProps')) {
			const selected = tl.renderInspector();
			const sub = $('#propSub');
			if (sub) sub.textContent = selected ? 'cinematic' : 'select a strip, key or cue';
		}
		const ratioSel = $('#cineRatio');
		if (ratioSel) {
			ratioSel.onchange = (e) => {
				doc.stage.ratio = e.target.value || null;
				tl.commit('change frame');
				renderPanel();
			};
		}
		const sceneSel = $('#cineScene');
		if (sceneSel) {
			sceneSel.onchange = (e) => {
				doc.stage.sceneId = e.target.value || null;
				tl.commit(doc.stage.sceneId ? 'set the scene' : 'clear the scene');
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
			tl.commit('rename', 'name');
			renderPanel();
		};
		tl.wirePanel(panel);
		$('#cineDur').onchange = (e) => setDuration(e.target.value);
		$('#cineTime').onchange = (e) => tl.setTime(parseFloat(e.target.value) || 0);

		panel.querySelectorAll('.cineActor').forEach((el) => {
			const actorId = el.dataset.actor;
			el.onclick = (e) => {
				if (e.target.closest('button,select,input,label')) return;
				selActorId = actorId;
				renderPanel();
			};
			el.querySelectorAll('.cineKeyBtn[data-viskey]').forEach((btn) => {
				btn.onclick = (e) => { e.stopPropagation(); tl.keyVisibility(actorId, tl.effectiveVisible(actorId)); };
			});
			el.querySelectorAll('.cineKeyBtn[data-key]').forEach((btn) => {
				btn.onclick = (e) => { e.stopPropagation(); tl.keyProperty(actorId, btn.dataset.key, null); };
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
						if (track && track.channels[act]) tl.keyProperty(actorId, act, v);
						else setPlace(actorId, act, v);
					};
					return;
				}
				if (node.tagName === 'INPUT' && node.type === 'checkbox') {
					node.onchange = (e) => setPlace(actorId, act, e.target.checked);
					return;
				}
				node.onclick = () => {
					if (act === 'pose') { if (tweak && tweak.actorId === actorId) stopPosing(); else startPosing(actorId); }
					else if (act === 'del') removeActor(actorId);
					else if (act === 'up') moveActor(actorId, -1);
					else if (act === 'down') moveActor(actorId, 1);
					else if (act === 'vis') {
						const cast = castOf(actorId);
						if (!cast) return;
						const next = !tl.effectiveVisible(actorId);
						// Once visibility is ANIMATED, the toggle keys the flipped state at the playhead —
						// same rule as the numeric fields. Editing the static flag would appear to do
						// nothing, because the track overrides it on the very next frame.
						if (visTracksOf(actorId).length) {
							tl.keyVisibility(actorId, next);
							return;
						}
						cast.visible = next;
						tl.commit('toggle visibility');
						renderPanel();
					}
				};
			});
		});
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

	/**
	 * The rig's Timeline extensions: what a strip on a RIG actor can do that the shared Timeline
	 * knows nothing about — bone masks, Tweak Mode (double-click / ✎ Tweak clip), ＋ New clip — and
	 * the keyboard + timeline handover while the animator is open.
	 */
	const rigExtension = {
		timelineSuspended: () => !!(tweak && !tweak.inline),
		stripBadge: (strip) => (maskOf(strip) && maskOf(strip).bones.length ? ' ◑' : ''),
		onStripActivate: (stripId) => enterTweak(stripId),
		stripInspector: (strip, track) => maskMarkup(strip, actorOf(track.actorId), track),
		stripActions: () =>
			'\t<button id="cineNewClip" title="Create an empty animation on this actor\'s rig, point this strip at it, and open it for keyframing">＋ New clip</button>\n' +
			'\t<button id="cineTweakStrip" title="Open this clip in the animator with the rest of the stage posed around it (or double-click the strip)">✎ Tweak clip</button>\n',
		wireInspector(root) {
			const q = (sel) => root.querySelector(sel);
			const sel = () => tl.selectedStripId();
			const add = q('#cineMaskAdd');
			if (add) add.onchange = (e) => { const v = e.target.value; e.target.value = ''; addMaskBone(sel(), v); };
			const kids = q('#cineMaskKids');
			if (kids) kids.onchange = (e) => setMaskChildren(sel(), e.target.checked);
			const clr = q('#cineMaskClear');
			if (clr) clr.onclick = () => setMask(sel(), null, 'clear mask');
			root.querySelectorAll('[data-maskdel]').forEach((b) => {
				b.onclick = () => removeMaskBone(sel(), b.dataset.maskdel);
			});
			const nc = q('#cineNewClip');
			if (nc) nc.onclick = () => newClipForStrip(sel());
			const tw = q('#cineTweakStrip');
			if (tw) tw.onclick = () => enterTweak(sel());
		},
		/**
		 * While tweaking, the keyboard is the ANIMATOR's — Delete removes a bone key, not a strip, and
		 * undoing the cinematic doc under a half-finished rig edit is not something to offer. Esc
		 * leaves, but only when the animator did not already CONSUME it: its own handler (which runs
		 * first) spends the first Esc clearing a dopesheet/graph selection and marks it via
		 * preventDefault. Jumping out from under that would read as the tool ignoring the selection it
		 * just cleared.
		 */
		keydown(e) {
			if (!tweak) return false;
			if (e.key === 'Escape' && !e.defaultPrevented) {
				e.preventDefault();
				exitTweak();
			}
			return true;
		},
	};

	const esc = (s) => TL.esc(s);

	// ---- lifecycle ----------------------------------------------------------

	/**
	 * The Timeline's keyboard (undo/redo, Ctrl+D, Delete, Ctrl+S) is live only while this mode is.
	 * `/rigger` binds no other Ctrl chord today, and its two global key handlers already gate on
	 * `editMode`/`animMode`, so nothing else fires here.
	 */
	async function init(bridge) {
		ctx = bridge;
		// Same cache-bust as this script: a redeploy must not pair a fresh host with a cached module.
		const v = new URLSearchParams(location.search).get('v');
		const q = v ? '?v=' + encodeURIComponent(v) : '';
		[EV, TL] = await Promise.all([import('/shared/cinematicEval.mjs' + q), import('/shared/timeline.mjs' + q)]);
		doc = restore() || newDoc();
		tl = TL.mount($('#timeline'), {
			doc,
			ev: EV,
			inspector: $('#cineProps'),
			extensions: [rigExtension],
			host: {
				evaluate,
				seeked: syncTransport,
				changed: save,
				render: renderPanel,
				async docReplaced(next) {
					doc = next;
					// The cast may have gained or lost members: rebuild instances (existing ones are
					// reused by actorId, so this is cheap) and drop a selection that no longer exists.
					await rebuildActors();
					if (selActorId && !castOf(selActorId)) selActorId = doc.stage.cast.length ? doc.stage.cast[0].actorId : null;
				},
				tracksChanged: refreshTargets,
				save: () => saveToR2(false),
				// The preview draws every rig into ONE raw-WebGL canvas while FX is Pixi in a second one,
				// so an `fx:` cue can only be shown as a BAND — above the whole cast or below it — never
				// sandwiched between two rigs. The game honours the true z; this keeps the preview from
				// contradicting it in the two cases it can actually represent.
				setDepth: (inFront) => { if (ctx.setFxDepth) ctx.setFxDepth(inFront); },
				actorLabel: (cast) => ({ text: cast.rigName || cast.rigId, title: cast.rigName || '' }),
				clips: (actorId) => { const actor = actorOf(actorId); return actor ? actor.skeletonData.animations : []; },
				sceneName: (id) => { const sc = scenes.find((s) => s.id === id); return sc ? sc.name || sc.id : null; },
				effects: () => fxEffects,
				cameraView: () => {
					const cam = ctx.renderer() && ctx.renderer().camera;
					return cam ? { x: cam.position.x, y: cam.position.y, zoom: cam.zoom } : null;
				},
			},
		});
		tl.historyReset();
		await refreshList();
		refreshEffects(); // best-effort, not awaited: the picker fills in when it lands
		refreshScenes();
		await rebuildActors();
		tl.setActive(true);
		renderPanel();
		// `setMode` already ran its own renderTimeline() BEFORE this module finished loading (the
		// script is lazy), so that call found no RiggerCinematic and drew nothing. Render here too,
		// or the timeline is empty on first entry until some other edit happens to refresh it.
		tl.renderTimeline();
	}

	function activate() {
		if (!tl) return;
		tl.setActive(true);
		renderPanel();
		tl.renderTimeline();
		// Rigs may have been added/removed (or the project switched) since we last rendered.
		rebuildActors().then(tl.renderTimeline);
	}

	function deactivate() {
		// Leaving cinematic mode with a tweak open would strand the animator on a rig the sequencer
		// no longer draws — and would never re-parse the clip back into the strips.
		if (tweak) exitTweak();
		if (tl) tl.setActive(false);
		save();
	}

	return {
		init,
		activate,
		deactivate,
		frame,
		// `view.html` can reach these before `init` has mounted the Timeline (the script loads
		// lazily), so each is a no-op until then — as they were when the timeline lived here.
		setTime: (t) => tl && tl.setTime(t),
		getTime: () => (tl ? tl.time() : 0),
		duration: () => (doc ? doc.duration : 0),
		isDirty: () => dirty,
		hasActors: () => actors.length > 0,
		renderPanel,
		renderTimeline: () => tl && tl.renderTimeline(),
		zoom: (factor) => tl && tl.zoom(factor),
		// tweak mode — the entry/exit pair, the animator's seek hook, and the state for live checks
		enterTweak,
		exitTweak,
		newClipForStrip,
		startPosing,
		stopPosing,
		ensureOverrideClip,
		isPosing: () => !!(tweak && tweak.inline),
		tweakMaskNames,
		tweakMaskInfo,
		tweakMaskAddSelected,
		tweakMaskFromKeyed,
		tweakMaskClear,
		seekFromLocal,
		isTweaking: () => !!tweak,
		deleteSelectedStrip: () => { if (tl && tl.selectedStripId()) tl.deleteStrip(tl.selectedStripId()); },
		hasSelectedStrip: () => !!(tl && tl.selectedStripId()),
		// history — exposed for live verification
		undo: () => tl && tl.undo(),
		redo: () => tl && tl.redo(),
		canUndo: () => !!(tl && tl.canUndo()),
		canRedo: () => !!(tl && tl.canRedo()),
		historyDepth: () => (tl ? tl.historyDepth() : { index: -1, size: 0, label: '' }),
	};
})();
