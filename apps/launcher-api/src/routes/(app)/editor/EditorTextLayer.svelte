<script lang="ts">
	import {
		findFont,
		resolveTransform,
		type FontCatalog,
		type LayoutNode,
		type ResolvedTransform,
		type Scene,
	} from 'engine-layout';
	import { onMount } from 'svelte';
	import {
		Application,
		BitmapText,
		Container,
		Text,
		TextStyle,
		type ColorSource,
	} from 'pixi.js';
	import {
		ensureBitmapFont,
		ensureWebFont,
		fetchFontCatalog,
		type EditorFont,
	} from './fonts.client';

	interface Props {
		/** All doc scenes — the composite the 2D canvas + spine layer also draw. */
		scenes: Scene[];
		layoutType: import('engine-layout').LayoutType;
		/** Editor view transform — kept byte-identical with the 2D canvas + spine layer. */
		panX: number;
		panY: number;
		zoom: number;
		/**
		 * Resolve a node's WORLD transform exactly as the 2D canvas does (the canvas's
		 * `nodeTransform`, which folds in space-specific framing). The overlay maps that
		 * world transform to screen via `world*zoom + pan`, so a text node lands on the
		 * same spot the 2D canvas would draw it.
		 */
		worldTransformOf: (node: LayoutNode, scene: Scene) => ResolvedTransform;
		/** Editor-only: scene ids hidden from the composite. */
		hiddenSceneIds?: Set<string>;
		/** Bumped by "Reload art" — re-fetches the catalog + reloads fonts. */
		reloadToken?: number;
		/** Monotonic font-load tally, folded into the 2D canvas's progress overlay. */
		onLoadingChange?: (counts: { started: number; settled: number }) => void;
		/** Reports which text NODE ids the overlay now renders with a real font, so the
		 * 2D canvas skips their `fillText` placeholder (no double-draw). */
		onReadyIdsChange?: (ids: Set<string>) => void;
	}

	let {
		scenes,
		layoutType,
		panX,
		panY,
		zoom,
		worldTransformOf,
		hiddenSceneIds = new Set<string>(),
		reloadToken = 0,
		onLoadingChange,
		onReadyIdsChange,
	}: Props = $props();

	let host: HTMLDivElement | null = $state(null);
	let app: Application | null = null;
	/** The world container — every text node is parented here at its screen position. */
	let world: Container | null = null;
	let ready = false;

	// Monotonic font-load tally (one font = one started + eventually one settled).
	let loadStarted = 0;
	let loadSettled = 0;
	function reportLoading(): void {
		onLoadingChange?.({ started: loadStarted, settled: loadSettled });
	}

	/** Catalog of the project's fonts, by family name. Empty until fetched. */
	let byName = new Map<string, EditorFont>();
	/** Font names whose load resolved (bitmap registered / web face added). */
	let loadedFonts = new Set<string>();
	/** Font names whose load is in flight (so we kick each off exactly once). */
	const fontLoads = new Set<string>();

	/** Kick off a font load once; on success mark it loaded + trigger a rebuild. */
	function ensureFont(font: EditorFont): void {
		if (fontLoads.has(font.name)) return;
		fontLoads.add(font.name);
		loadStarted++;
		reportLoading();
		const done = (name: string | null): void => {
			loadSettled++;
			reportLoading();
			if (name) {
				loadedFonts.add(name);
				rebuild();
			}
		};
		if (font.kind === 'bitmap') void ensureBitmapFont(font).then(done);
		else void ensureWebFont(font).then(done);
	}

	/** Text node id → its pixi display object (BitmapText | Text), reused per id. */
	const objects = new Map<string, BitmapText | Text>();
	let readyIds = new Set<string>();
	function publishReady(ids: Set<string>): void {
		if (ids.size === readyIds.size && [...ids].every((id) => readyIds.has(id))) return;
		readyIds = ids;
		onReadyIdsChange?.(new Set(ids));
	}

	/** Top-level text nodes of every non-hidden scene (containers stay 2D-only). */
	function textTargets(): { node: Extract<LayoutNode, { kind: 'text' }>; scene: Scene }[] {
		const out: { node: Extract<LayoutNode, { kind: 'text' }>; scene: Scene }[] = [];
		for (const sc of scenes) {
			if (hiddenSceneIds.has(sc.id)) continue;
			for (const n of sc.nodes) {
				if (n.kind !== 'text') continue;
				if (!resolveTransform(n, layoutType).visible) continue;
				out.push({ node: n, scene: sc });
			}
		}
		return out;
	}

	function toColor(fill: number | undefined): ColorSource {
		return fill ?? 0xffffff;
	}

	/** Build (or reuse) a BitmapText for a node whose font is a loaded bitmap font. */
	function buildBitmap(
		node: Extract<LayoutNode, { kind: 'text' }>,
		font: EditorFont,
	): BitmapText {
		const existing = objects.get(node.id);
		const obj = existing instanceof BitmapText ? existing : new BitmapText({ text: node.text });
		obj.text = node.text;
		obj.style = {
			fontFamily: font.name,
			fontSize: node.style?.fontSize ?? 24,
			align: node.style?.align ?? 'left',
			letterSpacing: node.style?.letterSpacing ?? 0,
		} as ConstructorParameters<typeof BitmapText>[0]['style'];
		// Bitmap fonts are baked atlases: tint recolours, but no stroke/dropShadow.
		obj.tint = toColor(node.style?.fill);
		return obj;
	}

	/** Build (or reuse) a regular Text for a web/system-font node. */
	function buildText(node: Extract<LayoutNode, { kind: 'text' }>): Text {
		const existing = objects.get(node.id);
		const obj = existing instanceof Text && !(existing instanceof BitmapText)
			? existing
			: new Text({ text: node.text });
		obj.text = node.text;
		const s = node.style ?? {};
		const style = new TextStyle({
			fontFamily: s.fontFamily ?? 'sans-serif',
			fontSize: s.fontSize ?? 24,
			fontWeight: (s.fontWeight ?? 'normal') as TextStyle['fontWeight'],
			fontStyle: s.fontStyle ?? 'normal',
			fill: toColor(s.fill),
			align: s.align ?? 'left',
			letterSpacing: s.letterSpacing ?? 0,
			lineHeight: s.lineHeight ?? 0,
			wordWrap: s.wordWrap ?? false,
			wordWrapWidth: s.wordWrapWidth ?? 100,
			breakWords: s.breakWords ?? false,
		});
		if (s.stroke) style.stroke = { color: s.stroke.color, width: s.stroke.width };
		if (s.dropShadow) {
			style.dropShadow = {
				color: s.dropShadow.color ?? 0x000000,
				alpha: s.dropShadow.alpha ?? 1,
				angle: s.dropShadow.angle ?? Math.PI / 4,
				blur: s.dropShadow.blur ?? 0,
				distance: s.dropShadow.distance ?? 4,
			};
		}
		obj.style = style;
		return obj;
	}

	/**
	 * Rebuild the overlay from the current targets: position each text node at the
	 * 2D canvas's world transform mapped to screen (`world*zoom + pan`), pick
	 * BitmapText vs Text by the catalog font kind, and report which node ids now
	 * render a REAL font (loaded bitmap or web) so the 2D canvas drops its
	 * placeholder. A node whose font hasn't loaded (or isn't in the catalog) is left
	 * to the 2D canvas's `fillText`, so it never disappears.
	 */
	function rebuild(): void {
		if (!ready || !app || !world) return;
		const targets = textTargets();
		const seen = new Set<string>();
		const nowReady = new Set<string>();

		for (const { node, scene } of targets) {
			const font = findFont({ prefix: '', fonts: [...byName.values()] } as FontCatalog, node.style?.fontFamily);
			// Web + bitmap fonts both need an async load; kick it off + skip until ready.
			if (font && !loadedFonts.has(font.name)) {
				ensureFont(font);
				continue;
			}
			// A web font the catalog DOESN'T list (a plain system family) renders fine via
			// Text immediately; but to avoid double-drawing with the 2D canvas we only
			// take ownership of nodes whose font we resolved through the catalog.
			if (!font) continue;

			seen.add(node.id);
			const obj = font.kind === 'bitmap' ? buildBitmap(node, font) : buildText(node);
			if (obj.parent !== world) world.addChild(obj);

			const t = worldTransformOf(node, scene);
			obj.visible = t.visible;
			if (!t.visible) continue;
			obj.anchor.set(t.anchor?.x ?? 0, t.anchor?.y ?? 0);
			// World → screen: same `world*zoom + pan` mapping as the 2D canvas, with the
			// node's own scale folded on top so size tracks the canvas exactly.
			obj.x = t.x * zoom + panX;
			obj.y = t.y * zoom + panY;
			obj.rotation = t.rotation ?? 0;
			obj.scale.set((t.scale?.x ?? 1) * zoom, (t.scale?.y ?? 1) * zoom);
			obj.alpha = t.alpha ?? 1;
			objects.set(node.id, obj);
			nowReady.add(node.id);
		}

		// Drop pixi objects whose node was removed / hidden / unowned this pass.
		for (const [id, obj] of objects) {
			if (seen.has(id)) continue;
			obj.destroy();
			objects.delete(id);
		}
		publishReady(nowReady);
	}

	// Rebuild whenever the inputs that affect layout/content change. Svelte tracks
	// the reads inside `textTargets()` (scenes/nodes) plus the view transform here.
	$effect(() => {
		void scenes;
		void hiddenSceneIds;
		void layoutType;
		void panX;
		void panY;
		void zoom;
		rebuild();
	});

	// "Reload art": drop the catalog + loaded-font state so fonts re-resolve.
	let lastReloadToken = 0;
	$effect(() => {
		const tok = reloadToken;
		if (tok === lastReloadToken) return;
		lastReloadToken = tok;
		loadedFonts = new Set();
		fontLoads.clear();
		void fetchFontCatalog().then((cat) => {
			byName = cat.byName;
			rebuild();
		});
	});

	onMount(() => {
		let disposed = false;
		const a = new Application();
		void a
			.init({
				backgroundAlpha: 0,
				antialias: true,
				resizeTo: host ?? undefined,
				resolution: window.devicePixelRatio || 1,
				autoDensity: true,
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
				a.canvas.style.position = 'absolute';
				a.canvas.style.inset = '0';
				a.canvas.style.width = '100%';
				a.canvas.style.height = '100%';
				a.canvas.style.pointerEvents = 'none';
				ready = true;
				void fetchFontCatalog().then((cat) => {
					byName = cat.byName;
					rebuild();
				});
			});
		return () => {
			disposed = true;
			ready = false;
			for (const obj of objects.values()) obj.destroy();
			objects.clear();
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

<div bind:this={host} class="text-layer"></div>

<style>
	.text-layer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		/* Input always reaches the 2D canvas underneath (selection/handles/drag). */
		pointer-events: none;
	}
</style>
