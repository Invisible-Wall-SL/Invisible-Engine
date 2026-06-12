<script lang="ts">
	import { onMount } from 'svelte';
	import { Application, BitmapText, Container, Text, TextStyle } from 'pixi.js';
	import { ensureBitmapFont, ensureWebFont, type CatalogFont } from './fonts.client';

	interface Props {
		font: CatalogFont;
		/** Sample text to render. */
		sample: string;
		/** Render size in px. */
		size: number;
	}

	let { font, sample, size }: Props = $props();

	let host: HTMLDivElement | null = $state(null);
	let app: Application | null = null;
	let world: Container | null = null;
	let obj: BitmapText | Text | null = null;
	let ready = $state(false);
	let loaded = $state(false);
	let failed = $state(false);

	/** (Re)build the display object once the font is loaded + the app is ready. */
	function rebuild(): void {
		if (!ready || !world || !loaded) return;
		if (obj) {
			obj.destroy();
			obj = null;
		}
		if (font.kind === 'bitmap') {
			obj = new BitmapText({
				text: sample,
				style: { fontFamily: font.name, fontSize: size },
			});
		} else {
			obj = new Text({
				text: sample,
				style: new TextStyle({ fontFamily: font.name, fontSize: size, fill: 0xffffff }),
			});
		}
		obj.position.set(0, 0);
		world.addChild(obj);
		resize();
	}

	/** Fit the canvas to the rendered text so the preview area sizes to content. */
	function resize(): void {
		if (!app || !obj || !host) return;
		const w = Math.max(1, Math.ceil(obj.width) + 8);
		const h = Math.max(1, Math.ceil(obj.height) + 8);
		app.renderer.resize(w, h);
		obj.position.set(4, 4);
	}

	// Rebuild when the sample text or size changes (re-render the same loaded font).
	$effect(() => {
		void sample;
		void size;
		rebuild();
	});

	onMount(() => {
		let disposed = false;
		const a = new Application();
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
				if (disposed) {
					a.destroy(true);
					return;
				}
				app = a;
				world = new Container();
				a.stage.addChild(world);
				if (host) host.appendChild(a.canvas);
				a.canvas.style.display = 'block';
				ready = true;
				const load = font.kind === 'bitmap' ? ensureBitmapFont(font) : ensureWebFont(font);
				void load.then((name) => {
					if (disposed) return;
					if (name) {
						loaded = true;
						rebuild();
					} else {
						failed = true;
					}
				});
			});
		return () => {
			disposed = true;
			ready = false;
			obj?.destroy();
			obj = null;
			try {
				app?.destroy(true);
			} catch {
				/* context teardown */
			}
			app = null;
			world = null;
		};
	});
</script>

<div class="preview">
	<div bind:this={host} class="canvas-host"></div>
	{#if failed}
		<span class="note err">Failed to load this font.</span>
	{:else if !loaded}
		<span class="note">Loading…</span>
	{/if}
</div>

<style>
	.preview {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 40px;
		overflow-x: auto;
	}
	.canvas-host {
		display: inline-block;
	}
	.note {
		color: #777;
		font-size: 12px;
	}
	.note.err {
		color: #e06b6b;
	}
</style>
