<script lang="ts">
	import {
		defaultHudText,
		findFont,
		getHudTextOverride,
		resolveBoundValue,
		resolveComponentParams,
		resolveTransform,
		MAX_COMPONENT_DEPTH,
		type ComponentDef,
		type FontCatalog,
		type LayoutNode,
		type ResolvedTransform,
		type Scene,
		type TextStyle as LayoutTextStyle,
	} from 'engine-layout';
	import { onMount } from 'svelte';
	import {
		Application,
		BitmapText,
		Container,
		Matrix,
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
	import {
		childLocalTransform,
		composeWorldMatrix,
		matMul,
		type Affine,
	} from './editorCanvas.helpers';

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
		/** Editor-only: when set, render ONLY these scene ids (per-scene composite, so a
		 * scene's text z-orders with its own scene group instead of always on top). */
		sceneFilter?: Set<string> | null;
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
		/** Open component's resolved params (Component Editor) — a HUD text anchor with
		 * a `preview.textParam` shows that param's value (caption/number) instead of its
		 * label. Empty/undefined in scene mode ⇒ the label fallback (parity). */
		componentParams?: Record<string, unknown>;
		/** Loaded project component defs, so the overlay can EXPAND a `componentInstance`'s
		 * tree (resolve its params + recurse into `def.root.children`) and own the text it
		 * draws — the same `componentMap` the 2D canvas uses. */
		componentMap?: Map<string, ComponentDef>;
		/** The fixed window dims (§10.2) — a nested `canvas`-space node folds its
		 * `screenAnchor` against these, mirroring `<LayoutNodeView>` (`canvasSizes`). */
		frameWidth: number;
		frameHeight: number;
	}

	let {
		scenes,
		layoutType,
		panX,
		panY,
		zoom,
		worldTransformOf,
		hiddenSceneIds = new Set<string>(),
		sceneFilter = null,
		reloadToken = 0,
		onLoadingChange,
		onReadyIdsChange,
		projectGameName = null,
		componentParams,
		componentMap = new Map<string, ComponentDef>(),
		frameWidth,
		frameHeight,
	}: Props = $props();

	/** Thousands-grouped integer — matches the 2D canvas / `ParamReadoutText`. */
	const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

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
	 * shows the real text. The `chain` is the node's full ancestor path within its scene
	 * (root-first, leaf-last) — the overlay composes its WORLD transform from it,
	 * identically to the 2D canvas. `key` (the chain's ids joined) is UNIQUE per rendered
	 * position, so two instances of one component (which share def-child node ids) get
	 * distinct pixi objects; `id` is the bare node id reported to `readyTextIds` (the 2D
	 * canvas's HUD-chip suppression keys on the bare id during instance expansion). */
	interface TextTarget {
		key: string;
		id: string;
		node: LayoutNode;
		scene: Scene;
		chain: LayoutNode[];
		text: string;
		style: Partial<LayoutTextStyle> | undefined;
	}

	/** Unique render-position key for a chain (its node ids joined) — see {@link TextTarget}. */
	function chainKey(chain: LayoutNode[]): string {
		return chain.map((n) => n.id).join('/');
	}

	/** Bound `text` for a text node (§13.4), mirroring the 2D canvas's `boundTextValue`:
	 * a numeric param formats thousands-grouped, a string passes through, no/other binding
	 * keeps the node's static `text`. `params` is the enclosing instance's resolved params
	 * (`instanceParams ?? componentParams`). */
	function boundTextValue(
		node: Extract<LayoutNode, { kind: 'text' }>,
		params: Record<string, unknown>,
	): string {
		const value = resolveBoundValue(node.paramBindings, 'text', params);
		if (typeof value === 'number') return numberFormat.format(value);
		if (typeof value === 'string') return value;
		return node.text;
	}

	/** Bound text STYLE overrides (fill/fontSize/fontFamily) for a text node, merged onto
	 * its static `style` — same fields + precedence as `LayoutNodeView`'s `resolvedStyle`
	 * and the 2D canvas's text block. Wrong-primitive binds are ignored (keep static). */
	function boundTextStyle(
		node: Extract<LayoutNode, { kind: 'text' }>,
		params: Record<string, unknown>,
	): Partial<LayoutTextStyle> | undefined {
		const fill = resolveBoundValue(node.paramBindings, 'style.fill', params);
		const fontSize = resolveBoundValue(node.paramBindings, 'style.fontSize', params);
		const fontFamily = resolveBoundValue(node.paramBindings, 'style.fontFamily', params);
		const overrides: Partial<LayoutTextStyle> = {};
		if (typeof fill === 'number') overrides.fill = fill;
		if (typeof fontSize === 'number') overrides.fontSize = fontSize;
		if (typeof fontFamily === 'string') overrides.fontFamily = fontFamily;
		return Object.keys(overrides).length > 0 ? { ...node.style, ...overrides } : node.style;
	}

	/** Caption a HUD text bind anchor shows: the resolved `preview.textParam` (decomposed
	 * readout part), else the author override, else the shared component default, else the
	 * node label. `params` is the enclosing instance's resolved params, so a placed
	 * `HudReadout`'s Caption reads its `label` ("BALANCE"), not the component name. */
	function hudAnchorTarget(
		n: Extract<LayoutNode, { kind: 'container' }> & { bind: NonNullable<LayoutNode['bind']> },
		sc: Scene,
		chain: LayoutNode[],
		params: Record<string, unknown>,
	): TextTarget {
		const ov = getHudTextOverride(n);
		const style = { fontFamily: HUD_DEFAULT_FONT, ...ov?.style };
		const key = n.preview?.textParam;
		const paramText = key ? hudParamValue(params[key]) : null;
		const fallback =
			n.bind.component === 'HudGameName'
				? (projectGameName ?? defaultHudText(n.bind.component))
				: defaultHudText(n.bind.component);
		return {
			key: chainKey(chain),
			id: n.id,
			node: n,
			scene: sc,
			chain,
			text: paramText ?? ov?.text ?? fallback ?? n.label ?? '',
			style,
		};
	}

	/** A resolved param value as a HUD chip caption: number → formatted, non-empty string
	 * → as-is, engine-fed/unset → "0" (parity with the 2D canvas's `chipCaption`). */
	function hudParamValue(v: unknown): string | null {
		if (typeof v === 'number') return numberFormat.format(v);
		if (typeof v === 'string' && v !== '') return v;
		return '0';
	}

	/**
	 * Recursively collect every text target of a scene's tree — top-level text, text
	 * nested in containers, and text inside `componentInstance` expansions (params
	 * threaded the SAME way the 2D canvas's `drawComponentInstance` threads them). The
	 * overlay owns ALL of it (the 2D `fillText` path is gone). `chain` is the ancestor
	 * path so far (root-first); `params` is the enclosing instance's resolved params
	 * (`instanceParams ?? componentParams`), so bound text/style/HUD captions resolve.
	 */
	function collectTextTargets(
		nodes: LayoutNode[],
		sc: Scene,
		out: TextTarget[],
		chain: LayoutNode[],
		params: Record<string, unknown>,
		depth: number,
		stack: string[],
	): void {
		for (const n of nodes) {
			if (!resolveTransform(n, layoutType).visible) continue;
			const nextChain = [...chain, n];
			if (n.kind === 'text') {
				out.push({
					key: chainKey(nextChain),
					id: n.id,
					node: n,
					scene: sc,
					chain: nextChain,
					text: boundTextValue(n, params),
					style: boundTextStyle(n, params),
				});
			} else if (n.kind === 'container' && n.bind && n.preview?.style === 'text') {
				out.push(
					hudAnchorTarget(
						n as Extract<LayoutNode, { kind: 'container' }> & {
							bind: NonNullable<LayoutNode['bind']>;
						},
						sc,
						nextChain,
						params,
					),
				);
				// A HUD bind anchor renders as its own leaf text — its (empty) children carry
				// no separate text, so don't recurse.
			} else if (n.kind === 'container') {
				collectTextTargets(n.children, sc, out, nextChain, params, depth, stack);
			} else if (n.kind === 'componentInstance') {
				const def = componentMap.get(n.componentId);
				if (!def || depth >= MAX_COMPONENT_DEPTH || stack.includes(def.id)) continue;
				// Resolve THIS instance's params (def defaults ◁ instance overrides) — the
				// scene editor threads no per-project defaults, matching `drawComponentInstance`.
				const instanceParams = resolveComponentParams(def, n.params, undefined);
				collectTextTargets(def.root.children, sc, out, nextChain, instanceParams, depth + 1, [
					...stack,
					def.id,
				]);
			}
		}
	}

	/** Every text target of every non-hidden, in-filter scene — top-level AND nested. */
	function textTargets(): TextTarget[] {
		const out: TextTarget[] = [];
		for (const sc of scenes) {
			if (hiddenSceneIds.has(sc.id)) continue;
			if (sceneFilter && !sceneFilter.has(sc.id)) continue;
			// Top-level params source: the Component Editor's open-component params (so a
			// HUD `preview.textParam` resolves there); empty in the scene editor — parity.
			collectTextTargets(sc.nodes, sc, out, [], componentParams ?? {}, 0, []);
		}
		return out;
	}

	function toColor(fill: number | undefined): ColorSource {
		return fill ?? 0xffffff;
	}

	/** Build (or reuse) a BitmapText for a target whose font is a loaded bitmap font.
	 * `key` is the unique render-position key (the object-map key), not the bare node id. */
	function buildBitmap(
		key: string,
		text: string,
		style: Partial<LayoutTextStyle> | undefined,
		font: EditorFont,
	): BitmapText {
		const existing = objects.get(key);
		const obj = existing instanceof BitmapText ? existing : new BitmapText({ text });
		obj.text = text;
		obj.style = {
			fontFamily: font.name,
			fontSize: style?.fontSize ?? 24,
			align: style?.align ?? 'left',
			letterSpacing: style?.letterSpacing ?? 0,
			// Colour the glyphs through `style.fill`, EXACTLY like the game's
			// `<BitmapText style={…} />`. A style object that omits `fill` makes PIXI
			// default it to BLACK, which multiplies the baked glyphs to black no matter
			// what `tint` is — that was the "all fonts render black" bug. `toColor` keeps
			// an unset fill white so the baked colour shows. No stroke/dropShadow on bitmap.
			fill: toColor(style?.fill),
		} as ConstructorParameters<typeof BitmapText>[0]['style'];
		// Leave the object tint neutral — the colour lives in `style.fill` (game parity),
		// not a separate multiply that would double-apply on a reused object.
		obj.tint = 0xffffff;
		return obj;
	}

	/** Build (or reuse) a regular Text for a web/system-font target. `key` is the unique
	 * render-position key (the object-map key), not the bare node id. */
	function buildText(key: string, text: string, style: Partial<TextStyle> | undefined): Text {
		const existing = objects.get(key);
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

	/** Destroy + drop the cached object for `key` (used on a Text↔BitmapText swap). */
	function dropObject(key: string): void {
		const existing = objects.get(key);
		if (!existing) return;
		existing.destroy();
		objects.delete(key);
	}

	/**
	 * Rebuild the overlay from the current targets — the SINGLE renderer for every
	 * `kind:'text'` node + HUD text anchor (top-level, nested, or inside a component
	 * instance). Each node's WORLD transform is composed from its ancestor chain the
	 * SAME way the 2D canvas's `ctx` stack does ({@link composeWorldMatrix}), then mapped
	 * to screen by the view matrix and applied via `setFromMatrix` + leaf `anchor` — so
	 * the text lands exactly where the canvas draws its sibling sprites, and matches the
	 * game runtime's container composition. A catalog bitmap/web font loads async; while
	 * loading the node renders IMMEDIATELY as a default `<Text>` (system fallback) and
	 * swaps to the real font on load — text never disappears. EVERY owned id is reported
	 * so the canvas's HUD chip / any 2D stand-in steps aside (no double-draw).
	 */
	function rebuild(): void {
		if (!ready || !app || !world) return;
		const targets = textTargets();
		const seen = new Set<string>();
		const owned = new Set<string>();
		// Editor view transform (world → screen): `[zoom, 0, 0, zoom, panX, panY]`, the
		// SAME mapping the 2D canvas applies (`translate(pan) · scale(zoom)`).
		const view: Affine = [zoom, 0, 0, zoom, panX, panY];

		for (const { key, id, node, scene, chain, text, style } of targets) {
			const font = findFont(
				{ prefix: '', fonts: [...byName.values()] } as FontCatalog,
				style?.fontFamily,
			);
			// A catalog font (bitmap OR web) needs an async load — kick it off, but DON'T
			// skip: render a default `<Text>` now (system fallback) so the node is never
			// blank, then this rebuild re-runs on load and swaps in the real font.
			const fontLoading = !!font && !loadedFonts.has(font.name);
			if (fontLoading && font) ensureFont(font);
			const useBitmap = !!font && !fontLoading && font.kind === 'bitmap';

			// Object kind must match (Text vs BitmapText) — drop a stale one on a swap.
			const existing = objects.get(key);
			if (useBitmap && !(existing instanceof BitmapText)) dropObject(key);
			else if (!useBitmap && existing instanceof BitmapText) dropObject(key);

			seen.add(key);
			const obj =
				useBitmap && font ? buildBitmap(key, text, style, font) : buildText(key, text, style);
			if (obj.parent !== world) world.addChild(obj);

			// WORLD matrix from the ancestor chain (top-level framed via the canvas's
			// `nodeTransform`; nested nodes pure-local) → screen via the view matrix. The
			// transform of each link is resolved by the SAME callbacks, so the leaf's anchor
			// + the chain's alpha come from one source.
			const topT = (top: LayoutNode) => worldTransformOf(top, scene);
			const childT = (child: LayoutNode) =>
				childLocalTransform(child, layoutType, scene.space, frameWidth, frameHeight);
			const worldMat = composeWorldMatrix(chain, topT, childT);
			const m = matMul(view, worldMat);
			// Leaf transform (framed when it IS the top-level node, else pure-local) for
			// the anchor; alpha multiplies down the whole chain like the canvas's globalAlpha.
			const leafT = chain.length === 1 ? topT(node) : childT(node);
			let alpha = 1;
			for (let i = 0; i < chain.length; i++) {
				const t = i === 0 ? topT(chain[i]) : childT(chain[i]);
				alpha *= t.alpha ?? 1;
			}
			obj.anchor.set(leafT.anchor?.x ?? 0, leafT.anchor?.y ?? 0);
			obj.setFromMatrix(new Matrix(m[0], m[1], m[2], m[3], m[4], m[5]));
			obj.alpha = alpha;
			obj.visible = true;
			objects.set(key, obj);
			// Report the BARE node id (not the unique key): the 2D canvas's HUD-chip
			// suppression checks `readyTextIds.has(node.id)` during instance expansion.
			owned.add(id);
		}

		// Drop pixi objects whose render position was removed / hidden / unowned this pass.
		for (const [key, obj] of objects) {
			if (seen.has(key)) continue;
			obj.destroy();
			objects.delete(key);
		}
		publishReady(owned);
	}

	// Rebuild whenever the inputs that affect layout/content change. Svelte tracks
	// the reads inside `textTargets()` (scenes/nodes) plus the view transform here.
	$effect(() => {
		void scenes;
		void hiddenSceneIds;
		void sceneFilter;
		void layoutType;
		void panX;
		void panY;
		void zoom;
		void componentParams;
		void componentMap;
		void frameWidth;
		void frameHeight;
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
		// Pixi's `resizeTo` only re-measures on WINDOW resize, so a side-panel drag (which
		// resizes our host element without a window resize) leaves the renderer at its old
		// logical size. Combined with the `width/height:100%` canvas below, the canvas then
		// stretches while the stage still maps to the stale size — text drifts/scales off the
		// 2D canvas. A ResizeObserver on the host re-syncs the renderer on every element resize.
		let ro: ResizeObserver | null = null;
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
				if (host) {
					ro = new ResizeObserver(() => {
						if (app) app.resize();
					});
					ro.observe(host);
				}
				void fetchFontCatalog().then((cat) => {
					byName = cat.byName;
					rebuild();
				});
			});
		return () => {
			disposed = true;
			ready = false;
			ro?.disconnect();
			ro = null;
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
