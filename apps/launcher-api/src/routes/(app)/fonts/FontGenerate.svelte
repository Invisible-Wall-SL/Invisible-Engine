<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Application, BitmapText, Container } from 'pixi.js';
	import {
		fetchFontCatalog,
		fitCanvasToObject,
		loadLocalBitmapFont,
		saveBitmapFont,
		type FontTarget,
		type LocalBitmapFont,
	} from './fonts.client';
	import {
		bakeBitmapFont,
		defaultEffects,
		parseFont,
		type BakeEffects,
		type BakeResult,
	} from './fontBake.client';
	import { CHARSET_LABELS, charsForPreset, type CharsetPreset } from './charsets.client';
	import type { Font } from 'opentype.js';

	interface Props {
		/** Sample text for the live preview (shared with View). */
		sample: string;
		/** Render size in px for the live preview. */
		size: number;
		/** Whether the user holds `fontPublish` (shows the shared save target). */
		canPublishShared: boolean;
		/** Called after a successful save so the parent refreshes + switches to View. */
		onsaved: () => void;
	}

	let { sample, size, canPublishShared, onsaved }: Props = $props();

	let target = $state<FontTarget>('project');

	const VECTOR_EXT = new Set(['ttf', 'otf']);
	const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

	// ---- Source font ----
	let font = $state<Font | null>(null);
	let fontFileName = $state('');
	let face = $state('');
	let folder = $state('');
	let folderTouched = $state(false);
	let overwrite = $state(false);
	let existingIds = $state<Set<string>>(new Set());

	// ---- Bake controls ----
	let preset = $state<CharsetPreset>('currency');
	let custom = $state('');
	let bakeSize = $state(64);
	let pageMaxWidth = $state(1024);
	let pageMaxHeight = $state(2048);
	let kerning = $state(true);
	let effects = $state<BakeEffects>(defaultEffects());

	// ---- Status ----
	let errors = $state<string[]>([]);
	let baking = $state(false);
	let bakeError = $state<string | null>(null);
	let result = $state<BakeResult | null>(null);
	/** Page filename → object URL, one per baked atlas page (preview + thumbnails). */
	let atlasUrls = $state<Record<string, string>>({});
	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let savedNote = $state<string | null>(null);

	const presets: CharsetPreset[] = ['digits', 'currency', 'alphanumeric', 'ascii', 'custom'];

	void fetchFontCatalog().then((res) => {
		existingIds = new Set(res.fonts.map((f) => f.id));
	});

	const chars = $derived(charsForPreset(preset, custom));
	const folderValid = $derived(ID_RE.test(folder));
	const folderCollision = $derived(folderValid && existingIds.has(folder));
	const faceValid = $derived(face.trim().length > 0);
	const canBake = $derived(!!font && chars.length > 0 && !baking);
	const canSave = $derived(
		!!result && faceValid && folderValid && (!folderCollision || overwrite) && !saving,
	);

	$effect(() => {
		// The folder IS the catalog id — keep it tracking the family name until the user
		// edits it by hand, so a different name yields a different id (no silent overwrite).
		if (!folderTouched) folder = slug(face);
	});
	const pageBase = $derived(folderValid ? folder : 'font');

	function slug(name: string): string {
		const s = name.replace(/[^A-Za-z0-9_-]/g, '');
		return ID_RE.test(s) ? s : s.slice(0, 64).replace(/^[^A-Za-z0-9]+/, '') || 'font';
	}

	const ext = (name: string): string => name.split('.').pop()?.toLowerCase() ?? '';

	function onPick(ev: Event): void {
		const input = ev.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) void loadFontFile(file);
	}
	function onDrop(ev: DragEvent): void {
		ev.preventDefault();
		dragging = false;
		const file = ev.dataTransfer?.files?.[0];
		if (file) void loadFontFile(file);
	}
	let dragging = $state(false);

	async function loadFontFile(file: File): Promise<void> {
		errors = [];
		savedNote = null;
		if (!VECTOR_EXT.has(ext(file.name))) {
			errors = [`"${file.name}" is not a TTF/OTF. Import existing BMFonts on the Import tab.`];
			return;
		}
		try {
			const buf = await file.arrayBuffer();
			const parsed = parseFont(buf);
			font = parsed;
			fontFileName = file.name;
			const family = parsed.names.fontFamily?.en?.trim() ?? '';
			face = family || file.name.replace(/\.[^.]+$/, '');
			clearResult();
		} catch (e) {
			font = null;
			errors = [`Failed to parse "${file.name}": ${e instanceof Error ? e.message : String(e)}`];
		}
	}

	function revokeAtlasUrls(): void {
		for (const url of Object.values(atlasUrls)) URL.revokeObjectURL(url);
		atlasUrls = {};
	}

	function clearResult(): void {
		teardownFont();
		result = null;
		bakeError = null;
		savedNote = null;
		revokeAtlasUrls();
	}

	async function bake(): Promise<void> {
		if (!font || !canBake) return;
		baking = true;
		bakeError = null;
		savedNote = null;
		try {
			const res = await bakeBitmapFont({
				font,
				face: face.trim(),
				pageBase,
				chars,
				fontSize: bakeSize,
				pageMaxWidth,
				pageMaxHeight,
				kerning,
				effects,
			});
			setResult(res);
		} catch (e) {
			bakeError = e instanceof Error ? e.message : String(e);
			result = null;
		} finally {
			baking = false;
		}
	}

	function setResult(res: BakeResult): void {
		teardownFont();
		revokeAtlasUrls();
		const urls: Record<string, string> = {};
		for (const page of res.pages) urls[page.file] = URL.createObjectURL(page.blob);
		atlasUrls = urls;
		result = res;
		// Re-render the live preview through the SAME path the game uses.
		void mountPreview(res);
	}

	// ---- Live preview (BitmapText built from the baked descriptor + page blob) ----
	let host = $state<HTMLDivElement | null>(null);
	let previewError = $state<string | null>(null);
	let app: Application | null = null;
	let world: Container | null = null;
	let obj: BitmapText | null = null;
	let localFont: LocalBitmapFont | null = null;

	function teardownFont(): void {
		obj?.destroy();
		obj = null;
		localFont?.dispose();
		localFont = null;
	}

	async function mountPreview(res: BakeResult): Promise<void> {
		previewError = null;
		if (!app || res.pages.length === 0) return;
		try {
			const pageUrls: Record<string, string> = {};
			for (const page of res.pages) {
				const url = atlasUrls[page.file];
				if (url) pageUrls[page.file] = url;
			}
			const lf = await loadLocalBitmapFont({
				family: face.trim(),
				descriptorText: res.xml,
				descriptorFormat: 'xml',
				pageUrls,
			});
			teardownFont();
			localFont = lf;
			drawSample();
		} catch (e) {
			previewError = e instanceof Error ? e.message : String(e);
		}
	}

	function drawSample(): void {
		if (!app || !world || !localFont) return;
		obj?.destroy();
		obj = new BitmapText({ text: sample, style: { fontFamily: localFont.family, fontSize: size } });
		world.addChild(obj);
		fitCanvasToObject(app, obj);
	}

	$effect(() => {
		// Re-render the sample when the shared sample/size controls change.
		void sample;
		void size;
		drawSample();
	});

	$effect(() => {
		// Mount the PIXI app once the host div exists.
		if (app || !host) return;
		const a = new Application();
		let disposed = false;
		void a
			.init({
				backgroundAlpha: 0,
				antialias: true,
				resolution: window.devicePixelRatio || 1,
				autoDensity: true,
				width: 1,
				height: 1,
			})
			.then(() => {
				if (disposed || !host) {
					a.destroy(true);
					return;
				}
				app = a;
				world = new Container();
				a.stage.addChild(world);
				host.appendChild(a.canvas);
				a.canvas.style.display = 'block';
				if (result) void mountPreview(result);
			});
		return () => {
			disposed = true;
		};
	});

	async function save(): Promise<void> {
		if (!result || !canSave) return;
		saving = true;
		saveError = null;
		savedNote = null;
		try {
			const descriptorFile = `${folder}.xml`;
			const saved = await saveBitmapFont({
				folder,
				descriptorFile,
				descriptorFormat: 'xml',
				target,
				overwrite,
				files: [
					{
						name: descriptorFile,
						blob: new Blob([result.xml], { type: 'application/xml' }),
						contentType: 'application/xml',
					},
					...result.pages.map((page) => ({
						name: page.file,
						blob: page.blob,
						contentType: 'image/png',
					})),
				],
			});
			savedNote = `Saved "${saved.name}" as ${saved.id}.`;
			existingIds = new Set([...existingIds, saved.id]);
			onsaved();
		} catch (e) {
			saveError = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}

	onDestroy(() => {
		teardownFont();
		revokeAtlasUrls();
		try {
			app?.destroy(true);
		} catch {
			/* context teardown */
		}
		app = null;
		world = null;
	});
</script>

<section class="generate">
	<div
		class="drop"
		class:dragging
		role="button"
		tabindex="0"
		ondragover={(e) => {
			e.preventDefault();
			dragging = true;
		}}
		ondragleave={() => (dragging = false)}
		ondrop={onDrop}
	>
		<p class="drop-title">Drop a TTF/OTF to bake a bitmap font</p>
		<p class="muted">
			opentype.js reads the real glyph outlines + metrics; effects (gradient/outline/shadow) bake
			natively. Output is BMFont XML + a page PNG, identical to what the games load.
		</p>
		<label class="file-btn">
			Choose a TTF/OTF…
			<input type="file" accept=".ttf,.otf" onchange={onPick} />
		</label>
		{#if fontFileName}<p class="muted small">Loaded <code>{fontFileName}</code></p>{/if}
	</div>

	{#if errors.length}
		<ul class="errors">
			{#each errors as err (err)}
				<li>{err}</li>
			{/each}
		</ul>
	{/if}

	{#if font}
		<div class="grid">
			<div class="panel controls-panel">
				<h2>Font</h2>
				<label class="field">
					Family name (catalog name + XML face)
					<input bind:value={face} spellcheck="false" placeholder="My Font" />
				</label>
				{#if !faceValid}
					<p class="warn small">A family name is required — it becomes the catalog name.</p>
				{/if}
				<label class="field">
					Folder / id
					<input
						class="mono"
						bind:value={folder}
						oninput={() => (folderTouched = true)}
						spellcheck="false"
						placeholder="myfont"
					/>
				</label>
				{#if !folderValid}
					<p class="warn small">
						Use 1–64 chars: letters, digits, <code>-</code> or <code>_</code>, starting with a letter
						or digit.
					</p>
				{:else if folderCollision}
					<p class="warn small">
						A font with id <code>{folder}</code> already exists. Change the folder/id above to save a
						new font, or confirm overwrite.
					</p>
					<label class="toggle small overwrite">
						<input type="checkbox" bind:checked={overwrite} /> Overwrite the existing
						<code>{folder}</code>
					</label>
				{/if}

				<h2 class="spaced">Characters</h2>
				<div class="presets">
					{#each presets as p (p)}
						<button class="chip" class:active={preset === p} type="button" onclick={() => (preset = p)}>
							{CHARSET_LABELS[p]}
						</button>
					{/each}
				</div>
				{#if preset === 'custom'}
					<textarea
						class="custom"
						bind:value={custom}
						spellcheck="false"
						placeholder="Type the exact characters to bake…"
					></textarea>
				{/if}
				<p class="muted small">{chars.length} character{chars.length === 1 ? '' : 's'} selected.</p>

				<h2 class="spaced">Size &amp; page</h2>
				<div class="row">
					<label class="field narrow">
						Glyph size (px)
						<input type="number" min="8" max="512" bind:value={bakeSize} />
					</label>
					<label class="field narrow">
						Page max width
						<input type="number" min="128" max="4096" step="128" bind:value={pageMaxWidth} />
					</label>
					<label class="field narrow">
						Page max height
						<input type="number" min="128" max="4096" step="128" bind:value={pageMaxHeight} />
					</label>
				</div>
				<label class="toggle small kern">
					<input type="checkbox" bind:checked={kerning} /> Kerning (emit
					<code>&lt;kernings&gt;</code>)
				</label>

				<h2 class="spaced">Effects</h2>
				<div class="effect">
					<label class="toggle">
						<input type="checkbox" bind:checked={effects.fill.enabled} /> Fill
					</label>
					{#if effects.fill.enabled}
						<div class="effect-body">
							<label class="toggle small">
								<input type="checkbox" bind:checked={effects.fill.gradient} /> Vertical gradient
							</label>
							<div class="row">
								<label class="color">
									{effects.fill.gradient ? 'Top' : 'Color'}
									<input type="color" bind:value={effects.fill.color} />
								</label>
								{#if effects.fill.gradient}
									<label class="color">
										Bottom
										<input type="color" bind:value={effects.fill.color2} />
									</label>
								{/if}
							</div>
						</div>
					{/if}
				</div>

				<div class="effect">
					<label class="toggle">
						<input type="checkbox" bind:checked={effects.outline.enabled} /> Outline
					</label>
					{#if effects.outline.enabled}
						<div class="effect-body row">
							<label class="field narrow">
								Width
								<input type="number" min="0" max="32" step="0.5" bind:value={effects.outline.width} />
							</label>
							<label class="color">
								Color
								<input type="color" bind:value={effects.outline.color} />
							</label>
						</div>
					{/if}
				</div>

				<div class="effect">
					<label class="toggle">
						<input type="checkbox" bind:checked={effects.shadow.enabled} /> Drop shadow
					</label>
					{#if effects.shadow.enabled}
						<div class="effect-body row">
							<label class="field narrow">
								Offset X
								<input type="number" min="-64" max="64" bind:value={effects.shadow.offsetX} />
							</label>
							<label class="field narrow">
								Offset Y
								<input type="number" min="-64" max="64" bind:value={effects.shadow.offsetY} />
							</label>
							<label class="field narrow">
								Blur
								<input type="number" min="0" max="64" bind:value={effects.shadow.blur} />
							</label>
							<label class="color">
								Color
								<input type="color" bind:value={effects.shadow.color} />
							</label>
						</div>
					{/if}
				</div>

				<div class="actions">
					<button class="primary" type="button" disabled={!canBake} onclick={bake}>
						{baking ? 'Baking…' : result ? 'Re-bake' : 'Bake'}
					</button>
					{#if bakeError}<span class="err small">{bakeError}</span>{/if}
				</div>
			</div>

			<div class="panel preview-panel">
				<h2>Live preview</h2>
				<div class="canvas-wrap">
					<div bind:this={host} class="canvas-host"></div>
					{#if previewError}
						<p class="warn small">Live render failed: {previewError}</p>
					{:else if !result}
						<p class="muted small">Bake to preview the font.</p>
					{/if}
				</div>

				{#if result}
					<dl class="metrics">
						<dt>Page size</dt>
						<dd class="mono">{result.scaleW}×{result.scaleH}</dd>
						<dt>Pages</dt>
						<dd class="mono">{result.pages.length}</dd>
						<dt>Glyphs</dt>
						<dd class="mono">{result.glyphCount}</dd>
						<dt>Kernings</dt>
						<dd class="mono">{result.kerningCount}</dd>
						{#if result.skipped.length}
							<dt>Skipped</dt>
							<dd class="warn mono">{result.skipped.length} (font lacks them)</dd>
						{/if}
					</dl>
					<div class="atlases">
						{#each result.pages as page (page.file)}
							{#if atlasUrls[page.file]}
								<figure class="atlas">
									<img src={atlasUrls[page.file]} alt="baked atlas page {page.file}" />
									<figcaption class="mono">{page.file}</figcaption>
								</figure>
							{/if}
						{/each}
					</div>

					{#if canPublishShared}
						<div class="target" role="radiogroup" aria-label="Save target">
							<span class="target-label">Save target</span>
							<button
								class="seg"
								class:active={target === 'project'}
								type="button"
								role="radio"
								aria-checked={target === 'project'}
								onclick={() => (target = 'project')}
							>
								Project
							</button>
							<button
								class="seg"
								class:active={target === 'shared'}
								type="button"
								role="radio"
								aria-checked={target === 'shared'}
								onclick={() => (target = 'shared')}
							>
								Shared library
							</button>
						</div>
					{/if}

					<div class="actions">
						<button class="primary" type="button" disabled={!canSave} onclick={save}>
							{saving ? 'Saving…' : target === 'shared' ? 'Save to shared library' : 'Save to project'}
						</button>
						{#if saveError}<span class="err small">{saveError}</span>{/if}
						{#if savedNote}<span class="ok small">{savedNote}</span>{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</section>

<style>
	.generate {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.drop {
		border: 1px dashed #333;
		border-radius: 12px;
		background: #16161c;
		padding: 24px;
		text-align: center;
		transition: border-color 0.15s;
	}
	.drop.dragging {
		border-color: #7ee0c0;
		background: #16201c;
	}
	.drop-title {
		color: #ddd;
		font-size: 15px;
		margin: 0 0 6px;
	}
	.file-btn {
		display: inline-block;
		margin-top: 12px;
		background: #1f1f28;
		border: 1px solid #333;
		border-radius: 8px;
		padding: 8px 14px;
		color: #e8e8ee;
		font-size: 13px;
		cursor: pointer;
	}
	.file-btn input {
		display: none;
	}
	.muted {
		color: #888;
		font-size: 13px;
		line-height: 1.6;
		margin: 6px 0 0;
	}
	.small {
		font-size: 12px;
	}
	.errors {
		margin: 0;
		padding: 12px 16px 12px 32px;
		background: #2a1a1a;
		border: 1px solid #5a2f2f;
		border-radius: 10px;
		color: #e0a0a0;
		font-size: 13px;
	}
	.grid {
		display: grid;
		grid-template-columns: minmax(300px, 420px) 1fr;
		gap: 16px;
	}
	@media (max-width: 880px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
	.panel {
		background: #16161c;
		border: 1px solid #222;
		border-radius: 12px;
		padding: 16px 18px;
	}
	h2 {
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
		margin: 0 0 12px;
	}
	h2.spaced {
		margin-top: 22px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
		color: #999;
		margin-bottom: 12px;
	}
	.field.narrow {
		flex: 0 0 auto;
	}
	.field input,
	.custom {
		background: #0f0f14;
		border: 1px solid #2a2a33;
		border-radius: 8px;
		padding: 8px 10px;
		color: #e8e8ee;
		font-size: 13px;
		font-family: inherit;
	}
	.field.narrow input {
		width: 90px;
	}
	.field input:focus,
	.custom:focus {
		outline: none;
		border-color: #6b5bff;
	}
	.mono {
		font-family: ui-monospace, monospace;
		font-size: 12px;
	}
	.row {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		align-items: flex-end;
	}
	.presets {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		margin-bottom: 10px;
	}
	.chip {
		background: #1f1f28;
		border: 1px solid #333;
		border-radius: 999px;
		padding: 5px 12px;
		color: #bbb;
		font-size: 12px;
		cursor: pointer;
	}
	.chip.active {
		background: #23203a;
		border-color: #6b5bff;
		color: #c8a3ff;
	}
	.custom {
		width: 100%;
		min-height: 64px;
		resize: vertical;
		margin-bottom: 8px;
		box-sizing: border-box;
	}
	.effect {
		border-top: 1px solid #222;
		padding: 10px 0;
	}
	.effect-body {
		margin: 10px 0 0 22px;
	}
	.toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: #ddd;
		cursor: pointer;
	}
	.toggle.small {
		font-size: 12px;
		color: #aaa;
		margin-bottom: 8px;
	}
	.toggle input,
	.effect input[type='checkbox'] {
		accent-color: #6b5bff;
	}
	.color {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
		color: #999;
	}
	.color input[type='color'] {
		width: 48px;
		height: 30px;
		padding: 0;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		background: #0f0f14;
		cursor: pointer;
	}
	.canvas-wrap {
		background: #0f0f14;
		border: 1px solid #2a2a33;
		border-radius: 8px;
		padding: 12px;
		overflow-x: auto;
		min-height: 60px;
	}
	.canvas-host {
		display: inline-block;
	}
	.metrics {
		margin: 14px 0 0;
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 4px 14px;
		font-size: 13px;
	}
	.metrics dt {
		color: #888;
	}
	.metrics dd {
		margin: 0;
		color: #e8e8ee;
	}
	.toggle.kern {
		margin-top: 12px;
	}
	.toggle.overwrite {
		margin-top: 4px;
		color: #e0b050;
	}
	.atlases {
		margin: 14px 0 0;
		display: flex;
		flex-wrap: wrap;
		gap: 14px;
	}
	.atlas {
		display: flex;
		flex-direction: column;
		gap: 4px;
		align-items: flex-start;
	}
	.atlas img {
		max-width: 100%;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		background: repeating-conic-gradient(#1a1a20 0% 25%, #14141a 0% 50%) 50% / 16px 16px;
		image-rendering: pixelated;
	}
	.target {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		margin-top: 16px;
	}
	.target-label {
		font-size: 12px;
		color: #999;
		margin-right: 4px;
	}
	.seg {
		background: #1f1f28;
		border: 1px solid #333;
		border-radius: 999px;
		padding: 5px 14px;
		color: #bbb;
		font-size: 12px;
		cursor: pointer;
	}
	.seg.active {
		background: #23203a;
		border-color: #6b5bff;
		color: #c8a3ff;
	}
	.actions {
		display: flex;
		gap: 12px;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 16px;
	}
	.primary {
		background: #6b5bff;
		border: none;
		border-radius: 8px;
		padding: 9px 18px;
		color: #fff;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}
	.primary:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.ok {
		color: #7ee787;
	}
	.warn {
		color: #e0b050;
	}
	.err {
		color: #e06b6b;
	}
	code {
		background: #0f0f14;
		border: 1px solid #2a2a33;
		border-radius: 4px;
		padding: 1px 5px;
		font-size: 12px;
		color: #c8a3ff;
	}
</style>
