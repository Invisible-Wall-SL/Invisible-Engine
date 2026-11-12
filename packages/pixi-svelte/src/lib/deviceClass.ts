import { lowMemoryDevice } from './textureResidency';

/**
 * What kind of device this is: the one place it is decided. A `phone` (every phone and tablet)
 * loads the compressed KTX2 art; a `desktop` (a desktop, a laptop, an arcade cabinet) loads the
 * uncompressed pages. Owner's rule (2026-11-12): a touch device is a phone unless it is an arcade.
 *
 * The user agent names iOS or Android only while the browser admits it. Chrome and Samsung
 * Internet in "Desktop site" mode, the default on Android tablets and foldables, send a Linux
 * desktop UA (a Galaxy S25 drew 333 MB of uncompressed art and 3× its screen's pixels that way). So
 * past the UA the device itself decides, once it has a touch screen whose PRIMARY pointer is a
 * finger:
 * - a page the browser zoomed out to fit is a phone or tablet showing the desktop site: it ignored
 *   the page's `width=device-width`, and a desktop browser never zooms out at load;
 * - otherwise the GPU: the families built only into phone and tablet chips are a phone, unless
 *   driven through Direct3D (a Windows PC on a Snapdragon); NVIDIA, AMD, Intel and the software
 *   renderers are a desktop, and so is a GPU the browser hides or masks (Brave).
 * A screen without touch, or a touch screen beside a mouse or touchpad (a touch laptop, a
 * clamshell Chromebook), stays a desktop and its GPU is never read. What the rule cannot tell stays
 * a desktop, as every such device was before.
 *
 * The renderer does not exist yet when the art is registered, so the GPU's name comes from a
 * throwaway context, made only for a touch-first device whose UA says desktop and whose page was
 * not zoomed out (a tablet in landscape, a cabinet). iOS never needs one: its desktop mode is a
 * touch Mac.
 */

export type DeviceClass = 'phone' | 'desktop';

/** Which signal decided the class (`?perf=1` reports it). */
export type DeviceReason =
	| 'phone-ua'
	| 'touch-mac'
	| 'no-touch'
	| 'fine-pointer'
	| 'zoomed-out'
	| 'phone-gpu'
	| 'windows-gpu'
	| 'desktop-gpu'
	| 'gpu-unknown'
	| 'gpu-hidden';

export interface DeviceSignals {
	userAgent: string;
	platform: string;
	maxTouchPoints: number;
	/** `(pointer: coarse)`: the primary pointer is a finger. */
	coarsePointer: boolean;
	devicePixelRatio: number;
	/** `visualViewport.scale` when first read: under 1 when the browser zoomed the page out. */
	viewportScale: number;
	/** `navigator.deviceMemory`, GB, where the browser reports it. */
	deviceMemory?: number;
}

export interface DeviceVerdict {
	class: DeviceClass;
	reason: DeviceReason;
	/** The GPU's name, when the rule had to read it. */
	gpu?: string;
}

const PHONE_UA = /iPad|iPhone|iPod/;
const ANDROID_UA = /Android/i;
/** GPU families built only into phone and tablet chips. */
const PHONE_GPU = /Adreno|Mali|Immortalis|PowerVR|Apple GPU|Xclipse|Maleoon/i;
/** A GPU driven through Direct3D belongs to a Windows PC, whoever made the chip. */
const WINDOWS_GPU = /Direct3D|D3D1[01]/i;
const DESKTOP_GPU = /NVIDIA|GeForce|Quadro|AMD|Radeon|Intel|llvmpipe|SwiftShader/i;

/** The visual viewport's zoom-out at boot, 1 when the page was not zoomed out. */
const zoomOut = (scale: number): number => (scale > 0 && scale < 1 ? scale : 1);

/** The class for `signals`. `readGpu` is called only when nothing else decides. */
export function classifyDevice(
	signals: DeviceSignals,
	readGpu: () => string | undefined,
): DeviceVerdict {
	if (PHONE_UA.test(signals.userAgent) || ANDROID_UA.test(signals.userAgent))
		return { class: 'phone', reason: 'phone-ua' };
	if (signals.platform === 'MacIntel' && signals.maxTouchPoints > 1)
		return { class: 'phone', reason: 'touch-mac' };
	if (signals.maxTouchPoints <= 0) return { class: 'desktop', reason: 'no-touch' };
	if (!signals.coarsePointer) return { class: 'desktop', reason: 'fine-pointer' };
	if (zoomOut(signals.viewportScale) < 1) return { class: 'phone', reason: 'zoomed-out' };
	const gpu = readGpu();
	if (!gpu) return { class: 'desktop', reason: 'gpu-hidden' };
	if (WINDOWS_GPU.test(gpu)) return { class: 'desktop', reason: 'windows-gpu', gpu };
	if (PHONE_GPU.test(gpu)) return { class: 'phone', reason: 'phone-gpu', gpu };
	return { class: 'desktop', reason: DESKTOP_GPU.test(gpu) ? 'desktop-gpu' : 'gpu-unknown', gpu };
}

/**
 * Screen pixels per CSS pixel: the device pixel ratio, times the zoom-out when the browser zoomed
 * the page out to fit. A phone showing the desktop site lays the page out 980 px wide and zooms it
 * out onto a ~384 px screen while `devicePixelRatio` stays the screen's own (2.8125), so a canvas
 * drawn at that ratio holds ~3× the pixels the screen shows. `devicePixelRatio` never includes the
 * visual viewport's zoom (only the browser's own page zoom, which leaves `scale` at 1), so each
 * factor counts once. A zoom-in counts as 1: never above the device's own ratio.
 */
export function screenPixelRatio(
	signals: Pick<DeviceSignals, 'devicePixelRatio' | 'viewportScale'>,
): number {
	const dpr = signals.devicePixelRatio > 0 ? signals.devicePixelRatio : 1;
	return dpr * zoomOut(signals.viewportScale);
}

/** The renderer's resolution: the screen pixel ratio, never below 1:1 (thin text ghosts drawn
 *  sub-native) and never above the render tier's cap (`renderSettings().maxResolution`). */
export const canvasResolution = (ratio: number, maxResolution: number): number =>
	Math.min(Math.max(ratio, 1), maxResolution);

export type TextureQuality = 'high' | 'low';

/** The `?quality=` pin in a query string: `high` forces the uncompressed art, `low` the KTX2. */
export function readTextureQuality(search: string): TextureQuality | undefined {
	const pin = new URLSearchParams(search).get('quality');
	return pin === 'high' || pin === 'low' ? pin : undefined;
}

/** KTX2 art for a phone, or a device reporting 4 GB or less, unless `?quality=` pins it. `device`
 *  is asked only when no pin decides, so a pinned page never reads the GPU. */
export function prefersCompressedTextures(input: {
	quality: TextureQuality | undefined;
	device: () => DeviceClass;
	lowMemory: boolean;
}): boolean {
	if (input.quality) return input.quality === 'low';
	return input.device() === 'phone' || input.lowMemory;
}

/** This browser's signals. */
export function readDeviceSignals(): DeviceSignals {
	const nav = navigator as Navigator & { deviceMemory?: number };
	return {
		userAgent: nav.userAgent || '',
		platform: nav.platform || '',
		maxTouchPoints: nav.maxTouchPoints || 0,
		coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
		devicePixelRatio: window.devicePixelRatio,
		viewportScale: window.visualViewport?.scale ?? 1,
		deviceMemory: nav.deviceMemory,
	};
}

/** The GPU's name, from a 1×1 WebGL context made for it and lost at once; undefined when hidden. */
export function readGpuName(): string | undefined {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 1;
	const gl = canvas.getContext('webgl', { antialias: false, depth: false });
	if (!gl) return undefined;
	const debug = gl.getExtension('WEBGL_debug_renderer_info');
	const name: unknown = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
	gl.getExtension('WEBGL_lose_context')?.loseContext();
	return typeof name === 'string' && name ? name : undefined;
}

let signals: DeviceSignals | undefined;
let verdict: DeviceVerdict | undefined;

/** This device's signals, read when first asked: the zoom at boot, never a later pinch. */
export const deviceSignals = (): DeviceSignals => (signals ??= readDeviceSignals());

/** This device's class, decided the first time anything asks. */
export const deviceClass = (): DeviceVerdict =>
	(verdict ??= classifyDevice(deviceSignals(), readGpuName));

/** This device's {@link screenPixelRatio} at boot. */
export const deviceScreenPixelRatio = (): number => screenPixelRatio(deviceSignals());

/** Whether this page loads the KTX2 art ({@link prefersCompressedTextures}). */
export const compressedTextures = (): boolean =>
	prefersCompressedTextures({
		quality: readTextureQuality(window.location.search),
		device: () => deviceClass().class,
		lowMemory: lowMemoryDevice({ deviceMemory: deviceSignals().deviceMemory }),
	});
