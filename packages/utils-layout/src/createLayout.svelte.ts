import { innerWidth, innerHeight } from 'svelte/reactivity/window';
import { STANDARD_MAIN_SIZES_MAP } from 'constants-shared/layout';

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

type MainSizesMap = typeof STANDARD_MAIN_SIZES_MAP;

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
	for (const layoutType of Object.keys(STANDARD_MAIN_SIZES_MAP) as (keyof MainSizesMap)[]) {
		const sizes = source[layoutType];
		if (isUsableSizes(sizes)) next[layoutType] = { width: sizes.width, height: sizes.height };
	}
	authoredMainSizesMap = Object.keys(next).length ? next : undefined;
};

/** The authored box currently in force (diagnostics — e.g. the debug overlay). */
export const getAuthoredMainSizesMap = (): Partial<MainSizesMap> | undefined =>
	authoredMainSizesMap;

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
	const layoutType = () => {
		if (canvasRatioType() === 'almostSquare') return 'tablet' as const;
		if (canvasRatioType() === 'longHeight') return 'portrait' as const;
		if (canvasSizeType() === 'mobile' || canvasSizeType() === 'smallMobile')
			return 'landscape' as const;
		return 'desktop' as const;
	};
	const isStacked = () => ['portrait', 'almostSquare'].includes(layoutType());

	// `authored` = the GAME box (the one the Scene Editor lays nodes out against), so a
	// published `doc.mainSizesMap` overrides it. The STANDARD box is the fixed HUD design
	// box (`STANDARD_MAIN_SIZES_MAP`) shared by every game — never doc-driven.
	const createMainLayout =
		(mainSizesMap: MainSizesMap, authored = false) =>
		() => {
			const x = canvasSizes().width * 0.5;
			const y = canvasSizes().height * 0.5;
			const mainSizes =
				(authored ? authoredMainSizesMap?.[layoutType()] : undefined) ?? mainSizesMap[layoutType()];
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

	const mainLayoutStandard = createMainLayout(STANDARD_MAIN_SIZES_MAP);

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
