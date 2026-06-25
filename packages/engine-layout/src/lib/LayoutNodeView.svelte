<script lang="ts" module>
	import type { LayoutNode, Scene, TextStyle } from './types';

	export type Props = { node: LayoutNode; space?: Scene['space'] };
</script>

<script lang="ts">
	import {
		BitmapText,
		Container,
		Rectangle,
		Sprite,
		SpineProvider,
		SpineTrack,
		Text,
		getContextApp,
	} from 'pixi-svelte';
	import { getContextLayout } from 'utils-layout';

	import { isBitmapFont } from './fontCatalog';
	import { getFontCatalog } from './registerFontCatalog';
	import { resolveTransform } from './resolveTransform';
	import { resolveLocalizedText } from './registerTextResolver';
	import { getBoundComponent } from './registerBoundComponents';
	import {
		backgroundCoverScale,
		backgroundCoverStretch,
		backgroundFit,
		coverTransform,
	} from './coverTransform';
	import { getComponentParams } from './componentParamsContext';
	import { getComponentSignalAnims } from './componentSignalContext';
	import { getComponentStateAnims } from './componentStateAnimContext';
	import { resolveBoundValue } from './componentParams';
	import { editorArtTextureKey, isManifestAssetKey, parseScopedFrameRef } from './editorArtKey';
	import ComponentInstance from './ComponentInstance.svelte';
	import ParamReadoutText from './ParamReadoutText.svelte';

	const { node, space }: Props = $props();
	const layoutContext = getContextLayout();
	const appContext = getContextApp();

	// Signal-driven spine-anim overrides (§8.5, spine-only). `undefined` when this
	// node has no `componentInstance` ancestor providing the context — a scene-level
	// spine then just uses its static `defaultAnimation` (byte-identical parity).
	const signalAnims = getComponentSignalAnims();
	// Button-state-driven spine-anim overrides — the interaction sibling of `signalAnims`.
	// `undefined` for a spine with no interactive `componentInstance` ancestor (parity).
	const stateAnims = getComponentStateAnims();

	const transform = $derived(resolveTransform(node, layoutContext.stateLayoutDerived.layoutType()));

	const Bound = $derived(node.bind ? getBoundComponent(node.bind.component) : undefined);

	// `canvas`-space nodes pin to a window edge: effective position is
	// `screenAnchor * canvasSize + (x, y)` (x/y act as an offset from that edge).
	// Absent screenAnchor → x/y are used verbatim (game/standard scenes).
	const canvas = $derived(layoutContext.stateLayoutDerived.canvasSizes());
	const posX = $derived(
		transform.screenAnchor ? transform.screenAnchor.x * canvas.width + transform.x : transform.x,
	);
	const posY = $derived(
		transform.screenAnchor ? transform.screenAnchor.y * canvas.height + transform.y : transform.y,
	);

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
		if (!isBackground || node.kind !== 'sprite') return undefined;
		const assets = appContext.stateApp.loadedAssets;
		const tex =
			(spriteKey ? assets?.[spriteKey] : undefined) ??
			(spriteFallbackKey ? assets?.[spriteFallbackKey] : undefined);
		return tex as unknown as { width?: number; height?: number } | undefined;
	});
	const bg = $derived.by(() => {
		if (!isBackground || node.kind !== 'sprite') return undefined;
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
		if (!isBackground) return undefined;
		const c = layoutContext.stateLayoutDerived.canvasSizes();
		return { width: c.width * bgCoverScale, height: c.height * bgCoverScale };
	});
	const bgSpineScale = $derived(isBackground ? bgStretch : undefined);

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
	const countUp = $derived(componentParams['countUp'] === true);
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
		const overrides: Partial<TextStyle> = {};
		if (typeof fontFamily === 'string') overrides.fontFamily = fontFamily;
		if (typeof fontSize === 'number') overrides.fontSize = fontSize;
		if (typeof fill === 'number') overrides.fill = fill;
		return Object.keys(overrides).length > 0 ? { ...node.style, ...overrides } : node.style;
	});
	// §9.4 bitmap vs system font: when the boot-registered catalog (the runtime
	// sibling of the editor's `/api/editor/fonts`) marks `resolvedStyle.fontFamily`
	// as a bitmap font, the plain text path renders `<BitmapText>` (pixi's BitmapFont
	// blitter) instead of `<Text>`. No catalog, or a family that isn't a bitmap
	// entry, ⇒ `false` ⇒ `<Text>` exactly as before (parity). The catalog is set
	// once at boot (like `getComponent`), so reading it here is a plain read.
	const isBitmap = $derived(isBitmapFont(getFontCatalog(), resolvedStyle?.fontFamily));

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

{#if transform.visible}
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
		-->
		<Container
			x={posX}
			y={posY}
			scale={transform.scale}
			rotation={transform.rotation}
			alpha={transform.alpha}
			zIndex={transform.zIndex}
		>
			<ComponentInstance {node} {space} />
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
		<SpineProvider
			key={node.assetKey}
			x={bg ? bg.x : posX}
			y={bg ? bg.y : posY}
			anchor={transform.anchor}
			scale={bgSpineBox ? bgSpineScale : sizedScale}
			rotation={transform.rotation}
			alpha={transform.alpha}
			zIndex={transform.zIndex}
			width={bgSpineBox ? bgSpineBox.width : sizedWidth}
			height={bgSpineBox ? bgSpineBox.height : sizedHeight}
			fit={bgSpineBox ? bgFit : undefined}
			skin={node.skin}
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
			{@const anim = override?.animation ?? node.defaultAnimation}
			{@const handsOffToIdle = !!(
				!stateAnim &&
				sigAnim &&
				node.defaultAnimation &&
				node.defaultAnimation !== sigAnim.animation
			)}
			{#if anim}
				<SpineTrack
					trackIndex={0}
					animationName={anim}
					loop={handsOffToIdle ? false : (override?.loop ?? node.loop ?? true)}
					then={handsOffToIdle ? node.defaultAnimation : undefined}
					thenLoop={node.loop ?? true}
				/>
			{/if}
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
			/>
		{:else if isBitmap && resolvedText !== undefined}
			<!--
				§9.4 bitmap text: `resolvedStyle.fontFamily` names a bitmap font in the
				boot-registered catalog, so render through pixi's BitmapFont blitter with
				the SAME positional props the `<Text>` path gets. (A bitmap-font numeric
				readout is a later follow-on — the numeric `<ParamReadoutText>` path above
				is unchanged.)
			-->
			<BitmapText
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
		{:else}
			<Text
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
	{/if}
{/if}
