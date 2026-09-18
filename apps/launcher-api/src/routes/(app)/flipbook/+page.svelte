<script lang="ts">
	/**
	 * Invisible Flipbook — the clip authoring surface (`docs/design/invisible-flipbook.md` step 4).
	 *
	 * Three columns: the saved-clip rail, the ORDERED frame list (the whole point of the tool —
	 * drag to reorder, duplicate to hold a frame), and the source-sheet region picker.
	 *
	 * Preview is a plain 2D canvas, not PIXI: `RegionThumb` already owns the atlas-slicing +
	 * rotated-region un-rotation the whole launcher uses, and repaints in place when its `region`
	 * prop changes — so playback is just "advance an index on a rAF clock". A second PIXI app for
	 * a still-frame flipbook would buy nothing.
	 */
	import { onMount } from 'svelte';
	import { invalidateAll, replaceState } from '$app/navigation';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import CanvasModeBar from '$lib/CanvasModeBar.svelte';
	import VideoMode from './VideoMode.svelte';
	import { SaveState } from '$lib/saveState.svelte';
	import { LeaseState } from '$lib/leaseState.svelte';
	import PresenceBanner from '$lib/PresenceBanner.svelte';
	import { askConfirm, askText } from '$lib/dialogs.svelte';
	import BoundsBox from '$lib/BoundsBox.svelte';
	import { boxFit } from '$lib/boundsFit';
	import { centrePane, paneSize, zoomAbout } from '$lib/panZoom';
	import {
		DEFAULT_FLIPBOOK_FPS,
		animationToClip,
		applyClipBounds,
		clipSheetKeys,
		detectSequencesAcross,
		fitClipBounds,
		isFlipbookDirection,
		parseAnimationPlist,
		parseFrameRef,
		playbackIndices,
		type FlipbookBounds,
		type FlipbookClip,
		type FlipbookFrameBox,
	} from 'engine-flipbook';
	import { clearRegionCache, fetchRegions, type RegionSet } from '../editor/editorRegions.client';
	import RegionThumb, { clearPageImages } from '../editor/RegionThumb.svelte';
	import { clearCropPages } from '../editor/regionCrop';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/**
	 * Which surface this page is showing. `clips` is the frame-list authoring the tool has always
	 * been; `video` is the generate-and-pick mode (docs/design/invisible-flipbook-video.md). They
	 * share nothing but the project, so the video mode lives in its own component rather than
	 * doubling the length of this one.
	 */
	let mode = $state<'clips' | 'video'>('clips');

	/** Sentinel id for a never-saved clip — the save keys the R2 file off the NAME instead
	 * (mirrors `/fx`'s untitled effect), so distinct names produce distinct files. */
	const UNTITLED_CLIP_ID = '__untitled__';

	function emptyClip(): FlipbookClip {
		return {
			id: UNTITLED_CLIP_ID,
			name: 'New clip',
			assetKey: data.atlases[0]?.manifestKey ?? '',
			frames: [],
			fps: DEFAULT_FLIPBOOK_FPS,
			loop: true,
		};
	}

	// The in-memory clip is the SINGLE source of truth while editing. Seeded either from a
	// reopened clip (`?clip=<id>` → `data.openedClip`) or a fresh empty one.
	let clip = $state<FlipbookClip>(data.openedClip ?? emptyClip());

	/**
	 * The clip exactly as it was last loaded or saved — the baseline the dirty check compares
	 * against. A value compare rather than a `markDirty()` at every mutation site: every edit
	 * here reassigns the WHOLE clip (`clip = { ...clip, … }`) across dozens of call sites, and a
	 * flag that has to be set at each of them is a flag that will eventually be missed. Only the
	 * discard guards read it, so it costs one `stringify` per open / close, not per keystroke.
	 */
	const snapshot = (): string => JSON.stringify($state.snapshot(clip));
	let baseline = snapshot();
	const markSaved = (): void => void (baseline = snapshot());
	const isDirty = (): boolean => snapshot() !== baseline;

	// --- save / open state ------------------------------------------------------
	/** Delete-flow spinner; `busy` (below) unions it with the save machine so every shared
	 * `disabled={busy}` keeps its "either operation in flight" meaning. */
	let deleting = $state(false);
	/** Open-flow spinner — one R2 GET, but the rail must not fire a second open under it. */
	let opening = $state(false);
	let saveError = $state('');
	let savedNote = $state('');
	let pickerId = $state<string>(data.openedClip?.id ?? '');
	/** LOCAL, reactive copy of the clip index so a save shows in the rail without a reload. */
	let clips = $state<{ id: string; name: string; frames: number }[]>(data.clips);

	function upsertClip(row: { id: string; name: string; frames: number }): void {
		const rest = clips.filter((c) => c.id !== row.id);
		clips = [...rest, row].sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Soft edit lease (multi-user-concurrency Phase 2c-rest batch B) over the OPEN clip. Flipbook
	 * edits one clip at a time and each clip is its OWN R2 object, so the lease `docKey` is the
	 * open clip's id and switching clips re-keys it (`lease.switchDoc`). A never-saved / untitled
	 * clip has no persisted key ⇒ `null` ⇒ inert ⇒ freely editable. `lease.readOnly` gates the doc
	 * `saveState` (its `blockWhen`); the `If-Match` CAS stays the correctness floor.
	 */
	const lease = new LeaseState({
		toolId: 'flipbook',
		clientKey: data.clientKey,
		projectKey: data.projectKey,
		docKey: '',
		enabled: data.projectKey.length > 0,
	});

	/** The lease key for a clip id: the persisted slug, or `null` for the untitled sentinel /
	 *  empty (a never-saved clip has nothing to lease). */
	function leaseIdFor(id: string): string | null {
		return id && id !== UNTITLED_CLIP_ID ? id : null;
	}

	/** Mirror of the lease's current doc key, so a re-key fires only when the OPEN clip actually
	 *  changes (first-saving a new one, saving-as, deleting the open one) — never on every
	 *  re-save of the same clip. */
	let leasedId: string | null = leaseIdFor(clip.id);
	function leaseSwitch(id: string | null): void {
		if (id === leasedId) return;
		leasedId = id;
		void lease.switchDoc(id);
	}

	/**
	 * Save-state machine (multi-user-concurrency Phase 2a). Manual save; the transport owns the
	 * request. Create encoding stays caller-side and keeps the `isUnsaved ? null : baseEtag`
	 * guard — after a delete the clip resets to untitled while the held etag stays stale, so the
	 * `isUnsaved` sentinel (not the etag) decides the create path. A 409 `scope-mismatch` is
	 * non-forceable (reload is the only fix); a plain conflict is DESTRUCTIVE (clips have no
	 * version history), surfaced by the wrapper's explicit confirm. `saveAs` repoints the id +
	 * `adoptEtag(null)`, restoring on a declined save.
	 */
	const saveState = new SaveState({
		initialEtag: data.openedEtag,
		blockWhen: () => lease.readOnly,
		save: async ({ baseEtag, force }) => {
			try {
				const isUnsaved = clip.id === '' || clip.id === UNTITLED_CLIP_ID;
				const outgoingId = isUnsaved ? clip.name.trim() || clip.id : clip.id;
				const res = await fetch('/api/flipbook/save', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						clip: { ...$state.snapshot(clip), id: outgoingId },
						projectKey: data.projectKey,
						...(force ? { force: true } : { baseEtag: isUnsaved ? null : baseEtag }),
					}),
				});
				if (res.status === 409) {
					const out = (await res.json().catch(() => ({}))) as {
						error?: string;
						message?: string;
					};
					const msg = out.message ?? 'This clip changed since you opened it.';
					return {
						ok: false,
						reason: out.error === 'scope-mismatch' ? 'scope-mismatch' : 'conflict',
						message: msg,
					};
				}
				if (!res.ok) {
					return { ok: false, reason: 'error', message: `Save failed (HTTP ${res.status}).` };
				}
				const out = (await res.json()) as {
					id: string;
					name: string;
					frames: number;
					etag: string | null;
				};
				// The server slugs the id; adopt it so a later save/open round-trips cleanly.
				clip = { ...clip, id: out.id };
				pickerId = out.id;
				// The clip now has a persisted key — re-key the lease onto it (a no-op when
				// re-saving the same clip; the acquire that matters is a NEW / saved-as clip).
				leaseSwitch(leaseIdFor(out.id));
				upsertClip({ id: out.id, name: out.name, frames: out.frames });
				// The stored clip is now what's on screen — re-baseline so the discard guards stop
				// warning about edits that have just been persisted.
				markSaved();
				savedNote = `Saved "${out.name}" (${out.frames} frame${out.frames === 1 ? '' : 's'}).`;
				return { ok: true, etag: out.etag };
			} catch {
				return { ok: false, reason: 'error', message: 'Save failed (network error).' };
			}
		},
	});
	/** Union of the in-flight flags — preserves every shared `disabled={busy}`. */
	const busy = $derived(deleting || opening || saveState.busy);

	onMount(() => {
		// Acquire the lease for the initially-open clip (if any); inert for a fresh /flipbook.
		void lease.switchDoc(leasedId);
		const onUnload = () => lease.release();
		// Opening a clip is now an in-page swap, so `confirmDiscard` guards it directly. A real
		// unload — closing the tab, the top bar's project switch, a link out of the tool — is the
		// one exit this page cannot intercept, and the browser's own prompt is what covers it.
		const onBeforeUnload = (e: BeforeUnloadEvent): void => {
			if (!isDirty()) return;
			e.preventDefault();
			e.returnValue = '';
		};
		window.addEventListener('pagehide', onUnload);
		window.addEventListener('beforeunload', onBeforeUnload);
		return () => {
			window.removeEventListener('pagehide', onUnload);
			window.removeEventListener('beforeunload', onBeforeUnload);
			lease.release();
		};
	});

	/**
	 * Persist the clip. `force` is the author confirming after a conflict, and it is genuinely
	 * DESTRUCTIVE: clips have no version history and no snapshots, so the other author's clip is
	 * simply gone. The prompt says so plainly. Resolves TRUE only when the clip reached R2 —
	 * `saveAs` relies on that to restore the clip it repointed.
	 */
	async function save(force = false): Promise<boolean> {
		if (!clip.assetKey) {
			saveError = 'Pick a source sheet before saving — a clip needs one to resolve its frames.';
			return false;
		}
		saveError = '';
		savedNote = '';
		const ok = await saveState.save({ force });
		if (ok) return true;
		saveError = saveState.message;
		if (saveState.status === 'scope-mismatch') return false; // never forceable — reload is the fix
		if (!force && saveState.status === 'conflict') {
			const confirmed = await askConfirm({
				title: 'Overwrite their clip with yours?',
				message:
					`${saveState.message}\n\n` +
					'This permanently REPLACES the stored clip. It has no version history, ' +
					'so their work cannot be recovered. Cancel to rename yours instead.',
				confirmLabel: 'Overwrite it',
				danger: true,
			});
			return confirmed ? await save(true) : false;
		}
		return false;
	}

	/** Save a COPY under a new name. Resetting the id to the sentinel makes the save key the new
	 * file off the new name; the original's R2 object is untouched. */
	async function saveAs(): Promise<void> {
		const name = await askText({
			title: 'Save a copy',
			label: 'Save as a new clip named:',
			value: `${clip.name} copy`.trim(),
			confirmLabel: 'Save copy',
		});
		if (name === null) return;
		const clean = name.trim();
		if (!clean) return;
		// A refused overwrite must not strand the tab holding the sentinel id + the copy's name.
		const previous = { id: clip.id, name: clip.name };
		const previousEtag = saveState.etag;
		clip = { ...clip, id: UNTITLED_CLIP_ID, name: clean };
		saveState.adoptEtag(null);
		if (!(await save())) {
			clip = { ...clip, id: previous.id, name: previous.name };
			saveState.adoptEtag(previousEtag);
		}
	}

	async function deleteOpen(): Promise<void> {
		const id = pickerId || (clip.id !== UNTITLED_CLIP_ID ? clip.id : '');
		if (!id) return;
		const label = clips.find((c) => c.id === id)?.name ?? id;
		const ok = await askConfirm({
			title: `Delete "${label}"?`,
			message: 'Clips have no version history — this cannot be undone.',
			confirmLabel: 'Delete clip',
			danger: true,
			requireText: label,
		});
		if (!ok) return;
		deleting = true;
		saveError = '';
		savedNote = '';
		try {
			const res = await fetch('/api/flipbook/delete', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id }),
			});
			if (!res.ok) {
				saveError = `Delete failed (HTTP ${res.status}).`;
				return;
			}
			clips = clips.filter((c) => c.id !== id);
			savedNote = `Deleted "${label}".`;
			if (clip.id === id) {
				clip = emptyClip();
				// The open clip is gone → nothing to lease; go inert (freely editable).
				leaseSwitch(null);
				// …and nothing left to discard, so the guards must not warn about the blank clip
				// that replaced it.
				markSaved();
			}
			pickerId = '';
		} catch {
			saveError = 'Delete failed (network error).';
		} finally {
			deleting = false;
		}
	}

	// --- opening a clip ---------------------------------------------------------
	/**
	 * Switching clips is an IN-MEMORY swap, not a navigation.
	 *
	 * It used to be `window.location.href = '/flipbook?clip=…'`, which re-ran the page loader to
	 * fetch one small JSON doc. The loader's real cost is the atlas list: `loadRegionSet` for
	 * EVERY manifest in the project, sequentially, each several R2 round-trips — and none of it
	 * depends on which clip is open. The full document load also discarded the parsed bundle and
	 * the `regionSets` cache, so every sheet the new clip touched was re-fetched from cold.
	 * `/api/flipbook/clip` returns the doc and its ETag, which is all a swap actually needs.
	 *
	 * `?clip=` is still kept in the address bar so the deep link is unchanged and shareable —
	 * via `replaceState`, which updates the URL WITHOUT running a load. The loader therefore
	 * stays the seeder for a cold open of that link; it simply stops being the seeder for a
	 * switch made inside the tool.
	 */
	/** Per-clip editor state that must NOT survive a swap — the playhead, transient notes, and
	 *  a pan/zoom that was framed around a different clip's art. */
	function resetPerClipView(): void {
		playing = false;
		step = 0;
		saveError = '';
		savedNote = '';
		importNote = '';
		importError = '';
		fitView();
	}

	/** Ask before anything that would DISCARD unsaved edits. */
	async function confirmDiscard(action: string): Promise<boolean> {
		if (!isDirty()) return true;
		return await askConfirm({
			title: `"${clip.name || 'This clip'}" has unsaved changes`,
			message: `${action} will discard them.`,
			confirmLabel: 'Discard them',
			danger: true,
		});
	}

	async function newClip(): Promise<void> {
		if (!(await confirmDiscard('Starting a new clip'))) return;
		const fresh = emptyClip();
		clip = fresh;
		sheetKey = fresh.assetKey || data.atlases[0]?.manifestKey || '';
		pickerId = '';
		// No stored doc behind a fresh clip ⇒ the next save takes the create path, and there is
		// nothing to lease until it has a persisted key.
		saveState.adoptEtag(null);
		leaseSwitch(null);
		resetPerClipView();
		markSaved();
		replaceState('/flipbook', {});
	}

	async function openClip(id: string): Promise<void> {
		if (!id || opening) return;
		if (id === clip.id && !isDirty()) return; // already open and untouched
		const label = clips.find((c) => c.id === id)?.name ?? id;
		if (!(await confirmDiscard(`Opening "${label}"`))) return;
		opening = true;
		saveError = '';
		try {
			const qs = new URLSearchParams({ id, project: data.projectKey });
			const res = await fetch(`/api/flipbook/clip?${qs}`);
			if (!res.ok) {
				const out = (await res.json().catch(() => ({}))) as { message?: string };
				saveError = out.message ?? `Could not open "${label}" (HTTP ${res.status}).`;
				return;
			}
			const out = (await res.json()) as { clip: FlipbookClip; etag: string | null };
			clip = out.clip;
			// The clip's own sheet becomes the picker's, so its frames' thumbnails resolve; the
			// `$effect` over `clipSheetKeys` fetches any OTHER sheet a multi-sheet clip names, and
			// skips every sheet already in `regionSets` — the cache the reload used to throw away.
			sheetKey = out.clip.assetKey || sheetKey;
			pickerId = out.clip.id;
			saveState.adoptEtag(out.etag);
			leaseSwitch(leaseIdFor(out.clip.id));
			resetPerClipView();
			markSaved();
			replaceState(`/flipbook?clip=${encodeURIComponent(out.clip.id)}`, {});
		} catch {
			saveError = `Could not open "${label}" (network error).`;
		} finally {
			opening = false;
		}
	}

	// --- animation plist import / export ----------------------------------------
	// The cocos2d ANIMATION plist is the file that actually STATES an animation — an ordered
	// frame list plus timing — so it can HOLD a frame and run frames out of numeric order,
	// neither of which filename detection can express. Importing one replaces a guess with the
	// authored truth.
	//
	// Done client-side because everything needed is already here: the parser is pure, and
	// `data.atlases` carries each sheet's regions, which is what pins every frame to the page
	// that packs it. Saving reuses `/api/flipbook/save`, so an imported clip gets exactly the
	// same normalisation and the same guards as a hand-authored one.
	let importing = $state(false);
	let importNote = $state('');
	/** Import failures render IN the plist box, not through `saveError`. `saveError` surfaces in
	 * the tool bar's meta pill — top-right, far from the button that was just clicked — so a
	 * refused import read as "nothing happened" rather than as the explanation it actually was. */
	let importError = $state('');

	async function importAnimationPlist(file: File): Promise<void> {
		importing = true;
		importNote = '';
		importError = '';
		try {
			const doc = parseAnimationPlist(await file.text());
			if (doc.animations.length === 0) {
				importError = 'That plist has no animations in it.';
				return;
			}
			const sheets = data.atlases.map((a) => ({ assetKey: a.manifestKey, regions: a.regions }));
			const incoming = doc.animations.map((a) => animationToClip(a, sheets));
			const lines = incoming.map(
				(c) => `  • ${c.name} — ${c.frames.length} frames @ ${c.fps ?? DEFAULT_FLIPBOOK_FPS}fps`,
			);
			// An import OVERWRITES a clip of the same id, and clips have no version history — so
			// name the ones that will be replaced instead of burying it in a generic warning.
			const clash = incoming.filter((c) => clips.some((row) => row.id === c.id));
			const warning = clash.length
				? ['', `${clash.length} of these already exist and will be REPLACED:`]
						.concat(clash.map((c) => `  • ${c.name}`))
						.join(String.fromCharCode(10))
				: '';
			const summary = lines.concat(warning ? [warning] : []).join(String.fromCharCode(10));
			const proceed = await askConfirm({
				title: `Import ${incoming.length} animation(s)?`,
				message: summary,
				confirmLabel: 'Import',
				danger: clash.length > 0,
			});
			if (!proceed) return;

			let ok = 0;
			for (const c of incoming) {
				const res = await fetch('/api/flipbook/save', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ clip: c, projectKey: data.projectKey, force: true }),
				});
				if (!res.ok) continue;
				const out = (await res.json()) as { id: string; name: string; frames: number };
				upsertClip({ id: out.id, name: out.name, frames: out.frames });
				ok++;
			}
			importNote = `Imported ${ok} of ${incoming.length} animation(s).`;
			if (ok < incoming.length) importError = 'Some animations could not be saved.';
		} catch (e) {
			importError =
				e instanceof Error ? e.message : 'That file could not be read as an animation plist.';
		} finally {
			importing = false;
		}
	}

	// --- source sheets + regions ------------------------------------------------
	// A clip may span SEVERAL sheets: a multipacked export routinely interleaves one animation
	// across pages (a 49-frame sequence arrived split over four). So region sets are cached PER
	// SHEET — the picker shows the selected sheet, but the frame list and preview each resolve
	// against whichever sheet their own frame names.
	let sheetKey = $state<string>(data.openedClip?.assetKey ?? data.atlases[0]?.manifestKey ?? '');
	let regionSets = $state<Record<string, RegionSet>>({});
	let regionFilter = $state('');

	/** Fetch a sheet's regions once; repeat calls for a cached sheet are no-ops. */
	function ensureRegions(key: string): void {
		if (!key || regionSets[key]) return;
		void fetchRegions(key).then((set) => {
			if (set) regionSets = { ...regionSets, [key]: set };
		});
	}

	// The selected sheet (for the picker) plus every sheet the clip's frames already reference,
	// so a reopened multi-sheet clip renders all its thumbnails rather than only the primary's.
	$effect(() => {
		ensureRegions(sheetKey);
		for (const key of clipSheetKeys(clip)) ensureRegions(key);
	});

	const REFRESH_TITLE =
		"Re-read this project's sheets from R2 — the region rects and the page image are cached " +
		'for this browser session, so this tab keeps drawing the old art after an atlas is ' +
		're-packed or redeployed elsewhere.';

	/** ↻ Refresh spinner — one click is several awaits long, so a second must not stack. */
	let refreshing = $state(false);

	/**
	 * Re-read the source art from R2. The server answers fresh on every call — what goes stale is
	 * CLIENT-side and lives for the whole SPA session: `fetchRegions`' module cache (the rects AND
	 * the `pageVersion` that busts the image URL) and `RegionThumb`'s shared page decodes. So an
	 * atlas re-packed in the Atlas Maker — a separate origin, in another tab — keeps drawing its
	 * OLD art here until those are dropped. Same remedy as the Scene Editor's ↻ Reload art
	 * (`EditorCanvas.refreshAssets`).
	 */
	async function refreshArt(): Promise<void> {
		if (refreshing) return;
		refreshing = true;
		try {
			clearRegionCache();
			clearPageImages();
			clearCropPages();
			regionSets = {};
			// Resetting `regionSets` re-runs the effect above, but re-fetching here explicitly keeps
			// the refresh correct if that dependency ever moves; `fetchRegions` de-dupes per sheet.
			ensureRegions(sheetKey);
			for (const key of clipSheetKeys(clip)) ensureRegions(key);
			// The sheet LIST and each sheet's region names come from the server load, so a sheet added,
			// renamed or re-packed since this tab opened needs that load re-run too. Safe for unsaved
			// work: `clip`, `pickerId`, `clips` and `sheetKey` seed from `data` once, and nothing syncs
			// `data.openedClip` back into them.
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	const regionSet = $derived(regionSets[sheetKey] ?? null);
	const visibleRegions = $derived(
		(regionSet?.regions ?? []).filter((r) =>
			regionFilter ? r.name.toLowerCase().includes(regionFilter.toLowerCase()) : true,
		),
	);

	/** Resolve a frame ENTRY to the sheet it names and that sheet's region record. `set` is null
	 * while the sheet is still fetching — which must read as "not loaded yet", never as missing. */
	function frameLookup(entry: string): {
		assetKey: string;
		region: string;
		set: RegionSet | null;
		record: RegionSet['regions'][number] | null;
	} {
		const ref = parseFrameRef(entry);
		const assetKey = ref.assetKey ?? clip.assetKey;
		const set = regionSets[assetKey] ?? null;
		return {
			assetKey,
			region: ref.region,
			set,
			record: set ? (set.regions.find((r) => r.name === ref.region) ?? null) : null,
		};
	}

	/** True once EVERY sheet this clip references has loaded — the only point at which a missing
	 * frame is a real finding rather than a pending fetch. */
	const allSheetsLoaded = $derived(clipSheetKeys(clip).every((k) => !!regionSets[k]));

	/**
	 * Author-time dangling detection (design doc §"Referential integrity"): a clip joins its sheet
	 * by region NAME, which survives a repack but NOT a rename or delete. Catching it the moment
	 * the author opens the clip is the whole point — a silently shortened animation looks
	 * plausible, so it must never be discovered at bake.
	 *
	 * Checked PER SHEET: a frame scoped to page 1 must not be excused by a same-named region on
	 * page 0, which is exactly the cross-sheet mix-up scoped refs exist to prevent.
	 */
	const missingFrames = $derived(
		allSheetsLoaded ? clip.frames.filter((f) => frameLookup(f).record === null) : [],
	);

	/** Sheets this clip draws from — used to decide whether to label rows by sheet at all. */
	const clipSheets = $derived(clipSheetKeys(clip));
	/** Short label for a sheet, matching the picker's. */
	const sheetLabel = (key: string): string =>
		data.atlases.find((a) => a.manifestKey === key)?.label ?? key.split('/').pop() ?? key;

	/** Switching sheets is NON-destructive now: it is the normal way to add frames from another
	 * page of a multipacked atlas. The primary `assetKey` only follows the picker while the clip
	 * is still empty; after that, frames from other sheets are stored as scoped refs. */
	function pickSheet(key: string): void {
		if (key === sheetKey) return;
		sheetKey = key;
		if (clip.frames.length === 0) clip = { ...clip, assetKey: key };
	}

	// --- ordered frame list -----------------------------------------------------
	function setFrames(frames: string[]): void {
		clip = { ...clip, frames };
		// The playhead is clamped against the WALK by its own effect — the walk is derived from
		// these frames, so it re-runs on this assignment.
	}

	/** Append from the SELECTED sheet. A frame from the clip's primary sheet stores a bare name
	 * (so a single-sheet clip's doc is unchanged); anything else stores `<assetKey>::<region>` so
	 * it resolves against its own page and can never pick up a same-named region elsewhere. */
	const appendFrame = (name: string): void => {
		if (clip.frames.length === 0 && clip.assetKey !== sheetKey) {
			clip = { ...clip, assetKey: sheetKey };
		}
		setFrames([...clip.frames, sheetKey === clip.assetKey ? name : `${sheetKey}::${name}`]);
	};

	const removeFrame = (i: number): void => setFrames(clip.frames.filter((_, n) => n !== i));

	// --- detected sequences -----------------------------------------------------
	// A sheet states its animations in its region names. Rebuilding a 49-frame run by clicking
	// 49 thumbnails is the wrong default, so offer each consecutively-numbered run as one click.
	// Detected from the region NAMES rather than read from the manifest's `sequences` hint, so an
	// authored sheet gets the same offer as one imported verbatim from a .plist — the hint stays
	// provenance. `detectSequences` is held to parity with the Sheet Maker's Python twin by
	// `tools/flipbook-spike/sequences.ts`.
	// Detected across EVERY sheet in the project, not just the selected one. A multipacked export
	// scatters one animation over its pages, so per-sheet detection finds only fragments: the
	// owner's real 4-page export offered runs of 6, then 7/4/3, then 3/3/3, then nothing — while
	// the union is the single 49-frame animation that was actually authored. `detectSequencesAcross`
	// only merges across sheets when the indices are UNIQUE (a real multipack); sheets that reuse
	// the same numbering — every Sheet-Maker sheet is `frame_0000…` — are detected separately, so an
	// offer can never splice one symbol's frames into another's clip.
	const sequences = $derived(
		detectSequencesAcross(
			data.atlases.map((a) => ({ assetKey: a.manifestKey, regions: a.regions })),
		),
	);
	/** Runs not already exactly loaded — a run the author just applied stops being an offer.
	 *  Labelled by SHEET in the list below (`sheetLabel`), never by stem alone: every Sheet-Maker
	 *  sheet detects under the same stem (`frame`), so the stem cannot tell two symbols apart. */
	const sequenceOffers = $derived(
		sequences.filter((s) => s.frames.join(' ') !== clip.frames.join(' ')),
	);

	/** Replace (not append) the frame list with a detected run. Appending would silently produce
	 * a double-length clip when clicked twice, and the run IS the animation — so it is the list.
	 * The run carries its own `primary` sheet (the one holding the most of its frames, so the
	 * stored doc needs the fewest scoped refs), which becomes the clip's `assetKey`. */
	async function useSequence(seq: {
		stem: string;
		primary: string;
		frames: string[];
		sheets: string[];
	}): Promise<void> {
		if (clip.frames.length > 0) {
			const ok = await askConfirm({
				title: `Replace the ${clip.frames.length} frame(s) in this clip?`,
				message:
					`They become the ${seq.frames.length}-frame sequence "${seq.stem}" from ` +
					`${seq.sheets.map(sheetLabel).join(' + ')}.`,
				confirmLabel: 'Replace frames',
				danger: true,
			});
			if (!ok) return;
		}
		clip = {
			...clip,
			assetKey: seq.primary,
			// Only name the clip after the run when it is still unnamed/untitled — never clobber
			// a name the author chose.
			name: clip.name && clip.id !== UNTITLED_CLIP_ID ? clip.name : seq.stem,
			frames: [...seq.frames],
		};
		sheetKey = seq.primary;
		step = 0;
	}

	/** Duplicating is a first-class edit, not a convenience: a repeated frame IS a hold, and the
	 * normalizer deliberately keeps duplicates for exactly this reason. */
	const duplicateFrame = (i: number): void =>
		setFrames([...clip.frames.slice(0, i + 1), clip.frames[i], ...clip.frames.slice(i + 1)]);

	function moveFrame(from: number, to: number): void {
		if (from === to || from < 0 || to < 0) return;
		const next = [...clip.frames];
		const [moved] = next.splice(from, 1);
		next.splice(to, 0, moved);
		setFrames(next);
	}

	// HTML5 drag events — no new dependency, and a frame row is a plain list item.
	let dragFrom = $state<number | null>(null);
	let dragOver = $state<number | null>(null);

	function onDrop(i: number): void {
		if (dragFrom !== null) moveFrame(dragFrom, i);
		dragFrom = null;
		dragOver = null;
	}

	// --- playback ---------------------------------------------------------------
	/**
	 * The playhead is an index into the WALK (`playbackIndices`), not into the authored frame
	 * list — which is the only way a reverse or ping-pong preview can be scrubbed monotonically
	 * and still report "3 / 8" against the frames the author sees. `frameAt` maps back to the
	 * authored index for the thumbnail, the name readout and the current-row highlight.
	 */
	let playing = $state(false);
	let step = $state(0);

	const fps = $derived(clip.fps ?? DEFAULT_FLIPBOOK_FPS);
	const loop = $derived(clip.loop !== false);
	const direction = $derived(clip.direction ?? 'forward');
	const walk = $derived(playbackIndices(clip.frames.length, clip.direction));
	/** The AUTHORED frame index under the playhead — what the list highlights. */
	const frameIndex = $derived(walk[step] ?? 0);
	const currentName = $derived(clip.frames[frameIndex] ?? '');
	const current = $derived(currentName ? frameLookup(currentName) : null);

	/**
	 * The playback clock. Deliberately accumulator-based rather than `setInterval(1000/fps)` so a
	 * dropped rAF doesn't desynchronise the sequence — a flipbook's timing IS its content.
	 * Reads only `playing`, `count` and `rate`, so advancing `step` cannot re-enter it.
	 */
	$effect(() => {
		const count = walk.length;
		const rate = fps;
		const looping = loop;
		if (!playing || count === 0 || rate <= 0) return;
		let raf = 0;
		let last = performance.now();
		let acc = 0;
		const tick = (now: number): void => {
			acc += now - last;
			last = now;
			const period = 1000 / rate;
			while (acc >= period) {
				acc -= period;
				const next = step + 1;
				if (next >= count) {
					if (!looping) {
						playing = false;
						return;
					}
					step = 0;
				} else {
					step = next;
				}
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	/** Clamp the playhead when the walk shrinks — deleting frames, or switching OUT of ping-pong,
	 * both leave `step` past the end, which would strand the preview on a blank. */
	$effect(() => {
		if (step >= walk.length) step = Math.max(0, walk.length - 1);
	});

	function setDirection(v: string): void {
		const next = isFlipbookDirection(v) ? v : 'forward';
		// Dropped when it is the default, so a clip that never touched this saves byte-identical.
		if (next === 'forward') {
			const { direction: _drop, ...rest } = clip;
			clip = rest;
		} else {
			clip = { ...clip, direction: next };
		}
		step = 0;
	}

	/** `false` is DROPPED rather than stored: absent already means "not mirrored", and writing it
	 * out would churn every clip's bytes the first time anyone opened this control. */
	function setFlip(axis: 'flipX' | 'flipY', on: boolean): void {
		if (on) {
			clip = { ...clip, [axis]: true };
		} else {
			const next = { ...clip };
			delete next[axis];
			clip = next;
		}
	}

	// --- bounds box ---------------------------------------------------------------
	/**
	 * The clip's declared BOX — the frame-animation twin of the Rigger's Bounds. Everything below
	 * works in ART PIXELS, origin-centred, the space `FlipbookBounds` is defined in.
	 *
	 * While the box editor is OPEN the stage deliberately fits a FIXED frame (`editorBox`) rather
	 * than the box being dragged: fitting the box itself would rescale the art under the cursor on
	 * every pixel of the drag, which makes it impossible to judge where the box sits against the
	 * art. Closed, the stage fits the authored box — what the game will draw.
	 */
	let boundsOpen = $state(false);

	/** Every frame's geometry in `FlipbookFrameBox` terms, skipping frames whose region hasn't
	 * loaded (or has gone missing) — an auto-fit measures what it can actually see. */
	const frameBoxes = $derived.by(() => {
		const out: FlipbookFrameBox[] = [];
		for (const entry of clip.frames) {
			const look = frameLookup(entry);
			const r = look.record;
			if (!r) continue;
			out.push({
				origW: r.origW ?? r.w,
				origH: r.origH ?? r.h,
				offX: r.offX ?? 0,
				offY: r.offY ?? 0,
				artW: r.w,
				artH: r.h,
			});
		}
		return out;
	});

	/** The box that just contains every frame's art — what ⊙ Fit writes. */
	const autoBounds = $derived(fitClipBounds(frameBoxes));

	/** The FIXED art-space window the box editor works in: the auto-fit and the authored box
	 * together, with a margin, so a box drawn well outside the art is still reachable. */
	const editorBox = $derived.by(() => {
		const parts = [autoBounds, clip.bounds].filter((b): b is FlipbookBounds => !!b);
		if (parts.length === 0) return undefined;
		const left = Math.min(...parts.map((b) => b.x));
		const top = Math.min(...parts.map((b) => b.y));
		const right = Math.max(...parts.map((b) => b.x + b.w));
		const bottom = Math.max(...parts.map((b) => b.y + b.h));
		const pad = Math.max(right - left, bottom - top) * 0.12;
		return { x: left - pad, y: top - pad, w: right - left + pad * 2, h: bottom - top + pad * 2 };
	});

	/** Which box the STAGE is fitted to right now (see `boundsOpen` above). */
	const stageBox = $derived(boundsOpen ? editorBox : clip.bounds);

	/**
	 * The preview is RESIZABLE (the stage carries a native CSS resize grip), so its size is
	 * measured rather than fixed. A 240px square was fine for judging frame order and never fine
	 * for placing a bounds box — the thing this preview is now also for.
	 *
	 * The thumbnail is square, so the size is the smaller side of the stage: dragging the grip
	 * down grows it until it hits the column width. Remembered per browser, because a preview you
	 * resized that snapped back on the next clip would be worse than a fixed one.
	 */
	/**
	 * The preview VIEWPORT — a pan/zoom canvas, not a fixed window.
	 *
	 * Three rules this is built on, each of them paid for:
	 *
	 * 1. **Nothing measured is ever written back into what is measured.** The first attempt at a
	 *    resizable preview observed the stage and assigned its height back — but the observed
	 *    height is the BORDER box and the assigned one the CONTENT box, so each pass added the 2px
	 *    border and the canvas grew without limit until the tool was unusable. The height is now
	 *    owned by the grip below (pointer deltas only) and the observer feeds NOTHING that changes
	 *    the element it watches.
	 * 2. **Zoom changes the thumbnail's PIXEL size, never a CSS scale.** The canvas redraws at the
	 *    zoomed size (sharp rather than upscaled), and — the part that matters — the box overlay's
	 *    positioning context stays unscaled, so `BoundsBox` keeps measuring pointers in plain
	 *    screen pixels and `boxFit` needs no zoom term at all.
	 * 3. **The pane is positioned, not centred by layout.** Centring is a one-line effect while the
	 *    view is untouched; the moment the author pans or zooms, their position is the truth.
	 */
	const VIEW_MIN_H = 180;
	const VIEW_KEY = 'flipbook.viewportHeight.v1';
	/** Viewport height. Written ONLY by the grip and the restore below — never by a measurement. */
	let viewH = $state(320);
	/** Measured content box, used for fitting and centring. Read-only, by rule 1. */
	let viewW = $state(0);
	let viewInnerH = $state(0);
	let viewportEl = $state<HTMLElement | null>(null);
	let zoom = $state(1);
	/** The pane's top-left inside the viewport. */
	let paneX = $state(0);
	let paneY = $state(0);
	/** Once the author pans or zooms, auto-centring stops fighting them. `⬚ Fit` clears it. */
	let viewTouched = $state(false);

	/** The thumbnail size at zoom 1: the largest square the viewport holds, with a little margin. */
	const fitSize = $derived(Math.max(48, Math.floor(Math.min(viewW, viewInnerH)) - 16));
	/** The thumbnail's pixel size right now — what `RegionThumb` draws at AND what `boxFit` maps
	 * into, so the art and the box overlay can never disagree about their shared box. */
	const stageSize = $derived(paneSize(fitSize, zoom));

	$effect(() => {
		const el = viewportEl;
		if (!el) return;
		// `contentRect`, not `getBoundingClientRect()` — the content box is what the pane lives in,
		// and mixing the two box models is precisely what made the canvas grow forever.
		const ro = new ResizeObserver((entries) => {
			for (const entry of entries) {
				viewW = entry.contentRect.width;
				viewInnerH = entry.contentRect.height;
			}
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	// Centre the pane while the view is untouched. Writes only `paneX`/`paneY`, which nothing above
	// reads — so this can never feed itself.
	$effect(() => {
		const w = viewW;
		const h = viewInnerH;
		const s = stageSize;
		if (viewTouched) return;
		const at = centrePane(w, h, s);
		paneX = at.x;
		paneY = at.y;
	});

	onMount(() => {
		try {
			const saved = Number(localStorage.getItem(VIEW_KEY));
			if (Number.isFinite(saved) && saved >= VIEW_MIN_H) viewH = saved;
		} catch {
			/* nothing stored ⇒ the default */
		}
	});

	/** Back to "the whole clip, centred" — the escape hatch from any pan/zoom. */
	function fitView(): void {
		zoom = 1;
		viewTouched = false;
	}

	/** Zoom about a point in VIEWPORT coordinates, so the art under the cursor stays under it.
	 * Expressed as a ratio of the pane's size before and after, which needs no art coordinates. */
	function zoomAt(nextZoom: number, cx: number, cy: number): void {
		const next = zoomAbout({ zoom, x: paneX, y: paneY }, fitSize, nextZoom, cx, cy);
		if (next.zoom === zoom && next.x === paneX && next.y === paneY) return;
		zoom = next.zoom;
		paneX = next.x;
		paneY = next.y;
		viewTouched = true;
	}

	function viewportPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
		const rect = viewportEl?.getBoundingClientRect();
		if (!rect) return { x: 0, y: 0 };
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	function onWheel(e: WheelEvent): void {
		// The page does not scroll here; the wheel is the zoom, as in every canvas tool.
		e.preventDefault();
		const at = viewportPoint(e);
		zoomAt(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), at.x, at.y);
	}

	function zoomStep(factor: number): void {
		zoomAt(zoom * factor, viewW / 2, viewInnerH / 2);
	}

	/** Pan. Started on the viewport background OR on the art itself; `BoundsBox` stops its own
	 * pointer events, so dragging a box handle never pans underneath it. */
	let panFrom: { x: number; y: number; paneX: number; paneY: number } | null = null;

	function onPanStart(e: PointerEvent): void {
		if (e.button !== 0 && e.button !== 1) return;
		const at = viewportPoint(e);
		panFrom = { x: at.x, y: at.y, paneX, paneY };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPanMove(e: PointerEvent): void {
		if (!panFrom) return;
		const at = viewportPoint(e);
		paneX = panFrom.paneX + (at.x - panFrom.x);
		paneY = panFrom.paneY + (at.y - panFrom.y);
		viewTouched = true;
	}

	function onPanEnd(e: PointerEvent): void {
		if (!panFrom) return;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
		panFrom = null;
	}

	/** The viewport's own resize grip. Pointer DELTAS drive the height — the height is never read
	 * back off the element, which is the whole reason the previous attempt ran away. */
	let gripFrom: { y: number; h: number } | null = null;

	function onGripStart(e: PointerEvent): void {
		gripFrom = { y: e.clientY, h: viewH };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	}

	function onGripMove(e: PointerEvent): void {
		if (!gripFrom) return;
		viewH = Math.max(VIEW_MIN_H, Math.round(gripFrom.h + (e.clientY - gripFrom.y)));
	}

	function onGripEnd(e: PointerEvent): void {
		if (!gripFrom) return;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
		gripFrom = null;
		try {
			localStorage.setItem(VIEW_KEY, String(viewH));
		} catch {
			/* blocked storage ⇒ the size just isn't remembered */
		}
	}

	/**
	 * Art pixels → pane pixels: the same centred contain-fit `RegionThumb` performs on `stageBox`,
	 * so the overlay lands exactly on the art it is describing.
	 *
	 * Expressed against the PANE — an element of exactly `stageSize` square holding both the
	 * thumbnail and the overlay — never against the viewport around it. Measuring from the
	 * viewport put the box half the leftover width away from its art, and every drag with it.
	 */
	const stageFit = $derived(boxFit(stageSize, stageBox));

	/** This frame's geometry re-based onto `stageBox` — `null` when no box applies, in which case
	 * the thumbnail fits the frame's own canvas exactly as it always has. */
	function stageFrameBox(
		r: RegionSet['regions'][number],
	): { origW: number; origH: number; offX: number; offY: number } | null {
		const b = stageBox;
		if (!b || !(b.w > 0) || !(b.h > 0)) return null;
		const out = applyClipBounds(
			{
				origW: r.origW ?? r.w,
				origH: r.origH ?? r.h,
				offX: r.offX ?? 0,
				offY: r.offY ?? 0,
				artW: r.w,
				artH: r.h,
			},
			b,
		);
		return { origW: out.origW, origH: out.origH, offX: out.offX, offY: out.offY };
	}

	function setBounds(b: FlipbookBounds | undefined): void {
		if (!b) {
			const { bounds: _drop, ...rest } = clip;
			clip = rest;
			return;
		}
		const round = (n: number): number => Math.round(n * 100) / 100;
		clip = {
			...clip,
			bounds: {
				x: round(b.x),
				y: round(b.y),
				w: round(Math.max(1, b.w)),
				h: round(Math.max(1, b.h)),
			},
		};
	}

	/** Open the editor with a box already in hand: an author who has never declared one should see
	 * the auto-fit, not an empty overlay they have to guess the first corner of. */
	function toggleBounds(): void {
		if (!boundsOpen && !clip.bounds && autoBounds) setBounds(autoBounds);
		boundsOpen = !boundsOpen;
	}

	/** One axis of the box, from the numeric fields. Written as an explicit switch rather than a
	 * computed spread key so the object stays a `FlipbookBounds` to the type-checker — this app's
	 * build strips types without checking them, so an `any` here would never be caught. */
	function setBoundsField(b: FlipbookBounds, key: 'x' | 'y' | 'w' | 'h', v: number): void {
		setBounds({
			x: key === 'x' ? v : b.x,
			y: key === 'y' ? v : b.y,
			w: key === 'w' ? v : b.w,
			h: key === 'h' ? v : b.h,
		});
	}

	function centreBounds(): void {
		const b = clip.bounds;
		if (b) setBounds({ x: -b.w / 2, y: -b.h / 2, w: b.w, h: b.h });
	}

	/** The stage element the box overlay measures against — `BoundsBox` converts pointer positions
	 * back into art pixels through it. */
	let stageEl = $state<HTMLElement | null>(null);

	function setFps(v: number): void {
		clip = { ...clip, fps: Number.isFinite(v) && v > 0 ? v : DEFAULT_FLIPBOOK_FPS };
	}
</script>

<svelte:head><title>Invisible Flipbook</title></svelte:head>

<div class="page">
	<ToolTopBar
		current="flipbook"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.projectKey}
	>
		{#snippet meta()}
			<CanvasModeBar
				inline
				options={[
					{ value: 'clips', label: 'Clips', title: 'Author a clip from atlas frames' },
					{ value: 'video', label: '🎬 Video', title: 'Generate video from a blueprint' },
				]}
				bind:value={mode}
				ariaLabel="Flipbook mode"
			/>
			{#if mode === 'clips'}
				<!-- Another author (or your own other tab) holds this clip's lease → read-only here.
			     The doc saveState refuses to save (its blockWhen); Take over is always offered. -->
				<PresenceBanner {lease} />
				{#if saveError}
					<span class="pill err">{saveError}</span>
				{:else if savedNote}
					<span class="pill ok">{savedNote}</span>
				{/if}
				{#if missingFrames.length}
					<span class="pill err" title={missingFrames.join(', ')}>
						{missingFrames.length} missing region{missingFrames.length === 1 ? '' : 's'}
					</span>
				{/if}
				<span>{clip.frames.length} frame{clip.frames.length === 1 ? '' : 's'}</span>
			{/if}
		{/snippet}
	</ToolTopBar>

	{#if mode === 'clips'}
		<div class="body">
			<aside class="rail">
				<div class="head">
					<h3>Clips</h3>
					<button class="add" onclick={() => void newClip()}>+ New</button>
				</div>

				<!-- The animation plist is authored elsewhere (a cocos project, an exporter) and states
			     the sequence outright — holds, order and rate — so it beats anything inferred from
			     filenames. It travels both ways because we ship the format, not just read it. -->
				<div class="plistbox">
					<h4>Animation plist</h4>
					<label class="ppick">
						<span>{importing ? 'Importing…' : 'Import .plist…'}</span>
						<input
							type="file"
							accept=".plist"
							disabled={importing || lease.readOnly}
							onchange={(e) => {
								const f = e.currentTarget.files?.[0];
								e.currentTarget.value = '';
								if (f) void importAnimationPlist(f);
							}}
						/>
					</label>
					<a class="pexport" href="/api/flipbook/animations" download>⤓ Export all clips</a>
					<p class="phint">
						An <b>animation</b> plist (ordered frames + timing), not a sprite-sheet plist — those go
						in the Sheet Maker.
					</p>
					{#if importNote}<p class="pnote">{importNote}</p>{/if}
					{#if importError}
						<p class="perr">{importError}</p>
						{#if /sprite-SHEET/.test(importError)}
							<!-- The overwhelmingly likely mistake, so name the fix rather than the fault: a
						     sheet plist and an animation plist look identical from the outside. -->
							<p class="phint">
								That is the file the <b>Sheet Maker</b> takes — it lists frame rectangles, not a
								sequence. An animation plist has an <code>animations</code> key and is written by the
								game project or cocos tooling, not by TexturePacker.
							</p>
						{/if}
					{/if}
				</div>
				<ul class="cliplist">
					{#each clips as row (row.id)}
						<li>
							<button class:active={row.id === pickerId} onclick={() => void openClip(row.id)}>
								<span class="nm">{row.name}</span>
								<span class="ct">{row.frames}f</span>
							</button>
						</li>
					{:else}
						<li class="empty">No saved clips yet.</li>
					{/each}
				</ul>

				<div class="railactions">
					<label class="field">
						<span>Name</span>
						<input
							value={clip.name}
							onchange={(e) => (clip = { ...clip, name: e.currentTarget.value })}
						/>
					</label>
					<button class="primary" disabled={busy || lease.readOnly} onclick={() => save()}>
						{saveState.busy ? 'Saving…' : '⤓ Save'}
					</button>
					<button disabled={busy || lease.readOnly} onclick={saveAs}>⧉ Save As…</button>
					<button
						class="danger"
						disabled={busy || !pickerId || lease.readOnly}
						onclick={deleteOpen}
					>
						🗑 Delete
					</button>
				</div>
			</aside>

			<section class="center">
				<div class="preview">
					<!-- Drag the grip in the stage's bottom-right corner to resize the preview. -->
					<!--
						A pan/zoom VIEWPORT, not a fixed window: wheel to zoom about the cursor, drag to
						pan, ⬚ Fit to reset, and the grip below to resize. The pane inside is positioned
						(not centred by layout) and is exactly `stageSize` square — it is both the box
						overlay's positioning context and the element `BoundsBox` measures pointers
						against, which is what keeps the box on its art at every zoom and pan.
					-->
					<div
						class="viewport"
						bind:this={viewportEl}
						style:height="{viewH}px"
						role="presentation"
						onwheel={onWheel}
						onpointerdown={onPanStart}
						onpointermove={onPanMove}
						onpointerup={onPanEnd}
						onpointercancel={onPanEnd}
					>
						{#if current?.set && current.record}
							<div
								class="pane"
								bind:this={stageEl}
								style:left="{paneX}px"
								style:top="{paneY}px"
								style:width="{stageSize}px"
								style:height="{stageSize}px"
							>
								<!-- Mirroring is a CSS transform on the thumbnail rather than a second draw path:
								     the game mirrors with a negative sprite scale about the same centre, so a
								     centred `scale(±1)` shows exactly what will render. -->
								<div
									class="mirror"
									style:transform="scale({clip.flipX ? -1 : 1}, {clip.flipY ? -1 : 1})"
								>
									<RegionThumb
										set={current.set}
										region={current.record}
										size={stageSize}
										box={stageFrameBox(current.record)}
									/>
								</div>
								{#if boundsOpen && clip.bounds && stageFit}
									<!--
										The declared box, drawn over the art at the SAME contain-fit the thumbnail
										used. Deliberately NOT mirrored with the art: the box is the clip's own frame
										of reference, and a mirrored overlay would move each handle away from the
										edge it grabs.
									-->
									<BoundsBox
										bounds={clip.bounds}
										fit={stageFit}
										stage={stageEl}
										onchange={(b) => setBounds(b)}
									/>
								{/if}
							</div>
						{:else}
							<div class="ph">
								{clip.frames.length ? 'Frame not found in this sheet' : 'Add frames to preview'}
							</div>
						{/if}
						<div class="viewbar">
							<button title="Zoom out" onclick={() => zoomStep(1 / 1.25)}>−</button>
							<span class="zoomval">{Math.round(zoom * 100)}%</span>
							<button title="Zoom in" onclick={() => zoomStep(1.25)}>+</button>
							<button title="Fit the clip in the viewport" onclick={fitView}>⬚ Fit</button>
						</div>
					</div>
					<!-- Drag to resize the viewport. Pointer DELTAS only — the height is never read back
					     off the element, which is what made an earlier version grow without limit. -->
					<div
						class="grip"
						role="presentation"
						title="Drag to resize the preview"
						onpointerdown={onGripStart}
						onpointermove={onGripMove}
						onpointerup={onGripEnd}
						onpointercancel={onGripEnd}
					></div>
					<div class="transport">
						<button
							class="play"
							disabled={clip.frames.length === 0}
							onclick={() => (playing = !playing)}
						>
							{playing ? '❚❚ Pause' : '▶ Play'}
						</button>
						<input
							class="scrub"
							type="range"
							min="0"
							max={Math.max(0, walk.length - 1)}
							step="1"
							disabled={walk.length === 0}
							value={step}
							oninput={(e) => {
								playing = false;
								step = Number(e.currentTarget.value);
							}}
						/>
						<!-- Position counts the WALK (a ping-pong is longer than the frame list), while the
						     name under it and the highlighted row name the AUTHORED frame it landed on. -->
						<span class="pos">
							{walk.length ? step + 1 : 0} / {walk.length}
						</span>
						<label class="field inline">
							<span>fps</span>
							<input
								class="num"
								type="number"
								min="1"
								max="120"
								step="1"
								value={fps}
								onchange={(e) => setFps(Number(e.currentTarget.value))}
							/>
						</label>
						<label class="check">
							<input
								type="checkbox"
								checked={loop}
								onchange={(e) => (clip = { ...clip, loop: e.currentTarget.checked })}
							/>
							<span>Loop</span>
						</label>
						<label class="field inline">
							<span>play</span>
							<select
								class="dir"
								value={direction}
								onchange={(e) => setDirection(e.currentTarget.value)}
							>
								<option value="forward">forward</option>
								<option value="reverse">reverse</option>
								<option value="pingpong">ping-pong</option>
							</select>
						</label>
						<label class="check">
							<input
								type="checkbox"
								checked={clip.flipX === true}
								onchange={(e) => setFlip('flipX', e.currentTarget.checked)}
							/>
							<span>Mirror X</span>
						</label>
						<label class="check">
							<input
								type="checkbox"
								checked={clip.flipY === true}
								onchange={(e) => setFlip('flipY', e.currentTarget.checked)}
							/>
							<span>Mirror Y</span>
						</label>
					</div>
					<div class="transport">
						<button
							class:active={boundsOpen}
							disabled={clip.frames.length === 0}
							title="Declare the box every consumer sizes this clip by — the flipbook twin of the Rigger's Bounds. Without one, each frame is sized by its own packed rect."
							onclick={toggleBounds}
						>
							⬚ Bounds
						</button>
						{#if boundsOpen}
							{@const b = clip.bounds}
							<button
								disabled={!autoBounds}
								title="Fit the box to every frame's art"
								onclick={() => setBounds(autoBounds)}>⊙ Fit</button
							>
							<button disabled={!b} title="Centre the box on the clip origin" onclick={centreBounds}
								>⌖ Centre</button
							>
							<button disabled={!b} title="Remove the box" onclick={() => setBounds(undefined)}
								>✕ Clear</button
							>
							{#if b}
								{#each [['x', b.x], ['y', b.y], ['w', b.w], ['h', b.h]] as const as [key, value] (key)}
									<label class="field inline">
										<span>{key}</span>
										<input
											class="num"
											type="number"
											step="1"
											{value}
											onchange={(e) => {
												const v = e.currentTarget.valueAsNumber;
												if (Number.isFinite(v)) setBoundsField(b, key, v);
											}}
										/>
									</label>
								{/each}
							{:else}
								<span class="hint">No box — each frame is sized by its own packed rect.</span>
							{/if}
						{/if}
					</div>
					{#if currentName}<div class="curname">{currentName}</div>{/if}
				</div>

				<div class="frames">
					<h3>Frames — drag to reorder</h3>
					<ol class="framelist">
						{#each clip.frames as name, i (i)}
							{@const look = frameLookup(name)}
							<li
								draggable="true"
								class:dragging={dragFrom === i}
								class:over={dragOver === i}
								class:current={i === frameIndex}
								class:missing={allSheetsLoaded && !look.record}
								ondragstart={() => (dragFrom = i)}
								ondragend={() => {
									dragFrom = null;
									dragOver = null;
								}}
								ondragover={(e) => {
									e.preventDefault();
									dragOver = i;
								}}
								ondrop={(e) => {
									e.preventDefault();
									onDrop(i);
								}}
							>
								<span class="ord">{i + 1}</span>
								<span class="thumb">
									{#if look.set && look.record}
										<RegionThumb set={look.set} region={look.record} size={40} />
									{:else}
										<span class="noart">?</span>
									{/if}
								</span>
								<button
									class="nm"
									title="Show this frame"
									onclick={() => {
										playing = false;
										// Jump to the first tick of the walk that shows this authored frame — under
										// ping-pong a frame appears twice, and the earlier pass is the intuitive one.
										const at = walk.indexOf(i);
										step = at >= 0 ? at : 0;
									}}>{look.region}</button
								>
								<!-- Which PAGE this frame lives on. Shown only when the clip actually spans
							     sheets, so a normal single-sheet clip gains no clutter. -->
								{#if clipSheets.length > 1}
									<span class="sheetchip" title={look.assetKey}>{sheetLabel(look.assetKey)}</span>
								{/if}
								<button
									class="mini"
									title="Duplicate (hold this frame)"
									onclick={() => duplicateFrame(i)}
								>
									⧉
								</button>
								<button class="mini danger" title="Remove frame" onclick={() => removeFrame(i)}>
									✕
								</button>
							</li>
						{:else}
							<li class="empty">
								No frames yet — click regions on the right to append them, in order.
							</li>
						{/each}
					</ol>
				</div>
			</section>

			<aside class="picker">
				<div class="head">
					<h3>Source sheet</h3>
					<button
						class="refresh"
						disabled={busy || refreshing}
						title={REFRESH_TITLE}
						onclick={refreshArt}
					>
						{refreshing ? 'Refreshing…' : '↻ Refresh from R2'}
					</button>
				</div>
				<select
					class="sheet"
					value={sheetKey}
					onchange={(e) => pickSheet(e.currentTarget.value)}
					disabled={data.atlases.length === 0}
				>
					{#each data.atlases as atlas (atlas.manifestKey)}
						<option value={atlas.manifestKey}>{atlas.label}</option>
					{:else}
						<option value="">No atlases in this project</option>
					{/each}
				</select>
				{#if sequenceOffers.length > 0}
					<div class="seqs">
						<h4>Detected animation{sequenceOffers.length === 1 ? '' : 's'}</h4>
						<p class="seqhint">
							Consecutively-numbered regions — probably one animation each. Sheets are combined only
							when their frame numbers do NOT overlap (a multipacked atlas); sheets that reuse the
							same numbering each get their own run, so a clip never mixes two symbols.
						</p>
						<!-- Keyed by sheet + FIRST FRAME, not by stem: one sheet can offer several runs of the
					     same stem (a gap splits a run), and every Sheet-Maker sheet uses the stem `frame`,
					     so a stem key collides and Svelte drops rows. A run's first frame is unique. -->
						{#each sequenceOffers as seq (`${seq.primary}::${seq.frames[0]}`)}
							<button
								class="seq"
								class:seqhere={seq.primary === sheetKey}
								onclick={() => void useSequence(seq)}
							>
								<span class="sqn">{seq.sheets.map(sheetLabel).join(' + ')}</span>
								<span class="sqc"
									>{seq.stem} · {seq.frames.length} frames{seq.sheets.length > 1
										? ` · ${seq.sheets.length} sheets`
										: ''}</span
								>
							</button>
						{/each}
					</div>
				{/if}

				<input class="filter" placeholder="Filter regions…" bind:value={regionFilter} />

				<div class="grid">
					{#each visibleRegions as region (region.name)}
						<button class="cell" title={region.name} onclick={() => appendFrame(region.name)}>
							{#if regionSet}<RegionThumb set={regionSet} {region} size={56} />{/if}
							<span class="cn">{region.name}</span>
						</button>
					{:else}
						<p class="empty">
							{regionSet ? 'No regions match.' : 'Loading regions…'}
						</p>
					{/each}
				</div>
			</aside>
		</div>
	{:else}
		<VideoMode
			projectKey={data.projectKey}
			canPublish={data.canPublishBlueprints}
			atlases={data.atlases}
		/>
	{/if}
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: #0b0e13;
		color: #cbd5e1;
	}
	.pill {
		padding: 2px 8px;
		border-radius: 999px;
		background: #1f2937;
		font-size: 11px;
	}
	.pill.err {
		color: #fca5a5;
	}
	.pill.ok {
		color: #86efac;
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	h3 {
		margin: 0 0 8px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.empty {
		color: #64748b;
		font-size: 12px;
		padding: 6px 2px;
	}

	/* --- left rail --- */
	.rail {
		width: 210px;
		flex: none;
		display: flex;
		flex-direction: column;
		border-right: 1px solid #1f2937;
		padding: 12px;
		min-height: 0;
	}
	.rail .head,
	.picker .head {
		display: flex;
		flex: none;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.cliplist {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.cliplist button {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 6px;
		padding: 5px 8px;
		border-radius: 6px;
		border: 1px solid transparent;
		background: #10161e;
		color: #cbd5e1;
		font-size: 12px;
		text-align: left;
		cursor: pointer;
		margin-bottom: 4px;
	}
	.cliplist button.active {
		border-color: #2563eb;
		color: #bfdbfe;
	}
	.cliplist .nm {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cliplist .ct {
		color: #64748b;
		font-size: 11px;
	}
	.railactions {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-top: 10px;
		border-top: 1px solid #1f2937;
	}
	.field {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: #94a3b8;
	}
	.field input {
		flex: 1;
		min-width: 0;
		padding: 4px 8px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #0e131a;
		color: #e2e8f0;
		font-size: 12px;
	}
	button {
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #161b22;
		color: #cbd5e1;
		font-size: 12px;
		padding: 5px 10px;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button.primary {
		border-color: #2563eb;
		color: #bfdbfe;
	}
	button.danger {
		border-color: #5b2a2a;
		color: #fca5a5;
	}
	.add {
		padding: 3px 8px;
		border-color: #2563eb;
		color: #bfdbfe;
	}
	.refresh {
		flex: none;
		padding: 3px 8px;
		white-space: nowrap;
	}

	/* --- centre: preview + ordered frames --- */
	.center {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.preview {
		flex: none;
		padding: 12px;
		border-bottom: 1px solid #1f2937;
	}
	.viewport {
		position: relative;
		overflow: hidden;
		border-radius: 8px;
		background: #070a0e;
		border: 1px solid #1f2937;
		/* `border-box` so the styled height IS the measured height. The two box models disagreeing
		   by the 2px border is exactly what an earlier observer fed back into itself. */
		box-sizing: border-box;
		min-height: 180px;
		/* The wheel is the zoom and a drag is the pan, so the browser must not claim either. */
		touch-action: none;
		overscroll-behavior: contain;
		cursor: grab;
	}
	.viewport:active {
		cursor: grabbing;
	}
	.pane {
		position: absolute;
	}
	.viewbar {
		position: absolute;
		right: 8px;
		bottom: 8px;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 3px 5px;
		border-radius: 6px;
		background: rgba(7, 10, 14, 0.82);
		border: 1px solid #1f2937;
	}
	.viewbar button {
		min-width: 24px;
		padding: 2px 6px;
		font-size: 11px;
	}
	.zoomval {
		min-width: 38px;
		text-align: center;
		color: #64748b;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.grip {
		height: 9px;
		margin: 2px 0 0;
		border-radius: 0 0 6px 6px;
		background: repeating-linear-gradient(90deg, #1f2937 0 12px, transparent 12px 18px);
		cursor: ns-resize;
		touch-action: none;
	}
	.mirror {
		display: grid;
		place-items: center;
		line-height: 0;
	}
	.ph {
		color: #475569;
		font-size: 12px;
	}
	.dir {
		min-width: 96px;
	}
	.hint {
		color: #64748b;
		font-size: 11px;
	}
	.transport button.active {
		border-color: #7ee0c0;
		color: #7ee0c0;
	}
	.transport {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 10px;
	}
	.play {
		width: 88px;
	}
	.scrub {
		flex: 1;
		min-width: 60px;
	}
	.pos {
		font-size: 12px;
		color: #94a3b8;
		font-variant-numeric: tabular-nums;
		min-width: 62px;
		text-align: center;
	}
	.field.inline {
		flex: none;
	}
	.num {
		width: 56px;
		flex: none;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: #94a3b8;
	}
	.curname {
		margin-top: 6px;
		font-size: 11px;
		color: #64748b;
		font-family: ui-monospace, monospace;
	}
	.frames {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px;
	}
	.framelist {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.framelist li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 8px;
		border-radius: 6px;
		border: 1px solid #1f2937;
		background: #10161e;
		cursor: grab;
	}
	.framelist li.dragging {
		opacity: 0.4;
	}
	.framelist li.over {
		border-color: #2563eb;
	}
	.framelist li.current {
		background: #131f2e;
	}
	.framelist li.missing .nm {
		color: #fca5a5;
		text-decoration: line-through;
	}
	.framelist li.empty {
		border-style: dashed;
		cursor: default;
	}
	.ord {
		width: 26px;
		flex: none;
		text-align: right;
		font-size: 11px;
		color: #64748b;
		font-variant-numeric: tabular-nums;
	}
	.thumb {
		flex: none;
		display: block;
	}
	.noart {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 4px;
		background: #16161c;
		color: #555;
	}
	.framelist .nm {
		flex: 1;
		min-width: 0;
		text-align: left;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		border: none;
		background: none;
		padding: 0;
		font-family: ui-monospace, monospace;
	}
	.mini {
		flex: none;
		padding: 2px 7px;
	}

	/* --- right: region picker --- */
	.picker {
		width: 260px;
		flex: none;
		display: flex;
		flex-direction: column;
		border-left: 1px solid #1f2937;
		padding: 12px;
		min-height: 0;
	}
	.sheet,
	.filter {
		flex: none;
		width: 100%;
		padding: 5px 8px;
		margin-bottom: 8px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #0e131a;
		color: #e2e8f0;
		font-size: 12px;
	}
	.plistbox {
		flex: none;
		margin: 0 0 10px;
		padding: 8px;
		border: 1px solid #2a323d;
		border-radius: 6px;
		background: #0e131a;
	}
	.plistbox h4 {
		margin: 0 0 6px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #93a4b8;
	}
	.ppick {
		display: block;
		margin-bottom: 5px;
		padding: 5px 8px;
		border-radius: 5px;
		border: 1px solid #2f4459;
		background: #14202c;
		color: #cfe3f5;
		font-size: 12px;
		text-align: center;
		cursor: pointer;
	}
	.ppick:hover {
		border-color: #3f6f9c;
	}
	/* The native control is unlabelled and ugly; the wrapping label carries the text. */
	.ppick input {
		display: none;
	}
	.pexport {
		display: block;
		padding: 5px 8px;
		border-radius: 5px;
		border: 1px solid #2a323d;
		background: #131820;
		color: #b9c6d4;
		font-size: 12px;
		text-align: center;
		text-decoration: none;
	}
	.pexport:hover {
		border-color: #3f6f9c;
		color: #e2e8f0;
	}
	.phint {
		margin: 6px 0 0;
		font-size: 11px;
		line-height: 1.35;
		color: #7c8798;
	}
	.pnote {
		margin: 5px 0 0;
		font-size: 11px;
		color: #7dd3fc;
	}
	.perr {
		margin: 6px 0 0;
		padding: 5px 7px;
		border-radius: 5px;
		border: 1px solid #7f2d2d;
		background: #23100f;
		color: #fca5a5;
		font-size: 11px;
		line-height: 1.35;
	}
	.seqs {
		flex: none;
		margin-bottom: 10px;
		padding: 8px;
		border: 1px solid #24405c;
		border-radius: 6px;
		background: #0d1722;
	}
	.seqs h4 {
		margin: 0 0 2px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #7dd3fc;
	}
	.seqhint {
		margin: 0 0 7px;
		font-size: 11px;
		line-height: 1.35;
		color: #7c8798;
	}
	.seq {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		margin-top: 4px;
		padding: 5px 8px;
		border-radius: 5px;
		border: 1px solid #2a3f55;
		background: #111d29;
		color: #cfe3f5;
		font-size: 12px;
		cursor: pointer;
		text-align: left;
	}
	.seq:hover {
		border-color: #3f6f9c;
		background: #16283a;
	}
	/* The run belonging to the sheet currently open in the picker — the one the author is
	   most likely reaching for now that every sheet offers its own. */
	.seqhere {
		border-color: #3f6f9c;
	}
	.sqn {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sqc {
		flex: none;
		color: #8aa0b6;
		font-size: 11px;
	}
	.sheetchip {
		flex: none;
		margin-left: 6px;
		padding: 1px 6px;
		border-radius: 999px;
		border: 1px solid #2f4459;
		background: #14202c;
		color: #8fb3d0;
		font-size: 10px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 110px;
	}
	.grid {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
		align-content: start;
	}
	.cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 5px 2px;
	}
	.cn {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 10px;
		color: #94a3b8;
	}
</style>
