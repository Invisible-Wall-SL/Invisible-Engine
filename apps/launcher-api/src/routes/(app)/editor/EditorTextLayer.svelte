<script lang="ts">
	import {
		defaultHudText,
		findFont,
		getHudTextOverride,
		resolveTransform,
		type FontCatalog,
		type LayoutNode,
		type ResolvedTransform,
		type Scene,
		type TextStyle as LayoutTextStyle,
	} from 'engine-layout';
	import { onMount } from 'svelte';
	import { Application, BitmapText, Container, Text, TextStyle, type ColorSource } from 'pixi.js';
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
		/** Project display name — the HUD game-name default shown when unset (matches
		 * what the game injects; not written to the doc). */
		projectGameName?: string | null;
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
		projectGameName = null,
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

	/** The engine's coded HUD text font (UiGameName / the logo `<Text>`), used as the
	 * editor's default so a HUD anchor without an explicit override still renders in a
	 * game-like font (the browser falls back to sans-serif if it isn't loaded). */
	const HUD_DEFAULT_FONT = 'proxima-nova';

	/** A normalized text target: a real `kind:'text'` node, OR a coded HUD text bind
	 * anchor (logo / game-name) — both render through the same PIXI path so the editor
	 * shows the real text. `isHud` anchors always render (default font when none is
	 * chosen) so the author SEES + edits the live label, not a placeholder chip. */
	interface TextTarget {
		id: string;
		node: LayoutNode;
		scene: Scene;
		text: string;
		style: Partial<LayoutTextStyle> | undefined;
		isHud: boolean;
	}

	/** Top-level text targets of every non-hidden scene (containers stay 2D-only,
	 * except a HUD text bind anchor — logo / game-name — which always renders). */
	function textTargets(): TextTarget[] {
		const out: TextTarget[] = [];
		for (const sc of scenes) {
			if (hiddenSceneIds.has(sc.id)) continue;
			for (const n of sc.nodes) {
				if (!resolveTransform(n, layoutType).visible) continue;
				if (n.kind === 'text') {
					out.push({ id: n.id, node: n, scene: sc, text: n.text, style: n.style, isHud: false });
				} else if (n.kind === 'container' && n.bind && n.preview?.style === 'text') {
					// A coded HUD text anchor (game-name / logo): render its LIVE label as
					// real text so the editor matches the game + the author can edit it. The
					// override text drives the game too (via bind.props → UiGameName). Prefer
					// the author's override, else the shared default label for this HUD
					// component (so even older docs without a baked default show real text),
					// else the node label. Default the font to the engine HUD font.
					const ov = getHudTextOverride(n);
					const style = { fontFamily: HUD_DEFAULT_FONT, ...ov?.style };
					// Game-name defaults to the PROJECT display name (matches what the game
					// shows); else the shared component default; else the node label.
					const fallback =
						n.bind.component === 'HudGameName'
							? (projectGameName ?? defaultHudText(n.bind.component))
							: defaultHudText(n.bind.component);
					out.push({
						id: n.id,
						node: n,
						scene: sc,
						text: ov?.text ?? fallback ?? n.label ?? '',
						style,
						isHud: true,
					});
				}
			}
		}
		return out;
	}

	function toColor(fill: number | undefined): ColorSource {
		return fill ?? 0xffffff;
	}

	/** Build (or reuse) a BitmapText for a target whose font is a loaded bitmap font. */
	function buildBitmap(
		id: string,
		text: string,
		style: Partial<LayoutTextStyle> | undefined,
		font: EditorFont,
	): BitmapText {
		const existing = objects.get(id);
		const obj = existing instanceof BitmapText ? existing : new BitmapText({ text });
		obj.text = text;
		obj.style = {
			fontFamily: font.name,
			fontSize: style?.fontSize ?? 24,
			align: style?.align ?? 'left',
			letterSpacing: style?.letterSpacing ?? 0,
		} as ConstructorParameters<typeof BitmapText>[0]['style'];
		// Bitmap fonts are baked atlases: tint recolours, but no stroke/dropShadow.
		obj.tint = toColor(style?.fill);
		return obj;
	}

	/** Build (or reuse) a regular Text for a web/system-font target. */
	function buildText(id: string, text: string, style: Partial<TextStyle> | undefined): Text {
		const existing = objects.get(id);
		const obj =
			existing instanceof Text && !(existing instanceof BitmapText) ? existing : new Text({ text });
		obj.text = text;
		const s = style ?? {};
		const textStyle = new TextStyle({
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
		if (s.stroke) textStyle.stroke = { color: s.stroke.color, width: s.stroke.width };
		if (s.dropShadow) {
			textStyle.dropShadow = {
				color: s.dropShadow.color ?? 0x000000,
				alpha: s.dropShadow.alpha ?? 1,
				angle: s.dropShadow.angle ?? Math.PI / 4,
				blur: s.dropShadow.blur ?? 0,
				distance: s.dropShadow.distance ?? 4,
			};
		}
		obj.style = textStyle;
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

		for (const { id, node, scene, text, style, isHud } of targets) {
			const font = findFont(
				{ prefix: '', fonts: [...byName.values()] } as FontCatalog,
				style?.fontFamily,
			);
			// Web + bitmap fonts both need an async load; kick it off + skip until ready.
			if (font && !loadedFonts.has(font.name)) {
				ensureFont(font);
				continue;
			}
			// A regular text node whose family ISN'T in the catalog is left to the 2D
			// canvas's `fillText` (avoids double-draw). A HUD anchor, by contrast, always
			// renders here as real text (its 2D stand-in is a placeholder chip, not text),
			// using the catalog font when chosen or a default `<Text>` font otherwise.
			if (!font && !isHud) continue;

			seen.add(id);
			const obj =
				font?.kind === 'bitmap' ? buildBitmap(id, text, style, font) : buildText(id, text, style);
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
			objects.set(id, obj);
			nowReady.add(id);
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
