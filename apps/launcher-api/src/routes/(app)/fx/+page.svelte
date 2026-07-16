<script lang="ts">
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import type { EffectDoc, EmitterConfigV3, EmitterLayer } from 'engine-fx';
	import { onMount } from 'svelte';
	import FxStage, { type ResolvedArt } from './FxStage.svelte';
	import {
		applyPreset,
		blendMode,
		burst,
		emissionArc,
		emptyEffectDoc,
		frameMixPercents,
		frameWeightInputs,
		FX_PRESETS,
		gravity,
		listEndpoints,
		movementModel,
		newLayer,
		nextLayerKey,
		setFrameWeight,
		toggleArtFrame,
		particleColor,
		particleSpin,
		setBlendMode,
		setBurst,
		setColorEnabled,
		setCoreParam,
		setEmissionArc,
		setGravity,
		setListEndpoint,
		setMovementModel,
		setParticleColor,
		setParticleKind,
		setPlacementBone,
		setPlacementOffset,
		setPlacementSpace,
		setParticleSpin,
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
	let saving = $state(false);
	let saveError = $state<string>('');
	/** ETag of the OPENED effect's doc — sent on save, re-adopted from the response.
	 * `null` when composing a new effect, which makes the save assert the name is free. */
	let docEtag = $state<string | null>(data.openedEtag);
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
		saving = true;
		saveError = '';
		savedNote = '';
		try {
			// The R2 file stem is the doc's id. A never-saved effect still holds the untitled
			// sentinel, so key its id off the NAME — distinct names ⇒ distinct files (the fix for
			// "every save overwrites the same effect"). Once saved/opened the id is the stable
			// server-slugged stem, so a rename just relabels the same file (no orphan, no clobber).
			const isUnsaved = doc.id === '' || doc.id === UNTITLED_EFFECT_ID;
			const outgoingId = isUnsaved ? doc.name.trim() || doc.id : doc.id;
			const res = await fetch('/api/fx/save', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					doc: { ...$state.snapshot(doc), id: outgoingId },
					// Editor-only sidecar — NEVER folded into the EffectDoc (out-of-band, §4).
					meta: { selectedLayer: selectedKey },
					// Names the project THIS tab loaded, so the server refuses rather than
					// writing to whatever project the session has since switched to.
					projectKey: data.projectKey,
					// Keying an unsaved effect off its name means the id may already be
					// SOMEONE ELSE'S — `null` asserts it's free and 409s if it isn't.
					...(force ? { force: true } : { baseEtag: isUnsaved ? null : docEtag }),
				}),
			});
			if (res.status === 409) {
				const out = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
				const msg = out.message ?? 'This effect changed since you opened it.';
				saveError = msg;
				// A wrong-project save is never forceable — reloading is the only fix.
				if (out.error === 'scope-mismatch') return false;
				saving = false;
				// Spell out that this DESTROYS the other effect. Effects have no history, so
				// "overwrite" here is permanent — cancelling and renaming is the safe way out,
				// and the wording has to make that the obvious read.
				const ok = confirm(
					`${msg}\n\nOverwrite it with yours?\n\n` +
						'This permanently REPLACES the stored effect. It has no version history, ' +
						'so their work cannot be recovered. Cancel to rename yours instead.',
				);
				return ok ? await saveEffect(true) : false;
			}
			if (!res.ok) {
				saveError = `Save failed (HTTP ${res.status}).`;
				return false;
			}
			const out = (await res.json()) as {
				id: string;
				name: string;
				layers: number;
				etag: string | null;
			};
			// The server slugs the id; adopt it so a subsequent save/open round-trips cleanly.
			doc = { ...doc, id: out.id };
			docEtag = out.etag;
			pickerId = out.id;
			// Reflect the save in the picker immediately (add a new effect, or relabel a renamed one).
			upsertEffect({ id: out.id, name: out.name });
			savedNote = `Saved "${out.name}" (${out.layers} layer${out.layers === 1 ? '' : 's'}).`;
			return true;
		} catch {
			saveError = 'Save failed (network error).';
			return false;
		} finally {
			saving = false;
		}
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
		const previousEtag = docEtag;
		doc = { ...doc, id: UNTITLED_EFFECT_ID, name: clean };
		docEtag = null;
		if (!(await saveEffect())) {
			doc = { ...doc, id: previous.id, name: previous.name };
			docEtag = previousEtag;
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
		saving = true;
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
			}
			pickerId = '';
		} catch {
			saveError = 'Delete failed (network error).';
		} finally {
			saving = false;
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

	// --- inspector readouts (derived from the config) ---------------------------
	const alphaEnds = $derived(config ? listEndpoints(config, 'alpha', 'alpha') : undefined);
	const scaleEnds = $derived(config ? listEndpoints(config, 'scale', 'scale') : undefined);
	const speedEnds = $derived(config ? listEndpoints(config, 'moveSpeed', 'speed') : undefined);
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
		<button class="primary" onclick={saveEffect} disabled={saving}>
			{saving ? 'Saving…' : '⤓ Save'}
		</button>
		<button title="Save a copy under a new name" onclick={saveEffectAs} disabled={saving}
			>⧉ Save As…</button
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
			disabled={saving || !pickerId}
			onclick={deleteOpenEffect}>🗑 Delete</button
		>
		<button onclick={() => (playing = !playing)}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
		<button onclick={() => stage?.resetView()}>Reset view</button>
		<span class="spacer"></span>
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
				{#each doc.layers as layer (layer.key)}
					<li class:active={layer.key === selectedKey}>
						<button class="pick" onclick={() => (selectedKey = layer.key)}>
							{layer.key}
							<span class="meta"
								>{layer.art.frames.length} frame{layer.art.frames.length === 1 ? '' : 's'}</span
							>
						</button>
						<button
							class="del"
							title="Remove layer"
							disabled={doc.layers.length === 1}
							onclick={() => removeLayer(layer.key)}>✕</button
						>
					</li>
				{/each}
			</ul>
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
							Emission section is replaced. Pair with a short emitter lifetime for a one-shot
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

				{#if emission}
					<section>
						<h3>Emission</h3>
						{@render slider('Direction (°)', emission.center, 0, 360, 1, (v) =>
							patchConfig(setEmissionArc(config, v, emission.spread)),
						)}
						{@render slider('Spread (±°)', emission.spread, 0, 180, 1, (v) =>
							patchConfig(setEmissionArc(config, emission.center, v)),
						)}
						<p class="hint">
							Launch direction: 0° = right, 90° = up, 180° = left, 270° = down. Spread 180° = all
							directions. A narrow upward arc + gravity makes a fountain.
						</p>
						{#if spin}
							{@render slider('Spin min (°/s)', spin.minSpeed, -720, 720, 5, (v) =>
								patchConfig(setParticleSpin(config, { ...spin, minSpeed: v })),
							)}
							{@render slider('Spin max (°/s)', spin.maxSpeed, -720, 720, 5, (v) =>
								patchConfig(setParticleSpin(config, { ...spin, maxSpeed: v })),
							)}
						{/if}
					</section>
				{/if}

				{#if alphaEnds}
					<section>
						<h3>Alpha</h3>
						{@render slider('Start', alphaEnds.start, 0, 1, 0.01, (v) =>
							patchConfig(setListEndpoint(config, 'alpha', 'alpha', 'start', v)),
						)}
						{@render slider('End', alphaEnds.end, 0, 1, 0.01, (v) =>
							patchConfig(setListEndpoint(config, 'alpha', 'alpha', 'end', v)),
						)}
					</section>
				{/if}

				{#if scaleEnds}
					<section>
						<h3>Scale</h3>
						{@render slider('Start', scaleEnds.start, 0, 4, 0.05, (v) =>
							patchConfig(setListEndpoint(config, 'scale', 'scale', 'start', v)),
						)}
						{@render slider('End', scaleEnds.end, 0, 4, 0.05, (v) =>
							patchConfig(setListEndpoint(config, 'scale', 'scale', 'end', v)),
						)}
					</section>
				{/if}

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
					{#if moveModel === 'speed' && speedEnds}
						{@render slider('Speed start', speedEnds.start, 0, 1000, 1, (v) =>
							patchConfig(setListEndpoint(config, 'moveSpeed', 'speed', 'start', v)),
						)}
						{@render slider('Speed end', speedEnds.end, 0, 1000, 1, (v) =>
							patchConfig(setListEndpoint(config, 'moveSpeed', 'speed', 'end', v)),
						)}
						<p class="hint">Speed along the launch direction, eased over the particle's life.</p>
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
							<input
								type="color"
								value={tint.start}
								oninput={(e) =>
									patchConfig(
										setParticleColor(config, 'start', (e.currentTarget as HTMLInputElement).value),
									)}
							/>
						</label>
						<label class="row">
							<span>End</span>
							<input
								type="color"
								value={tint.end}
								oninput={(e) =>
									patchConfig(
										setParticleColor(config, 'end', (e.currentTarget as HTMLInputElement).value),
									)}
							/>
						</label>
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
		width: 200px;
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
	.del {
		padding: 0 8px;
		border-radius: 6px;
		border: 1px solid #5b2a2a;
		background: #1d1416;
		color: #fca5a5;
		cursor: pointer;
		font-size: 11px;
	}
	.del:disabled {
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
