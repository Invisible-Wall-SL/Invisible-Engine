<script lang="ts">
	/**
	 * Invisible Flipbook — 🎬 **Video mode** (`docs/design/invisible-flipbook-video.md` step 2).
	 *
	 * Generate N variations of a video from a ComfyUI blueprint, watch them play in a grid, pick
	 * one. Turning the pick into a clip is step 3.
	 *
	 * A separate component, not more of `+page.svelte`: the clip editor is already 1300 lines and
	 * the two modes share no state beyond the project. Everything here talks to
	 * `/api/flipbook/video/*`, which gates on the `flipbook` tool and forwards to the atlas-tool.
	 *
	 * **No `<video>` element anywhere.** The blueprint saves an animated WEBP, which plays, loops
	 * and honours alpha inside a plain `<img>` — so a tile is an image, with no playback state to
	 * manage and no poster frame. The checkerboard behind each tile is load-bearing: it is how the
	 * author sees whether the background cutout actually produced alpha.
	 */
	import { onDestroy } from 'svelte';

	let { projectKey }: { projectKey: string } = $props();

	interface BlueprintParam {
		key: string;
		label: string;
		type: 'int' | 'float' | 'text' | 'bool' | 'select';
		default?: unknown;
		min?: number;
		max?: number;
		step?: number;
		options?: string[];
		group?: string;
	}
	interface Blueprint {
		id: string;
		name?: string;
		description?: string;
		params?: BlueprintParam[];
	}
	interface Variation {
		index: number;
		seed: number;
		status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
		remote_status?: string;
		file: string;
		bytes: number;
		error: string;
	}
	interface Session {
		id: string;
		blueprint: string;
		blueprint_name?: string;
		prompt: string;
		status: 'queued' | 'running' | 'finished' | 'cancelled';
		created: number;
		done_count: number;
		variations: Variation[];
	}

	let blueprints = $state<Blueprint[]>([]);
	let blueprintId = $state('');
	let prompt = $state('');
	let negative = $state('');
	let sourceRef = $state('');
	let variations = $state(4);
	/** Param overrides, keyed by param key. Only what the author actually touched — an untouched
	 * param is omitted so the blueprint's own default applies (and keeps applying if it changes). */
	let overrides = $state<Record<string, string | number | boolean>>({});

	let session = $state<Session | null>(null);
	let recent = $state<Session[]>([]);
	let busy = $state(false);
	let err = $state('');
	let loading = $state(true);

	const blueprint = $derived(blueprints.find((b) => b.id === blueprintId) ?? null);
	const params = $derived(blueprint?.params ?? []);
	const running = $derived(session?.status === 'running' || session?.status === 'queued');
	/** Params bucketed by their declared `group`, in first-seen order — a plain array rather than a
	 * Map because `svelte/prefer-svelte-reactivity` (rightly) flags a bare Map inside a rune. */
	const paramGroups = $derived.by(() => {
		const groups: { group: string; items: BlueprintParam[] }[] = [];
		for (const p of params) {
			const name = p.group || 'Settings';
			const found = groups.find((g) => g.group === name);
			if (found) found.items.push(p);
			else groups.push({ group: name, items: [p] });
		}
		return groups;
	});

	const api = (route: string, qs = '') => `/api/flipbook/video/${route}${qs ? `?${qs}` : ''}`;

	async function getJson<T>(route: string, qs = ''): Promise<T> {
		const res = await fetch(api(route, qs));
		if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
		return (await res.json()) as T;
	}

	async function postJson<T>(route: string, body: unknown): Promise<T> {
		const res = await fetch(api(route), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
		return (await res.json()) as T;
	}

	async function boot(): Promise<void> {
		loading = true;
		err = '';
		try {
			blueprints = await getJson<Blueprint[]>('blueprints');
			if (!blueprintId && blueprints.length) blueprintId = blueprints[0].id;
			recent = await getJson<Session[]>('sessions');
			// Re-attach to a session still running from a previous visit — the runner survives a
			// page reload, so the grid should too rather than looking like nothing happened.
			const live = recent.find((s) => s.status === 'running' || s.status === 'queued');
			session = live ?? recent[0] ?? null;
		} catch (e) {
			err = (e as Error).message;
		}
		loading = false;
	}
	boot();

	function coerce(p: BlueprintParam, raw: string | number | boolean): string | number | boolean {
		if (p.type === 'bool') return Boolean(raw);
		if (p.type === 'int') return Math.round(Number(raw));
		if (p.type === 'float') return Number(raw);
		return String(raw);
	}

	async function generate(): Promise<void> {
		busy = true;
		err = '';
		try {
			const payload: Record<string, unknown> = {
				blueprint: blueprintId,
				prompt,
				negative,
				source_ref: sourceRef,
				variations,
				params: Object.fromEntries(
					Object.entries(overrides).flatMap(([k, v]) => {
						const p = params.find((x) => x.key === k);
						return p ? [[k, coerce(p, v)]] : [];
					}),
				),
			};
			const res = await postJson<Session & { error?: string }>('generate', payload);
			// The tool answers user-fixable problems as 200 + {error} so the message can be shown
			// verbatim — a 500 would only say "Internal Error".
			if (res.error) err = res.error;
			else session = res;
		} catch (e) {
			err = (e as Error).message;
		}
		busy = false;
	}

	async function cancel(): Promise<void> {
		if (!session) return;
		try {
			await postJson('cancel', { session: session.id });
		} catch (e) {
			err = (e as Error).message;
		}
	}

	async function removeSession(id: string): Promise<void> {
		try {
			const res = await postJson<{ error?: string }>('delete', { session: id });
			if (res.error) {
				err = res.error;
				return;
			}
			recent = recent.filter((s) => s.id !== id);
			if (session?.id === id) session = recent[0] ?? null;
		} catch (e) {
			err = (e as Error).message;
		}
	}

	// --- polling ---------------------------------------------------------------
	// Only while something is actually in flight. A finished session is terminal, so polling it
	// would be pure noise against a service that cold-starts.
	let timer: ReturnType<typeof setInterval> | null = null;
	$effect(() => {
		const id = session?.id;
		const active = running;
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		if (!id || !active) return;
		timer = setInterval(async () => {
			try {
				session = await getJson<Session>('status', `session=${encodeURIComponent(id)}`);
				if (session.status !== 'running' && session.status !== 'queued') {
					recent = await getJson<Session[]>('sessions');
				}
			} catch {
				/* a poll blip is not worth a banner — the next tick retries */
			}
		}, 2500);
	});
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});

	// --- make a clip from a variation ------------------------------------------
	// Two steps, deliberately: the TOOL packs the frames into sheet(s) (Pillow +
	// the MaxRects packer live there), then the LAUNCHER writes the clip doc
	// through the normal `/api/flipbook/save` — clip storage, its ETag
	// compare-and-swap and its edit lease are the launcher's and must stay there.
	interface Probe {
		frames: number;
		width: number;
		height: number;
		fps: number;
		has_alpha: boolean;
		error?: string;
	}
	let making = $state<Variation | null>(null);
	let probe = $state<Probe | null>(null);
	let clipName = $state('');
	let start = $state(0);
	let end = $state(0);
	let stride = $state(1);
	let maxSize = $state(0);
	let packing = $state(false);
	let makeErr = $state('');

	/** What the current range/stride will actually pack — shown BEFORE committing,
	 * because 81 frames is several atlas pages and that should never be a surprise. */
	const willPack = $derived.by(() => {
		if (!probe) return 0;
		const to = end > 0 ? Math.min(end, probe.frames) : probe.frames;
		const from = Math.max(0, Math.min(start, probe.frames - 1));
		return Math.max(0, Math.ceil((to - from) / Math.max(1, stride)));
	});

	async function openMake(v: Variation): Promise<void> {
		making = v;
		probe = null;
		makeErr = '';
		packing = false;
		clipName = `${(session?.blueprint_name ?? 'video').replace(/[^A-Za-z0-9]+/g, '_')}_${String(v.index).padStart(3, '0')}`;
		start = 0;
		stride = 1;
		maxSize = 0;
		try {
			const p = await getJson<Probe>(
				'probe',
				`session=${encodeURIComponent(session!.id)}&v=${v.index}`,
			);
			if (p.error) {
				makeErr = p.error;
				return;
			}
			probe = p;
			end = p.frames;
		} catch (e) {
			makeErr = (e as Error).message;
		}
	}

	async function makeClip(): Promise<void> {
		if (!making || !session) return;
		packing = true;
		makeErr = '';
		try {
			const sheet = await postJson<{
				assetKey: string;
				frames: string[];
				fps: number;
				name: string;
				used_frames: number;
				pages: unknown[];
				error?: string;
			}>('toclip', {
				session: session.id,
				variation: making.index,
				name: clipName,
				start,
				end,
				stride,
				max_size: maxSize,
			});
			if (sheet.error) {
				makeErr = sheet.error;
				return;
			}
			// Mirrors the clip editor's own create path: an unsaved clip sends its NAME as the
			// id (the server slugs it) with `baseEtag: null`, which asserts the id is free.
			const res = await fetch('/api/flipbook/save', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					clip: {
						id: clipName,
						name: clipName,
						assetKey: sheet.assetKey,
						frames: sheet.frames,
						fps: sheet.fps,
						loop: true,
					},
					projectKey,
					baseEtag: null,
				}),
			});
			const out = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				id?: string;
				message?: string;
			};
			if (res.status === 409) {
				makeErr = out.message ?? 'A clip with that name already exists — rename yours.';
				return;
			}
			if (!res.ok || !out.ok || !out.id) {
				makeErr = out.message ?? `Save failed (${res.status}).`;
				return;
			}
			// Straight into the clip editor with it open — the packed sheet is only half the
			// job, and the author still wants to trim, reorder and set the loop mode.
			window.location.href = `/flipbook?clip=${encodeURIComponent(out.id)}`;
		} catch (e) {
			makeErr = (e as Error).message;
		} finally {
			packing = false;
		}
	}

	// --- source-image picker ---------------------------------------------------
	let picking = $state(false);
	let pickPath = $state('');
	let pickDirs = $state<{ name: string; path: string }[]>([]);
	let pickFiles = $state<{ name: string; path: string }[]>([]);
	let pickUp = $state<string | null>(null);

	async function browse(path: string): Promise<void> {
		try {
			const r = await getJson<{
				ok: boolean;
				rel: string;
				up: string | null;
				dirs: { name: string; path: string }[];
				files: { name: string; path: string }[];
				error?: string;
			}>('refs', `path=${encodeURIComponent(path)}`);
			if (!r.ok) {
				err = r.error ?? 'Could not browse the project files.';
				return;
			}
			pickPath = r.rel;
			pickDirs = r.dirs;
			pickFiles = r.files;
			pickUp = r.up;
		} catch (e) {
			err = (e as Error).message;
		}
	}

	function openPicker(): void {
		picking = true;
		void browse('');
	}

	function fmtAge(t: number): string {
		if (!t) return '';
		const mins = Math.round((Date.now() / 1000 - t) / 60);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const h = Math.round(mins / 60);
		return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
	}
</script>

<div class="vbody">
	<aside class="rail">
		<h3>Generate</h3>

		{#if loading}
			<p class="empty">Loading blueprints…</p>
		{:else if !blueprints.length}
			<p class="empty">
				No blueprints in the shared library. Seed one, then restart the Atlas Maker service — the
				library hydrates at container start.
			</p>
		{:else}
			<label class="fld">
				<span>Blueprint</span>
				<select bind:value={blueprintId} disabled={running}>
					{#each blueprints as b (b.id)}
						<option value={b.id}>{b.name ?? b.id}</option>
					{/each}
				</select>
			</label>
			{#if blueprint?.description}
				<p class="hint">{blueprint.description}</p>
			{/if}

			<label class="fld">
				<span>Prompt</span>
				<textarea
					bind:value={prompt}
					rows="4"
					disabled={running}
					placeholder="What should happen in the animation?"
				></textarea>
			</label>

			<label class="fld">
				<span>Negative</span>
				<textarea bind:value={negative} rows="2" disabled={running} placeholder="(optional)"
				></textarea>
			</label>

			<div class="fld">
				<span>Source image</span>
				<div class="srcrow">
					<input value={sourceRef} readonly placeholder="none picked" title={sourceRef} />
					<button onclick={openPicker} disabled={running}>Pick…</button>
				</div>
				<p class="hint">
					Image-to-video animates this still. Point it at a symbol's source art and the model moves
					that art.
				</p>
			</div>

			<label class="fld">
				<span>Variations</span>
				<input type="number" min="1" max="12" bind:value={variations} disabled={running} />
			</label>

			{#each paramGroups as g (g.group)}
				<details class="grp">
					<summary>{g.group}</summary>
					{#each g.items as p (p.key)}
						<label class="fld sm">
							<span>{p.label}</span>
							{#if p.type === 'bool'}
								<input
									type="checkbox"
									checked={Boolean(overrides[p.key] ?? p.default)}
									disabled={running}
									onchange={(e) => (overrides[p.key] = e.currentTarget.checked)}
								/>
							{:else if p.type === 'select'}
								<select
									value={String(overrides[p.key] ?? p.default ?? '')}
									disabled={running}
									onchange={(e) => (overrides[p.key] = e.currentTarget.value)}
								>
									{#each p.options ?? [] as o (o)}
										<option value={o}>{o}</option>
									{/each}
								</select>
							{:else if p.type === 'text'}
								<input
									value={String(overrides[p.key] ?? p.default ?? '')}
									disabled={running}
									onchange={(e) => (overrides[p.key] = e.currentTarget.value)}
								/>
							{:else}
								<input
									type="number"
									min={p.min}
									max={p.max}
									step={p.step ?? (p.type === 'int' ? 1 : 0.1)}
									value={Number(overrides[p.key] ?? p.default ?? 0)}
									disabled={running}
									onchange={(e) => (overrides[p.key] = e.currentTarget.value)}
								/>
							{/if}
						</label>
					{/each}
				</details>
			{/each}

			<div class="actions">
				{#if running}
					<button class="danger" onclick={cancel}>■ Cancel</button>
				{:else}
					<button class="go" onclick={generate} disabled={busy || !blueprintId}>
						{busy ? 'Starting…' : `▶ Generate ${variations}`}
					</button>
				{/if}
			</div>
			{#if err}<p class="pill err">{err}</p>{/if}
		{/if}
	</aside>

	<section class="main">
		<div class="sessbar">
			{#if recent.length}
				<select
					value={session?.id ?? ''}
					onchange={async (e) => {
						const id = e.currentTarget.value;
						session = id
							? await getJson<Session>('status', `session=${encodeURIComponent(id)}`)
							: null;
					}}
				>
					{#each recent as s (s.id)}
						<option value={s.id}>
							{s.blueprint_name ?? s.blueprint} · {s.variations?.length ?? 0} · {fmtAge(s.created)}
						</option>
					{/each}
				</select>
			{/if}
			{#if session}
				<span class="pill">{session.status}</span>
				<span class="who">{session.prompt}</span>
				<button
					class="danger sm"
					disabled={running}
					title={running ? 'Cancel the session before deleting it' : 'Delete this session'}
					onclick={() => removeSession(session!.id)}>🗑</button
				>
			{/if}
		</div>

		{#if !session}
			<p class="empty big">No video sessions yet. Generate one to fill this grid.</p>
		{:else}
			<div class="grid">
				{#each session.variations as v (v.index)}
					<figure class="tile" class:failed={v.status === 'failed'}>
						<div class="thumb">
							{#if v.status === 'done' && v.file}
								<!-- Animated WEBP: it plays and loops on its own. -->
								<img
									src={api(
										'file',
										`session=${encodeURIComponent(session.id)}&v=${encodeURIComponent(v.file)}`,
									)}
									alt={`variation ${v.index}`}
								/>
							{:else if v.status === 'failed'}
								<span class="state bad" title={v.error}>failed</span>
							{:else if v.status === 'cancelled'}
								<span class="state">cancelled</span>
							{:else if v.status === 'running'}
								<span class="state live">{v.remote_status || 'running'}…</span>
							{:else}
								<span class="state">queued</span>
							{/if}
						</div>
						<figcaption>
							<span class="ix">#{String(v.index).padStart(3, '0')}</span>
							<button
								class="seed"
								title="Copy this seed — it reproduces this exact render"
								onclick={() => navigator.clipboard?.writeText(String(v.seed))}
							>
								{v.seed}
							</button>
							<button
								class="make"
								disabled={v.status !== 'done'}
								title="Pack these frames into a sheet and create a clip"
								onclick={() => openMake(v)}
							>
								🎞 Make flipbook
							</button>
						</figcaption>
						{#if v.status === 'failed' && v.error}
							<p class="tileerr">{v.error}</p>
						{/if}
					</figure>
				{/each}
			</div>
		{/if}
	</section>

	{#if making}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="backdrop" onclick={() => (making = null)}></div>
		<div class="picker wide">
			<header>
				<strong>Make a flipbook from #{String(making.index).padStart(3, '0')}</strong>
				<button onclick={() => (making = null)}>✕</button>
			</header>

			{#if makeErr}
				<p class="pill err">{makeErr}</p>
			{/if}

			{#if !probe}
				<p class="empty">Reading the animation…</p>
			{:else}
				<p class="hint">
					{probe.frames} frames · {probe.width}×{probe.height} · {probe.fps} fps
				</p>
				{#if !probe.has_alpha}
					<p class="pill err">
						These frames have no transparency — the background cutout was off, or it produced none.
						Packing them gives opaque rectangles, not symbol art.
					</p>
				{/if}

				<label class="fld">
					<span>Clip name</span>
					<input bind:value={clipName} disabled={packing} />
				</label>

				<div class="row">
					<label class="fld sm"
						><span>From</span>
						<input
							type="number"
							min="0"
							max={probe.frames - 1}
							bind:value={start}
							disabled={packing}
						/></label
					>
					<label class="fld sm"
						><span>To</span>
						<input
							type="number"
							min="1"
							max={probe.frames}
							bind:value={end}
							disabled={packing}
						/></label
					>
					<label class="fld sm"
						><span>Every</span>
						<input type="number" min="1" max="8" bind:value={stride} disabled={packing} /></label
					>
					<label class="fld sm"
						><span>Max px</span>
						<input
							type="number"
							min="0"
							max="1024"
							step="16"
							bind:value={maxSize}
							disabled={packing}
						/></label
					>
				</div>

				<p class="hint">
					<b>{willPack}</b> frame{willPack === 1 ? '' : 's'} will be packed at
					{(probe.fps / Math.max(1, stride)).toFixed(1)} fps. Frames are alpha-trimmed, so the cost is
					ink, not canvas — but every frame is atlas space, and a clip spanning several pages is normal.
				</p>

				<div class="actions">
					<button class="go" disabled={packing || !willPack || !clipName.trim()} onclick={makeClip}>
						{packing ? 'Packing…' : `🎞 Pack ${willPack} frames & create clip`}
					</button>
				</div>
			{/if}
		</div>
	{/if}

	{#if picking}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="backdrop" onclick={() => (picking = false)}></div>
		<div class="picker">
			<header>
				<strong>Pick a source image</strong>
				<button onclick={() => (picking = false)}>✕</button>
			</header>
			<p class="crumb">{pickPath || '(root)'}</p>
			<ul>
				{#if pickUp !== null}
					<li><button onclick={() => browse(pickUp ?? '')}>⬆ up</button></li>
				{/if}
				{#each pickDirs as d (d.path)}
					<li><button onclick={() => browse(d.path)}>📁 {d.name}</button></li>
				{/each}
				{#each pickFiles as f (f.path)}
					<li>
						<button
							class="file"
							onclick={() => {
								sourceRef = f.path;
								picking = false;
							}}>🖼 {f.name}</button
						>
					</li>
				{/each}
			</ul>
			{#if !pickDirs.length && !pickFiles.length}
				<p class="empty">Nothing here.</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.vbody {
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
	.empty.big {
		padding: 40px;
		text-align: center;
	}
	.pill {
		padding: 2px 8px;
		border-radius: 999px;
		background: #1f2937;
		font-size: 11px;
	}
	.pill.err {
		color: #fca5a5;
		display: block;
		margin-top: 8px;
		padding: 6px 8px;
		line-height: 1.4;
	}
	.hint {
		color: #64748b;
		font-size: 11px;
		margin: 2px 0 10px;
		line-height: 1.45;
	}

	.rail {
		width: 280px;
		flex: none;
		display: flex;
		flex-direction: column;
		border-right: 1px solid #1f2937;
		padding: 12px;
		overflow-y: auto;
	}
	.fld {
		display: block;
		margin-bottom: 10px;
	}
	.fld > span {
		display: block;
		font-size: 11px;
		color: #94a3b8;
		margin-bottom: 3px;
	}
	.fld.sm {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 6px;
	}
	.fld.sm > span {
		margin: 0;
		flex: 1;
		line-height: 1.3;
	}
	.fld.sm input[type='number'],
	.fld.sm select,
	.fld.sm input:not([type='checkbox']) {
		width: 90px;
		flex: none;
	}
	input,
	select,
	textarea {
		width: 100%;
		box-sizing: border-box;
		background: #10161e;
		border: 1px solid #1f2937;
		border-radius: 6px;
		color: #cbd5e1;
		padding: 5px 7px;
		font-size: 12px;
		font-family: inherit;
	}
	textarea {
		resize: vertical;
	}
	input[type='checkbox'] {
		width: auto;
	}
	.srcrow {
		display: flex;
		gap: 6px;
	}
	.srcrow input {
		flex: 1;
		min-width: 0;
	}
	.grp {
		border-top: 1px solid #1f2937;
		padding-top: 8px;
		margin-bottom: 8px;
	}
	.grp summary {
		font-size: 11px;
		color: #94a3b8;
		cursor: pointer;
		margin-bottom: 6px;
	}
	button {
		background: #1f2937;
		border: 1px solid #2a3646;
		border-radius: 6px;
		color: #cbd5e1;
		padding: 5px 9px;
		font-size: 12px;
		font-family: inherit;
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		background: #27364a;
	}
	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.actions {
		margin-top: 6px;
	}
	.go {
		width: 100%;
		background: #14532d;
		border-color: #166534;
		color: #86efac;
		padding: 8px;
	}
	.danger {
		color: #fca5a5;
	}
	.danger.sm {
		padding: 3px 7px;
	}

	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		padding: 12px;
		overflow-y: auto;
	}
	.sessbar {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}
	.sessbar select {
		width: auto;
		max-width: 320px;
	}
	.who {
		color: #64748b;
		font-size: 11px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 12px;
	}
	.tile {
		margin: 0;
		border: 1px solid #1f2937;
		border-radius: 8px;
		overflow: hidden;
		background: #10161e;
	}
	.tile.failed {
		border-color: #7f1d1d;
	}
	.thumb {
		aspect-ratio: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		/* The checkerboard is load-bearing: it is how the author sees whether the blueprint's
		   background cutout actually produced alpha, rather than a matte-coloured rectangle. */
		background-color: #0b0e13;
		background-image:
			linear-gradient(45deg, #171c25 25%, transparent 25%),
			linear-gradient(-45deg, #171c25 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, #171c25 75%),
			linear-gradient(-45deg, transparent 75%, #171c25 75%);
		background-size: 16px 16px;
		background-position:
			0 0,
			0 8px,
			8px -8px,
			-8px 0;
	}
	.thumb img {
		max-width: 100%;
		max-height: 100%;
		display: block;
	}
	.state {
		font-size: 11px;
		color: #64748b;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.state.live {
		color: #7ee0c0;
	}
	.state.bad {
		color: #fca5a5;
	}
	figcaption {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 8px;
		border-top: 1px solid #1f2937;
	}
	.ix {
		font-size: 11px;
		color: #64748b;
	}
	.seed {
		font-size: 10px;
		padding: 2px 6px;
		font-family: ui-monospace, monospace;
	}
	.make {
		margin-left: auto;
		font-size: 10px;
		padding: 2px 6px;
	}
	.tileerr {
		margin: 0;
		padding: 6px 8px;
		font-size: 10px;
		color: #fca5a5;
		border-top: 1px solid #1f2937;
		line-height: 1.4;
	}

	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 40;
	}
	.picker {
		position: fixed;
		top: 12vh;
		left: 50%;
		transform: translateX(-50%);
		width: min(460px, 92vw);
		max-height: 66vh;
		overflow-y: auto;
		background: #0f141b;
		border: 1px solid #1f2937;
		border-radius: 10px;
		padding: 12px;
		z-index: 41;
		box-shadow: 0 18px 50px rgba(0, 0, 0, 0.6);
	}
	.picker header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 6px;
	}
	.crumb {
		color: #64748b;
		font-size: 11px;
		margin: 0 0 8px;
	}
	.picker ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.picker li button {
		width: 100%;
		text-align: left;
		background: #10161e;
	}
	.picker.wide {
		width: min(560px, 94vw);
	}
	.row {
		display: flex;
		gap: 8px;
	}
	.row .fld.sm {
		flex: 1;
		display: block;
	}
	.row .fld.sm > span {
		margin-bottom: 3px;
	}
	.row .fld.sm input[type='number'] {
		width: 100%;
	}
	.picker li button.file {
		color: #a5d8ff;
	}
</style>
