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
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import { DEFAULT_FLIPBOOK_FPS, detectSequences, type FlipbookClip } from 'engine-flipbook';
	import { fetchRegions, type RegionSet } from '../editor/editorRegions.client';
	import RegionThumb from '../editor/RegionThumb.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

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

	// --- save / open state ------------------------------------------------------
	let saving = $state(false);
	let saveError = $state('');
	let savedNote = $state('');
	/** ETag of the OPENED clip — sent on save, re-adopted from the response. `null` when
	 * composing a new clip, which makes the save assert the name is free. */
	let docEtag = $state<string | null>(data.openedEtag);
	let pickerId = $state<string>(data.openedClip?.id ?? '');
	/** LOCAL, reactive copy of the clip index so a save shows in the rail without a reload. */
	let clips = $state<{ id: string; name: string; frames: number }[]>(data.clips);

	function upsertClip(row: { id: string; name: string; frames: number }): void {
		const rest = clips.filter((c) => c.id !== row.id);
		clips = [...rest, row].sort((a, b) => a.name.localeCompare(b.name));
	}

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
		saving = true;
		saveError = '';
		savedNote = '';
		try {
			const isUnsaved = clip.id === '' || clip.id === UNTITLED_CLIP_ID;
			const outgoingId = isUnsaved ? clip.name.trim() || clip.id : clip.id;
			const res = await fetch('/api/flipbook/save', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					clip: { ...$state.snapshot(clip), id: outgoingId },
					// Names the project THIS tab loaded, so the server refuses rather than writing
					// to whatever project the session has since switched to.
					projectKey: data.projectKey,
					...(force ? { force: true } : { baseEtag: isUnsaved ? null : docEtag }),
				}),
			});
			if (res.status === 409) {
				const out = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
				const msg = out.message ?? 'This clip changed since you opened it.';
				saveError = msg;
				if (out.error === 'scope-mismatch') return false; // never forceable — reload is the fix
				saving = false;
				const ok = confirm(
					`${msg}\n\nOverwrite it with yours?\n\n` +
						'This permanently REPLACES the stored clip. It has no version history, ' +
						'so their work cannot be recovered. Cancel to rename yours instead.',
				);
				return ok ? await save(true) : false;
			}
			if (!res.ok) {
				saveError = `Save failed (HTTP ${res.status}).`;
				return false;
			}
			const out = (await res.json()) as {
				id: string;
				name: string;
				frames: number;
				etag: string | null;
			};
			// The server slugs the id; adopt it so a later save/open round-trips cleanly.
			clip = { ...clip, id: out.id };
			docEtag = out.etag;
			pickerId = out.id;
			upsertClip({ id: out.id, name: out.name, frames: out.frames });
			savedNote = `Saved "${out.name}" (${out.frames} frame${out.frames === 1 ? '' : 's'}).`;
			return true;
		} catch {
			saveError = 'Save failed (network error).';
			return false;
		} finally {
			saving = false;
		}
	}

	/** Save a COPY under a new name. Resetting the id to the sentinel makes the save key the new
	 * file off the new name; the original's R2 object is untouched. */
	async function saveAs(): Promise<void> {
		const name = window.prompt('Save as a new clip named:', `${clip.name} copy`.trim());
		if (name === null) return;
		const clean = name.trim();
		if (!clean) return;
		// A refused overwrite must not strand the tab holding the sentinel id + the copy's name.
		const previous = { id: clip.id, name: clip.name };
		const previousEtag = docEtag;
		clip = { ...clip, id: UNTITLED_CLIP_ID, name: clean };
		docEtag = null;
		if (!(await save())) {
			clip = { ...clip, id: previous.id, name: previous.name };
			docEtag = previousEtag;
		}
	}

	async function deleteOpen(): Promise<void> {
		const id = pickerId || (clip.id !== UNTITLED_CLIP_ID ? clip.id : '');
		if (!id) return;
		const label = clips.find((c) => c.id === id)?.name ?? id;
		if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
		saving = true;
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
			if (clip.id === id) clip = emptyClip();
			pickerId = '';
		} catch {
			saveError = 'Delete failed (network error).';
		} finally {
			saving = false;
		}
	}

	// Navigating (rather than swapping in memory) keeps the loader the single seeder of both the
	// clip and its ETag — the same choice `/fx` makes.
	const newClip = (): void => void (window.location.href = '/flipbook');
	const openClip = (id: string): void =>
		void (window.location.href = `/flipbook?clip=${encodeURIComponent(id)}`);

	// --- source sheet + regions -------------------------------------------------
	let sheetKey = $state<string>(data.openedClip?.assetKey ?? data.atlases[0]?.manifestKey ?? '');
	let regionSet = $state<RegionSet | null>(null);
	let regionFilter = $state('');

	$effect(() => {
		const key = sheetKey;
		if (!key) {
			regionSet = null;
			return;
		}
		let live = true;
		void fetchRegions(key).then((set) => {
			if (live) regionSet = set;
		});
		return () => {
			live = false;
		};
	});

	const regionsByName = $derived(new Map((regionSet?.regions ?? []).map((r) => [r.name, r])));
	const visibleRegions = $derived(
		(regionSet?.regions ?? []).filter((r) =>
			regionFilter ? r.name.toLowerCase().includes(regionFilter.toLowerCase()) : true,
		),
	);

	/**
	 * Author-time dangling detection (design doc §"Referential integrity"): a clip joins its sheet
	 * by region NAME, which survives a repack but NOT a rename or delete. Catching it the moment
	 * the author opens the clip is the whole point — a silently shortened animation looks
	 * plausible, so it must never be discovered at bake.
	 *
	 * Only meaningful once the region set for the clip's OWN sheet has loaded; while the author is
	 * previewing a different sheet we do not accuse the frames of being missing.
	 */
	const framesResolved = $derived(regionSet !== null && sheetKey === clip.assetKey);
	const missingFrames = $derived(
		framesResolved ? clip.frames.filter((f) => !regionsByName.has(f)) : [],
	);

	/** Switching sheets is destructive: v1 is one sheet per clip, so the existing frame names
	 * cannot be resolved against the new page. Confirm rather than silently dangle them all. */
	function pickSheet(key: string): void {
		if (key === sheetKey) return;
		if (
			clip.frames.length &&
			key !== clip.assetKey &&
			!window.confirm(
				'A clip draws its frames from ONE sheet. Switching sheets clears the ' +
					`${clip.frames.length} frame${clip.frames.length === 1 ? '' : 's'} in this clip.`,
			)
		) {
			return;
		}
		sheetKey = key;
		if (key !== clip.assetKey) clip = { ...clip, assetKey: key, frames: [] };
		frameIndex = 0;
	}

	// --- ordered frame list -----------------------------------------------------
	function setFrames(frames: string[]): void {
		clip = { ...clip, frames };
		if (frameIndex >= frames.length) frameIndex = Math.max(0, frames.length - 1);
	}

	const appendFrame = (name: string): void => {
		if (clip.assetKey !== sheetKey) clip = { ...clip, assetKey: sheetKey };
		setFrames([...clip.frames, name]);
	};

	const removeFrame = (i: number): void => setFrames(clip.frames.filter((_, n) => n !== i));

	// --- detected sequences -----------------------------------------------------
	// A sheet states its animations in its region names. Rebuilding a 49-frame run by clicking
	// 49 thumbnails is the wrong default, so offer each consecutively-numbered run as one click.
	// Detected from the region NAMES rather than read from the manifest's `sequences` hint, so an
	// authored sheet gets the same offer as one imported verbatim from a .plist — the hint stays
	// provenance. `detectSequences` is held to parity with the Sheet Maker's Python twin by
	// `tools/flipbook-spike/sequences.ts`.
	const sequences = $derived(detectSequences((regionSet?.regions ?? []).map((r) => r.name)));
	/** Runs not already exactly loaded — a run the author just applied stops being an offer. */
	const sequenceOffers = $derived(
		sequences.filter((s) => s.frames.join(' ') !== clip.frames.join(' ')),
	);

	/** Replace (not append) the frame list with a detected run. Appending would silently produce
	 * a double-length clip when clicked twice, and the run IS the animation — so it is the list. */
	function useSequence(seq: { stem: string; frames: string[] }): void {
		if (
			clip.frames.length > 0 &&
			!confirm(
				`Replace the ${clip.frames.length} frame(s) in this clip with the ${seq.frames.length}-frame ` +
					`sequence "${seq.stem}"?`,
			)
		) {
			return;
		}
		clip = {
			...clip,
			assetKey: sheetKey,
			// Only name the clip after the run when it is still unnamed/untitled — never clobber
			// a name the author chose.
			name: clip.name && clip.id !== UNTITLED_CLIP_ID ? clip.name : seq.stem,
			frames: [...seq.frames],
		};
		frameIndex = 0;
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
	let playing = $state(false);
	let frameIndex = $state(0);

	const fps = $derived(clip.fps ?? DEFAULT_FLIPBOOK_FPS);
	const loop = $derived(clip.loop !== false);
	const currentName = $derived(clip.frames[frameIndex] ?? '');
	const currentRegion = $derived(currentName ? (regionsByName.get(currentName) ?? null) : null);

	/**
	 * The playback clock. Deliberately accumulator-based rather than `setInterval(1000/fps)` so a
	 * dropped rAF doesn't desynchronise the sequence — a flipbook's timing IS its content.
	 * Reads only `playing`, `count` and `rate`, so advancing `frameIndex` cannot re-enter it.
	 */
	$effect(() => {
		const count = clip.frames.length;
		const rate = fps;
		const looping = loop;
		if (!playing || count === 0 || rate <= 0) return;
		let raf = 0;
		let last = performance.now();
		let acc = 0;
		const step = (now: number): void => {
			acc += now - last;
			last = now;
			const period = 1000 / rate;
			while (acc >= period) {
				acc -= period;
				const next = frameIndex + 1;
				if (next >= count) {
					if (!looping) {
						playing = false;
						return;
					}
					frameIndex = 0;
				} else {
					frameIndex = next;
				}
			}
			raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	});

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
		{/snippet}
	</ToolTopBar>

	<div class="body">
		<aside class="rail">
			<div class="head">
				<h3>Clips</h3>
				<button class="add" onclick={newClip}>+ New</button>
			</div>
			<ul class="cliplist">
				{#each clips as row (row.id)}
					<li>
						<button class:active={row.id === pickerId} onclick={() => openClip(row.id)}>
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
				<button class="primary" disabled={saving} onclick={() => save()}>
					{saving ? 'Saving…' : '⤓ Save'}
				</button>
				<button disabled={saving} onclick={saveAs}>⧉ Save As…</button>
				<button class="danger" disabled={saving || !pickerId} onclick={deleteOpen}>
					🗑 Delete
				</button>
			</div>
		</aside>

		<section class="center">
			<div class="preview">
				<div class="stage">
					{#if regionSet && currentRegion}
						<RegionThumb set={regionSet} region={currentRegion} size={240} />
					{:else}
						<div class="ph">
							{clip.frames.length ? 'Frame not found in this sheet' : 'Add frames to preview'}
						</div>
					{/if}
				</div>
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
						max={Math.max(0, clip.frames.length - 1)}
						step="1"
						disabled={clip.frames.length === 0}
						value={frameIndex}
						oninput={(e) => {
							playing = false;
							frameIndex = Number(e.currentTarget.value);
						}}
					/>
					<span class="pos">
						{clip.frames.length ? frameIndex + 1 : 0} / {clip.frames.length}
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
				</div>
				{#if currentName}<div class="curname">{currentName}</div>{/if}
			</div>

			<div class="frames">
				<h3>Frames — drag to reorder</h3>
				<ol class="framelist">
					{#each clip.frames as name, i (i)}
						{@const region = regionsByName.get(name)}
						<li
							draggable="true"
							class:dragging={dragFrom === i}
							class:over={dragOver === i}
							class:current={i === frameIndex}
							class:missing={framesResolved && !region}
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
								{#if regionSet && region}
									<RegionThumb set={regionSet} {region} size={40} />
								{:else}
									<span class="noart">?</span>
								{/if}
							</span>
							<button
								class="nm"
								title="Show this frame"
								onclick={() => {
									playing = false;
									frameIndex = i;
								}}>{name}</button
							>
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
			<h3>Source sheet</h3>
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
						These regions are numbered consecutively, so they are probably one animation.
					</p>
					{#each sequenceOffers as seq (seq.stem)}
						<button class="seq" onclick={() => useSequence(seq)}>
							<span class="sqn">{seq.stem}</span>
							<span class="sqc">{seq.frames.length} frames</span>
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
	.rail .head {
		display: flex;
		align-items: center;
		justify-content: space-between;
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
	.stage {
		display: grid;
		place-items: center;
		height: 248px;
		border-radius: 8px;
		background: #070a0e;
		border: 1px solid #1f2937;
	}
	.ph {
		color: #475569;
		font-size: 12px;
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
