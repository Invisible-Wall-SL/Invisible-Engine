<script lang="ts">
	import { onMount } from 'svelte';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import SaveStatusBadge from '$lib/SaveStatusBadge.svelte';
	import PresenceBanner from '$lib/PresenceBanner.svelte';
	import { LeaseState } from '$lib/leaseState.svelte';
	import { SaveState } from '$lib/saveState.svelte';
	import {
		SOUND_FILE_EXTENSIONS,
		SOUND_ORIGINS,
		isValidSoundName,
		type SoundEntry,
		type SoundOrigin,
		type SoundsDoc,
	} from 'engine-layout';
	import { checkSoundLibrary, type SoundBinding } from '$lib/soundUsage';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** The live library. Seeded from the server's normalized doc and PUT back verbatim. */
	let doc = $state<SoundsDoc>(structuredClone(data.doc));

	/** Compared against the doc to drive the dirty pill. `$state.snapshot` because a raw
	 *  `structuredClone` of a `$state` proxy throws `DataCloneError`. */
	let baseline = $state(JSON.stringify(data.doc));
	const dirty = $derived(JSON.stringify($state.snapshot(doc)) !== baseline);

	const entries = $derived(doc.entries ?? []);

	const UNSORTED = 'Unsorted';

	/** Entries grouped for browsing, section order following first appearance so the list does not
	 *  reshuffle as sections are typed. */
	const sections = $derived.by(() => {
		const groups = new Map<string, SoundEntry[]>();
		for (const entry of entries) {
			const key = entry.section?.trim() || UNSORTED;
			const list = groups.get(key) ?? [];
			list.push(entry);
			groups.set(key, list);
		}
		return [...groups.entries()];
	});

	const approvedCount = $derived(entries.filter((e) => e.status === 'approved').length);

	/**
	 * Names that would COLLIDE on save. The server collapses duplicates last-wins, so two entries
	 * sharing a name means the earlier one silently vanishes — the page has to say so before the
	 * author loses the row rather than after.
	 */
	const duplicateNames = $derived.by(() => {
		const seen = new Set<string>();
		const dupes = new Set<string>();
		for (const entry of entries) {
			if (seen.has(entry.name)) dupes.add(entry.name);
			seen.add(entry.name);
		}
		return dupes;
	});

	/** Entries the save would DROP — an invalid name is not a warning, it is a deletion. */
	const invalidNames = $derived(entries.filter((e) => !isValidSoundName(e.name)).length);

	// ── usage index ─────────────────────────────────────────────────────────────────────────────
	// The bindings come from the server (the config / symbols / flow docs, which this page cannot
	// edit); the CHECKS re-run here on every keystroke, so renaming a sound immediately shows it
	// becoming unbound rather than staying green until a reload.
	const bindings = $derived(data.bindings as Record<string, SoundBinding[]>);
	const boundNames = $derived(Object.keys(bindings));
	const checks = $derived(
		checkSoundLibrary(
			$state.snapshot(doc),
			(name) => Boolean(bindings[name]?.length),
			boundNames,
			data.builtinNames,
		),
	);
	const overriding = $derived(new Set(checks.overridesBuiltin));

	/** What plays a given sound — an empty list means nothing does. */
	const usesOf = (name: string): SoundBinding[] => bindings[name] ?? [];

	const SOURCE_LABEL: Record<SoundBinding['source'], string> = {
		slot: 'Game Config',
		winTier: 'Game Config',
		symbol: 'Symbols',
		anticipation: 'Symbols',
		flow: 'Flow',
	};

	let showNotRebindable = $state(false);

	// ── audition ────────────────────────────────────────────────────────────────────────────────
	// One shared element rather than one per row: a library of fifty rows would otherwise open fifty
	// connections, and only one sound is ever being listened to.
	let player: HTMLAudioElement | undefined;
	let playingId = $state<string | null>(null);

	const fileUrl = (file: string) =>
		`/api/sounds/file?project=${encodeURIComponent(data.projectKey)}&file=${encodeURIComponent(file)}`;

	function toggle(entry: SoundEntry) {
		if (!player) return;
		if (playingId === entry.id) {
			player.pause();
			playingId = null;
			return;
		}
		player.src = fileUrl(entry.file);
		// The authored level, so what you hear is what the game will play — auditioning at full
		// volume a sound you deliberately mixed down to 0.2 tells you nothing useful.
		player.volume = entry.volume ?? 1;
		playingId = entry.id;
		void player.play().catch(() => {
			playingId = null;
		});
	}

	// ── upload ──────────────────────────────────────────────────────────────────────────────────
	let uploading = $state(0);
	let uploadError = $state('');
	let dragging = $state(false);

	const ACCEPT = SOUND_FILE_EXTENSIONS.map((e) => `.${e}`).join(',');

	/**
	 * A playable NAME derived from the upload's own filename, sanitized to what a binding may hold
	 * and de-duplicated against the library.
	 *
	 * Deduplicating here is not politeness: the server collapses duplicates last-wins, so an upload
	 * that reused an existing name would REPLACE that entry on the next save and take its sound out
	 * of the game with no visible step.
	 */
	function nameFor(fileName: string): string {
		// `lastIndexOf` returns -1 for a name with no dot, and `slice(0, -1)` would quietly eat the
		// last character. Only reachable if the extension check ever loosens, which is exactly when
		// nobody would be looking here.
		const dot = fileName.lastIndexOf('.');
		const base = dot > 0 ? fileName.slice(0, dot) : fileName;
		let candidate =
			base
				.trim()
				.replace(/[^A-Za-z0-9_-]+/g, '_')
				.replace(/^_+|_+$/g, '')
				.slice(0, 60) || 'sound';
		const taken = new Set(entries.map((e) => e.name));
		if (!taken.has(candidate)) return candidate;
		for (let i = 2; ; i += 1) {
			const next = `${candidate}_${i}`;
			if (!taken.has(next)) return next;
		}
	}

	/**
	 * The file's real length, measured by decoding it here.
	 *
	 * The server does not do this: it would have to decode five container formats, while the browser
	 * has already decoded the file to play it and its answer is the one that matters — the same
	 * decoder plays the sound in the game. The value becomes the sprite region's length, so a wrong
	 * one clips the sound or makes howler's `end` fire late.
	 */
	async function measureDurationMs(file: File): Promise<number> {
		const ctx = new AudioContext();
		try {
			const buf = await ctx.decodeAudioData(await file.arrayBuffer());
			return Math.max(1, Math.round(buf.duration * 1000));
		} finally {
			void ctx.close();
		}
	}

	async function uploadOne(file: File): Promise<void> {
		const durationMs = await measureDurationMs(file);

		const form = new FormData();
		form.append('file', file);
		const res = await fetch(`/api/sounds/file?project=${encodeURIComponent(data.projectKey)}`, {
			method: 'POST',
			body: form,
		});
		if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
		const stored = (await res.json()) as { id: string; file: string };

		doc.entries = [
			...entries,
			{
				id: stored.id,
				name: nameFor(file.name),
				kind: 'sfx',
				file: stored.file,
				durationMs,
				status: 'draft',
				origin: 'library',
			},
		];
	}

	/**
	 * The bytes land immediately; the ENTRY only exists once you save. That gap is deliberate — an
	 * upload that also wrote the doc would have to write it unconditionally and could erase a
	 * co-author's library — but it means a file uploaded and never saved is an orphan, so the page
	 * says as much rather than letting it look filed away.
	 */
	async function addFiles(files: FileList | null) {
		if (!files?.length) return;
		uploadError = '';
		for (const file of Array.from(files)) {
			uploading += 1;
			try {
				await uploadOne(file);
			} catch (e) {
				uploadError = `${file.name}: ${e instanceof Error ? e.message : String(e)}`;
			} finally {
				uploading -= 1;
			}
		}
	}

	function remove(entry: SoundEntry) {
		if (playingId === entry.id) {
			player?.pause();
			playingId = null;
		}
		doc.entries = entries.filter((e) => e.id !== entry.id);
	}

	function setVolume(entry: SoundEntry, raw: string) {
		const n = Number(raw);
		// Out of range is DROPPED, not clamped — the same rule the doc's normalize applies, so the
		// page can't show a level the save would refuse to keep.
		if (Number.isFinite(n) && n >= 0 && n <= 1) entry.volume = n;
		else delete entry.volume;
	}

	function setApproved(entry: SoundEntry, approved: boolean) {
		entry.status = approved ? 'approved' : 'draft';
		if (approved) entry.reviewedAt = new Date().toISOString();
		else {
			// Demoting must actually revoke: a reviewer left on a draft would make the sign-off
			// permanent, which is the one thing an approval must not be.
			delete entry.reviewedBy;
			delete entry.reviewedAt;
		}
	}

	const fmt = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

	// ── save ────────────────────────────────────────────────────────────────────────────────────
	const lease = new LeaseState({
		toolId: 'sound',
		clientKey: data.clientKey,
		projectKey: data.projectKey,
		docKey: 'sound',
		enabled: data.projectKey.length > 0,
	});

	const saveState = new SaveState({
		initialEtag: data.etag,
		conflictMessage: 'Someone else saved this sound library while you were editing.',
		blockWhen: () => lease.readOnly,
		save: async ({ baseEtag, force }) => {
			const res = await fetch(`/api/sounds?project=${encodeURIComponent(data.projectKey)}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ doc: $state.snapshot(doc), baseEtag, force }),
			});
			if (res.status === 409) {
				const c = (await res.json()) as { message?: string };
				return { ok: false, reason: 'conflict', message: c.message };
			}
			if (!res.ok) {
				return { ok: false, reason: 'error', message: (await res.text()) || `HTTP ${res.status}` };
			}
			// Adopt the SERVER's doc, not the payload: the normalize DROPS entries it cannot ship, so a
			// page that kept its own copy would list sounds the project does not have.
			const saved = (await res.json()) as { doc: SoundsDoc; etag: string | null };
			doc = structuredClone(saved.doc);
			baseline = JSON.stringify(saved.doc);
			return { ok: true, etag: saved.etag };
		},
	});
	const save = (force = false) => void saveState.save({ force });

	// The dirty flag is DERIVED here (a doc snapshot compared to the last-saved baseline) but the
	// shared pill reads `state.dirty`, so the two have to be kept in step or the badge never leaves
	// "Saved" no matter what you type. Manual-save tool, so this only feeds the pill — there is no
	// debounce to arm.
	$effect(() => {
		saveState.setDirty(dirty);
	});

	onMount(() => {
		void lease.start();
		const onUnload = () => lease.release();
		window.addEventListener('pagehide', onUnload);
		return () => {
			window.removeEventListener('pagehide', onUnload);
			lease.release();
			player?.pause();
		};
	});
</script>

<svelte:head><title>Invisible Sound — {data.projectKey}</title></svelte:head>

<audio bind:this={player} onended={() => (playingId = null)} hidden></audio>

<div class="page">
	<ToolTopBar
		current="sound"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.projectKey}
	>
		{#snippet meta()}
			{#if lease.readOnly}
				<PresenceBanner {lease} />
			{:else}
				<SaveStatusBadge
					state={saveState}
					dirtyLabel="Unsaved"
					onRetry={() => save()}
					onReloadTheirs={() => location.reload()}
				/>
			{/if}
			<button
				class="save"
				onclick={() => save()}
				disabled={lease.readOnly || saveState.busy || !dirty}
			>
				{saveState.busy ? 'Saving…' : 'Save'}
			</button>
		{/snippet}
	</ToolTopBar>

	<div class="body">
		{#if saveState.status === 'conflict'}
			<div class="conflict">
				<p>{saveState.message}</p>
				<p class="conflict-sub">
					Your edits are still on this page — nothing has been lost. Reload to take their version
					(your unsaved edits go), or overwrite with yours.
				</p>
				<div class="conflict-actions">
					<button onclick={() => location.reload()}>Reload theirs</button>
					<button class="danger" onclick={() => save(true)}>Overwrite with mine</button>
				</div>
			</div>
		{/if}

		<p class="intro">
			Every sound this game owns. Upload them here, listen, say where each came from, and approve
			the ones that are cleared to ship. <strong>Which cue plays when</strong> is not set here — a
			game-wide moment lives in <a href="/config">Invisible Game Config</a>, a per-symbol cue in
			<a href="/symbols">Invisible Symbols</a>, and a one-off in
			<a href="/flow-v2">Invisible Flow</a>. Those tools bind a sound by the
			<strong>name</strong> you give it below.
		</p>

		<section>
			<h2>Add sounds</h2>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="drop"
				class:over={dragging}
				ondragover={(e) => {
					e.preventDefault();
					dragging = true;
				}}
				ondragleave={() => (dragging = false)}
				ondrop={(e) => {
					e.preventDefault();
					dragging = false;
					void addFiles(e.dataTransfer?.files ?? null);
				}}
			>
				<p>Drop audio here, or</p>
				<label class="pick">
					<input
						type="file"
						accept={ACCEPT}
						multiple
						onchange={(e) => {
							const input = e.currentTarget;
							void addFiles(input.files).then(() => (input.value = ''));
						}}
					/>
					choose files
				</label>
				<p class="hint">{SOUND_FILE_EXTENSIONS.join(', ')} — up to 25 MB each</p>
				{#if uploading > 0}<p class="hint busy">Uploading {uploading}…</p>{/if}
				{#if uploadError}<p class="err">{uploadError}</p>{/if}
			</div>
			<p class="hint">
				A file is stored the moment it uploads, but it only becomes part of the library when you
				<strong>save</strong>. Leave without saving and the bytes stay behind unreferenced.
			</p>
		</section>

		{#if entries.length === 0}
			<p class="empty">
				This project has no sounds of its own yet — the game plays only the sounds built into the
				engine.
			</p>
		{:else}
			<p class="counts">
				{entries.length} sound{entries.length === 1 ? '' : 's'} · {approvedCount} approved ·
				{entries.length - approvedCount} draft
			</p>

			{#if invalidNames > 0}
				<p class="warn">
					<strong
						>{invalidNames} sound{invalidNames === 1 ? ' has' : 's have'} an unusable name.</strong
					>
					A name may only contain letters, numbers, <code>_</code> and <code>-</code>. Saving now
					would
					<strong>drop</strong> those rows.
				</p>
			{/if}
			{#if duplicateNames.size > 0}
				<p class="warn">
					<strong>Two sounds share a name ({[...duplicateNames].join(', ')}).</strong> Only the last
					one survives a save — rename one, or the other disappears.
				</p>
			{/if}

			{#each sections as [section, list] (section)}
				<section>
					<h2>{section}</h2>
					<div class="rows">
						{#each list as entry (entry.id)}
							<div class="row" class:bad={!isValidSoundName(entry.name)}>
								<button
									class="play"
									class:on={playingId === entry.id}
									onclick={() => toggle(entry)}
									title="Listen"
								>
									{playingId === entry.id ? '■' : '▶'}
								</button>

								<div class="main">
									<div class="line">
										<input
											class="name"
											value={entry.name}
											oninput={(e) => (entry.name = e.currentTarget.value)}
											placeholder="name"
											title="The name a binding stores"
										/>
										<select bind:value={entry.kind} title="Which player this is meant for">
											<option value="sfx">SFX</option>
											<option value="music">Music</option>
										</select>
										<input
											class="section"
											value={entry.section ?? ''}
											oninput={(e) => {
												const v = e.currentTarget.value.trim();
												if (v) entry.section = v;
												else delete entry.section;
											}}
											placeholder={UNSORTED}
											title="Grouping — for browsing only"
										/>
										<span class="dur">{fmt(entry.durationMs)}</span>
										<label class="vol" title="Base volume (0–1)">
											vol
											<input
												type="number"
												min="0"
												max="1"
												step="0.05"
												value={entry.volume ?? ''}
												oninput={(e) => setVolume(entry, e.currentTarget.value)}
												placeholder="1"
											/>
										</label>
										<label class="loop" title="Loop this sound while it plays">
											<input
												type="checkbox"
												checked={entry.loop ?? false}
												onchange={(e) => {
													if (e.currentTarget.checked) entry.loop = true;
													else delete entry.loop;
												}}
											/>
											loop
										</label>
										{#if usesOf(entry.name).length}
											<span
												class="use bound"
												title={usesOf(entry.name)
													.map((b) => `${SOURCE_LABEL[b.source]}: ${b.where}`)
													.join('\n')}
											>
												played by {usesOf(entry.name).length}
											</span>
										{:else if overriding.has(entry.name)}
											<span
												class="use override"
												title="The engine ships a sound of this name. Yours replaces it — nothing to bind."
											>
												replaces a built-in
											</span>
										{:else}
											<span
												class="use unbound"
												title="Nothing in this project plays this sound yet.">unused</span
											>
										{/if}
										<label class="approve" class:on={entry.status === 'approved'}>
											<input
												type="checkbox"
												checked={entry.status === 'approved'}
												onchange={(e) => setApproved(entry, e.currentTarget.checked)}
											/>
											{entry.status === 'approved' ? 'Approved' : 'Draft'}
										</label>
										<button
											class="del"
											onclick={() => remove(entry)}
											title="Remove from the library">×</button
										>
									</div>

									<details>
										<summary>Where it came from</summary>
										<div class="meta">
											<label>
												Origin
												<select
													value={entry.origin}
													onchange={(e) => (entry.origin = e.currentTarget.value as SoundOrigin)}
												>
													{#each SOUND_ORIGINS as origin (origin)}
														<option value={origin}>{origin}</option>
													{/each}
												</select>
											</label>
											{#if entry.origin === 'ai'}
												<label>
													Model
													<input
														value={entry.model ?? ''}
														oninput={(e) => {
															const v = e.currentTarget.value.trim();
															if (v) entry.model = v;
															else delete entry.model;
														}}
														placeholder="which model generated it"
													/>
												</label>
											{:else}
												<label>
													Author
													<input
														value={entry.author ?? ''}
														oninput={(e) => {
															const v = e.currentTarget.value.trim();
															if (v) entry.author = v;
															else delete entry.author;
														}}
														placeholder="musician or studio"
													/>
												</label>
											{/if}
											<label>
												Licence
												<input
													value={entry.license ?? ''}
													oninput={(e) => {
														const v = e.currentTarget.value.trim();
														if (v) entry.license = v;
														else delete entry.license;
													}}
													placeholder="e.g. CC-BY-4.0, commissioned, royalty-free"
												/>
											</label>
											<label>
												Licence URL
												<input
													value={entry.licenseUrl ?? ''}
													oninput={(e) => {
														const v = e.currentTarget.value.trim();
														if (v) entry.licenseUrl = v;
														else delete entry.licenseUrl;
													}}
													placeholder="where the terms live"
												/>
											</label>
											<label class="wide">
												Notes
												<input
													value={entry.notes ?? ''}
													oninput={(e) => {
														const v = e.currentTarget.value.trim();
														if (v) entry.notes = v;
														else delete entry.notes;
													}}
													placeholder="anything the next person needs to know"
												/>
											</label>
											<p class="file">{entry.file}</p>
										</div>
									</details>
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/each}

			<p class="hint">
				A <strong>draft</strong> still plays everywhere — in the game, in a test build, here. It only
				blocks a publish, so an unapproved sound is never silently missing; you are told before you ship
				it.
			</p>
		{/if}

		<section>
			<h2>What's actually played</h2>
			<p class="hint">
				Read from <a href="/config">Invisible Game Config</a>,
				<a href="/symbols">Invisible Symbols</a> and <a href="/flow-v2">Invisible Flow</a> — the
				tools that own <em>when</em> a sound plays. This page only reports; change a binding where it
				lives.
			</p>

			{#if checks.missing.length}
				<p class="warn">
					<strong>Something asks for a sound that doesn't exist:</strong>
					{checks.missing.join(', ')}. Nothing plays at those moments — and the game reports no
					error, it just goes quiet. Either upload a sound with that name, or fix the binding.
				</p>
			{/if}
			{#if checks.unapprovedBound.length}
				<p class="warn">
					<strong
						>{checks.unapprovedBound.length} sound{checks.unapprovedBound.length === 1
							? ' is'
							: 's are'} played but not approved:</strong
					>
					{checks.unapprovedBound.join(', ')}. They work — this is the list to review before you
					ship.
				</p>
			{/if}
			{#if checks.unbound.length}
				<p class="hint">
					<strong
						>Nothing plays {checks.unbound.length} of your sound{checks.unbound.length === 1
							? ''
							: 's'}:</strong
					>
					{checks.unbound.join(', ')}. Either bind {checks.unbound.length === 1 ? 'it' : 'them'} in one
					of the tools above, or rename to match a built-in sound to replace it.
				</p>
			{/if}
			{#if entries.length > 0 && !checks.missing.length && !checks.unbound.length}
				<p class="hint good">Every sound in this library is played by something.</p>
			{/if}

			<p class="counts">
				{boundNames.length} sound name{boundNames.length === 1 ? '' : 's'} bound across {data
					.builtinNames.length} built-in + {entries.length} project sound{entries.length === 1
					? ''
					: 's'}.
			</p>

			<button class="linky" onclick={() => (showNotRebindable = !showNotRebindable)}>
				{showNotRebindable ? '▾' : '▸'}
				{checks.notRebindable.length} built-in sound{checks.notRebindable.length === 1 ? '' : 's'} you
				can't re-bind from a tool
			</button>
			{#if showNotRebindable}
				<p class="hint">
					These ship with the engine and are played from its own code — no slot, symbol, tier or
					flow cue names them, so there is nothing to point somewhere else. To change one, upload
					your own sound <strong>under the same name</strong> and it replaces it.
				</p>
				<p class="names">{checks.notRebindable.join(' · ')}</p>
			{/if}
		</section>
	</div>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: #0b0b0f;
		color: #e8e8ee;
	}
	.body {
		flex: 1;
		overflow: auto;
		padding: 24px;
		max-width: 1400px;
		width: 100%;
		margin: 0 auto;
	}
	.intro {
		margin: 0 0 24px;
		font-size: 13px;
		color: #b9b9c4;
		line-height: 1.6;
	}
	.intro a {
		color: #7ee0c0;
	}
	section {
		margin-bottom: 30px;
	}
	h2 {
		margin: 0 0 8px;
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #7ee0c0;
	}
	.hint {
		margin: 8px 0 0;
		font-size: 12px;
		color: #8b8b98;
		line-height: 1.6;
		max-width: 900px;
	}
	.hint.busy {
		color: #7ee0c0;
	}
	.counts {
		margin: 0 0 18px;
		font-size: 12px;
		color: #8b8b98;
	}
	.empty {
		font-size: 13px;
		color: #8b8b98;
		padding: 28px 0;
	}
	.warn {
		margin: 0 0 12px;
		padding: 10px 12px;
		border: 1px solid #5a4520;
		border-radius: 8px;
		background: #1e1810;
		color: #d3b483;
		font-size: 12px;
		line-height: 1.6;
	}
	.err {
		color: #ff9d9d;
		font-size: 12px;
		margin: 6px 0 0;
	}
	code {
		font-family: ui-monospace, monospace;
		background: #16161d;
		padding: 1px 5px;
		border-radius: 4px;
		color: #c8a3ff;
	}

	.drop {
		border: 1px dashed #2a2a36;
		border-radius: 10px;
		padding: 22px;
		text-align: center;
		background: #101016;
	}
	.drop.over {
		border-color: #7ee0c0;
		background: #10201b;
	}
	.drop p {
		margin: 0;
		font-size: 13px;
		color: #b9b9c4;
	}
	.pick {
		display: inline-block;
		margin-top: 8px;
		padding: 7px 14px;
		border: 1px solid #2a2a36;
		border-radius: 8px;
		background: #16161d;
		color: #e8e8ee;
		font-size: 12px;
		cursor: pointer;
	}
	.pick:hover {
		border-color: #7ee0c0;
	}
	.pick input {
		display: none;
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.row {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 10px 12px;
		border: 1px solid #1c1c24;
		border-radius: 10px;
		background: #101016;
	}
	.row.bad {
		border-color: #6a3030;
	}
	.main {
		flex: 1;
		min-width: 0;
	}
	.line {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.play {
		width: 32px;
		height: 32px;
		flex: none;
		border: 1px solid #2a2a36;
		border-radius: 8px;
		background: #16161d;
		color: #e8e8ee;
		cursor: pointer;
		font-size: 12px;
	}
	.play.on {
		border-color: #7ee0c0;
		color: #7ee0c0;
	}
	input,
	select {
		border: 1px solid #2a2a36;
		border-radius: 6px;
		background: #16161d;
		color: #e8e8ee;
		font: inherit;
		font-size: 12px;
		padding: 5px 7px;
	}
	input:focus,
	select:focus {
		outline: none;
		border-color: #7ee0c0;
	}
	.name {
		width: 190px;
		font-family: ui-monospace, monospace;
	}
	.section {
		width: 120px;
	}
	.dur {
		font-size: 12px;
		color: #8b8b98;
		font-variant-numeric: tabular-nums;
		min-width: 52px;
	}
	.use {
		font-size: 11px;
		padding: 3px 8px;
		border-radius: 999px;
		border: 1px solid #2a2a36;
		color: #8b8b98;
		cursor: help;
		white-space: nowrap;
	}
	.use.bound {
		border-color: #2c4a3e;
		color: #7ee0c0;
	}
	.use.override {
		border-color: #4a4020;
		color: #d3b483;
	}
	.use.unbound {
		border-color: #3a3a46;
		color: #6f6f7d;
	}
	.hint.good {
		color: #7ee0c0;
	}
	.names {
		font-family: ui-monospace, monospace;
		font-size: 11px;
		color: #6f6f7d;
		line-height: 1.9;
		margin: 8px 0 0;
		max-width: 900px;
	}
	.linky {
		border: 0;
		background: none;
		color: #b9b9c4;
		font: inherit;
		font-size: 12px;
		padding: 8px 0 0;
		cursor: pointer;
		text-align: left;
	}
	.linky:hover {
		color: #7ee0c0;
	}
	.vol,
	.loop,
	.approve {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: #8b8b98;
	}
	.vol input {
		width: 62px;
	}
	.approve {
		margin-left: auto;
		padding: 4px 9px;
		border: 1px solid #2a2a36;
		border-radius: 999px;
		cursor: pointer;
	}
	.approve.on {
		border-color: #7ee0c0;
		color: #7ee0c0;
	}
	.del {
		border: 1px solid #2a2a36;
		border-radius: 6px;
		background: #16161d;
		color: #8b8b98;
		cursor: pointer;
		width: 26px;
		height: 26px;
		font-size: 14px;
		line-height: 1;
	}
	.del:hover {
		border-color: #6a3030;
		color: #ff9d9d;
	}

	details {
		margin-top: 6px;
	}
	summary {
		font-size: 11px;
		color: #6f6f7d;
		cursor: pointer;
	}
	summary:hover {
		color: #b9b9c4;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 14px;
		padding: 10px 0 2px;
	}
	.meta label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11px;
		color: #6f6f7d;
	}
	.meta label.wide {
		flex: 1;
		min-width: 240px;
	}
	.meta label.wide input {
		width: 100%;
	}
	.meta .file {
		width: 100%;
		margin: 4px 0 0;
		font-size: 11px;
		color: #4d4d59;
		font-family: ui-monospace, monospace;
	}

	.save {
		border: 1px solid #2a2a36;
		border-radius: 8px;
		background: #16161d;
		color: #e8e8ee;
		font-size: 12px;
		padding: 6px 14px;
		cursor: pointer;
	}
	.save:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.conflict {
		border: 1px solid #6a3030;
		background: #1d1113;
		border-radius: 10px;
		padding: 14px 16px;
		margin-bottom: 18px;
	}
	.conflict p {
		margin: 0 0 6px;
		font-size: 13px;
		color: #ffbcbc;
	}
	.conflict-sub {
		font-size: 12px !important;
		color: #b9b9c4 !important;
	}
	.conflict-actions {
		display: flex;
		gap: 8px;
		margin-top: 10px;
	}
	.conflict-actions button {
		border: 1px solid #2a2a36;
		border-radius: 8px;
		background: #16161d;
		color: #e8e8ee;
		font-size: 12px;
		padding: 6px 12px;
		cursor: pointer;
	}
	.conflict-actions .danger {
		border-color: #6a3030;
		color: #ff9d9d;
	}
</style>
