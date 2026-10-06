// Browser side of render.mjs. Bundled twice: once against the reference Pixi runtime (RUNTIME=ref)
// and once against engine-rig/pixi (RUNTIME=rig). Exposes window.renderPose → base64 RGBA pixels.
import { Application, Assets, Graphics, Rectangle } from 'pixi.js';
import * as R from 'RUNTIME';

declare const RUNTIME_NAME: string;

interface Pose {
	atlas: string;
	skeleton: string;
	animation: string | null;
	time: number;
	size: number;
	skin?: string;
	/** Attach a marker shape to every other slot, as the game attaches text, effects and clips. */
	slotObjects?: boolean;
	/** Draw the view as constructed, before any `update` (as a game shows a rig it has mounted
	 * but not yet played). */
	fresh?: boolean;
}

let app: Application | null = null;

async function ensureApp(size: number): Promise<Application> {
	if (app && app.screen.width === size) return app;
	app?.destroy(true);
	app = new Application();
	await app.init({
		width: size,
		height: size,
		preference: 'webgl',
		antialias: false,
		backgroundAlpha: 0,
		preserveDrawingBuffer: true,
		resolution: 1,
	});
	document.body.appendChild(app.canvas);
	return app;
}

function toBase64(bytes: Uint8Array | Uint8ClampedArray): string {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RT = R as any;

interface Frame {
	pixels: string;
	/** `view.bounds` and Pixi's `getLocalBounds()`, as [minX, minY, maxX, maxY]. */
	bounds: number[];
	local: number[];
}

const box = (b: { minX: number; minY: number; maxX: number; maxY: number }): number[] => [
	b.minX,
	b.minY,
	b.maxX,
	b.maxY,
];

(window as unknown as { renderPose: (p: Pose) => Promise<Frame> }).renderPose = async (
	pose: Pose,
) => {
	const a = await ensureApp(pose.size);
	const loaded = await Assets.load([pose.atlas, pose.skeleton]);
	const atlas = loaded[pose.atlas];
	const raw = loaded[pose.skeleton];
	const loader = new RT.AtlasAttachmentLoader(atlas);
	const reader =
		raw instanceof Uint8Array ? new RT.SkeletonBinary(loader) : new RT.SkeletonJson(loader);
	const data = reader.readSkeletonData(raw instanceof Uint8Array ? raw : structuredClone(raw));
	const View = RUNTIME_NAME === 'ref' ? RT.Spine : RT.RigView;
	const view = new View({ skeletonData: data, autoUpdate: false });
	if (pose.skin) {
		view.skeleton.setSkinByName(pose.skin);
		view.skeleton.setSlotsToSetupPose();
	}
	if (pose.slotObjects) {
		view.skeleton.slots.forEach((slot: { data: { index: number } }, i: number) => {
			if (i % 2) return;
			// An L, so a flip, a turn or a shear of the bone shows.
			const marker = new Graphics()
				.rect(0, 0, 40, 10)
				.rect(0, 0, 10, 30)
				.fill((i * 0x3a5f1d) & 0xffffff);
			view.addSlotObject(slot, marker, {
				followSlotColor: i % 4 === 0,
				followAttachmentTimeline: i % 8 === 0,
			});
		});
	}
	if (pose.animation) view.state.setAnimation(0, pose.animation, true);
	if (!pose.fresh) {
		view.update(pose.time);
		view.update(0);
	}
	// Fit the authored box (identical in both runtimes) into the canvas.
	const w = data.width || 400;
	const h = data.height || 400;
	const scale = (pose.size * 0.9) / Math.max(w, h);
	const cx = data.width ? data.x + data.width / 2 : 0;
	const cy = data.height ? data.y + data.height / 2 : 0;
	view.scale.set(scale);
	view.position.set(pose.size / 2 - cx * scale, pose.size / 2 + cy * scale);
	a.stage.removeChildren();
	a.stage.addChild(view);
	a.renderer.render(a.stage);
	const out = a.renderer.extract.pixels({
		target: a.stage,
		frame: new Rectangle(0, 0, pose.size, pose.size),
	});
	// Measured after drawing: asking a never-updated view for its bounds updates it.
	const bounds = box(view.bounds);
	const local = box(view.getLocalBounds());
	a.stage.removeChildren();
	view.destroy();
	return { pixels: toBase64(out.pixels), bounds, local };
};
(window as unknown as { ready: boolean }).ready = true;
