<script lang="ts" module>
	import type { Snippet } from 'svelte';

	import type { EffectNode, LayoutNode, Scene, TextStyle } from './types';

	export type Props = {
		node: LayoutNode;
		space?: Scene['space'];
		/** Per-rig bone hosting: `effect` nodes whose `hostSpineId` names THIS (spine) node — rendered
		 * INSIDE its `<SpineProvider>` so their bone layers ride this rig's bone. Paired by `LayoutScene`;
		 * only meaningful when this node is a spine. */
		attachedEffects?: EffectNode[];
	};
</script>

<script lang="ts">
	import {
		Container,
		EffectPlayer,
		Rectangle,
		RiggedEffect,
		Sprite,
		SpineBoneAttach,
		SpineProvider,
		SpineTrack,
		getContextApp,
	} from 'pixi-svelte';
	import { getContextLayout } from 'utils-layout';

	import CatalogText from './CatalogText.svelte';
	import TextBox from './TextBox.svelte';
	import { anchoredPosition, resolveTransform } from './resolveTransform';
	import { resolveLocalizedText } from './registerTextResolver';
	import { getBoundComponent } from './registerBoundComponents';
	import {
		backgroundCoverScale,
		backgroundCoverStretch,
		backgroundFit,
		coverTransform,
	} from './coverTransform';
	import { componentDesignSize } from './componentDesignSize';
	import { hostedComponentSpace } from './boundComponentCatalog';
	import { resolveComponent } from './registerComponents';
	import { resolveEffect } from './registerEffects';
	import { resolveRigFx } from './registerRigFx';
	import { getComponentParams } from './componentParamsContext';
	import { getComponentSignalAnims } from './componentSignalContext';
	import { getComponentStateAnims } from './componentStateAnimContext';
	import { getComponentSpineRest } from './componentSpineRestContext';
	import { getComponentFiredSignals } from './componentFiredSignalsContext';
	import { isNodeRevealed } from './signalGates';
	import { resolveBoundValue } from './componentParams';
	import { editorArtTextureKey, isManifestAssetKey, parseScopedFrameRef } from './editorArtKey';
	import ComponentInstance from './ComponentInstance.svelte';
	import ParamReadoutText from './ParamReadoutText.svelte';
	import Repeater from './Repeater.svelte';

	const { node, space, attachedEffects }: Props = $props();
	const layoutContext = getContextLayout();
	const appContext = getContextApp();

	// The hoisted tap-to-continue surface exposed by a `tapToContinue`-enabled
	// `componentInstance` child (see the componentInstance branch below). `undefined`
	// for every other node kind and every non-tap instance ⇒ nothing extra renders
	// (byte-identical parity).
	let instanceTap = $state<Snippet | undefined>(undefined);

	// Signal-driven spine-anim overrides (§8.5, spine-only). `undefined` when this
	// node has no `componentInstance` ancestor providing the context — a scene-level
	// spine then just uses its static `defaultAnimation` (byte-identical parity).
	const signalAnims = getComponentSignalAnims();
	// Button-state-driven spine-anim overrides — the interaction sibling of `signalAnims`.
	// `undefined` for a spine with no interactive `componentInstance` ancestor (parity).
	const stateAnims = getComponentStateAnims();
	// Per-instance RESTING spine overrides (default animation / loop / skin), keyed by
	// node id. `undefined` for a scene-level spine or a placement with no overrides — the
	// spine then uses its static def values (byte-identical parity).
	const spineRest = getComponentSpineRest();
	// Fired-signal bus of the owning `componentInstance` (Invisible Flow — intro-complete
	// sequencing). `undefined` for a top-level scene node with no instance ancestor ⇒ the reveal
	// gate below stays OPEN and a spine `completeSignal` fires nothing (byte-identical parity).
	const firedSignals = getComponentFiredSignals();
	// Reveal gate: a node with `hiddenUntilSignal` renders only once that component-scoped signal has
	// fired for the instance (e.g. show the free-spin amount + tap only AFTER a sibling spine's intro
	// completes). Reactive read of the instance's `counts` proxy, so it flips when the signal fires;
	// re-arms on a fresh mount (a new instance ⇒ empty counts). Unset ⇒ always revealed (parity).
	const revealed = $derived(
		!firedSignals || isNodeRevealed(node.hiddenUntilSignal, firedSignals.counts),
	);

	const transform = $derived(resolveTransform(node, layoutContext.stateLayoutDerived.layoutType()));

	const Bound = $derived(node.bind ? getBoundComponent(node.bind.component) : undefined);

	// Effective position — `screenAnchor` pins a `canvas`-space node to a window edge (x/y
	// then act as an offset from that edge); every other space uses x/y verbatim. Shared with
	// the editor via `anchoredPosition` so the two surfaces cannot disagree about where a node
	// sits — they did, and a `game`-space node carrying a `screenAnchor` silently rendered
	// off-screen in the game while the editor drew it in place.
	const canvas = $derived(layoutContext.stateLayoutDerived.canvasSizes());
	const pos = $derived(anchoredPosition(transform, space, canvas.width, canvas.height));
	const posX = $derived(pos.x);
	const posY = $derived(pos.y);

	// A componentInstance that HOSTS a board-relative overlay (the win / free-spin VISUALS,
	// catalog `space:'game'`) must be framed against the MAIN box even when the author drops it
	// on a `canvas`/`standard` screen — which provides NO game-space `<MainContainer>`. Without
	// this the game draws such an overlay at raw window pixels (smaller + offset to the upper-
	// left of the main-scaled board) while the Scene Editor previews it board-centred. We
	// re-apply the SAME main→window mapping `<MainContainer>` uses (and the editor mirrors via
	// `mainToWorld`/`mainScale`), so the overlay renders identically in both, in ANY screen
	// space. Gated to a non-`game`/non-`background` host scene (a `game` scene already frames
	// it; a `background` scene cover-fits) ⇒ every existing placement is byte-identical (parity).
	const hostedSpace = $derived(
		node.kind === 'componentInstance'
			? hostedComponentSpace(resolveComponent(node.componentId, node.componentVersion).def)
			: undefined,
	);
	const gameFrameOverlay = $derived(
		hostedSpace === 'game' && space !== 'game' && space !== 'background',
	);
	const gameFrame = $derived.by(() => {
		if (!gameFrameOverlay) return undefined;
		const ml = layoutContext.stateLayoutDerived.mainLayout();
		return {
			x: ml.x + ml.scale * (transform.x - ml.width / 2),
			y: ml.y + ml.scale * (transform.y - ml.height / 2),
			scale: {
				x: (transform.scale?.x ?? 1) * ml.scale,
				y: (transform.scale?.y ?? 1) * ml.scale,
			},
		};
	});

	// `background`-space sprites/spine cover- or contain-fit the canvas, driven by the
	// SAME canonical doc readers the editor preview uses (`backgroundCoverScale` =
	// `scale.x`, default 1 = exact cover; `backgroundFit` = `'cover'`/`'contain'`,
	// default `'cover'`) so editor == game for any authored scale/fit. Both the sprite
	// and spine paths now compute a TRUE cover (max/min(targetW/artW, targetH/artH))
	// from the art's natural dimensions via the shared `coverTransform` — exactly what
	// the editor preview does. The spine path expresses it through `<SpineProvider>`'s
	// `fit` (which `spineSizeScale` turns into the same uniform cover from
	// `skeleton.data` dims); the sprite path reads the loaded texture's natural size
	// and feeds the per-axis cover scale to the `<Sprite>`. A background skeleton is
	// authored around its own origin, matching apps/lines `Background.svelte`.
	const isBackground = $derived(space === 'background');
	// Per-node cover-fit opt-in (`node.coverFit`) for a sprite/spine in a normal
	// `canvas`-space (flow-gated) scene: it runs the SAME cover path as `background`
	// space (target = the canvas/window, same cover inputs) but the scene stays flow-
	// gated (NOT a persistent background). `isCover` is the unified trigger every cover
	// derived below reads, so a `background` scene AND every non-cover node are byte-
	// identical to before (parity). Scoped to sprite/spine — a `componentInstance` cover
	// stays `background`-only (see `bgComponent`), matching the editor toggle's scope.
	const isCanvasCoverFit = $derived(
		space === 'canvas' &&
			node.coverFit === true &&
			(node.kind === 'sprite' || node.kind === 'spine'),
	);
	const isCover = $derived(isBackground || isCanvasCoverFit);
	const bgCoverScale = $derived(backgroundCoverScale(node));
	const bgStretch = $derived(backgroundCoverStretch(node));
	const bgFit = $derived(backgroundFit(node));
	// A background SPRITE covers the canvas via a true `coverTransform` from the
	// loaded texture's NATURAL size (both axes) — never the old ratio-based
	// `normalBackgroundLayout`, which set only one axis and left a sprite's other axis
	// at natural pixels (PIXI's `width`/`height` setter only touches the matching
	// `scale` axis), visibly stretching whenever the configured `backgroundRatio` ≠ the
	// art's real aspect. The fitted cover lives entirely in `scale` (centred, origin
	// anchor 0.5), so `coverScale` zooms it and `stretchX/Y` stretch it — matching the
	// editor's 2D draw (`natural × scale`). Until the texture resolves, natural dims are
	// `0` and `coverTransform` falls back to a centred `coverScale × stretch`.
	const bgTexture = $derived.by(() => {
		if (!isCover || node.kind !== 'sprite') return undefined;
		const assets = appContext.stateApp.loadedAssets;
		const tex =
			(spriteKey ? assets?.[spriteKey] : undefined) ??
			(spriteFallbackKey ? assets?.[spriteFallbackKey] : undefined);
		return tex as unknown as { width?: number; height?: number } | undefined;
	});
	const bg = $derived.by(() => {
		if (!isCover || node.kind !== 'sprite') return undefined;
		const canvasBox = layoutContext.stateLayoutDerived.canvasSizes();
		const artWidth = bgTexture?.width && bgTexture.width > 0 ? bgTexture.width : 0;
		const artHeight = bgTexture?.height && bgTexture.height > 0 ? bgTexture.height : 0;
		const cover = coverTransform({
			artWidth,
			artHeight,
			targetWidth: canvasBox.width,
			targetHeight: canvasBox.height,
			coverScale: bgCoverScale,
			stretchX: bgStretch.x,
			stretchY: bgStretch.y,
			fit: bgFit,
		});
		return { x: cover.x, y: cover.y, scale: { x: cover.scaleX, y: cover.scaleY } };
	});

	// A sized sprite/spine (explicit width/height) carries BOTH `width` and `scale`,
	// but pixi-svelte's `propsSyncEffect` assigns props in object-key order and
	// PIXI's `width`/`height` setters overwrite `scale.x`/`scale.y` — so `width`
	// applied after `scale` silently clobbers any editor resize that wrote `scale`.
	// The editor previews the displayed size as `width * scale`, so fold `scale`
	// INTO the dimensions here and feed the sprite `scale = 1` (undefined), making
	// `width`/`height` the single authority — "what you size in the editor" then
	// equals "what the game shows". Falls through to plain `scale` when no explicit
	// dimension is set (texture-natural sizing).
	const sizeScaleX = $derived(transform.scale?.x ?? 1);
	const sizeScaleY = $derived(transform.scale?.y ?? 1);
	const hasExplicitSize = $derived(transform.width !== undefined || transform.height !== undefined);
	const sizedWidth = $derived(
		transform.width !== undefined ? transform.width * sizeScaleX : undefined,
	);
	const sizedHeight = $derived(
		transform.height !== undefined ? transform.height * sizeScaleY : undefined,
	);
	const sizedScale = $derived(hasExplicitSize ? undefined : transform.scale);

	// A background SPINE covers via pixi-svelte's `fit`: feed the full canvas box on
	// BOTH axes (× the cover multiplier) and the doc fit; `SpineProvider`/`spineSizeScale`
	// turn that into a UNIFORM cover/contain from `skeleton.data` dims — true cover —
	// equalling `coverTransform` so the editor preview and the game agree. The free
	// per-axis stretch rides on the `scale` prop, which `BaseSpineProvider` multiplies
	// onto the `fit` scale (`spine.scale.set(baseX * sizeScale.x, …)`), so default
	// stretch {1,1} is byte-identical to before.
	const bgSpineBox = $derived.by(() => {
		if (!isCover || node.kind !== 'spine') return undefined;
		const c = layoutContext.stateLayoutDerived.canvasSizes();
		return { width: c.width * bgCoverScale, height: c.height * bgCoverScale };
	});
	const bgSpineScale = $derived(bgSpineBox ? bgStretch : undefined);
	// A `coverFit` (canvas) spine CENTERS on the canvas — `SpineProvider` places the art
	// centre at (x, y), so the cover must sit at the canvas centre (the same point the
	// sprite cover's `coverTransform` returns), NOT the node's authored x/y. Without this a
	// spine placed anywhere in a flow screen would render its full-canvas fill offset by
	// that position (editor centres it via `backgroundTransform`, so the two would disagree).
	// Background spines are LEFT on `posX`/`posY` (their authored-at-centre convention) —
	// `isCanvasCoverFit` is false for them, so this is undefined and the path is byte-identical.
	const spineCoverCenter = $derived.by(() => {
		if (!isCanvasCoverFit || node.kind !== 'spine') return undefined;
		const c = layoutContext.stateLayoutDerived.canvasSizes();
		return { x: c.width / 2, y: c.height / 2 };
	});

	// A background COMPONENT INSTANCE covers the canvas as ONE composed unit: a
	// `componentInstance` placed in a `background`-space scene (e.g. a backdrop +
	// tumbleweed + windmill grouped in one prefab) cover-fits the window exactly like a
	// plain sprite/spine does, instead of rendering at its authored transform and
	// letterboxing. The component declares no design size, so we compute the union
	// bounding box of its `def.root` content (via the shared `componentDesignSize` — the
	// same union the editor previews), feed it to the SAME `coverTransform`, and place
	// the wrapping <Container> so that union's CENTRE lands on the canvas centre. The
	// component's children keep drawing at their authored LOCAL coords inside that
	// container. Sprite child sizes come from the loaded texture store (mirroring
	// `bgTexture`); a not-yet-loaded child is skipped (the box grows as assets resolve).
	// Gated on `isBackground && kind==='componentInstance'` AND a resolved box, so every
	// other placement (and every existing doc — none has a background instance) keeps its
	// authored transform byte-identically.
	const bgComponent = $derived.by(() => {
		if (!isBackground || node.kind !== 'componentInstance') return undefined;
		const def = resolveComponent(node.componentId, node.componentVersion).def;
		if (!def) return undefined;
		const assets = appContext.stateApp.loadedAssets;
		// Intrinsic size of a leaf child. Sprite: the loaded texture's natural size,
		// resolved by the SAME scoped→bare region/assetKey precedence a sprite node uses
		// (`parseScopedFrameRef` + editor-art namespacing). Spine: unmeasurable without a
		// live skeleton, so `null` (the union is driven by the dominant sprite art — the
		// full-bleed backdrop). Not-yet-loaded ⇒ `null` (skipped by the walk).
		const intrinsic = (n: LayoutNode): { w: number; h: number } | null => {
			if (n.kind !== 'sprite') return null;
			const scoped = parseScopedFrameRef(n.region);
			const region = scoped.region;
			const assetKey = scoped.assetKey ?? n.assetKey;
			const key =
				region && isManifestAssetKey(assetKey)
					? editorArtTextureKey(assetKey, region)
					: (region ?? assetKey);
			const fallback = region && isManifestAssetKey(assetKey) ? region : undefined;
			const tex = ((key ? assets?.[key] : undefined) ??
				(fallback ? assets?.[fallback] : undefined)) as
				| { width?: number; height?: number }
				| undefined;
			if (!tex || !(tex.width && tex.width > 0) || !(tex.height && tex.height > 0)) return null;
			return { w: tex.width, h: tex.height };
		};
		const box = componentDesignSize(
			def,
			intrinsic,
			layoutContext.stateLayoutDerived.layoutType(),
			undefined,
		);
		if (!box) return undefined;
		const canvasBox = layoutContext.stateLayoutDerived.canvasSizes();
		const cover = coverTransform({
			artWidth: box.width,
			artHeight: box.height,
			targetWidth: canvasBox.width,
			targetHeight: canvasBox.height,
			coverScale: bgCoverScale,
			stretchX: bgStretch.x,
			stretchY: bgStretch.y,
			fit: bgFit,
		});
		// `cover.x/y` is the canvas CENTRE; the container's children draw at local coords,
		// so offset the container so the union's local centre (`box.min + size/2`) maps
		// onto it: worldCentre = containerPos + unionLocalCentre * coverScale.
		return {
			x: cover.x - (box.minX + box.width / 2) * cover.scaleX,
			y: cover.y - (box.minY + box.height / 2) * cover.scaleY,
			scale: { x: cover.scaleX, y: cover.scaleY },
		};
	});

	// Param threading (§13.2 / Phase B1) — TEXT branch only. When this text node
	// renders inside a `componentInstance` expansion that provides params, a
	// `paramBindings` entry overrides the bound field with the resolved param
	// value; an unbound field keeps the node's own static value. Parity: at the top
	// level (no provider) `getComponentParams()` is `{}` and `node.paramBindings` is
	// typically absent, so every existing doc renders byte-identical to today.
	// Wrong-primitive bound values are ignored (prefer the static value over a crash).
	const componentParams = $derived(getComponentParams());

	// Phase B2 — VALUE feed. The bound `text` value may now be a NUMBER (the
	// `engineProvided` `value` param fed by `<ComponentInstance>`). A numeric bind
	// routes through `<ParamReadoutText>` (formatted + optional count-up); a STRING
	// bind passes through as in B1; an unbound text keeps `node.text`. `boundText`
	// is the raw resolved value; `numericValue` is set ONLY for the readout path, so
	// every non-numeric text node renders through the unchanged B1 `<Text>` below.
	const boundText = $derived(
		node.kind === 'text'
			? resolveBoundValue(node.paramBindings, 'text', componentParams)
			: undefined,
	);
	const numericValue = $derived(typeof boundText === 'number' ? boundText : undefined);
	// Localization (§18): the FINAL string — static `node.text` or a string param
	// bind — runs through the game-registered text resolver, so any text field may
	// be a localization key. Unknown keys / no resolver render the literal (parity).
	const resolvedText = $derived.by(() => {
		if (node.kind !== 'text') return undefined;
		const raw = typeof boundText === 'string' ? boundText : node.text;
		return resolveLocalizedText(raw);
	});
	// Author-set count-up flag (§13.2): read from the resolved params; absent ⇒ snap.
	// SUPPRESSED when the bound source is SELF-ANIMATED (`valueSelfAnimated`, forwarded by
	// `<ComponentInstance>` for a live count-up tween like `winCountUpAmount` /
	// `freeSpinOutroTotalWin`): the readout then snaps to the live value each frame instead of
	// running a SECOND, lagging tween on top — so the count-up still looks smooth (the source
	// animates it) AND a tap-to-skip / round-slam that snaps the source shows the final total
	// instantly. A plain source ⇒ `countUp` behaves exactly as before (parity).
	const countUp = $derived(
		componentParams['countUp'] === true && componentParams['valueSelfAnimated'] !== true,
	);
	// Numeric readout format: the value SOURCE's own formatter when the game
	// registered one (forwarded by `<ComponentInstance>` as `valueFormat` — e.g.
	// currency for balance/bet/win), so a plain `text` node bound to `value` renders
	// like the coded readout. Falls back to a thousands-grouped integer when no
	// source formatter is present (parity). Cached formatter instance.
	const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
	const formatValue = (value: number) => {
		const fmt = componentParams['valueFormat'];
		return typeof fmt === 'function'
			? (fmt as (v: number) => string)(value)
			: numberFormat.format(value);
	};
	const resolvedStyle = $derived.by(() => {
		if (node.kind !== 'text') return undefined;
		const fontFamily = resolveBoundValue(node.paramBindings, 'style.fontFamily', componentParams);
		const fontSize = resolveBoundValue(node.paramBindings, 'style.fontSize', componentParams);
		const fill = resolveBoundValue(node.paramBindings, 'style.fill', componentParams);
		const align = resolveBoundValue(node.paramBindings, 'style.align', componentParams);
		const verticalAlign = resolveBoundValue(node.paramBindings, 'style.verticalAlign', componentParams);
		const overrides: Partial<TextStyle> = {};
		if (typeof fontFamily === 'string') overrides.fontFamily = fontFamily;
		if (typeof fontSize === 'number') overrides.fontSize = fontSize;
		if (typeof fill === 'number') overrides.fill = fill;
		if (typeof align === 'string') overrides.align = align as TextStyle['align'];
		if (typeof verticalAlign === 'string')
			overrides.verticalAlign = verticalAlign as TextStyle['verticalAlign'];
		// ALWAYS spread `node.style` (never return it by reference): the editor mutates
		// style fields in place (`node.style.fontFamily = …`), and pixi's `<Text>` only
		// re-syncs its `style` when the OBJECT REFERENCE changes (`propsSyncEffect` reads
		// `props.style`, not its fields). Returning the same `node.style` reference meant a
		// font/size/colour edit never reached PixiJS. The spread yields a fresh object on
		// each style change AND deep-reads every field, so the `$derived` also re-runs on an
		// in-place edit. `node.style` undefined ⇒ `{}` (default style — visually parity).
		return { ...node.style, ...overrides };
	});
	// Text-box dims (§text-box model): a text node's box `width`/`height`/`autoFit` may come
	// from param bindings (the parametric Text Box binds them to per-instance params) OR the
	// node's own transform. A numeric readout and a plain text node both read these, so the
	// box reaches the count-up path too. Unbound + unset ⇒ undefined ⇒ auto-size (parity).
	const boundBoxWidth = $derived(
		node.kind === 'text'
			? resolveBoundValue(node.paramBindings, 'width', componentParams)
			: undefined,
	);
	const boundBoxHeight = $derived(
		node.kind === 'text'
			? resolveBoundValue(node.paramBindings, 'height', componentParams)
			: undefined,
	);
	const boundAutoFit = $derived(
		node.kind === 'text'
			? resolveBoundValue(node.paramBindings, 'autoFit', componentParams)
			: undefined,
	);
	const textBoxWidth = $derived(
		typeof boundBoxWidth === 'number' ? boundBoxWidth : transform.width,
	);
	const textBoxHeight = $derived(
		typeof boundBoxHeight === 'number' ? boundBoxHeight : transform.height,
	);
	const textAutoFit = $derived(
		typeof boundAutoFit === 'boolean'
			? boundAutoFit
			: node.kind === 'text' && node.autoFit === true,
	);
	const textHasBox = $derived(typeof textBoxWidth === 'number' && textBoxWidth > 0);
	// Sprite param bindings (§13.2): a `componentInstance` may drive a sprite's
	// texture (`region`/`assetKey`) + `tint` from params, so ONE prefab renders a
	// different icon / colour per instance. Unbound sprites (and any sprite outside a
	// component instance) keep their static values — byte-identical parity.
	const boundRegion = $derived(
		node.kind === 'sprite'
			? resolveBoundValue(node.paramBindings, 'region', componentParams)
			: undefined,
	);
	const boundAssetKey = $derived(
		node.kind === 'sprite'
			? resolveBoundValue(node.paramBindings, 'assetKey', componentParams)
			: undefined,
	);
	const boundTint = $derived(
		node.kind === 'sprite'
			? resolveBoundValue(node.paramBindings, 'tint', componentParams)
			: undefined,
	);
	// Spine param binding (§13.2, the spine analogue of the sprite `assetKey` bind): a
	// `componentInstance` may drive a spine's SOURCE bundle from a `spine`-kind param, so
	// one prefab renders a different rig per instance (e.g. a button whose spine background
	// is swapped per placement). The instance's spine picker stores the bundle NAME (its
	// last path segment), which `SpineProvider` resolves the same as a bundle key (games
	// register a spine under that plain name). An unbound spine, an outside-instance spine,
	// or an unset param (empty) all fall back to the node's static `assetKey` — parity.
	const boundSpineAssetKey = $derived(
		node.kind === 'spine'
			? resolveBoundValue(node.paramBindings, 'assetKey', componentParams)
			: undefined,
	);
	const spineAssetKey = $derived(
		typeof boundSpineAssetKey === 'string' && boundSpineAssetKey
			? boundSpineAssetKey
			: node.kind === 'spine'
				? node.assetKey
				: undefined,
	);
	// A sprite resolves its texture by `region` (a frame in a loaded sheet) or, when
	// region-less (a standalone image), by `assetKey`. Editor-art frames are ALSO
	// registered scoped by their manifest (`<assetKey>::<region>`), so a node bound
	// to one sheet can't pick up an identically-named frame from another. We look up
	// the scoped key first and fall back to the bare region (parity for game-bundled
	// sheets + any registration predating the namespacing).
	const spriteRef = $derived.by(() => {
		if (node.kind !== 'sprite') return undefined;
		const rawRegion = typeof boundRegion === 'string' ? boundRegion : node.region;
		const rawAssetKey = typeof boundAssetKey === 'string' ? boundAssetKey : node.assetKey;
		// An atlas-scoped image-param value (`<assetKey>::<region>`, from the region
		// picker) pins the atlas, so a region name packed by several atlases resolves to
		// the picked one instead of whichever sheet loaded last. A legacy bare name keeps
		// `assetKey` from the node (parity).
		const scoped = parseScopedFrameRef(rawRegion);
		const region = scoped.region;
		const assetKey = scoped.assetKey ?? rawAssetKey;
		if (region && isManifestAssetKey(assetKey)) {
			return { key: editorArtTextureKey(assetKey, region), fallbackKey: region };
		}
		return { key: region ?? assetKey, fallbackKey: undefined };
	});
	const spriteKey = $derived(spriteRef?.key);
	const spriteFallbackKey = $derived(spriteRef?.fallbackKey);
	const spriteTint = $derived(typeof boundTint === 'number' ? boundTint : transform.tint);

	// A `rect` is a vector flat fill (pixi `Graphics` rect) — it scales losslessly,
	// so a full-screen dim sized large stays crisp. Its size is the node's own
	// `width`/`height` (an editor resize writes a per-layoutType override that
	// `resolveTransform` surfaces as `transform.width`/`height`, taking precedence).
	// As with the sprite path, `scale` is folded INTO the dimensions so "what you
	// size in the editor" equals "what the game shows" — the displayed size is
	// `width * scale` — and the `<Rectangle>` runs at scale 1. Default anchor `{0,0}`
	// (top-left) matches the sprite branch: a rect at `(0,0)` fills from the canvas
	// origin; a centred full-screen dim simply sets anchor `{0.5,0.5}`.
	const rectWidth = $derived(
		node.kind === 'rect' ? (transform.width ?? node.width) * sizeScaleX : 0,
	);
	const rectHeight = $derived(
		node.kind === 'rect' ? (transform.height ?? node.height) * sizeScaleY : 0,
	);
	const rectColor = $derived(node.kind === 'rect' ? (node.color ?? 0xffffff) : 0xffffff);
</script>

{#if transform.visible && revealed}
	{#if Bound}
		<!--
			Bound-component contract (read before migrating a coded component to a
			`bind` node — see docs/design/invisible-editor.md §7.1):
			this wrapping <Container> already applies POSITION x/y + scale/rotation/
			alpha/zIndex. The bound component is therefore mounted at the node's
			placement and MUST render its art at LOCAL origin — do NOT re-apply
			transform.x/y (that double-positions it). It SHOULD read transform.anchor
			+ transform.width/height for its own sprite/spine (Containers carry no
			anchor/size), and leave scale at 1 (the container scales). With the
			generator's transform == the component's current placement, a no-doc boot
			renders byte-for-byte as before.

			`cover` is the doc-driven background cover intent (§10.3 step 5): a
			`background`-space bind anchor (the full-bleed Background) receives the
			canonical cover `scale` + `fit` so the coded component sizes its spine to
			the canvas via pixi-svelte's `fit` instead of hardcoding a scale. Purely
			additive — a bound component that ignores `cover` renders exactly as today
			(parity). The cover scale is applied OUTSIDE this container (against the
			canvas), so the container's own `transform.scale` stays the placement scale.
		-->
		<Container
			x={posX}
			y={posY}
			scale={transform.scale}
			rotation={transform.rotation}
			alpha={transform.alpha}
			zIndex={transform.zIndex}
		>
			{#if isBackground}
				<Bound
					{transform}
					cover={{ scale: bgCoverScale, fit: bgFit, stretch: bgStretch }}
					{...node.bind?.props ?? {}}
				/>
			{:else}
				<Bound {transform} {...node.bind?.props ?? {}} />
			{/if}
		</Container>
	{:else if node.kind === 'container'}
		<Container
			x={posX}
			y={posY}
			scale={transform.scale}
			rotation={transform.rotation}
			alpha={transform.alpha}
			zIndex={transform.zIndex}
		>
			{#each node.children as child (child.id)}
				<svelte:self node={child} {space} />
			{/each}
		</Container>
	{:else if node.kind === 'componentInstance'}
		<!--
			Component-instance placement (§8.6): this wrapping <Container> applies the
			instance node's transform; <ComponentInstance> resolves the ComponentDef and
			renders `def.root` through this same node-walk (so a component composes
			identically to an inlined container). Static only in v1 — params/signals are
			ignored (see ComponentInstance.svelte).

			In a `background`-space scene the instance cover-fits the window as ONE unit:
			`bgComponent` synthesises a centred cover transform (position + per-axis cover
			scale) from the component's computed design box, replacing the authored x/y/
			scale — mirroring the sprite/spine `bg` path. Outside background space, or until
			the design box resolves, `bgComponent` is undefined ⇒ the authored transform is
			used verbatim (byte-identical parity).
		-->
		<Container
			x={gameFrame ? gameFrame.x : bgComponent ? bgComponent.x : posX}
			y={gameFrame ? gameFrame.y : bgComponent ? bgComponent.y : posY}
			scale={gameFrame ? gameFrame.scale : bgComponent ? bgComponent.scale : transform.scale}
			rotation={transform.rotation}
			alpha={transform.alpha}
			zIndex={transform.zIndex}
		>
			<ComponentInstance {node} {space} bind:tap={instanceTap} />
		</Container>
		<!--
			Tap-to-continue hoist (Invisible Flow §6.2): a `tapToContinue`-enabled overlay
			instance exposes its full-CANVAS tap surface (dim + full-screen hit area + prompt)
			via `bind:tap`; we render it HERE, as a SIBLING of the transform wrapper above, so
			it covers the real canvas regardless of the instance's per-layoutType placement/
			scale (the portrait offset+scale used to push the "full-screen" hit rectangle off
			the visible canvas and double-scale the prompt). This mirrors the engine-owned
			free-spin gate, which is a scene-root canvas bind — never positioned. OFF ⇒
			`instanceTap` stays undefined ⇒ nothing renders here (byte-identical parity).
		-->
		{#if instanceTap}
			{@render instanceTap()}
		{/if}
	{:else if node.kind === 'repeater'}
		<!--
			Data-driven repeater (§ feature cards): this wrapping <Container> applies the repeater
			node's own transform (position the WHOLE list), then <Repeater> resolves the live
			`source` array and renders one <ComponentInstance> per item, each offset by the layout
			rule inside its own container. The editor can't run the live source, so it draws a
			placeholder; the game mounts the real per-item instances. No registered source ⇒
			nothing renders (parity).
		-->
		<Container
			x={posX}
			y={posY}
			scale={transform.scale}
			rotation={transform.rotation}
			alpha={transform.alpha}
			zIndex={transform.zIndex}
		>
			<Repeater {node} {space} />
		</Container>
	{:else if node.kind === 'sprite'}
		<Sprite
			key={spriteKey}
			fallbackKey={spriteFallbackKey}
			x={bg ? bg.x : posX}
			y={bg ? bg.y : posY}
			anchor={bg ? { x: 0.5, y: 0.5 } : transform.anchor}
			scale={bg ? bg.scale : sizedScale}
			rotation={transform.rotation}
			alpha={transform.alpha}
			zIndex={transform.zIndex}
			width={bg ? undefined : sizedWidth}
			height={bg ? undefined : sizedHeight}
			tint={spriteTint}
		/>
	{:else if node.kind === 'rect'}
		<!--
			Flat filled rectangle (§ rect node): a vector `<Rectangle>` (pixi `Graphics`
			rect) — the basic fill primitive for full-screen dims, panels and colour
			blocks. Vector, so it scales losslessly. `width`/`height` come from the node
			(scale folded in above); `color` → `backgroundColor` (default `0xffffff`);
			opacity is the standard `transform.alpha`. Default anchor `{0.5,0.5}` (centred —
			matching the editor's 2D draw, hit-test and spawn, so an anchor-less rect lands
			identically in editor + game); set `{0,0}` to pin from the top-left.
		-->
		<Rectangle
			x={posX}
			y={posY}
			anchor={transform.anchor ?? { x: 0.5, y: 0.5 }}
			width={rectWidth}
			height={rectHeight}
			backgroundColor={rectColor}
			rotation={transform.rotation}
			alpha={transform.alpha}
			zIndex={transform.zIndex}
		/>
	{:else if node.kind === 'spine'}
		{@const stateAnim = stateAnims?.[node.id]}
		{@const sigAnim = signalAnims?.[node.id]}
		{@const override = stateAnim ?? sigAnim}
		<!--
			Per-instance RESTING overrides: a placement may swap this spine's resting
			animation / loop / skin (its at-rest look) without touching the def. Each
			falls back to the def node's value, so an un-overridden spine is parity.
		-->
		{@const rest = spineRest?.[node.id]}
		{@const effDefaultAnimation = rest?.defaultAnimation ?? node.defaultAnimation}
		{@const effLoop = rest?.loop ?? node.loop}
		{@const effSkin = rest?.skin ?? node.skin}
		<!--
			State-overlay spine: a spine that declares button `stateAnimations` but NO resting
			`defaultAnimation` is meant to appear ONLY while a state is active (e.g. an image
			button that turns into a spine during the spin). Hide it until an override (a state
			animation or a signal cue) gives it something to play; otherwise it would sit on its
			static bind pose over the button. A spine with a `defaultAnimation`, or one without
			`stateAnimations` at all (every spine before this feature), is always visible — parity.
		-->
		{@const isStateOverlay =
			!effDefaultAnimation &&
			!!node.stateAnimations &&
			Object.keys(node.stateAnimations).length > 0}
		{@const spineVisible = !isStateOverlay || !!override}
		<!--
			Anchor / placement parity with the editor: the editor preview places a spine's
			SKELETON ORIGIN at the node position (anchor only frames the selection box, never
			shifts the art — see `matFromTransform` "Anchor is NOT folded in here" + the spine
			overlay's `skeleton.x = world.x`). `SpineProvider`'s `anchorToPivot` instead pivots
			the art by `anchor·size` (assuming top-left-origin art), which offsets an
			origin-centred skeleton in-game vs the editor. So for a NON-background spine we pass
			NO anchor → pivot 0 → origin at the node position, matching the editor exactly.
			Background spines keep `transform.anchor` (their cover path centres via `coverTransform`
			and is untouched). Default-anchor (0) spines already resolved to pivot 0, so they're
			byte-identical; only the previously-offset non-zero-anchor case moves into parity.
		-->
		<SpineProvider
			key={spineAssetKey ?? node.assetKey}
			x={bg ? bg.x : spineCoverCenter ? spineCoverCenter.x : posX}
			y={bg ? bg.y : spineCoverCenter ? spineCoverCenter.y : posY}
			anchor={isCover ? transform.anchor : undefined}
			scale={bgSpineBox ? bgSpineScale : sizedScale}
			rotation={transform.rotation}
			alpha={transform.alpha}
			zIndex={transform.zIndex}
			width={bgSpineBox ? bgSpineBox.width : sizedWidth}
			height={bgSpineBox ? bgSpineBox.height : sizedHeight}
			fit={bgSpineBox ? bgFit : undefined}
			skin={effSkin}
			visible={spineVisible}
			rebroadcastEvents
		>
			<!--
				A button-STATE animation (hover/press/…) wins over a signal cue, which wins
				over the resting `defaultAnimation` — so a spine button reacts to its state
				immediately and returns to rest when the state clears.

				One-shot → idle hand-off (signal cues only): when a signal cue is active (e.g.
				`enter` → `intro`) AND the node has a different `defaultAnimation` (the resting
				`idle`), play the cue animation ONCE then settle into the looping default — the
				free-spin-intro pattern (intro plays, idle loops, the gate holds the screen until
				the tap). A state animation loops/holds while its state is active instead, so the
				hand-off is suppressed while one is in effect. With no override, or no distinct
				default, this is the prior single-animation behaviour.
			-->
			{@const anim = override?.animation ?? effDefaultAnimation}
			{@const handsOffToIdle = !!(
				!stateAnim &&
				sigAnim &&
				effDefaultAnimation &&
				effDefaultAnimation !== sigAnim.animation
			)}
			<!--
				A signal cue is an EVENT: firing it again asks for a REPLAY, even though the animation
				name is unchanged. Hand its fire token to the track so the repeat is distinguishable
				from a re-render — without it the second fire compares equal, the track is left as-is,
				and a finished one-shot rig sits frozen on its last frame for the rest of the session.
				Only while the cue is the ACTIVE override: a button state animation drives the track
				declaratively and must keep the plain value comparison.
			-->
			{@const replay = stateAnim ? undefined : sigAnim?.fire}
			{#if anim}
				<!--
					Completion signal (Invisible Flow — intro-complete sequencing): when the ACTIVE signal
					cue names a `completeSignal`, fire it on the instance's fired-signal bus the moment this
					one-shot finishes — so sibling nodes gated by `hiddenUntilSignal` reveal + a tap arms.
					Only for a signal cue (`sigAnim`), never a button-state animation; only when the owning
					instance provides the bus. Absent ⇒ no listener (parity).
				-->
				{@const completeSignal = stateAnim ? undefined : sigAnim?.completeSignal}
				<SpineTrack
					trackIndex={0}
					animationName={anim}
					loop={handsOffToIdle ? false : (override?.loop ?? effLoop ?? true)}
					then={handsOffToIdle ? effDefaultAnimation : undefined}
					thenLoop={effLoop ?? true}
					{replay}
					oncomplete={completeSignal && firedSignals
						? () => firedSignals.fire(completeSignal)
						: undefined}
				/>
			{/if}
			<!--
				Per-rig bone hosting: effects that attach to THIS rig (`EffectNode.hostSpineId`, paired by
				`LayoutScene`) mount their `<EffectPlayer>` DIRECTLY inside this `<SpineProvider>` — no extra
				transform, so a bone layer resolves this rig's bone (`SpineBoneAttach` → `getContextSpine`)
				and the rig's timeline events (rebroadcast) fire it. The effect rides the rig; its own node
				transform is intentionally not applied here.
			-->
			{#each attachedEffects ?? [] as fx (fx.id)}
				{@const fxDoc = resolveEffect(fx.effectId)}
				{#if fxDoc}
					<EffectPlayer doc={fxDoc} />
				{/if}
			{/each}
			<!--
				Reveal-symbol rider: ride the chosen `stateGame.specialSymbol` on a named bone of THIS
				rig (`SpineNode.revealSymbolBone`) — the on-node alternative to the rig-spawning
				`freeSpinIntroSymbolReveal` component. Same bone-hosting mechanism as `attachedEffects`
				above: mount the game's registered `revealSymbolRider` on the bone via `<SpineBoneAttach>`
				so the symbol banks/scales with the rig. Unset bone, or a game that didn't register the
				rider ⇒ nothing mounts (parity).
			-->
			{#if node.revealSymbolBone}
				{@const RevealRider = getBoundComponent('revealSymbolRider')}
				{#if RevealRider}
					<SpineBoneAttach
						boneName={node.revealSymbolBone}
						offset={{ x: node.revealSymbolOffsetX ?? 0, y: node.revealSymbolOffsetY ?? 0 }}
						followRotation={node.revealSymbolFollowRotation ?? true}
						followScale={node.revealSymbolFollowScale ?? true}
					>
						<RevealRider
							state={node.revealSymbolState ?? 'bookIdle'}
							scale={node.revealSymbolScale ?? 1}
						/>
					</SpineBoneAttach>
				{/if}
			{/if}
			<!--
				Rig-timeline direct FX binding: effects the Rigger bound DIRECTLY on this rig's
				animation event keys (`event.fx`, baked into the `rigFx` manifest, keyed by this rig's
				assetKey). Each plays a chosen effect on the beat of the rig's OWN event — no Scene-Editor
				placement, no cue-string matching. Empty for a rig with no bindings (parity — nothing mounts).
			-->
			{@const rigBinds = resolveRigFx(spineAssetKey ?? node.assetKey)}
			{#each rigBinds as b (b.event + ':' + b.effectId + ':' + (b.bone ?? ''))}
				{@const d = resolveEffect(b.effectId)}
				{#if d}
					<RiggedEffect doc={d} event={b.event} bone={b.bone} />
				{/if}
			{/each}
		</SpineProvider>
	{:else if node.kind === 'text'}
		{#if numericValue !== undefined}
			<!--
				B2 numeric readout: this text node is bound to a numeric `value` param
				fed by `<ComponentInstance>`. `<ParamReadoutText>` formats it (and counts
				up when `params.countUp` is set). Every other text node falls through to
				the unchanged B1 `<Text>` below — parity.
			-->
			<ParamReadoutText
				target={numericValue}
				x={posX}
				y={posY}
				anchor={transform.anchor}
				scale={transform.scale}
				rotation={transform.rotation}
				alpha={transform.alpha}
				zIndex={transform.zIndex}
				style={resolvedStyle}
				{countUp}
				format={formatValue}
				boxWidth={textHasBox ? textBoxWidth : undefined}
				boxHeight={textBoxHeight}
				autoFit={textAutoFit}
			/>
		{:else if textHasBox}
			<!--
				Text BOX (explicit `width`, from the node or a bound `boxWidth` param): the
				glyphs lay out INSIDE the box — aligned horizontally across `width` (`style.align`)
				and vertically across `height` (`style.verticalAlign`), auto-shrinking the font
				when `autoFit`. `<TextBox>` owns the box math + measurement; it still renders
				through `<CatalogText>`, so the bitmap-vs-system-font decision is unchanged. A
				box-less text node falls to the plain `<CatalogText>` below (byte-identical parity).
			-->
			<TextBox
				text={resolvedText ?? ''}
				style={resolvedStyle}
				boxWidth={textBoxWidth ?? 0}
				boxHeight={textBoxHeight}
				autoFit={textAutoFit}
				x={posX}
				y={posY}
				anchor={transform.anchor}
				scale={transform.scale}
				rotation={transform.rotation}
				alpha={transform.alpha}
				zIndex={transform.zIndex}
			/>
		{:else}
			<!--
				§9.4 non-numeric text: `<CatalogText>` renders `<BitmapText>` (pixi's
				BitmapFont blitter) when `resolvedStyle.fontFamily` names a bitmap family in
				the boot-registered catalog, else the system-font `<Text>` (parity). The
				SAME bitmap-vs-system decision every coded text part shares, kept in ONE
				place so the HUD/button parts and layout text nodes can never drift.
			-->
			<CatalogText
				text={resolvedText}
				x={posX}
				y={posY}
				anchor={transform.anchor}
				scale={transform.scale}
				rotation={transform.rotation}
				alpha={transform.alpha}
				zIndex={transform.zIndex}
				style={resolvedStyle}
			/>
		{/if}
	{:else if node.kind === 'effect'}
		<!--
			Placed Invisible FX effect: mount an <EffectPlayer> for the resolved doc inside this
			node's transform <Container> (the SAME wrapper container/componentInstance use), so the
			effect plays at the placed position; each layer's own `placement.offset` composes on top.
			The doc resolves from the boot-registered effects (`registerEffects` ← `bakedEffects()`);
			a dangling / un-baked id ⇒ undefined ⇒ nothing mounts (never crashes). A `bone`-placed
			layer has no host <SpineProvider> here, so it falls back to origin+offset (v1: scene-placed
			effects are for FREE layers; bone effects mount on their host rig via Effects.svelte).
		-->
		{@const effectDoc = resolveEffect(node.effectId)}
		{#if effectDoc}
			<Container
				x={posX}
				y={posY}
				scale={transform.scale}
				rotation={transform.rotation}
				alpha={transform.alpha}
				zIndex={transform.zIndex}
			>
				<EffectPlayer doc={effectDoc} />
			</Container>
		{/if}
	{/if}
{/if}
