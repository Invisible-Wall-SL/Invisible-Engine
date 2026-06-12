<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Application, BitmapText, Container } from 'pixi.js';
	import type { FontDescriptorFormat } from 'engine-layout';
	import {
		fetchFontCatalog,
		loadLocalBitmapFont,
		parseDescriptorClient,
		type CatalogFont,
		type LocalBitmapFont,
		type ParsedDescriptor,
	} from './fonts.client';

	interface Props {
		/** Sample text to render in the live preview (shared with View). */
		sample: string;
		/** Render size in px. */
		size: number;
		/** Called after a successful save so the parent can refresh + switch to View. */
		onsaved: () => void;
	}

	let { sample, size, onsaved }: Props = $props();

	const DESC_EXT: Record<string, FontDescriptorFormat> = { xml: 'xml', fnt: 'fnt', json: 'json' };
	const IMAGE_EXT = new Set(['png', 'webp', 'jpg', 'jpeg']);
	const VECTOR_EXT = new Set(['ttf', 'otf']);
	const WEBFONT_EXT = new Set(['woff', 'woff2']);
	const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

	const IMAGE_CONTENT_TYPE: Record<string, string> = {
		png: 'image/png',
		webp: 'image/webp',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
	};
	const DESC_CONTENT_TYPE: Record<FontDescriptorFormat, string> = {
		xml: 'application/xml',
		fnt: 'application/octet-stream',
		json: 'application/json',
	};

	interface PickedDescriptor {
		file: File;
		format: FontDescriptorFormat;
		text: string;
		parsed: ParsedDescriptor;
	}
	interface PickedImage {
		file: File;
		name: string;
		url: string;
	}

	let descriptor = $state<PickedDescriptor | null>(null);
	let images = $state<PickedImage[]>([]);
	let folder = $state('');
	let folderTouched = $state(false);
	let existingIds = $state<Set<string>>(new Set());

	let errors = $state<string[]>([]);
	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let savedNote = $state<string | null>(null);

	// Live-preview state.
	let host = $state<HTMLDivElement | null>(null);
	let previewError = $state<string | null>(null);

	let app: Application | null = null;
	let world: Container | null = null;
	let obj: BitmapText | null = null;
	let localFont: LocalBitmapFont | null = null;
	// Bump to force the preview effect to re-run when the file set changes.
	let previewToken = $state(0);

	void fetchFontCatalog().then((list: CatalogFont[]) => {
		existingIds = new Set(list.map((f) => f.id));
	});

	const ext = (name: string): string => name.split('.').pop()?.toLowerCase() ?? '';

	function slug(face: string): string {
		const s = face.replace(/[^A-Za-z0-9_-]/g, '');
		return ID_RE.test(s) ? s : s.slice(0, 64).replace(/^[^A-Za-z0-9]+/, '') || 'font';
	}

	/** Map of declared page filename → object URL (only the supplied ones). */
	const pageUrls = $derived.by<Record<string, string>>(() => {
		const map: Record<string, string> = {};
		for (const img of images) map[img.name] = img.url;
		return map;
	});

	const missingPages = $derived.by<string[]>(() => {
		if (!descriptor) return [];
		return descriptor.parsed.pageFiles.filter((p) => !pageUrls[p]);
	});
	const extraImages = $derived.by<string[]>(() => {
		if (!descriptor) return images.map((i) => i.name);
		const declared = new Set(descriptor.parsed.pageFiles);
		return images.filter((i) => !declared.has(i.name)).map((i) => i.name);
	});

	const folderValid = $derived(ID_RE.test(folder));
	const folderCollision = $derived(folderValid && existingIds.has(folder));
	const canSave = $derived(
		!!descriptor && folderValid && missingPages.length === 0 && !saving,
	);

	function classify(files: FileList | File[]): void {
		errors = [];
		savedNote = null;
		saveError = null;
		const newErrors: string[] = [];

		for (const file of Array.from(files)) {
			const e = ext(file.name);
			if (VECTOR_EXT.has(e)) {
				newErrors.push(`"${file.name}" is a TTF/OTF — use Generate (Phase 3) to bake those.`);
				continue;
			}
			if (WEBFONT_EXT.has(e)) {
				newErrors.push(`"${file.name}" is a web font — web-font import lands in Phase 4.`);
				continue;
			}
			if (DESC_EXT[e]) {
				void readDescriptor(file, DESC_EXT[e]);
				continue;
			}
			if (IMAGE_EXT.has(e)) {
				addImage(file);
				continue;
			}
			newErrors.push(`"${file.name}" is not a BMFont descriptor or page image.`);
		}
		errors = newErrors;
	}

	async function readDescriptor(file: File, format: FontDescriptorFormat): Promise<void> {
		try {
			const text = await file.text();
			const parsed = parseDescriptorClient(text, format);
			if (!parsed.face) {
				errors = [...errors, `"${file.name}" has no font face — not a valid descriptor.`];
				return;
			}
			if (parsed.pageFiles.length === 0) {
				errors = [...errors, `"${file.name}" declares no page images.`];
				return;
			}
			descriptor = { file, format, text, parsed };
			if (!folderTouched) folder = slug(parsed.face);
			previewToken += 1;
		} catch (e) {
			errors = [...errors, `Failed to read "${file.name}": ${e instanceof Error ? e.message : e}`];
		}
	}

	function addImage(file: File): void {
		// Replace an existing image of the same name (re-pick).
		const dup = images.find((i) => i.name === file.name);
		if (dup) {
			URL.revokeObjectURL(dup.url);
			images = images.filter((i) => i !== dup);
		}
		images = [...images, { file, name: file.name, url: URL.createObjectURL(file) }];
		previewToken += 1;
	}

	function removeImage(name: string): void {
		const hit = images.find((i) => i.name === name);
		if (hit) URL.revokeObjectURL(hit.url);
		images = images.filter((i) => i.name !== name);
		previewToken += 1;
	}

	function reset(): void {
		teardownFont();
		descriptor = null;
		for (const img of images) URL.revokeObjectURL(img.url);
		images = [];
		folder = '';
		folderTouched = false;
		errors = [];
		saveError = null;
		savedNote = null;
		previewError = null;
		previewToken += 1;
	}

	// Drag + drop / file input plumbing.
	let dragging = $state(false);
	function onDrop(ev: DragEvent): void {
		ev.preventDefault();
		dragging = false;
		if (ev.dataTransfer?.files) classify(ev.dataTransfer.files);
	}
	function onPick(ev: Event): void {
		const input = ev.target as HTMLInputElement;
		if (input.files) classify(input.files);
		input.value = '';
	}

	// ---- Live preview (rebuild on file/sample/size change) ----
	function teardownFont(): void {
		obj?.destroy();
		obj = null;
		localFont?.dispose();
		localFont = null;
	}

	function drawSample(): void {
		if (!app || !world || !localFont) return;
		obj?.destroy();
		obj = new BitmapText({ text: sample, style: { fontFamily: localFont.family, fontSize: size } });
		obj.position.set(4, 4);
		world.addChild(obj);
		const w = Math.max(1, Math.ceil(obj.width) + 8);
		const h = Math.max(1, Math.ceil(obj.height) + 8);
		app.renderer.resize(w, h);
	}

	$effect(() => {
		// Re-render when the loaded font is ready and sample/size change.
		void sample;
		void size;
		drawSample();
	});

	$effect(() => {
		// (Re)load the local font whenever the descriptor or page set changes.
		void previewToken;
		const desc = descriptor;
		previewError = null;
		teardownFont();
		if (!app || !desc || missingPages.length > 0) return;

		let cancelled = false;
		void loadLocalBitmapFont({
			family: desc.parsed.face,
			descriptorText: desc.text,
			descriptorFormat: desc.format,
			pageUrls,
		})
			.then((lf) => {
				if (cancelled) {
					lf.dispose();
					return;
				}
				localFont = lf;
				drawSample();
			})
			.catch((e: unknown) => {
				if (!cancelled) previewError = e instanceof Error ? e.message : String(e);
			});
		return () => {
			cancelled = true;
		};
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
				previewToken += 1; // kick a load now that the app exists
			});
		return () => {
			disposed = true;
		};
	});

	async function save(): Promise<void> {
		if (!descriptor || !canSave) return;
		saving = true;
		saveError = null;
		savedNote = null;
		try {
			const files = [
				{ name: descriptor.file.name, contentType: DESC_CONTENT_TYPE[descriptor.format] },
				...descriptor.parsed.pageFiles.map((p) => ({
					name: p,
					contentType: IMAGE_CONTENT_TYPE[ext(p)] ?? 'application/octet-stream',
				})),
			];

			const urlsRes = await fetch('/api/fonts/upload-urls', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ folder, files }),
			});
			if (!urlsRes.ok) throw new Error(await errText(urlsRes, 'Failed to mint upload URLs.'));
			const { uploads } = (await urlsRes.json()) as {
				uploads: { name: string; url: string; contentType: string }[];
			};

			// PUT each file directly to R2 with the matching content-type.
			for (const up of uploads) {
				const blob =
					up.name === descriptor.file.name
						? descriptor.file
						: images.find((i) => i.name === up.name)?.file;
				if (!blob) throw new Error(`Internal: no local file for "${up.name}".`);
				const put = await fetch(up.url, {
					method: 'PUT',
					headers: { 'content-type': up.contentType },
					body: blob,
				});
				if (!put.ok) throw new Error(`Upload of "${up.name}" failed (${put.status}).`);
			}

			const saveRes = await fetch('/api/fonts/save', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					folder,
					descriptorFile: descriptor.file.name,
					descriptorFormat: descriptor.format,
				}),
			});
			if (!saveRes.ok) throw new Error(await errText(saveRes, 'Save failed.'));
			const { font } = (await saveRes.json()) as { font: { name: string; id: string } };

			savedNote = `Saved "${font.name}" as ${font.id}.`;
			existingIds = new Set([...existingIds, font.id]);
			onsaved();
		} catch (e) {
			saveError = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}

	async function errText(res: Response, fallback: string): Promise<string> {
		try {
			const body = (await res.json()) as { message?: string };
			return body.message ?? fallback;
		} catch {
			return `${fallback} (${res.status})`;
		}
	}

	onDestroy(() => {
		teardownFont();
		for (const img of images) URL.revokeObjectURL(img.url);
		try {
			app?.destroy(true);
		} catch {
			/* context teardown */
		}
		app = null;
		world = null;
	});
</script>

<section class="import">
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
		<p class="drop-title">Drop a BMFont descriptor + its page image(s)</p>
		<p class="muted">
			Accepts <code>.xml</code>/<code>.fnt</code>/<code>.json</code> + <code>.png</code>/<code
				>.webp</code
			>/<code>.jpg</code>. TTF/OTF go through Generate; web fonts arrive in Phase 4.
		</p>
		<label class="file-btn">
			Choose files…
			<input type="file" multiple accept=".xml,.fnt,.json,.png,.webp,.jpg,.jpeg" onchange={onPick} />
		</label>
	</div>

	{#if errors.length}
		<ul class="errors">
			{#each errors as err (err)}
				<li>{err}</li>
			{/each}
		</ul>
	{/if}

	{#if descriptor}
		<div class="grid">
			<div class="panel meta-panel">
				<h2>Detected font</h2>
				<dl>
					<dt>Face name</dt>
					<dd class="mono">{descriptor.parsed.face}</dd>
					<dt>Format</dt>
					<dd class="mono">{descriptor.format}</dd>
					<dt>Glyphs</dt>
					<dd class="mono">{descriptor.parsed.glyphCount || '—'}</dd>
					<dt>Pages</dt>
					<dd>
						<ul class="pages">
							{#each descriptor.parsed.pageFiles as page (page)}
								<li class:missing={!pageUrls[page]}>
									<span class="mono">{page}</span>
									{#if pageUrls[page]}
										<span class="ok">✓ supplied</span>
									{:else}
										<span class="warn">missing — add this image</span>
									{/if}
								</li>
							{/each}
						</ul>
					</dd>
				</dl>

				{#if extraImages.length}
					<p class="warn small">
						Extra image{extraImages.length > 1 ? 's' : ''} not referenced by the descriptor
						(ignored on save): {extraImages.join(', ')}
					</p>
				{/if}

				<label class="folder-field">
					Folder / id
					<input
						class="mono"
						bind:value={folder}
						oninput={() => (folderTouched = true)}
						spellcheck="false"
						placeholder="goldfont"
					/>
				</label>
				{#if !folderValid}
					<p class="warn small">
						Use 1–64 chars: letters, digits, <code>-</code> or <code>_</code>, starting with a
						letter or digit.
					</p>
				{:else if folderCollision}
					<p class="warn small">An entry with id <code>{folder}</code> exists — saving overwrites it.</p>
				{/if}
			</div>

			<div class="panel preview-panel">
				<h2>Live preview</h2>
				<div class="canvas-wrap">
					<div bind:this={host} class="canvas-host"></div>
					{#if previewError}
						<p class="warn small">Live render failed: {previewError}</p>
					{:else if missingPages.length}
						<p class="muted small">Add the missing page image to preview.</p>
					{/if}
				</div>
				{#if images.length}
					<div class="thumbs">
						{#each images as img (img.name)}
							<figure class="thumb-fig">
								<img src={img.url} alt={img.name} />
								<figcaption class="mono">{img.name}</figcaption>
								<button class="rm" type="button" onclick={() => removeImage(img.name)}>Remove</button>
							</figure>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<div class="actions">
			<button class="primary" type="button" disabled={!canSave} onclick={save}>
				{saving ? 'Saving…' : 'Save to project'}
			</button>
			<button class="ghost" type="button" disabled={saving} onclick={reset}>Clear</button>
			{#if missingPages.length}
				<span class="warn small">Supply every declared page image before saving.</span>
			{/if}
			{#if saveError}<span class="err small">{saveError}</span>{/if}
			{#if savedNote}<span class="ok small">{savedNote}</span>{/if}
		</div>
	{/if}
</section>

<style>
	.import {
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
		margin: 0;
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
		grid-template-columns: minmax(260px, 360px) 1fr;
		gap: 16px;
	}
	@media (max-width: 820px) {
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
	dl {
		margin: 0;
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 6px 14px;
		font-size: 13px;
	}
	dt {
		color: #888;
	}
	dd {
		margin: 0;
		color: #e8e8ee;
	}
	.mono {
		font-family: ui-monospace, monospace;
		font-size: 12px;
	}
	.pages {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.pages li {
		display: flex;
		gap: 8px;
		align-items: baseline;
		flex-wrap: wrap;
	}
	.ok {
		color: #7ee787;
		font-size: 11px;
	}
	.warn {
		color: #e0b050;
	}
	.err {
		color: #e06b6b;
	}
	.folder-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
		color: #999;
		margin-top: 16px;
	}
	.folder-field input {
		background: #0f0f14;
		border: 1px solid #2a2a33;
		border-radius: 8px;
		padding: 8px 10px;
		color: #e8e8ee;
	}
	.folder-field input:focus {
		outline: none;
		border-color: #6b5bff;
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
	.thumbs {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		margin-top: 14px;
	}
	.thumb-fig {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		align-items: center;
	}
	.thumb-fig img {
		max-width: 120px;
		max-height: 90px;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		background: repeating-conic-gradient(#1a1a20 0% 25%, #14141a 0% 50%) 50% / 16px 16px;
		image-rendering: pixelated;
	}
	.rm {
		background: transparent;
		border: none;
		color: #888;
		font-size: 11px;
		cursor: pointer;
		text-decoration: underline;
		padding: 0;
	}
	.rm:hover {
		color: #e06b6b;
	}
	.actions {
		display: flex;
		gap: 12px;
		align-items: center;
		flex-wrap: wrap;
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
	.ghost {
		background: transparent;
		border: 1px solid #333;
		border-radius: 8px;
		padding: 9px 16px;
		color: #bbb;
		font-size: 13px;
		cursor: pointer;
	}
	.ghost:disabled {
		opacity: 0.45;
		cursor: not-allowed;
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
