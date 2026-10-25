import type { createLayout } from './createLayout.svelte';

type Layout = ReturnType<typeof createLayout>;
type Derived = Layout['stateLayoutDerived'];

/**
 * The layout as seen from inside a container scaled by `scale()`: a window `1 / scale` the size,
 * so whatever is sized or placed from it (a full-window rect, a `screenAnchor`, a cover fit, a
 * nested `<MainContainer>`) lands on the real window once the container scales it back up, while
 * pixel offsets and sizes come out `scale` times larger. The bucket (`layoutType`, `isStacked`)
 * and the device class stay the real window's. A `canvas`-space screen that scales with the window
 * (`Scene.scaleWithWindow`) hands this to its content. `scale()` must be finite and above 0: the
 * container is scaled by the same reader, so the two cannot disagree.
 */
export function scaleLayout(layout: Layout, scale: () => number): Layout {
	const real = layout.stateLayoutDerived;
	const boxLayout = (read: Derived['mainLayout']) => () => {
		const box = read();
		const k = scale();
		return { ...box, x: box.x / k, y: box.y / k, scale: box.scale / k };
	};
	const coverLayout =
		(read: Derived['normalBackgroundLayout']): Derived['normalBackgroundLayout'] =>
		(options) => {
			const cover = read(options);
			const k = scale();
			return cover.width === undefined
				? { x: cover.x / k, y: cover.y / k, height: cover.height / k }
				: { x: cover.x / k, y: cover.y / k, width: cover.width / k };
		};
	return {
		...layout,
		stateLayoutDerived: {
			...real,
			canvasSizes: () => {
				const canvas = real.canvasSizes();
				const k = scale();
				return { width: canvas.width / k, height: canvas.height / k };
			},
			mainLayout: boxLayout(real.mainLayout),
			mainLayoutStandard: boxLayout(real.mainLayoutStandard),
			normalBackgroundLayout: coverLayout(real.normalBackgroundLayout),
			portraitBackgroundLayout: coverLayout(real.portraitBackgroundLayout),
		},
	};
}
