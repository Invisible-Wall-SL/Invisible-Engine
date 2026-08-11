import { innerWidth, innerHeight } from 'svelte/reactivity/window';
import {
	DEFAULT_LAYOUT_PROFILE,
	resolveBucketBox,
	selectBucket,
	type LayoutProfile,
} from 'constants-shared/layoutProfile';

type Sizes = { width: number; height: number };

const CANVAS_RATIO_TYPE_BREAK_POINTS = {
	wideSquare: 1.3, // Min ratio of long width canvas, used for position FS UI elements
	narrowSquare: 0.8, // GALAXY FOLD EXPAND RATIO IS 1.400390625
};

const CANVAS_SIZE_TYPE_BREAK_POINTS = {
	smallMobile: 375, // Max size of small mobile layouts e.g. iPhone SE
	mobile: 480, // Max size of common mobile layouts e.g. iPhone XR
	tablet: 820, // Max size of tablets layouts, e.g. iPad Air
	largeTablet: 1024, // Max size of large tablets layouts, e.g. iPad Pro
};

const getRatio = (value: Sizes) => value.width / (value.height || 1);

// Box map keyed by bucket id (author-defined) — no longer a fixed four-key shape.
type MainSizesMap = Record<string, { width: number; height: number }>;

/**
 * The AUTHORED main box — `LayoutDoc.mainSizesMap`, published by the game once its
 * editor doc resolves (`loadEditorScenes()`).
 *
 * Why it exists: the Scene Editor previews every `game`-space node against the DOC's
 * box, while the runtime scaled a per-game box hard-coded in `stateLayout.ts` and read
 * the doc's box nowhere. A doc whose Canvas Size drifted from the coded one therefore
 * rendered every authored node at a different SIZE *and* a different POSITION in the
 * game than in the editor — silently, because `<MainContainer>` still filled the
 * window. `canvas`-space screens (the free-spin intro / book reveal) never touch this
 * box, so they stayed pixel-perfect: exactly the "only some screens are off" symptom.
 * The doc is the authoring surface, so the doc owns the box.
 *
 * Unset (a game that ships no doc, or a doc with no usable box) ⇒ the coded map, so
 * every existing game whose doc box already equals its coded box is byte-identical.
 */
let authoredMainSizesMap = $state<Partial<MainSizesMap> | undefined>(undefined);

const isUsableSizes = (value: unknown): value is { width: number; height: number } => {
	if (typeof value !== 'object' || value === null) return false;
	const { width, height } = value as { width?: unknown; height?: unknown };
	return (
		typeof width === 'number' &&
		typeof height === 'number' &&
		Number.isFinite(width) &&
		Number.isFinite(height) &&
		width > 0 &&
		height > 0
	);
};

/**
 * Publish the authored doc's main box to the runtime. Called once at boot with
 * `doc.mainSizesMap`; a partial/garbage map is rejected per-layoutType (a bad entry
 * falls back to the coded box rather than collapsing the game to a zero-sized stage).
 * Pass `undefined` to clear.
 */
export const setAuthoredMainSizesMap = (input: unknown): void => {
	if (input === undefined) {
		authoredMainSizesMap = undefined;
		return;
	}
	if (typeof input !== 'object' || input === null) return;
	const source = input as Record<string, unknown>;
	const next: Partial<MainSizesMap> = {};
	// Iterate the input's OWN keys so any authored bucket id (not just the legacy four)
	// carries through — the box map is keyed by bucket id, which is now author-defined.
	for (const layoutType of Object.keys(source)) {
		const sizes = source[layoutType];
		if (isUsableSizes(sizes)) next[layoutType] = { width: sizes.width, height: sizes.height };
	}
	authoredMainSizesMap = Object.keys(next).length ? next : undefined;
};

/** The authored box currently in force (diagnostics — e.g. the debug overlay). */
export const getAuthoredMainSizesMap = (): Partial<MainSizesMap> | undefined =>
	authoredMainSizesMap;

/**
 * The authored LAYOUT PROFILE in force — the bucket set + selection rules published
 * by the game's doc (or the pipeline default baked into the bundle). Unset ⇒
 * {@link DEFAULT_LAYOUT_PROFILE}, so a game that ships no profile behaves exactly as
 * before. Set once at boot alongside {@link setAuthoredMainSizesMap}.
 */
let authoredLayoutProfile = $state<LayoutProfile | undefined>(undefined);

/** Publish the authored layout profile to the runtime. Pass `undefined` to clear. */
export const setAuthoredLayoutProfile = (profile: LayoutProfile | undefined): void => {
	authoredLayoutProfile = profile && profile.buckets?.length ? profile : undefined;
};

/** The profile currently driving bucket selection (authored, else the default). */
export const getActiveLayoutProfile = (): LayoutProfile =>
	authoredLayoutProfile ?? DEFAULT_LAYOUT_PROFILE;

export const createLayout = (layoutOptions: {
	backgroundRatio: {
		normal: number;
		portrait: number;
	};
	mainSizesMap: MainSizesMap;
}) => {
	const canvasSizes = () => ({ width: innerWidth.current ?? 1, height: innerHeight.current ?? 1 }); // because of resizeTo: window
	const canvasRatio = () => getRatio(canvasSizes());
	const canvasRatioType = () => {
		if (canvasRatio() >= CANVAS_RATIO_TYPE_BREAK_POINTS.wideSquare) return 'longWidth' as const;
		if (canvasRatio() <= CANVAS_RATIO_TYPE_BREAK_POINTS.narrowSquare) return 'longHeight' as const;
		return 'almostSquare' as const;
	};
	const canvasSizeType = () => {
		const deviceWidth = Math.min(canvasSizes().width, canvasSizes().height);
		if (deviceWidth <= CANVAS_SIZE_TYPE_BREAK_POINTS.smallMobile) return 'smallMobile' as const;
		if (deviceWidth <= CANVAS_SIZE_TYPE_BREAK_POINTS.mobile) return 'mobile' as const;
		if (deviceWidth <= CANVAS_SIZE_TYPE_BREAK_POINTS.tablet) return 'tablet' as const;
		if (deviceWidth <= CANVAS_SIZE_TYPE_BREAK_POINTS.largeTablet) return 'largeTablet' as const;
		return 'desktop' as const;
	};
	// The live-window bucket, chosen by the ACTIVE profile's rules (author-defined; the
	// default profile reproduces the legacy ratio/size decision tree). `canvasRatioType`
	// / `canvasSizeType` above are retained for consumers but no longer drive selection.
	const selectedBucket = () => selectBucket(getActiveLayoutProfile(), canvasSizes());
	const layoutType = () => selectedBucket().id;
	const isStacked = () => selectedBucket().stacked === true;

	// `authored` = the GAME box (the one the Scene Editor lays nodes out against), so a
	// published `doc.mainSizesMap` overrides it. `fallbackBox` guards the case where a coded
	// game ships no box for an author-added bucket id: fall back to the game's own fallback-
	// bucket box, then the profile's design box — never `undefined.width`.
	const createMainLayout =
		(mainSizesMap: MainSizesMap, authored = false) =>
		() => {
			const x = canvasSizes().width * 0.5;
			const y = canvasSizes().height * 0.5;
			const profile = getActiveLayoutProfile();
			const id = layoutType();
			const mainSizes =
				(authored ? authoredMainSizesMap?.[id] : undefined) ??
				mainSizesMap[id] ??
				mainSizesMap[profile.fallbackBucketId] ??
				resolveBucketBox(profile, id);
			const widthScale = canvasSizes().width / mainSizes.width;
			const heightScale = canvasSizes().height / mainSizes.height;
			const scale = Math.min(widthScale, heightScale);

			return {
				x,
				y,
				scale,
				width: mainSizes.width,
				height: mainSizes.height,
				anchor: 0.5,
			};
		};

	const mainLayout = createMainLayout(layoutOptions.mainSizesMap, true);

	// The STANDARD (HUD/frame) box is now the ACTIVE profile's per-bucket design box, so
	// authoring a bucket's resolution/aspect reshapes the HUD frame. Reads through
	// `resolveBucketBox` (profile-driven) rather than the frozen legacy map.
	const mainLayoutStandard = () => {
		const profile = getActiveLayoutProfile();
		const mainSizes = resolveBucketBox(profile, layoutType());
		const canvas = canvasSizes();
		const scale = Math.min(canvas.width / mainSizes.width, canvas.height / mainSizes.height);
		return {
			x: canvas.width * 0.5,
			y: canvas.height * 0.5,
			scale,
			width: mainSizes.width,
			height: mainSizes.height,
			anchor: 0.5,
		};
	};

	const createBackgroundLayout = ({ scale, ratio }: { scale: number; ratio: number }) => {
		const canvasRatio = getRatio(canvasSizes());

		if (canvasRatio < ratio) {
			return {
				x: canvasSizes().width / 2,
				y: canvasSizes().height / 2,
				height: canvasSizes().height * scale,
			};
		}

		return {
			x: canvasSizes().width / 2,
			y: canvasSizes().height / 2,
			width: canvasSizes().width * scale,
		};
	};

	const normalBackgroundLayout = ({ scale }: { scale: number }) =>
		createBackgroundLayout({ scale, ratio: layoutOptions.backgroundRatio.normal });
	const portraitBackgroundLayout = ({ scale }: { scale: number }) =>
		createBackgroundLayout({ scale, ratio: layoutOptions.backgroundRatio.portrait });

	const stateLayout = $state({
		showLoadingScreen: true,
	});

	const stateLayoutDerived = {
		canvasSizes,
		canvasRatio,
		canvasRatioType,
		canvasSizeType,
		layoutType,
		isStacked,
		mainLayout,
		mainLayoutStandard,
		normalBackgroundLayout,
		portraitBackgroundLayout,
	};

	return {
		stateLayout,
		stateLayoutDerived,
	};
};
