<script lang="ts">
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import ColorField from '$lib/ColorField.svelte';
	import { SaveState } from '$lib/saveState.svelte';
	import { LeaseState } from '$lib/leaseState.svelte';
	import PresenceBanner from '$lib/PresenceBanner.svelte';
	import type { EffectDoc, EmitterConfigV3, EmitterLayer } from 'engine-fx';
	import { onMount } from 'svelte';
	import FxStage, { type ResolvedArt } from './FxStage.svelte';
	import {
		applyPreset,
		blendMode,
		burst,
		colorOverlay,
		curveRange,
		duplicateLayer,
		emissionArc,
		emptyEffectDoc,
		flipbookPlay,
		frameMixPercents,
		frameWeightInputs,
		FX_PRESETS,
		gravity,
		insertLayerCopy,
		movementModel,
		moveLayer,
		newLayer,
		nextLayerKey,
		rotationLock,
		setFrameWeight,
		toggleArtFrame,
		particleColor,
		particleSpin,
		setBlendMode,
		setBurst,
		setColorEnabled,
		setColorOverlayEnabled,
		setColorOverlayField,
		setCoreParam,
		setCurveBound,
		setCurveEnabled,
		setCurveVaried,
		setEmissionArc,
		setEmissionEnabled,
		setFlipbookFps,
		setFlipbookLoop,
		setGravity,
		setMovementModel,
		setParticleColor,
		setParticleKind,
		setPlacementBone,
		setPlacementOffset,
		setPlacementSpace,
		setParticleSpin,
		setRotationLock,
		setSpawnKind,
		setSpawnRadius,
		setSpawnRect,
		setSpawnRing,
		setSpineParticleAnimation,
		setSpineParticleLoop,
		setSpineParticleSkeleton,
		setTriggerDuration,
		setTriggerEvent,
		setTriggerStopEvent,
		setTriggerMode,
		spawnKind,
		spawnShape,
		UNTITLED_EFFECT_ID,
		type BlendKind,
		type CurveProp,
		type CurveRange,
		type MovementModel,
		type SpawnKind,
		triggerMode,
	} from './fxModel.client';
	import { loadFxSpine, type FxSkeletonEntry, type LoadedFxSpine } from './fxSpine.client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The in-memory EffectDoc is the SINGLE source of truth while editing. The live
	// preview rebuilds from it on change. It is seeded EITHER from a reopened effect
	// (loader's `?effect=<id>` → `data.openedDoc`) or a fresh empty effect (New). Save
	// writes it back via `/api/fx/save` (the EffectDoc + the editor-only sidecar split).
	const initialDoc = data.openedDoc ?? emptyEffectDoc();
	let doc = $state<EffectDoc>(initialDoc);
	let selectedKey = $state<string>(
		data.openedMeta?.selectedLayer ?? initialDoc.layers[0]?.key ?? '',
	);
	let playing = $state(true);

	// --- save / open state ------------------------------------------------------
	/** Delete-flow spinner; `busy` (below) unions it with the save machine so every shared
	 * `disabled={busy}` keeps its "either operation in flight" meaning. */
	let deleting = $state(false);
	let saveError = $state<string>('');
	let savedNote = $state<string>('');
	let pickerId = $state<string>(data.openedDoc?.id ?? '');
	// A LOCAL, reactive copy of the saved-effect index so the picker reflects a save WITHOUT a
	// full reload (the loader only lists effects once, server-side). Upserted on every save.
	let effects = $state<{ id: string; name: string }[]>(data.effects);

	/** Merge a just-saved effect into the picker list (add or relabel), kept name-sorted. */
	function upsertEffect(row: { id: string; name: string }): void {
		const rest = effects.filter((e) => e.id !== row.id);
		effects = [...rest, row].sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Soft edit lease (multi-user-concurrency Phase 2c-rest batch B) over the OPEN effect. FX
	 * edits one effect at a time and each effect is its OWN R2 object, so the lease `docKey` is
	 * the open effect's id and switching effects re-keys it (`lease.switchDoc`). A never-saved /
	 * untitled effect has no persisted key ⇒ `null` ⇒ inert ⇒ freely editable. `lease.readOnly`
	 * gates the doc `saveState` (its `blockWhen`); the `If-Match` CAS stays the correctness floor.
	 */
	const lease = new LeaseState({
		toolId: 'fx',
		clientKey: data.clientKey,
		projectKey: data.projectKey,
		docKey: '',
		enabled: data.projectKey.length > 0,
	});

	/** The lease key for an effect id: the persisted slug, or `null` for the untitled sentinel /
	 *  empty (a never-saved effect has nothing to lease). */
	function leaseIdFor(id: string): string | null {
		return id && id !== UNTITLED_EFFECT_ID ? id : null;
	}

	/** Mirror of the lease's current doc key, so a re-key only fires when the OPEN effect actually
	 *  changes (opening a different one, first-saving a new one, deleting the open one) — never on
	 *  every re-save of the same effect. */
	let leasedId: string | null = leaseIdFor(initialDoc.id);
	function leaseSwitch(id: string | null): void {
		if (id === leasedId) return;
		leasedId = id;
		void lease.switchDoc(id);
	}

	/**
	 * Save-state machine (multi-user-concurrency Phase 2a). Manual save; the transport owns the
	 * request. Create encoding stays caller-side and keeps the `isUnsaved ? null : baseEtag`
	 * guard (an unsaved effect keys its id off its NAME, and after a delete the doc resets to
	 * untitled while the held etag stays stale — the `isUnsaved` sentinel decides the create
	 * path, not the etag). A 409 `scope-mismatch` is non-forceable; a plain conflict is
	 * DESTRUCTIVE (effects have no version history), surfaced by the wrapper's explicit confirm.
	 * `saveEffectAs` repoints the id + `adoptEtag(null)`, restoring on a declined save.
	 */
	const saveState = new SaveState({
		initialEtag: data.openedEtag,
		blockWhen: () => lease.readOnly,
		save: async ({ baseEtag, force }) => {
			try {
				// A never-saved effect still holds the untitled sentinel, so key its id off the NAME
				// — distinct names ⇒ distinct files. Once saved/opened the id is the stable slug.
				const isUnsaved = doc.id === '' || doc.id === UNTITLED_EFFECT_ID;
				const outgoingId = isUnsaved ? doc.name.trim() || doc.id : doc.id;
				const res = await fetch('/api/fx/save', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						doc: { ...$state.snapshot(doc), id: outgoingId },
						// Editor-only sidecar — NEVER folded into the EffectDoc (out-of-band, §4).
						meta: { selectedLayer: selectedKey },
						projectKey: data.projectKey,
						...(force ? { force: true } : { baseEtag: isUnsaved ? null : baseEtag }),
					}),
				});
				if (res.status === 409) {
					const out = (await res.json().catch(() => ({}))) as {
						error?: string;
						message?: string;
					};
					const msg = out.message ?? 'This effect changed since you opened it.';
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
					layers: number;
					etag: string | null;
				};
				// The server slugs the id; adopt it so a subsequent save/open round-trips cleanly.
				doc = { ...doc, id: out.id };
				pickerId = out.id;
				// The effect now has a persisted key — re-key the lease onto it (a no-op when
				// re-saving the same effect; the acquire that matters is a NEW / saved-as effect).
				leaseSwitch(leaseIdFor(out.id));
				upsertEffect({ id: out.id, name: out.name });
				savedNote = `Saved "${out.name}" (${out.layers} layer${out.layers === 1 ? '' : 's'}).`;
				return { ok: true, etag: out.etag };
			} catch {
				return { ok: false, reason: 'error', message: 'Save failed (network error).' };
			}
		},
	});
	/** Union of the two in-flight flags — preserves every shared `disabled={busy}`. */
	const busy = $derived(deleting || saveState.busy);

	onMount(() => {
		// A layer copied in a previous effect survives the navigation — surface it on the button.
		clipboardName = readClipboard()?.key ?? '';
		// Acquire the lease for the initially-open effect (if any); inert for a fresh /fx.
		void lease.switchDoc(leasedId);
		const onUnload = () => lease.release();
		window.addEventListener('pagehide', onUnload);
		return () => {
			window.removeEventListener('pagehide', onUnload);
			lease.release();
		};
	});

	/**
	 * Persist the effect.
	 *
	 * `force` is the author confirming after a conflict, and here it is genuinely
	 * DESTRUCTIVE — unlike components, effects have no version history and no snapshots,
	 * so the other author's effect is simply gone with no recovery surface anywhere in
	 * the product. The prompt has to say that plainly rather than ask a breezy
	 * "overwrite?"; the point of Phase 1 is that this is a decision, not an accident.
	 *
	 * Resolves TRUE only when the effect actually reached R2 — `saveEffectAs` relies on
	 * that to restore the doc it repointed, so a declined overwrite doesn't strand the tab.
	 */
	async function saveEffect(force = false): Promise<boolean> {
		saveError = '';
		savedNote = '';
		const ok = await saveState.save({ force });
		if (ok) return true;
		saveError = saveState.message;
		// A wrong-project save is never forceable — reloading is the only fix.
		if (saveState.status === 'scope-mismatch') return false;
		if (!force && saveState.status === 'conflict') {
			// Spell out that this DESTROYS the other effect. Effects have no history, so
			// "overwrite" here is permanent — cancelling and renaming is the safe way out.
			const confirmed = confirm(
				`${saveState.message}\n\nOverwrite it with yours?\n\n` +
					'This permanently REPLACES the stored effect. It has no version history, ' +
					'so their work cannot be recovered. Cancel to rename yours instead.',
			);
			return confirmed ? await saveEffect(true) : false;
		}
		return false;
	}

	/**
	 * Save a COPY of the current effect under a new name. We reset the in-memory doc's id to the
	 * untitled sentinel so `saveEffect` keys the new file off the new name — the original effect's
	 * R2 objects are untouched (we only mutate the in-memory doc, then write a fresh file).
	 */
	async function saveEffectAs(): Promise<void> {
		const suggested = `${doc.name} copy`.trim();
		const name = window.prompt('Save as a new effect named:', suggested);
		if (name === null) return; // cancelled
		const clean = name.trim();
		if (!clean) return;
		// Remember what we were editing: the save can now be REFUSED (the new name may
		// already be someone else's effect), and this function has already repointed the
		// doc at the untitled sentinel. Without a restore, declining the overwrite would
		// strand the tab holding a sentinel id + the copy's name — detached from the
		// original, with every retry hitting the same 409.
		const previous = { id: doc.id, name: doc.name };
		const previousEtag = saveState.etag;
		doc = { ...doc, id: UNTITLED_EFFECT_ID, name: clean };
		saveState.adoptEtag(null);
		if (!(await saveEffect())) {
			doc = { ...doc, id: previous.id, name: previous.name };
			saveState.adoptEtag(previousEtag);
		}
	}

	/**
	 * Delete the currently-open effect from R2 (both the `.fx.json` and its `.fx.meta.json`
	 * sidecar) and drop it from the picker. If the open doc IS the deleted one, reset the editor
	 * to a fresh untitled effect. Guarded to only fire on an actually-saved effect.
	 */
	async function deleteOpenEffect(): Promise<void> {
		const id = pickerId || (doc.id !== UNTITLED_EFFECT_ID ? doc.id : '');
		if (!id) return;
		const label = effects.find((e) => e.id === id)?.name ?? id;
		if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
		deleting = true;
		saveError = '';
		savedNote = '';
		try {
			const res = await fetch('/api/fx/delete', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id }),
			});
			if (!res.ok) {
				saveError = `Delete failed (HTTP ${res.status}).`;
				return;
			}
			effects = effects.filter((e) => e.id !== id);
			savedNote = `Deleted "${label}".`;
			if (doc.id === id) {
				const fresh = emptyEffectDoc();
				doc = fresh;
				selectedKey = fresh.layers[0]?.key ?? '';
				// The open effect is gone → nothing to lease; go inert (freely editable).
				leaseSwitch(null);
			}
			pickerId = '';
		} catch {
			saveError = 'Delete failed (network error).';
		} finally {
			deleting = false;
		}
	}

	function newEffect(): void {
		// Navigate to a clean /fx (drops `?effect=`) so the loader seeds an empty doc.
		window.location.href = '/fx';
	}

	function openEffect(id: string): void {
		if (!id) return;
		window.location.href = `/fx?effect=${encodeURIComponent(id)}`;
	}

	const selected = $derived(doc.layers.find((l) => l.key === selectedKey));
	const config = $derived(selected?.config);

	let stage = $state<FxStage | null>(null);

	// --- art resolution (reuse the editor's region + asset endpoints) -----------
	// The editor's region/asset endpoints accept the `fx` tool as well (their `altTools`),
	// so FX reads regions + the page image straight from them — no new shared art surface.
	const artCache = new Map<string, Promise<ResolvedArt | null>>();

	function resolveArt(assetKey: string): Promise<ResolvedArt | null> {
		const hit = artCache.get(assetKey);
		if (hit) return hit;
		const p = (async (): Promise<ResolvedArt | null> => {
			const res = await fetch(`/api/editor/regions?sheet=${encodeURIComponent(assetKey)}`);
			if (!res.ok) return null;
			const set = (await res.json()) as {
				pageKey: string;
				pageVersion?: string;
				pageWidth: number;
				pageHeight: number;
				regions: { name: string; x: number; y: number; w: number; h: number; rotated?: boolean }[];
			};
			if (!set.pageKey) return null;
			const v = set.pageVersion ? `&v=${encodeURIComponent(set.pageVersion)}` : '';
			return {
				pageUrl: `/api/editor/asset?key=${encodeURIComponent(set.pageKey)}${v}`,
				pageWidth: set.pageWidth,
				pageHeight: set.pageHeight,
				regions: set.regions,
			};
		})();
		artCache.set(assetKey, p);
		return p;
	}

	// --- spine-particle resolution (Tier C) -------------------------------------
	// A `particleKind:'spine'` layer's `spineParticle.skeletonKey` is the CANONICAL bundle key —
	// the skeleton entry's `folder`, which is EXACTLY the key the runtime registers the spine under
	// in `loadedAssets` (`editorArt.spines[].key` = `bundleFromAssetKey(...)` = the `folder`) and the
	// key the bake dangling-`skeletonKey` guard checks. Authoring this same key means a saved spine
	// effect resolves verbatim in the shipped game (no translation layer). The stage pools `Spine`
	// instances built from the loaded skeleton; we load + cache it here (reusing `loadFxSpine`, the
	// SAME loader the backdrop uses — no second skeleton load path) and hand the stage a
	// `resolveSkeleton`. Only ONE skeleton ships per `folder` (the runtime/editor-art take the first
	// entry in a bundle), so resolving by `folder` matches what the game will register.
	const skeletonCache = new Map<string, Promise<LoadedFxSpine | null>>();
	// Reactive bump so the inspector re-derives the animation list once a skeleton finishes loading.
	let skeletonMetaVersion = $state(0);
	const skeletonMeta = new Map<string, LoadedFxSpine>();

	function resolveSkeleton(skeletonKey: string): Promise<LoadedFxSpine | null> {
		const hit = skeletonCache.get(skeletonKey);
		if (hit) return hit;
		const entry = skeletons.find((s) => s.folder === skeletonKey);
		const p = (async (): Promise<LoadedFxSpine | null> => {
			if (!entry) return null;
			try {
				const loaded = await loadFxSpine(entry);
				skeletonMeta.set(skeletonKey, loaded);
				skeletonMetaVersion++;
				return loaded;
			} catch {
				return null;
			}
		})();
		skeletonCache.set(skeletonKey, p);
		return p;
	}

	// The shippable spine-particle skeletons: one per `folder` (the runtime/editor-art ship the
	// FIRST skeleton of a bundle, so a `folder` maps to exactly one shippable skeleton). Deduping by
	// `folder` keeps the picker option values unique AND in the canonical key namespace the layer
	// saves. A root-level bundle (`folder:''`) can't be a stable lookup key, so it's excluded.
	const spineParticleSkeletons = $derived.by((): FxSkeletonEntry[] => {
		const seen = new Set<string>();
		const out: FxSkeletonEntry[] = [];
		for (const s of skeletons) {
			if (!s.folder || seen.has(s.folder)) continue;
			seen.add(s.folder);
			out.push(s);
		}
		return out;
	});

	// The animation clips for the SELECTED layer's spine-particle skeleton (loaded on demand). An
	// empty list (not yet loaded / unknown) degrades the Animation control to a free-text input.
	const spineParticleAnimations = $derived.by((): string[] => {
		void skeletonMetaVersion; // re-derive once a load resolves
		const key = selected?.spineParticle?.skeletonKey;
		if (!key) return [];
		const loaded = skeletonMeta.get(key);
		if (loaded) return loaded.animations;
		// Kick off a load so the dropdown populates (no-op if already cached/in-flight).
		void resolveSkeleton(key);
		return [];
	});

	// The chosen atlas's region names (for the region picker checkboxes).
	let pickerAtlasKey = $state<string>('');
	let pickerRegions = $state<string[]>([]);

	$effect(() => {
		const key = selected?.art.assetKey;
		if (key) pickerAtlasKey = key;
	});

	const atlasOptions = $derived(data.atlases);

	async function selectAtlas(manifestKey: string): Promise<void> {
		pickerAtlasKey = manifestKey;
		// Re-selecting an atlas re-resolves it: drop the cached region set so a re-authored
		// atlas is picked up fresh (new page version) without a full page reload.
		artCache.delete(manifestKey);
		const a = atlasOptions.find((x) => x.manifestKey === manifestKey);
		pickerRegions = a ? a.regions : [];
		if (selected) {
			// Binding an atlas clears stale frames so the picker drives art.frames cleanly.
			updateSelected((l) => ({ ...l, art: { ...l.art, assetKey: manifestKey, frames: [] } }));
		}
	}

	// Seed the picker region list when a layer with art is selected.
	$effect(() => {
		const key = selected?.art.assetKey;
		const a = key ? atlasOptions.find((x) => x.manifestKey === key) : undefined;
		pickerRegions = a ? a.regions : [];
	});

	// Toggle a region in the layer's art. Selecting >1 frame no longer auto-forces a flipbook — the
	// default is a random MIX (one image per particle, weightable below); Flipbook is opt-in.
	function toggleFrame(name: string): void {
		if (!selected) return;
		updateSelected((l) => toggleArtFrame(l, name));
	}

	// The Mix control's per-frame slider values + their normalized % readout (static multi-frame).
	const mixWeights = $derived(selected ? frameWeightInputs(selected) : []);
	const mixPercents = $derived(selected ? frameMixPercents(selected) : []);

	// --- Tier B: Spine backdrop -------------------------------------------------
	// The backdrop is a project Spine rig loaded purely as an authoring aid: play a clip and
	// pin `bone`-placed layers onto its bones. The skeleton list comes from the SAME
	// `/spine/skeletons` endpoint the Spine Viewer / Rigger use (its gate now also accepts the
	// `fx` tool). `onSpineMeta` is the stage telling us the loaded rig's clip / skin / bone
	// lists, which drive the dropdowns below.
	let skeletons = $state<FxSkeletonEntry[]>([]);
	let spineKey = $state<string>('');
	let spineAnimation = $state<string>('');
	let spineSkin = $state<string>('');
	let spineMeta = $state<{ animations: string[]; skins: string[]; bones: string[] }>({
		animations: [],
		skins: [],
		bones: [],
	});

	const spineEntry = $derived(
		skeletons.find((s) => `${s.dir_b64}/${s.skeleton_file}` === spineKey) ?? null,
	);

	onMount(async () => {
		try {
			const res = await fetch('/spine/skeletons');
			if (!res.ok) return;
			const d = (await res.json()) as { skeletons?: FxSkeletonEntry[] };
			skeletons = d.skeletons ?? [];
		} catch {
			// Leave the list empty — the backdrop picker just offers "none".
		}
	});

	function selectSkeleton(key: string): void {
		spineKey = key;
		// Reset the clip/skin so the stage doesn't try to play a previous skeleton's clip while
		// the new rig loads; `onSpineMeta` picks a valid default once it's loaded.
		spineAnimation = '';
		spineSkin = '';
	}

	function onSpineMeta(meta: { animations: string[]; skins: string[]; bones: string[] }): void {
		spineMeta = meta;
		// Default to the first clip so a freshly-picked backdrop animates immediately.
		if (!meta.animations.includes(spineAnimation)) spineAnimation = meta.animations[0] ?? '';
		if (spineSkin && !meta.skins.includes(spineSkin)) spineSkin = '';
	}

	// --- immutable doc edits ----------------------------------------------------
	function updateSelected(fn: (l: EmitterLayer) => EmitterLayer): void {
		doc = { ...doc, layers: doc.layers.map((l) => (l.key === selectedKey ? fn(l) : l)) };
	}

	function patchConfig(next: EmitterConfigV3): void {
		updateSelected((l) => ({ ...l, config: next }));
	}

	function addLayer(): void {
		const key = nextLayerKey(doc);
		doc = { ...doc, layers: [...doc.layers, newLayer(key)] };
		selectedKey = key;
	}

	function removeLayer(key: string): void {
		const layers = doc.layers.filter((l) => l.key !== key);
		doc = { ...doc, layers };
		if (selectedKey === key) selectedKey = layers[0]?.key ?? '';
	}

	function renameLayer(key: string, name: string): void {
		const clean = name.trim();
		if (!clean || doc.layers.some((l) => l.key === clean)) return;
		doc = { ...doc, layers: doc.layers.map((l) => (l.key === key ? { ...l, key: clean } : l)) };
		if (selectedKey === key) selectedKey = clean;
	}

	// --- layer stack: duplicate / copy-paste / reorder ---------------------------
	// The clipboard lives in `localStorage`, not just a rune, so a layer can be copied out of ONE
	// effect and pasted into ANOTHER — opening an effect is a full page navigation here, so an
	// in-memory clipboard would die on the way. `clipboardName` mirrors it for the button label.
	const LAYER_CLIPBOARD_KEY = 'invisible-fx.layer-clipboard';
	let clipboardName = $state<string>('');

	function readClipboard(): EmitterLayer | null {
		try {
			const raw = localStorage.getItem(LAYER_CLIPBOARD_KEY);
			if (!raw) return null;
			const layer = JSON.parse(raw) as EmitterLayer;
			return layer && typeof layer.key === 'string' && layer.config ? layer : null;
		} catch {
			return null;
		}
	}

	function copyLayer(key: string): void {
		const layer = doc.layers.find((l) => l.key === key);
		if (!layer) return;
		try {
			localStorage.setItem(LAYER_CLIPBOARD_KEY, JSON.stringify($state.snapshot(layer)));
			clipboardName = layer.key;
			savedNote = `Copied "${layer.key}".`;
		} catch {
			saveError = 'Could not copy this layer (browser storage is unavailable).';
		}
	}

	function pasteLayer(): void {
		const layer = readClipboard();
		if (!layer) return;
		const next = insertLayerCopy(doc, layer, selectedKey || undefined);
		doc = next.doc;
		selectedKey = next.key;
	}

	function duplicateSelected(key: string): void {
		const next = duplicateLayer(doc, key);
		doc = next.doc;
		selectedKey = next.key;
	}

	function reorderLayer(key: string, delta: number): void {
		doc = moveLayer(doc, key, delta);
	}

	// --- inspector readouts (derived from the config) ---------------------------
	// The three varying curves read through ONE seam (`curveRange`) so alpha/scale/speed all get the
	// same min/max treatment — `undefined` means the config carries no behavior for it yet, which
	// the section turns into an "add it" checkbox rather than silently vanishing.
	const alphaRange = $derived(config ? curveRange(config, 'alpha') : undefined);
	const scaleRange = $derived(config ? curveRange(config, 'scale') : undefined);
	const speedRange = $derived(config ? curveRange(config, 'speed') : undefined);
	const overlay = $derived(config ? colorOverlay(config) : undefined);
	const lockAngle = $derived(config ? rotationLock(config) : undefined);
	const flipbook = $derived(selected ? flipbookPlay(selected) : undefined);
	const shape = $derived(config ? spawnShape(config) : undefined);
	const spawnSel = $derived<SpawnKind>(config ? (spawnKind(config) ?? 'circle') : 'circle');
	const brst = $derived(config ? burst(config) : undefined);
	const emission = $derived(config ? emissionArc(config) : undefined);
	const spin = $derived(config ? particleSpin(config) : undefined);
	const moveModel = $derived<MovementModel>(config ? movementModel(config) : 'speed');
	const grav = $derived(config ? gravity(config) : undefined);
	const tint = $derived(config ? particleColor(config) : undefined);
	const blend = $derived<BlendKind>(config ? blendMode(config) : 'normal');

	let presetId = $state<string>('');

	function applySelectedPreset(key: string): void {
		if (!key) return;
		updateSelected((l) => applyPreset(l, key));
		presetId = '';
	}

	function num(e: Event): number {
		return Number((e.currentTarget as HTMLInputElement).value);
	}

	// A blank input must CLEAR an optional number (e.g. trigger duration → `emitterLifetime`
	// governs), not coerce to 0 the way `Number('')` would. NaN signals "cleared" to the mutator.
	function numOrBlank(e: Event): number {
		const raw = (e.currentTarget as HTMLInputElement).value.trim();
		return raw === '' ? Number.NaN : Number(raw);
	}
</script>

<!--
	A reusable "slider + number box" row. The range slider drives `onLive` on EVERY drag tick
	(`oninput`) so the preview re-tunes in realtime (the rebuild path is generation-guarded /
	coalesced in FxStage, so dragging is safe). A paired numeric box shows the live value AND lets
	you type an exact one (`onchange`, on commit). Both call the SAME mutator, so they stay in sync.
-->
{#snippet slider(
	label: string,
	value: number,
	min: number,
	max: number,
	step: number,
	apply: (v: number) => void,
)}
	<div class="row slider">
		<span>{label}</span>
		<input
			type="range"
			{min}
			{max}
			{step}
			{value}
			oninput={(e) => apply(Number((e.currentTarget as HTMLInputElement).value))}
		/>
		<input
			class="numbox"
			type="number"
			{min}
			{max}
			{step}
			{value}
			onchange={(e) => apply(Number((e.currentTarget as HTMLInputElement).value))}
		/>
	</div>
{/snippet}

<!--
	One varying CURVE (alpha / scale / speed) as a whole inspector section.

	Two toggles, always visible so nothing silently disappears: **On** adds or removes the
	behavior itself (a config that never carried an alpha curve can now grow one), and **Min /
	Max** turns each end into a per-particle RANGE.

	The four bounds are INDEPENDENT: each end of the curve carries its own floor, so moving one
	never drags another. `range.varied` is keyed off the behavior TYPE, never off the numbers —
	deriving it from "some floor < 1" made the toggle switch itself off (taking all four sliders
	with it) the moment a min was dragged up to its max.
-->
{#snippet curveSection(
	title: string,
	cfg: EmitterConfigV3,
	prop: CurveProp,
	range: CurveRange | undefined,
	lo: number,
	hi: number,
	step: number,
	offHint: string,
)}
	<section>
		<div class="grouphead">
			<h3>{title}</h3>
			<label class="toggle">
				<input
					type="checkbox"
					checked={!!range}
					onchange={(e) =>
						patchConfig(setCurveEnabled(cfg, prop, (e.currentTarget as HTMLInputElement).checked))}
				/>
				<span>On</span>
			</label>
		</div>
		{#if range}
			<label class="toggle wide">
				<input
					type="checkbox"
					checked={range.varied}
					onchange={(e) =>
						patchConfig(setCurveVaried(cfg, prop, (e.currentTarget as HTMLInputElement).checked))}
				/>
				<span>Min / Max (vary per particle)</span>
			</label>
			{#if range.varied}
				<!-- All four thumbs share ONE axis (`lo`..`hi`). Capping a `min` slider at its own `max`
				     instead made the min's TRACK rescale as the max was dragged, so the min thumb slid
				     across while its value never changed — it read as "the min moves when I move the max".
				     Overshoot is handled where it belongs, by clamping in `setCurveBound`. -->
				{@render slider('Start min', range.startMin, lo, hi, step, (v) =>
					patchConfig(setCurveBound(cfg, prop, 'start', 'min', v)),
				)}
				{@render slider('Start max', range.startMax, lo, hi, step, (v) =>
					patchConfig(setCurveBound(cfg, prop, 'start', 'max', v)),
				)}
				{@render slider('End min', range.endMin, lo, hi, step, (v) =>
					patchConfig(setCurveBound(cfg, prop, 'end', 'min', v)),
				)}
				{@render slider('End max', range.endMax, lo, hi, step, (v) =>
					patchConfig(setCurveBound(cfg, prop, 'end', 'max', v)),
				)}
				<p class="hint">
					Each particle spawns somewhere in the Start range and ends somewhere in the End range —
					the four bounds are independent.
				</p>
			{:else}
				{@render slider('Start', range.startMax, lo, hi, step, (v) =>
					patchConfig(setCurveBound(cfg, prop, 'start', 'max', v)),
				)}
				{@render slider('End', range.endMax, lo, hi, step, (v) =>
					patchConfig(setCurveBound(cfg, prop, 'end', 'max', v)),
				)}
			{/if}
		{:else}
			<p class="hint">{offHint}</p>
		{/if}
	</section>
{/snippet}

<svelte:head><title>Invisible FX</title></svelte:head>

<div class="page">
	<ToolTopBar
		current="fx"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.projectKey}
	/>

	<div class="subbar">
		<strong>Invisible FX</strong>
		<input
			class="name"
			title="Effect name"
			placeholder="Effect name"
			value={doc.name}
			onchange={(e) => (doc = { ...doc, name: (e.currentTarget as HTMLInputElement).value })}
		/>
		<!-- `onclick={saveEffect}` passes the click EVENT as `force` (truthy): a manual Save has
		     always FORCE-overwritten here — preserved verbatim. Pre-existing latent bug (the
		     destructive conflict `confirm()` is effectively dead on this path); flagged for the owner. -->
		<button class="primary" onclick={saveEffect} disabled={busy || lease.readOnly}>
			{saveState.busy ? 'Saving…' : '⤓ Save'}
		</button>
		<button
			title="Save a copy under a new name"
			onclick={saveEffectAs}
			disabled={busy || lease.readOnly}>⧉ Save As…</button
		>
		<button onclick={newEffect}>+ New</button>
		<select
			class="open"
			title="Open a saved effect"
			value={pickerId}
			onchange={(e) => openEffect((e.currentTarget as HTMLSelectElement).value)}
		>
			<option value="">Open effect…</option>
			{#each effects as eff (eff.id)}
				<option value={eff.id}>{eff.name}</option>
			{/each}
		</select>
		<button
			class="danger"
			title="Delete the open effect"
			disabled={busy || !pickerId || lease.readOnly}
			onclick={deleteOpenEffect}>🗑 Delete</button
		>
		<button onclick={() => (playing = !playing)}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
		<button onclick={() => stage?.resetView()}>Reset view</button>
		<span class="spacer"></span>
		<!-- Another author (or your own other tab) holds this effect's lease → read-only here.
		     The doc saveState refuses to save (its blockWhen); Take over is always offered. -->
		<PresenceBanner {lease} />
		{#if saveError}
			<span class="err">{saveError}</span>
		{:else if savedNote}
			<span class="ok">{savedNote}</span>
		{/if}
		<span class="count">{doc.layers.length} layer{doc.layers.length === 1 ? '' : 's'}</span>
	</div>

	<div class="body">
		<aside class="layers">
			<div class="head">
				<h3>Layers</h3>
				<button class="add" onclick={addLayer}>+ Add</button>
			</div>
			<ul>
				{#each doc.layers as layer, i (layer.key)}
					<li class:active={layer.key === selectedKey}>
						<button class="pick" onclick={() => (selectedKey = layer.key)}>
							{layer.key}
							<span class="meta"
								>{layer.art.frames.length} frame{layer.art.frames.length === 1 ? '' : 's'}</span
							>
						</button>
						<!-- List order IS draw order: the last layer renders in front. -->
						<button
							class="ico"
							title="Move behind (earlier in the stack)"
							disabled={i === 0}
							onclick={() => reorderLayer(layer.key, -1)}>▲</button
						>
						<button
							class="ico"
							title="Move in front (later in the stack)"
							disabled={i === doc.layers.length - 1}
							onclick={() => reorderLayer(layer.key, 1)}>▼</button
						>
						<button class="ico" title="Duplicate layer" onclick={() => duplicateSelected(layer.key)}
							>⧉</button
						>
						<button
							class="ico del"
							title="Remove layer"
							disabled={doc.layers.length === 1}
							onclick={() => removeLayer(layer.key)}>✕</button
						>
					</li>
				{/each}
			</ul>
			<div class="clip">
				<button
					title="Copy the selected layer — paste it into this or any other effect"
					disabled={!selected}
					onclick={() => selected && copyLayer(selected.key)}>⧉ Copy</button
				>
				<button
					title={clipboardName ? `Paste "${clipboardName}"` : 'Nothing copied yet'}
					disabled={!clipboardName}
					onclick={pasteLayer}>📋 Paste</button
				>
			</div>
		</aside>

		<div class="canvas">
			<div class="stagebar">
				<span class="lbl">Backdrop</span>
				<select
					title="Load a project Spine rig as a backdrop (Tier B — pin layers to its bones)"
					value={spineKey}
					onchange={(e) => selectSkeleton((e.currentTarget as HTMLSelectElement).value)}
				>
					<option value="">— none —</option>
					{#each skeletons as s (s.dir_b64 + '/' + s.skeleton_file)}
						<option value={`${s.dir_b64}/${s.skeleton_file}`}>
							{s.folder ? `${s.folder}/` : ''}{s.name}
						</option>
					{/each}
				</select>
				{#if spineEntry}
					<select
						title="Animation clip"
						value={spineAnimation}
						onchange={(e) => (spineAnimation = (e.currentTarget as HTMLSelectElement).value)}
					>
						{#each spineMeta.animations as a (a)}
							<option value={a}>{a}</option>
						{/each}
					</select>
					{#if spineMeta.skins.length > 1}
						<select
							title="Skin"
							value={spineSkin}
							onchange={(e) => (spineSkin = (e.currentTarget as HTMLSelectElement).value)}
						>
							<option value="">— default skin —</option>
							{#each spineMeta.skins as s (s)}
								<option value={s}>{s}</option>
							{/each}
						</select>
					{/if}
				{/if}
			</div>
			<div class="stagewrap">
				<FxStage
					bind:this={stage}
					layers={doc.layers}
					{playing}
					{resolveArt}
					{resolveSkeleton}
					{spineEntry}
					{spineAnimation}
					{spineSkin}
					{onSpineMeta}
				/>
			</div>
		</div>

		<aside class="inspector">
			{#if selected && config}
				<section>
					<h3>Layer</h3>
					<label class="row">
						<span>Name</span>
						<input
							value={selected.key}
							onchange={(e) =>
								renameLayer(selected.key, (e.currentTarget as HTMLInputElement).value)}
						/>
					</label>
					<label class="row">
						<span>Preset</span>
						<select
							title="Drop in a ready-made effect, then tune it. Replaces this layer's emitter (art is kept)."
							value={presetId}
							onchange={(e) => applySelectedPreset((e.currentTarget as HTMLSelectElement).value)}
						>
							<option value="">Apply preset…</option>
							{#each FX_PRESETS as p (p.key)}
								<option value={p.key}>{p.label}</option>
							{/each}
						</select>
					</label>
				</section>

				<section>
					<h3>Particle</h3>
					<label class="row">
						<span>Kind</span>
						<select
							value={selected.particleKind}
							onchange={(e) =>
								updateSelected((l) =>
									setParticleKind(
										l,
										(e.currentTarget as HTMLSelectElement).value as 'sprite' | 'spine',
									),
								)}
						>
							<option value="sprite">Sprite (atlas art)</option>
							<option value="spine" disabled={skeletons.length === 0}>Spine clip</option>
						</select>
					</label>
					{#if selected.particleKind === 'spine'}
						{#if skeletons.length === 0}
							<p class="hint">
								This project has no Spine bundles yet — make one in the Spine Viewer / Rigger to use
								spine-clip particles.
							</p>
						{:else}
							<label class="row">
								<span>Skeleton</span>
								<select
									value={selected.spineParticle?.skeletonKey ?? ''}
									onchange={(e) =>
										updateSelected((l) =>
											setSpineParticleSkeleton(l, (e.currentTarget as HTMLSelectElement).value),
										)}
								>
									<option value="">— pick a skeleton —</option>
									{#each spineParticleSkeletons as s (s.folder)}
										<option value={s.folder}>{s.folder}/{s.name}</option>
									{/each}
								</select>
							</label>
							{#if selected.spineParticle?.skeletonKey}
								<label class="row">
									<span>Animation</span>
									{#if spineParticleAnimations.length > 0}
										<select
											value={selected.spineParticle?.animation ?? ''}
											onchange={(e) =>
												updateSelected((l) =>
													setSpineParticleAnimation(
														l,
														(e.currentTarget as HTMLSelectElement).value,
													),
												)}
										>
											<option value="">— pick a clip —</option>
											{#each spineParticleAnimations as a (a)}
												<option value={a}>{a}</option>
											{/each}
										</select>
									{:else}
										<input
											placeholder="clip name"
											title="Loading the skeleton's clips… or type the clip name"
											value={selected.spineParticle?.animation ?? ''}
											onchange={(e) =>
												updateSelected((l) =>
													setSpineParticleAnimation(l, (e.currentTarget as HTMLInputElement).value),
												)}
										/>
									{/if}
								</label>
								<label class="row check">
									<input
										type="checkbox"
										checked={selected.spineParticle?.loop ?? false}
										onchange={(e) =>
											updateSelected((l) =>
												setSpineParticleLoop(l, (e.currentTarget as HTMLInputElement).checked),
											)}
									/>
									<span>Loop each particle's clip</span>
								</label>
							{/if}
							<p class="hint">
								Each particle is a pooled Spine instance playing a clip. Keep <code
									>Max particles</code
								>
								low — a spine particle is far heavier than a sprite (tens, not hundreds).
							</p>
						{/if}
					{/if}
				</section>

				{#if selected.particleKind === 'sprite'}
					<section>
						<h3>Art</h3>
						<label class="row">
							<span>Atlas</span>
							<select
								value={selected.art.assetKey}
								onchange={(e) => selectAtlas((e.currentTarget as HTMLSelectElement).value)}
							>
								<option value="">— pick an atlas —</option>
								{#each atlasOptions as a (a.manifestKey)}
									<option value={a.manifestKey}>{a.label}</option>
								{/each}
							</select>
						</label>
						{#if atlasOptions.length === 0}
							<p class="hint">
								This project has no usable atlases yet (make one in Atlas/Sheet Maker).
							</p>
						{/if}
						{#if selected.art.frames.length === 0}
							<p class="hint">
								No art bound yet — the preview shows placeholder dots so you can tune the emitter.
								Pick an atlas, then tick a region for the real particle.
							</p>
						{/if}
						{#if selected.art.assetKey}
							<div class="frames">
								{#if pickerRegions.length === 0}
									<p class="hint">No regions in this atlas.</p>
								{:else}
									{#each pickerRegions as name (name)}
										<label class="frame">
											<input
												type="checkbox"
												checked={selected.art.frames.includes(name)}
												onchange={() => toggleFrame(name)}
											/>
											{name}
										</label>
									{/each}
								{/if}
							</div>
							{#if selected.art.frames.length > 1}
								<label class="row check">
									<input
										type="checkbox"
										checked={selected.art.animated ?? false}
										onchange={(e) =>
											updateSelected((l) => ({
												...l,
												art: { ...l.art, animated: (e.currentTarget as HTMLInputElement).checked },
											}))}
									/>
									<span>Flipbook (animate frames per particle)</span>
								</label>
								{#if (selected.art.animated ?? false) && flipbook}
									<label class="row check">
										<input
											type="checkbox"
											checked={flipbook.fps === null}
											onchange={(e) =>
												updateSelected((l) =>
													setFlipbookFps(
														l,
														(e.currentTarget as HTMLInputElement).checked ? null : 24,
													),
												)}
										/>
										<span>Match particle lifetime</span>
									</label>
									{#if flipbook.fps !== null}
										{@render slider('Speed (fps)', flipbook.fps, 1, 60, 1, (v) =>
											updateSelected((l) => setFlipbookFps(l, v)),
										)}
										<label class="row check">
											<input
												type="checkbox"
												checked={flipbook.loop}
												onchange={(e) =>
													updateSelected((l) =>
														setFlipbookLoop(l, (e.currentTarget as HTMLInputElement).checked),
													)}
											/>
											<span>Loop while the particle lives</span>
										</label>
									{/if}
									<p class="hint">
										Match lifetime stretches the {selected.art.frames.length} frames across each particle's
										life (they play through exactly once). Give it a real fps instead to pin the animation
										speed — then Loop decides whether it repeats or holds on the last frame.
									</p>
								{/if}
								{#if !(selected.art.animated ?? false)}
									<div class="mix">
										<span class="mixhead">Mix — per-image share</span>
										{#each selected.art.frames as fname, i (fname)}
											<div class="row slider">
												<span class="mixname" title={fname}>{fname}</span>
												<input
													type="range"
													min="0"
													max="100"
													step="1"
													value={mixWeights[i] ?? 0}
													oninput={(e) =>
														updateSelected((l) =>
															setFrameWeight(
																l,
																fname,
																Number((e.currentTarget as HTMLInputElement).value),
															),
														)}
												/>
												<span class="pct">{Math.round(mixPercents[i] ?? 0)}%</span>
											</div>
										{/each}
										<p class="hint">
											Each particle gets ONE image, chosen by these shares (drag to weight). Turn on
											Flipbook instead to animate all frames on every particle.
										</p>
									</div>
								{/if}
							{/if}
						{/if}
					</section>
				{/if}

				<section>
					<h3>Placement</h3>
					<label class="row">
						<span>Mode</span>
						<select
							value={selected.placement.space}
							onchange={(e) =>
								updateSelected((l) =>
									setPlacementSpace(
										l,
										(e.currentTarget as HTMLSelectElement).value as 'free' | 'bone',
									),
								)}
						>
							<option value="free">Free (scene)</option>
							<option value="bone" disabled={spineMeta.bones.length === 0}>Bone (rig)</option>
						</select>
					</label>
					{#if selected.placement.space === 'bone'}
						{#if spineMeta.bones.length === 0}
							<p class="hint">Load a backdrop skeleton to pin this layer to a bone.</p>
						{:else}
							<label class="row">
								<span>Bone</span>
								<select
									value={selected.placement.bone ?? ''}
									onchange={(e) =>
										updateSelected((l) =>
											setPlacementBone(l, (e.currentTarget as HTMLSelectElement).value),
										)}
								>
									<option value="">— pick a bone —</option>
									{#each spineMeta.bones as b (b)}
										<option value={b}>{b}</option>
									{/each}
								</select>
							</label>
						{/if}
					{/if}
					<label class="row">
						<span>Offset X</span>
						<input
							type="number"
							step="1"
							value={selected.placement.offset?.x ?? 0}
							onchange={(e) => updateSelected((l) => setPlacementOffset(l, 'x', num(e)))}
						/>
					</label>
					<label class="row">
						<span>Offset Y</span>
						<input
							type="number"
							step="1"
							value={selected.placement.offset?.y ?? 0}
							onchange={(e) => updateSelected((l) => setPlacementOffset(l, 'y', num(e)))}
						/>
					</label>
				</section>

				<section>
					<h3>Trigger</h3>
					<label class="row">
						<span>Mode</span>
						<select
							value={triggerMode(selected)}
							onchange={(e) =>
								updateSelected((l) =>
									setTriggerMode(
										l,
										(e.currentTarget as HTMLSelectElement).value as 'always' | 'event',
									),
								)}
						>
							<option value="always">Always (ambient)</option>
							<option value="event">On event</option>
						</select>
					</label>
					{#if triggerMode(selected) === 'event'}
						<label class="row">
							<span>Event</span>
							<!--
								A COMBOBOX (input + datalist): pick a known event from the project's exported
								vocabulary (the same names Flow's Broadcast node offers), OR type any custom cue
								name — e.g. a Flow v2 `fireCue` cue whose vocabulary isn't project-loaded here yet.
								The layer fires when a broadcast of this EXACT name hits the event bus, so the name
								must match what Flow emits. `setTriggerEvent` accepts any string (empty clears).
							-->
							<input
								list="fx-event-types"
								placeholder="event / cue name"
								title="The event name a Flow Broadcast / fireCue emits — pick a known one or type a custom cue (must match the name used in Flow)"
								value={selected.trigger?.eventType ?? ''}
								onchange={(e) =>
									updateSelected((l) =>
										setTriggerEvent(l, (e.currentTarget as HTMLInputElement).value),
									)}
							/>
						</label>
						{#if data.eventTypes.length > 0}
							<datalist id="fx-event-types">
								{#each data.eventTypes as t (t)}
									<option value={t}></option>
								{/each}
							</datalist>
						{/if}
						<p class="hint">
							Fires when a Flow <strong>Broadcast</strong> / <strong>fireCue</strong> (or any game event)
							of this exact name is emitted. Pick a known event, or type a custom cue name — it must
							match the name used in Flow.
						</p>
						<label class="row">
							<span>Stop event</span>
							<input
								list="fx-event-types"
								placeholder="(optional) stop cue"
								title="Optional SECOND cue that STOPS this layer — fire on Event, stop on this. Blank ⇒ stop by Duration / emitterLifetime instead."
								value={selected.trigger?.stopEventType ?? ''}
								onchange={(e) =>
									updateSelected((l) =>
										setTriggerStopEvent(l, (e.currentTarget as HTMLInputElement).value),
									)}
							/>
						</label>
						<p class="hint">
							Optional — fire on <strong>Event</strong>, keep emitting, then <strong>stop</strong>
							when a Flow Broadcast / fireCue of this name is emitted (for a continuous effect). Blank
							⇒ it stops by Duration / <code>emitterLifetime</code> instead.
						</p>
						<label class="row">
							<span>Duration (ms)</span>
							<input
								type="number"
								step="50"
								min="0"
								placeholder="emitterLifetime"
								value={selected.trigger?.duration ?? ''}
								onchange={(e) => updateSelected((l) => setTriggerDuration(l, numOrBlank(e)))}
							/>
						</label>
						<p class="hint">
							Blank ⇒ the config's <code>emitterLifetime</code> governs how long the burst emits.
						</p>
					{/if}
				</section>

				<section>
					<h3>Emitter</h3>
					{@render slider('Frequency (s)', config.frequency, 0.001, 0.5, 0.001, (v) =>
						patchConfig(setCoreParam(config, 'frequency', v)),
					)}
					{@render slider('Max particles', config.maxParticles ?? 0, 1, 1000, 1, (v) =>
						patchConfig(setCoreParam(config, 'maxParticles', v)),
					)}
					{@render slider('Lifetime min (s)', config.lifetime.min, 0.05, 5, 0.05, (v) =>
						patchConfig(setCoreParam(config, 'lifetimeMin', v)),
					)}
					{@render slider('Lifetime max (s)', config.lifetime.max, 0.05, 5, 0.05, (v) =>
						patchConfig(setCoreParam(config, 'lifetimeMax', v)),
					)}
				</section>

				<section>
					<h3>Spawn</h3>
					<label class="row">
						<span>Kind</span>
						<select
							value={spawnSel}
							onchange={(e) =>
								patchConfig(
									setSpawnKind(config, (e.currentTarget as HTMLSelectElement).value as SpawnKind),
								)}
						>
							<option value="point">Point</option>
							<option value="circle">Circle</option>
							<option value="ring">Ring</option>
							<option value="rectangle">Rectangle</option>
							<option value="burst">Burst (ring)</option>
						</select>
					</label>
					{#if spawnSel === 'burst' && brst}
						{@render slider('Spacing (°)', brst.spacing, 0, 180, 1, (v) =>
							patchConfig(setBurst(config, 'spacing', v)),
						)}
						{@render slider('Start angle (°)', brst.start, 0, 360, 1, (v) =>
							patchConfig(setBurst(config, 'start', v)),
						)}
						{@render slider('Distance (px)', brst.distance, 0, 400, 1, (v) =>
							patchConfig(setBurst(config, 'distance', v)),
						)}
						<p class="hint">
							Fires particles in an even fan — one every Spacing° from the Start angle, spawned
							Distance px out (0 = from the centre). Burst owns the launch direction, so the
							Direction controls below step aside. Pair with a short emitter lifetime for a one-shot
							explosion.
						</p>
					{:else if shape?.kind === 'circle'}
						{@render slider('Radius', shape.radius, 0, 400, 1, (v) =>
							patchConfig(setSpawnRadius(config, v)),
						)}
					{:else if shape?.kind === 'ring'}
						{@render slider('Outer radius', shape.radius, 0, 400, 1, (v) =>
							patchConfig(setSpawnRing(config, v, shape.innerRadius)),
						)}
						{@render slider('Inner radius', shape.innerRadius, 0, 400, 1, (v) =>
							patchConfig(setSpawnRing(config, shape.radius, v)),
						)}
					{:else if shape?.kind === 'rectangle'}
						{@render slider('Width', shape.width, 0, 800, 1, (v) =>
							patchConfig(setSpawnRect(config, v, shape.height)),
						)}
						{@render slider('Height', shape.height, 0, 800, 1, (v) =>
							patchConfig(setSpawnRect(config, shape.width, v)),
						)}
					{:else if shape?.kind === 'point'}
						<p class="hint">Particles spawn from a single point at the emitter origin.</p>
					{:else}
						<p class="hint">This config has no spawn shape — pick one to add it.</p>
					{/if}
				</section>

				<section>
					<div class="grouphead">
						<h3>Direction &amp; rotation</h3>
						{#if spawnSel !== 'burst'}
							<label class="toggle">
								<input
									type="checkbox"
									checked={!!emission}
									onchange={(e) =>
										patchConfig(
											setEmissionEnabled(config, (e.currentTarget as HTMLInputElement).checked),
										)}
								/>
								<span>On</span>
							</label>
						{/if}
					</div>
					{#if spawnSel === 'burst'}
						<p class="hint">
							Burst owns the launch direction — set it with Spacing / Start angle above.
						</p>
					{:else if emission}
						{@render slider('Direction (°)', emission.center, 0, 360, 1, (v) =>
							patchConfig(setEmissionArc(config, v, emission.spread)),
						)}
						{@render slider('Spread (±°)', emission.spread, 0, 180, 1, (v) =>
							patchConfig(setEmissionArc(config, emission.center, v)),
						)}
						<p class="hint">
							Launch direction: 0° = right, 90° = up, 180° = left, 270° = down. Spread 180° = all
							directions (each particle picks an angle in Direction ± Spread). A narrow upward arc +
							gravity makes a fountain.
						</p>
						{#if spin}
							{@render slider('Spin min (°/s)', spin.minSpeed, -720, 720, 5, (v) =>
								patchConfig(setParticleSpin(config, { ...spin, minSpeed: v })),
							)}
							{@render slider('Spin max (°/s)', spin.maxSpeed, -720, 720, 5, (v) =>
								patchConfig(setParticleSpin(config, { ...spin, maxSpeed: v })),
							)}
							{@render slider('Spin accel', spin.accel, -720, 720, 5, (v) =>
								patchConfig(setParticleSpin(config, { ...spin, accel: v })),
							)}
							<p class="hint">
								Spin is how fast the particle turns as it flies — each one picks a rate between min
								and max, then accelerates by Spin accel. All zero = no spin.
							</p>
						{/if}
					{:else}
						<p class="hint">
							This layer has no launch direction, so particles fly straight right (0°). Turn it on
							to author a direction + spread.
						</p>
					{/if}
					<label class="row check">
						<input
							type="checkbox"
							checked={lockAngle !== undefined}
							onchange={(e) =>
								patchConfig(
									setRotationLock(config, (e.currentTarget as HTMLInputElement).checked ? 0 : null),
								)}
						/>
						<span>Lock the particle's angle</span>
					</label>
					{#if lockAngle !== undefined}
						{@render slider('Locked angle', lockAngle, 0, 360, 1, (v) =>
							patchConfig(setRotationLock(config, v)),
						)}
						<p class="hint">
							Particles still TRAVEL along the direction above — they just don't turn to face it.
							What flat art (confetti, snowflakes, a flipbook) usually wants.
						</p>
					{/if}
				</section>

				{@render curveSection(
					'Alpha',
					config,
					'alpha',
					alphaRange,
					0,
					1,
					0.01,
					'This layer has no alpha curve — particles stay fully opaque. Turn it on to fade them.',
				)}

				{@render curveSection(
					'Scale',
					config,
					'scale',
					scaleRange,
					0,
					4,
					0.05,
					'This layer has no scale curve — particles render at their art size. Turn it on to grow or shrink them.',
				)}

				<section>
					<h3>Movement</h3>
					<label class="row">
						<span>Model</span>
						<select
							value={moveModel}
							onchange={(e) =>
								patchConfig(
									setMovementModel(
										config,
										(e.currentTarget as HTMLSelectElement).value as MovementModel,
									),
								)}
						>
							<option value="speed">Eased speed</option>
							<option value="gravity">Gravity (acceleration)</option>
						</select>
					</label>
					{#if moveModel === 'speed' && speedRange}
						<label class="toggle wide">
							<input
								type="checkbox"
								checked={speedRange.varied}
								onchange={(e) =>
									patchConfig(
										setCurveVaried(config, 'speed', (e.currentTarget as HTMLInputElement).checked),
									)}
							/>
							<span>Min / Max (vary per particle)</span>
						</label>
						{#if speedRange.varied}
							<!-- Each `min` tops out at its own `max` — see the `curveSection` snippet. -->
							{@render slider(
								'Speed start min',
								speedRange.startMin,
								0,
								speedRange.startMax,
								1,
								(v) => patchConfig(setCurveBound(config, 'speed', 'start', 'min', v)),
							)}
							{@render slider('Speed start max', speedRange.startMax, 0, 2000, 1, (v) =>
								patchConfig(setCurveBound(config, 'speed', 'start', 'max', v)),
							)}
							{@render slider('Speed end min', speedRange.endMin, 0, 2000, 1, (v) =>
								patchConfig(setCurveBound(config, 'speed', 'end', 'min', v)),
							)}
							{@render slider('Speed end max', speedRange.endMax, 0, 2000, 1, (v) =>
								patchConfig(setCurveBound(config, 'speed', 'end', 'max', v)),
							)}
						{:else}
							{@render slider('Speed start', speedRange.startMax, 0, 2000, 1, (v) =>
								patchConfig(setCurveBound(config, 'speed', 'start', 'max', v)),
							)}
							{@render slider('Speed end', speedRange.endMax, 0, 2000, 1, (v) =>
								patchConfig(setCurveBound(config, 'speed', 'end', 'max', v)),
							)}
						{/if}
						<p class="hint">
							Speed along the launch direction, eased over the particle's life. With Min / Max on,
							each particle launches somewhere in the Start range and eases to somewhere in the End
							range — the four bounds are independent.
						</p>
					{:else if moveModel === 'gravity' && grav}
						{@render slider('Start speed min', grav.minStart, 0, 2000, 10, (v) =>
							patchConfig(setGravity(config, 'minStart', v)),
						)}
						{@render slider('Start speed max', grav.maxStart, 0, 2000, 10, (v) =>
							patchConfig(setGravity(config, 'maxStart', v)),
						)}
						{@render slider('Gravity X', grav.accelX, -3000, 3000, 10, (v) =>
							patchConfig(setGravity(config, 'accelX', v)),
						)}
						{@render slider('Gravity Y', grav.accelY, -3000, 3000, 10, (v) =>
							patchConfig(setGravity(config, 'accelY', v)),
						)}
						{@render slider('Max speed', grav.maxSpeed, 0, 4000, 10, (v) =>
							patchConfig(setGravity(config, 'maxSpeed', v)),
						)}
						<label class="row check">
							<input
								type="checkbox"
								checked={grav.rotate}
								onchange={(e) =>
									patchConfig(
										setGravity(config, 'rotate', (e.currentTarget as HTMLInputElement).checked),
									)}
							/>
							<span>Rotate particle to its travel direction</span>
						</label>
						<p class="hint">
							Particles launch along the Emission direction at the start speed, then accelerate by
							gravity (positive Y pulls down). Up-direction + downward gravity = a fountain.
						</p>
					{/if}
				</section>

				<section>
					<h3>Colour</h3>
					<label class="row check">
						<input
							type="checkbox"
							checked={!!tint}
							onchange={(e) =>
								patchConfig(setColorEnabled(config, (e.currentTarget as HTMLInputElement).checked))}
						/>
						<span>Tint particles over life</span>
					</label>
					{#if tint}
						<label class="row">
							<span>Start</span>
							<ColorField
								value={tint.start}
								oninput={(hex) => patchConfig(setParticleColor(config, 'start', hex))}
							/>
						</label>
						<label class="row">
							<span>End</span>
							<ColorField
								value={tint.end}
								oninput={(hex) => patchConfig(setParticleColor(config, 'end', hex))}
							/>
						</label>
					{/if}
					<label class="row check">
						<input
							type="checkbox"
							checked={!!overlay}
							onchange={(e) =>
								patchConfig(
									setColorOverlayEnabled(config, (e.currentTarget as HTMLInputElement).checked),
								)}
						/>
						<span>Colour overlay (per-particle intensity)</span>
					</label>
					{#if overlay}
						<label class="row">
							<span>Overlay</span>
							<ColorField
								value={overlay.color}
								oninput={(hex) => patchConfig(setColorOverlayField(config, 'color', hex))}
							/>
						</label>
						{@render slider('Intensity min', overlay.min, 0, 1, 0.01, (v) =>
							patchConfig(setColorOverlayField(config, 'min', v)),
						)}
						{@render slider('Intensity max', overlay.max, 0, 1, 0.01, (v) =>
							patchConfig(setColorOverlayField(config, 'max', v)),
						)}
						<p class="hint">
							Every particle draws its own intensity between min and max — 0 leaves the art
							untouched, 1 replaces it with the overlay colour. Lays ON TOP of the over-life tint,
							so a spread here breaks up a flat-coloured burst.
						</p>
					{/if}
				</section>

				<section>
					<h3>Blend mode</h3>
					<label class="row">
						<span>Blend</span>
						<select
							value={blend}
							onchange={(e) =>
								patchConfig(
									setBlendMode(config, (e.currentTarget as HTMLSelectElement).value as BlendKind),
								)}
						>
							<option value="normal">Normal</option>
							<option value="add">Add (glow)</option>
							<option value="screen">Screen</option>
							<option value="multiply">Multiply</option>
						</select>
					</label>
					<p class="hint">Add / screen give the additive glow fire, sparks and magic want.</p>
				</section>
			{:else}
				<p class="hint">No layer selected.</p>
			{/if}
		</aside>
	</div>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: #0b0e13;
	}
	.subbar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 16px;
		border-bottom: 1px solid #1f2937;
		color: #cbd5e1;
		font-size: 13px;
	}
	.subbar strong {
		color: #e2e8f0;
	}
	.tag {
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 999px;
		background: #1f2937;
		color: #93c5fd;
	}
	.subbar button {
		font-size: 12px;
		padding: 4px 10px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #161b22;
		color: #cbd5e1;
		cursor: pointer;
	}
	.subbar button.primary {
		border-color: #2563eb;
		color: #bfdbfe;
	}
	.subbar button.danger {
		border-color: #5b2a2a;
		color: #fca5a5;
	}
	.subbar button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.subbar .name {
		width: 160px;
		padding: 4px 8px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #0e131a;
		color: #e2e8f0;
		font-size: 12px;
	}
	.subbar .open {
		padding: 4px 8px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #0e131a;
		color: #cbd5e1;
		font-size: 12px;
	}
	.spacer {
		flex: 1;
	}
	.count {
		color: #94a3b8;
	}
	.err {
		color: #fca5a5;
		font-size: 11px;
	}
	.ok {
		color: #86efac;
		font-size: 11px;
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.layers,
	.inspector {
		flex: none;
		border-color: #1f2937;
		padding: 12px;
		overflow-y: auto;
		color: #cbd5e1;
		font-size: 13px;
	}
	.layers {
		width: 244px;
		border-right: 1px solid #1f2937;
	}
	.inspector {
		width: 280px;
		border-left: 1px solid #1f2937;
	}
	.layers .head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}
	h3 {
		margin: 0 0 8px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.add {
		font-size: 12px;
		padding: 3px 8px;
		border-radius: 6px;
		border: 1px solid #2563eb;
		background: #161b22;
		color: #bfdbfe;
		cursor: pointer;
	}
	.layers ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.layers li {
		display: flex;
		align-items: stretch;
		gap: 4px;
	}
	.layers li.active .pick {
		border-color: #3b82f6;
		background: #182231;
	}
	.pick {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-align: left;
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #14181f;
		color: #e2e8f0;
		cursor: pointer;
		font-size: 12px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.pick .meta {
		color: #64748b;
		font-size: 10px;
	}
	.ico {
		flex: none;
		width: 22px;
		padding: 0;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #14181f;
		color: #94a3b8;
		cursor: pointer;
		font-size: 11px;
		line-height: 1;
	}
	.ico:hover:not(:disabled) {
		border-color: #3b82f6;
		color: #bfdbfe;
	}
	.del {
		border-color: #5b2a2a;
		background: #1d1416;
		color: #fca5a5;
	}
	.ico:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.clip {
		display: flex;
		gap: 6px;
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px solid #1f2937;
	}
	.clip button {
		flex: 1;
		padding: 5px 6px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #14181f;
		color: #cbd5e1;
		cursor: pointer;
		font-size: 11px;
	}
	.clip button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.canvas {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.stagebar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
		border-bottom: 1px solid #1f2937;
		background: #0e131a;
	}
	.stagebar .lbl {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.stagebar select {
		padding: 3px 6px;
		border-radius: 5px;
		border: 1px solid #2a323d;
		background: #0e131a;
		color: #e2e8f0;
		font-size: 12px;
	}
	.stagewrap {
		flex: 1;
		min-height: 0;
	}
	section {
		border-top: 1px solid #1f2937;
		padding-top: 10px;
		margin-bottom: 10px;
	}
	section:first-child {
		border-top: none;
		padding-top: 0;
	}
	/* A section heading with its on/off switch on the same line — the pattern that keeps a
	   section VISIBLE (and addable) instead of vanishing when its behavior is absent. */
	.grouphead {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}
	.toggle {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: #94a3b8;
		cursor: pointer;
	}
	.toggle input {
		accent-color: #3b82f6;
	}
	.toggle.wide {
		margin-bottom: 8px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 8px;
		font-size: 12px;
	}
	.row > span {
		color: #94a3b8;
	}
	.row input,
	.row select {
		width: 130px;
		padding: 3px 6px;
		border-radius: 5px;
		border: 1px solid #2a323d;
		background: #0e131a;
		color: #e2e8f0;
		font-size: 12px;
	}
	.row.check {
		justify-content: flex-start;
	}
	.row.check input {
		width: auto;
	}
	.row.slider {
		gap: 6px;
	}
	.row.slider > span {
		flex: none;
		width: 78px;
	}
	.row.slider input[type='range'] {
		flex: 1;
		width: auto;
		min-width: 0;
		padding: 0;
		accent-color: #3b82f6;
		background: transparent;
		border: none;
	}
	.row.slider .numbox {
		flex: none;
		width: 52px;
		padding: 3px 4px;
		text-align: right;
	}
	.mix {
		margin: 6px 0 4px;
		padding: 8px;
		border: 1px solid #1f2937;
		border-radius: 6px;
	}
	.mixhead {
		display: block;
		margin-bottom: 6px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.mix .mixname {
		flex: none;
		width: 96px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #cbd5e1;
	}
	.mix .pct {
		flex: none;
		width: 36px;
		text-align: right;
		color: #93c5fd;
		font-size: 11px;
	}
	.frames {
		display: flex;
		flex-direction: column;
		gap: 3px;
		max-height: 180px;
		overflow-y: auto;
		margin-bottom: 8px;
		padding: 4px;
		border: 1px solid #1f2937;
		border-radius: 6px;
	}
	.frame {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: #cbd5e1;
	}
	.hint {
		color: #64748b;
		font-size: 11px;
	}
</style>
