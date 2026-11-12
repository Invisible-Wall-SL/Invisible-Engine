/**
 * Offline fixture for phone-or-desktop and the screen's real pixels (`pixi-svelte` `deviceClass.ts`)
 * over real device signatures, with what each device then loads: KTX2 or not, the renderer's
 * resolution and canvas, and the art tier of a 4K game (`artTier.ts`). Run with tsx:
 *   pnpm --filter launcher-api exec tsx ../lines/src/game/deviceClass.fixture.ts
 *
 * Pins:
 *   1. every row's class, the signal that decided it, whether the GPU had to be read, and what it
 *      then loads; a row marked `same` gets exactly what the rule on `main` (c26b7e3c) gave it, and
 *      every other row gets something else; and how each GPU family's name is read;
 *   2. a phone draws no more pixels than its screen has (unless held at 1:1), and a 4K game picks
 *      `half` wherever the screen shows it at half or less, measured from the screen's own pixels;
 *   3. `?quality=high|low` pin the format on every row, and a pinned page never reads the GPU;
 *   4. the screen ratio's edge cases: a pinch-zoom in, a missing or zero scale, a zero DPR;
 *   5. in a stubbed browser: the signals are read once (a later pinch does not change the ratio),
 *      the GPU at most once, from a 1×1 context that is lost again, and never without touch.
 */

import { DEFAULT_LAYOUT_PROFILE } from 'constants-shared/layoutProfile';
import {
	canvasResolution,
	classifyDevice,
	prefersCompressedTextures,
	screenPixelRatio,
	type DeviceClass,
	type DeviceReason,
	type DeviceSignals,
} from 'pixi-svelte/deviceClass';

import { artScreenScale, chooseArtTier } from './artTier';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
	if (actual === expected) console.log(`  ok    ${label}`);
	else {
		failures += 1;
		console.error(`  FAIL  ${label}: got ${String(actual)}, expected ${String(expected)}`);
	}
};

const box = (w: number, h: number) => ({ width: w, height: h });
const K4 = {
	mainSizesMap: {
		desktop: box(3840, 2160),
		landscape: box(3840, 2160),
		portrait: box(2160, 3840),
		tablet: box(3840, 3840),
	},
	layoutProfile: {
		...DEFAULT_LAYOUT_PROFILE,
		buckets: DEFAULT_LAYOUT_PROFILE.buckets.map((b) => ({
			...b,
			box: box(b.box.width * 2, b.box.height * 2),
		})),
	},
};
const MAX_RESOLUTION = 2;

const UA = {
	chromeLinux:
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
	samsungDesktopSite:
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/29.0 Chrome/136.0.0.0 Safari/537.36',
	chromeAndroid:
		'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36',
	iPhone:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
	safariMac:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
	chromeWindows:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
	chromeOsArm:
		'Mozilla/5.0 (X11; CrOS aarch64 16328.55.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
	headless:
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.0.0 Safari/537.36',
};
const GPU = {
	adreno830: 'ANGLE (Qualcomm, Adreno (TM) 830, OpenGL ES 3.2)',
	xclipse940:
		'ANGLE (Samsung, Vulkan 1.3.264 (Samsung Xclipse 940 (0x73930000)), Samsung driver-2.0.0)',
	adreno740: 'ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)',
	adreno750: 'ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2)',
	adreno618: 'ANGLE (Qualcomm, Adreno (TM) 618, OpenGL ES 3.2)',
	maliG715: 'ANGLE (ARM, Mali-G715, OpenGL ES 3.2)',
	apple: 'Apple GPU',
	irisXe:
		'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x0000A7A0) Direct3D11 vs_5_0 ps_5_0, D3D11)',
	rtxLinux: 'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL 4.5.0)',
	rtxWindows:
		'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)',
	uhd630: 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)',
	adrenoX1:
		'ANGLE (Qualcomm, Qualcomm(R) Adreno(TM) X1-85 GPU (0x0000043A) Direct3D11 vs_5_0 ps_5_0, D3D11)',
	swiftShader:
		'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
	brave: 'Brave',
};

/** What a device gets: the art format, the renderer's resolution and canvas, a 4K game's tier. */
type Outcome = { ktx2: boolean; resolution: number; canvas: string; art: string };

type Row = {
	name: string;
	ua: string;
	platform: string;
	touch: number;
	coarse: boolean;
	gpu?: string;
	dpr: number;
	viewport: [number, number];
	zoom: number;
	screen: [number, number];
	memory?: number;
	expect: { class: DeviceClass; reason: DeviceReason; gpuRead: boolean } & Outcome;
	/** Gets exactly what the rule on `main` gave it. */
	same: boolean;
};

// Chrome keeps the page zoom in single precision.
const zoom = (screenWidth: number, layoutWidth: number) => Math.fround(screenWidth / layoutWidth);

const ROWS: Row[] = [
	{
		name: 'Galaxy S25, Chrome, Desktop site (the 2026-11-12 ?perf=1 report)',
		ua: UA.chromeLinux,
		platform: 'Linux x86_64',
		touch: 5,
		coarse: true,
		gpu: GPU.adreno830,
		dpr: 2.8125,
		viewport: [980, 1770],
		zoom: zoom(384, 980),
		screen: [384, 832],
		memory: 8,
		expect: {
			class: 'phone',
			reason: 'zoomed-out',
			gpuRead: false,
			ktx2: true,
			resolution: 1.102,
			canvas: '1080x1951',
			art: 'half',
		},
		same: false,
	},
	{
		// 1080 px across a 2160 px box is exactly half; in single precision the zoom lands a hair over.
		name: 'Pixel 8, Chrome, Desktop site (1080 px wide: the 4K box at exactly half)',
		ua: UA.chromeLinux,
		platform: 'Linux armv81',
		touch: 5,
		coarse: true,
		gpu: GPU.maliG715,
		dpr: 2.625,
		viewport: [980, 1929],
		zoom: zoom(1080 / 2.625, 980),
		screen: [411, 914],
		memory: 8,
		expect: {
			class: 'phone',
			reason: 'zoomed-out',
			gpuRead: false,
			ktx2: true,
			resolution: 1.102,
			canvas: '1080x2126',
			art: 'half',
		},
		same: false,
	},
	{
		name: 'Galaxy S24 (Exynos), Samsung Internet, Desktop site, landscape',
		ua: UA.samsungDesktopSite,
		platform: 'Linux x86_64',
		touch: 5,
		coarse: true,
		gpu: GPU.xclipse940,
		dpr: 2.8125,
		viewport: [980, 389],
		zoom: zoom(832, 980),
		screen: [832, 384],
		memory: 8,
		expect: {
			class: 'phone',
			reason: 'zoomed-out',
			gpuRead: false,
			ktx2: true,
			resolution: 2,
			canvas: '1960x778',
			art: 'half',
		},
		same: false,
	},
	{
		name: 'Galaxy Tab S9, Chrome (desktop site by default), portrait',
		ua: UA.chromeLinux,
		platform: 'Linux x86_64',
		touch: 10,
		coarse: true,
		gpu: GPU.adreno740,
		dpr: 2,
		viewport: [980, 1484],
		zoom: zoom(800, 980),
		screen: [800, 1280],
		memory: 8,
		expect: {
			class: 'phone',
			reason: 'zoomed-out',
			gpuRead: false,
			ktx2: true,
			resolution: 1.6327,
			canvas: '1600x2423',
			art: 'full',
		},
		same: false,
	},
	{
		name: 'Galaxy Tab S9, Chrome (desktop site by default), landscape, not zoomed out',
		ua: UA.chromeLinux,
		platform: 'Linux x86_64',
		touch: 10,
		coarse: true,
		gpu: GPU.adreno740,
		dpr: 2,
		viewport: [1280, 712],
		zoom: 1,
		screen: [1280, 800],
		memory: 8,
		expect: {
			class: 'phone',
			reason: 'phone-gpu',
			gpuRead: true,
			ktx2: true,
			resolution: 2,
			canvas: '2560x1424',
			art: 'full',
		},
		same: false,
	},
	{
		name: 'Galaxy Z Fold6 inner screen, Chrome (desktop site by default)',
		ua: UA.chromeLinux,
		platform: 'Linux x86_64',
		touch: 10,
		coarse: true,
		gpu: GPU.adreno750,
		dpr: 2.625,
		viewport: [980, 1063],
		zoom: zoom(707, 980),
		screen: [707, 823],
		memory: 8,
		expect: {
			class: 'phone',
			reason: 'zoomed-out',
			gpuRead: false,
			ktx2: true,
			resolution: 1.8938,
			canvas: '1856x2013',
			art: 'half',
		},
		same: false,
	},
	{
		name: 'Budget Android phone (DPR 2, 360 px), Chrome, Desktop site',
		ua: UA.chromeLinux,
		platform: 'Linux armv81',
		touch: 5,
		coarse: true,
		gpu: 'ANGLE (ARM, Mali-G57, OpenGL ES 3.2)',
		dpr: 2,
		viewport: [980, 2025],
		zoom: zoom(360, 980),
		screen: [360, 800],
		memory: 4,
		expect: {
			class: 'phone',
			reason: 'zoomed-out',
			gpuRead: false,
			ktx2: true,
			resolution: 1,
			canvas: '980x2025',
			art: 'half',
		},
		same: false,
	},
	{
		name: 'Pixel Tablet (Mali-G710), Chrome (desktop site by default), landscape',
		ua: UA.chromeLinux,
		platform: 'Linux x86_64',
		touch: 10,
		coarse: true,
		gpu: 'ANGLE (ARM, Mali-G710, OpenGL ES 3.2)',
		dpr: 2,
		viewport: [1280, 712],
		zoom: 1,
		screen: [1280, 800],
		memory: 8,
		expect: {
			class: 'phone',
			reason: 'phone-gpu',
			gpuRead: true,
			ktx2: true,
			resolution: 2,
			canvas: '2560x1424',
			art: 'full',
		},
		same: false,
	},
	{
		name: 'iPad Pro 12.9", Safari (desktop mode by default)',
		ua: UA.safariMac,
		platform: 'MacIntel',
		touch: 5,
		coarse: true,
		gpu: GPU.apple,
		dpr: 2,
		viewport: [1024, 1292],
		zoom: 1,
		screen: [1024, 1366],
		expect: {
			class: 'phone',
			reason: 'touch-mac',
			gpuRead: false,
			ktx2: true,
			resolution: 2,
			canvas: '2048x2584',
			art: 'full',
		},
		same: true,
	},
	{
		name: 'iPhone 16, Safari',
		ua: UA.iPhone,
		platform: 'iPhone',
		touch: 5,
		coarse: true,
		gpu: GPU.apple,
		dpr: 3,
		viewport: [390, 664],
		zoom: 1,
		screen: [390, 844],
		expect: {
			class: 'phone',
			reason: 'phone-ua',
			gpuRead: false,
			ktx2: true,
			resolution: 2,
			canvas: '780x1328',
			art: 'half',
		},
		same: true,
	},
	{
		name: 'iPhone 16 on an operator page with no viewport meta (zoomed out by Safari)',
		ua: UA.iPhone,
		platform: 'iPhone',
		touch: 5,
		coarse: true,
		gpu: GPU.apple,
		dpr: 3,
		viewport: [980, 1669],
		zoom: zoom(390, 980),
		screen: [390, 844],
		expect: {
			class: 'phone',
			reason: 'phone-ua',
			gpuRead: false,
			ktx2: true,
			resolution: 1.1939,
			canvas: '1170x1993',
			art: 'full',
		},
		same: false,
	},
	{
		name: 'Pixel 9 Pro, Chrome',
		ua: UA.chromeAndroid,
		platform: 'Linux armv81',
		touch: 5,
		coarse: true,
		gpu: GPU.maliG715,
		dpr: 2.625,
		viewport: [426, 804],
		zoom: 1,
		screen: [426, 923],
		memory: 8,
		expect: {
			class: 'phone',
			reason: 'phone-ua',
			gpuRead: false,
			ktx2: true,
			resolution: 2,
			canvas: '852x1608',
			art: 'half',
		},
		same: true,
	},
	{
		name: 'Windows touch laptop (Intel Iris Xe), touchpad',
		ua: UA.chromeWindows,
		platform: 'Win32',
		touch: 10,
		coarse: false,
		gpu: GPU.irisXe,
		dpr: 1.5,
		viewport: [1280, 632],
		zoom: 1,
		screen: [1280, 800],
		memory: 8,
		expect: {
			class: 'desktop',
			reason: 'fine-pointer',
			gpuRead: false,
			ktx2: false,
			resolution: 1.5,
			canvas: '1920x948',
			art: 'half',
		},
		same: true,
	},
	{
		name: 'the same laptop folded into a tablet (finger first)',
		ua: UA.chromeWindows,
		platform: 'Win32',
		touch: 10,
		coarse: true,
		gpu: GPU.irisXe,
		dpr: 1.5,
		viewport: [1280, 632],
		zoom: 1,
		screen: [1280, 800],
		memory: 8,
		expect: {
			class: 'desktop',
			reason: 'windows-gpu',
			gpuRead: true,
			ktx2: false,
			resolution: 1.5,
			canvas: '1920x948',
			art: 'half',
		},
		same: true,
	},
	{
		name: 'Surface Pro (Snapdragon X, Adreno), keyboard off',
		ua: UA.chromeWindows,
		platform: 'Win32',
		touch: 10,
		coarse: true,
		gpu: GPU.adrenoX1,
		dpr: 2,
		viewport: [1440, 912],
		zoom: 1,
		screen: [1440, 960],
		memory: 8,
		expect: {
			class: 'desktop',
			reason: 'windows-gpu',
			gpuRead: true,
			ktx2: false,
			resolution: 2,
			canvas: '2880x1824',
			art: 'full',
		},
		same: true,
	},
	{
		name: '4K touch cabinet, Linux kiosk (NVIDIA, DPR 1; the same UA as the S25)',
		ua: UA.chromeLinux,
		platform: 'Linux x86_64',
		touch: 10,
		coarse: true,
		gpu: GPU.rtxLinux,
		dpr: 1,
		viewport: [3840, 2160],
		zoom: 1,
		screen: [3840, 2160],
		memory: 8,
		expect: {
			class: 'desktop',
			reason: 'desktop-gpu',
			gpuRead: true,
			ktx2: false,
			resolution: 1,
			canvas: '3840x2160',
			art: 'full',
		},
		same: true,
	},
	{
		name: '4K touch cabinet, Windows kiosk (NVIDIA, DPR 1)',
		ua: UA.chromeWindows,
		platform: 'Win32',
		touch: 10,
		coarse: true,
		gpu: GPU.rtxWindows,
		dpr: 1,
		viewport: [3840, 2160],
		zoom: 1,
		screen: [3840, 2160],
		memory: 8,
		expect: {
			class: 'desktop',
			reason: 'windows-gpu',
			gpuRead: true,
			ktx2: false,
			resolution: 1,
			canvas: '3840x2160',
			art: 'full',
		},
		same: true,
	},
	{
		name: '1080p touch cabinet, Windows (Intel UHD 630, DPR 1)',
		ua: UA.chromeWindows,
		platform: 'Win32',
		touch: 10,
		coarse: true,
		gpu: GPU.uhd630,
		dpr: 1,
		viewport: [1920, 1080],
		zoom: 1,
		screen: [1920, 1080],
		memory: 8,
		expect: {
			class: 'desktop',
			reason: 'windows-gpu',
			gpuRead: true,
			ktx2: false,
			resolution: 1,
			canvas: '1920x1080',
			art: 'half',
		},
		same: true,
	},
	{
		name: 'ARM Chromebook with touch (Snapdragon 7c, Adreno 618), tablet mode',
		ua: UA.chromeOsArm,
		platform: 'Linux aarch64',
		touch: 10,
		coarse: true,
		gpu: GPU.adreno618,
		dpr: 1.6,
		viewport: [1200, 619],
		zoom: 1,
		screen: [1200, 675],
		memory: 8,
		expect: {
			class: 'phone',
			reason: 'phone-gpu',
			gpuRead: true,
			ktx2: true,
			resolution: 1.6,
			canvas: '1920x990',
			art: 'half',
		},
		same: false,
	},
	{
		name: 'the same Chromebook as a laptop (touchpad)',
		ua: UA.chromeOsArm,
		platform: 'Linux aarch64',
		touch: 10,
		coarse: false,
		gpu: GPU.adreno618,
		dpr: 1.6,
		viewport: [1200, 619],
		zoom: 1,
		screen: [1200, 675],
		memory: 8,
		expect: {
			class: 'desktop',
			reason: 'fine-pointer',
			gpuRead: false,
			ktx2: false,
			resolution: 1.6,
			canvas: '1920x990',
			art: 'half',
		},
		same: true,
	},
	{
		name: 'Android tablet in Brave, Desktop site, landscape (GPU name masked)',
		ua: UA.chromeLinux,
		platform: 'Linux x86_64',
		touch: 10,
		coarse: true,
		gpu: GPU.brave,
		dpr: 2,
		viewport: [1280, 712],
		zoom: 1,
		screen: [1280, 800],
		memory: 8,
		expect: {
			class: 'desktop',
			reason: 'gpu-unknown',
			gpuRead: true,
			ktx2: false,
			resolution: 2,
			canvas: '2560x1424',
			art: 'full',
		},
		same: true,
	},
	{
		name: 'touch kiosk with WebGL unavailable to the probe',
		ua: UA.chromeLinux,
		platform: 'Linux x86_64',
		touch: 10,
		coarse: true,
		dpr: 1,
		viewport: [1920, 1080],
		zoom: 1,
		screen: [1920, 1080],
		memory: 8,
		expect: {
			class: 'desktop',
			reason: 'gpu-hidden',
			gpuRead: true,
			ktx2: false,
			resolution: 1,
			canvas: '1920x1080',
			art: 'half',
		},
		same: true,
	},
	{
		name: 'plain desktop, Windows (NVIDIA, no touch)',
		ua: UA.chromeWindows,
		platform: 'Win32',
		touch: 0,
		coarse: false,
		gpu: GPU.rtxWindows,
		dpr: 1,
		viewport: [1920, 945],
		zoom: 1,
		screen: [1920, 1080],
		memory: 8,
		expect: {
			class: 'desktop',
			reason: 'no-touch',
			gpuRead: false,
			ktx2: false,
			resolution: 1,
			canvas: '1920x945',
			art: 'half',
		},
		same: true,
	},
	{
		name: 'MacBook Pro, Safari (no touch)',
		ua: UA.safariMac,
		platform: 'MacIntel',
		touch: 0,
		coarse: false,
		gpu: GPU.apple,
		dpr: 2,
		viewport: [1512, 860],
		zoom: 1,
		screen: [1512, 982],
		expect: {
			class: 'desktop',
			reason: 'no-touch',
			gpuRead: false,
			ktx2: false,
			resolution: 2,
			canvas: '3024x1720',
			art: 'full',
		},
		same: true,
	},
	{
		name: '4 GB Windows laptop (no touch)',
		ua: UA.chromeWindows,
		platform: 'Win32',
		touch: 0,
		coarse: false,
		gpu: GPU.uhd630,
		dpr: 1,
		viewport: [1366, 657],
		zoom: 1,
		screen: [1366, 768],
		memory: 4,
		expect: {
			class: 'desktop',
			reason: 'no-touch',
			gpuRead: false,
			ktx2: true,
			resolution: 1,
			canvas: '1366x657',
			art: 'half',
		},
		same: true,
	},
	{
		name: 'the current-games harness (headless shell, SwiftShader)',
		ua: UA.headless,
		platform: 'Linux x86_64',
		touch: 0,
		coarse: false,
		gpu: GPU.swiftShader,
		dpr: 1,
		viewport: [1280, 720],
		zoom: 1,
		screen: [1280, 720],
		memory: 8,
		expect: {
			class: 'desktop',
			reason: 'no-touch',
			gpuRead: false,
			ktx2: false,
			resolution: 1,
			canvas: '1280x720',
			art: 'half',
		},
		same: true,
	},
];

const signalsOf = (row: Row): DeviceSignals => ({
	userAgent: row.ua,
	platform: row.platform,
	maxTouchPoints: row.touch,
	coarsePointer: row.coarse,
	devicePixelRatio: row.dpr,
	viewportScale: row.zoom,
	deviceMemory: row.memory,
});

const canvasOf = ([width, height]: [number, number], resolution: number) =>
	`${Math.round(width * resolution)}x${Math.round(height * resolution)}`;

const artFor = (row: Row, pixelRatio: number) =>
	chooseArtTier({
		window: { width: row.viewport[0], height: row.viewport[1], pixelRatio },
		maxResolution: MAX_RESOLUTION,
		doc: K4,
	});

/** Everything a row gets now; `formatGpuReads` is how often the format decision read the GPU. */
function outcome(row: Row, quality?: 'high' | 'low') {
	let gpuReads = 0;
	const readGpu = () => {
		gpuReads += 1;
		return row.gpu;
	};
	const verdict = classifyDevice(signalsOf(row), readGpu);
	const classifyReads = gpuReads;
	gpuReads = 0;
	const ktx2 = prefersCompressedTextures({
		quality,
		device: () => classifyDevice(signalsOf(row), readGpu).class,
		lowMemory: typeof row.memory === 'number' && row.memory <= 4,
	});
	const ratio = screenPixelRatio(signalsOf(row));
	const resolution = canvasResolution(ratio, MAX_RESOLUTION);
	return {
		verdict,
		classifyReads,
		formatGpuReads: gpuReads,
		ktx2,
		ratio,
		resolution,
		canvas: canvasOf(row.viewport, resolution),
		art: artFor(row, ratio),
	};
}

/** The rule on `main` (c26b7e3c), copied: the UA or a touch Mac for KTX2, the raw DPR for the
 *  canvas and the art tier, a tier covering only at or under its scale. */
function today(row: Row): Outcome {
	const ios = /iPad|iPhone|iPod/.test(row.ua) || (row.platform === 'MacIntel' && row.touch > 1);
	const ktx2 =
		ios || /Android/i.test(row.ua) || (typeof row.memory === 'number' && row.memory <= 4);
	const resolution = Math.min(Math.max(row.dpr || 1, 1), MAX_RESOLUTION);
	const scale = artScreenScale({
		window: { width: row.viewport[0], height: row.viewport[1], pixelRatio: row.dpr },
		maxResolution: MAX_RESOLUTION,
		doc: K4,
	});
	return {
		ktx2,
		resolution,
		canvas: canvasOf(row.viewport, resolution),
		art: 0.5 >= scale ? 'half' : 'full',
	};
}

const round4 = (n: number) => Number(n.toFixed(4));
const brief = (o: Outcome) =>
	`${o.ktx2 ? 'KTX2' : 'WebP'} · res ${round4(o.resolution)} · ${o.canvas} · 4K art ${o.art}`;

console.log('1. every device: class, the signal that decided it, what it loads');
for (const row of ROWS) {
	const got = outcome(row);
	const now: Outcome = {
		ktx2: got.ktx2,
		resolution: got.resolution,
		canvas: got.canvas,
		art: got.art,
	};
	const before = today(row);
	console.log(`\n  ${row.name}`);
	console.log(`        before: ${brief(before)}`);
	console.log(`        now:    ${got.verdict.class} (${got.verdict.reason}) · ${brief(now)}`);
	check(`class`, got.verdict.class, row.expect.class);
	check(`reason`, got.verdict.reason, row.expect.reason);
	check(`GPU read`, got.classifyReads > 0, row.expect.gpuRead);
	check(`GPU read at most once`, got.classifyReads <= 1, true);
	check(`KTX2`, got.ktx2, row.expect.ktx2);
	check(`resolution`, round4(got.resolution), row.expect.resolution);
	check(`canvas`, got.canvas, row.expect.canvas);
	check(`4K art tier`, got.art, row.expect.art);
	const unchanged =
		now.ktx2 === before.ktx2 &&
		now.resolution === before.resolution &&
		now.canvas === before.canvas &&
		now.art === before.art;
	check(row.same ? 'gets what main gave it' : 'gets something main did not', unchanged, row.same);
}

console.log('\n   a screen without touch is never touched');
for (const row of ROWS.filter((r) => r.touch === 0)) check(row.name, row.same, true);

console.log('\n2. a phone draws no more than its screen, and its 4K art is half where half covers');
// Measured from the screen's own pixels: the window spans the screen's width on every phone row, so
// it shows `screen width × DPR` pixels across, of which the canvas draws at most the tier's cap.
for (const row of ROWS) {
	const got = outcome(row);
	if (got.verdict.class !== 'phone') continue;
	const physical = row.screen[0] * row.dpr;
	const drawn = Math.round(row.viewport[0] * got.resolution);
	// `screen.width` is whole CSS px, so it can fall short of the panel by under one CSS px.
	check(
		`${row.name}: ${drawn} px across ≤ the screen's ${Math.round(physical)} (or 1:1)`,
		drawn <= Math.max(physical + row.dpr, row.viewport[0]),
		true,
	);
	const fit = artScreenScale({
		window: { width: row.viewport[0], height: row.viewport[1], pixelRatio: 1 },
		maxResolution: 1,
		doc: K4,
	});
	const shown = fit * Math.min(Math.max(physical / row.viewport[0], 1), MAX_RESOLUTION);
	check(
		`${row.name}: 4K art shown at ${round4(shown)} → ${shown <= 0.5 + 1e-6 ? 'half' : 'full'}`,
		got.art,
		shown <= 0.5 + 1e-6 ? 'half' : 'full',
	);
}
const s25 = ROWS[0];
check(
	'S25: half with the zoom as a double too (384 / 980)',
	artFor(s25, screenPixelRatio({ devicePixelRatio: 2.8125, viewportScale: 384 / 980 })),
	'half',
);
check(
	'a 1921×1081 desktop window at 1× keeps full (the slack never reaches a real window)',
	chooseArtTier({
		window: { width: 1921, height: 1081, pixelRatio: 1 },
		maxResolution: MAX_RESOLUTION,
		doc: K4,
	}),
	'full',
);

console.log('\n   each GPU family, on a touch-first device its UA calls a desktop');
const FAMILIES: [string, DeviceReason][] = [
	['ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)', 'phone-gpu'],
	['ANGLE (ARM, Mali-G710, OpenGL ES 3.2)', 'phone-gpu'],
	['ANGLE (ARM, Immortalis-G720, OpenGL ES 3.2)', 'phone-gpu'],
	['ANGLE (Imagination Technologies, PowerVR B-Series BXM-8-256, OpenGL ES 3.2)', 'phone-gpu'],
	['ANGLE (Samsung, Xclipse 940, OpenGL ES 3.2)', 'phone-gpu'],
	['ANGLE (Huawei, Maleoon 910, OpenGL ES 3.2)', 'phone-gpu'],
	['Apple GPU', 'phone-gpu'],
	['ANGLE (Mesa, Mali-G610 (Panfrost), OpenGL ES 3.1)', 'phone-gpu'],
	[GPU.adrenoX1, 'windows-gpu'],
	[
		'ANGLE (AMD, AMD Radeon RX 7800 XT (0x0000747E) Direct3D11 vs_5_0 ps_5_0, D3D11)',
		'windows-gpu',
	],
	['ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)', 'desktop-gpu'],
	['ANGLE (AMD, AMD Radeon Graphics (radeonsi, renoir), OpenGL 4.6)', 'desktop-gpu'],
	['ANGLE (Mesa, llvmpipe (LLVM 17.0.6, 256 bits), OpenGL 4.5)', 'desktop-gpu'],
	[GPU.rtxLinux, 'desktop-gpu'],
	[GPU.swiftShader, 'desktop-gpu'],
	['WebKit WebGL', 'gpu-unknown'],
];
const kiosk = ROWS.find((r) => r.name.startsWith('4K touch cabinet, Linux'))!;
for (const [gpu, reason] of FAMILIES)
	check(gpu, classifyDevice(signalsOf(kiosk), () => gpu).reason, reason);

console.log('\n3. ?quality= pins the format, and a pinned page never reads the GPU');
for (const row of ROWS) {
	const high = outcome(row, 'high');
	const low = outcome(row, 'low');
	check(`${row.name}: high → WebP`, high.ktx2, false);
	check(`${row.name}: low → KTX2`, low.ktx2, true);
	check(`${row.name}: no GPU read under a pin`, high.formatGpuReads + low.formatGpuReads, 0);
}

console.log('\n4. the screen ratio');
const ratio = (devicePixelRatio: number, viewportScale: number) =>
	screenPixelRatio({ devicePixelRatio, viewportScale });
check('no zoom: the DPR', ratio(2.625, 1), 2.625);
check('a pinch-zoom in counts as 1', ratio(3, 2.5), 3);
check('a zero scale (a document not fully active) counts as 1', ratio(2, 0), 2);
check('a missing scale counts as 1', ratio(2, Number.NaN), 2);
check('a zero DPR counts as 1', ratio(0, 0.5), 0.5);
check('canvasResolution floors at 1:1', canvasResolution(0.73, 2), 1);
check('canvasResolution caps at the tier', canvasResolution(2.8125, 1.5), 1.5);

console.log('\n5. in a browser: read once, the GPU at most once and only with touch');
type Stub = {
	touch: number;
	coarse: boolean;
	scale: number;
	contexts: number;
	lost: number;
	sizes: string[];
};
const stub: Stub = { touch: 0, coarse: false, scale: 1, contexts: 0, lost: 0, sizes: [] };
const fakeGl = {
	RENDERER: 0x1f01,
	getExtension: (name: string) =>
		name === 'WEBGL_debug_renderer_info'
			? { UNMASKED_RENDERER_WEBGL: 0x9246 }
			: name === 'WEBGL_lose_context'
				? { loseContext: () => (stub.lost += 1) }
				: null,
	getParameter: (p: number) => (p === 0x9246 ? GPU.adreno740 : 'WebKit WebGL'),
};
const define = (name: string, value: unknown) =>
	Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
define('navigator', {
	userAgent: UA.chromeLinux,
	platform: 'Linux x86_64',
	get maxTouchPoints() {
		return stub.touch;
	},
	deviceMemory: 8,
});
define('window', {
	devicePixelRatio: 2,
	location: { search: '' },
	matchMedia: (query: string) => ({ matches: query === '(pointer: coarse)' && stub.coarse }),
	visualViewport: {
		get scale() {
			return stub.scale;
		},
	},
});
define('document', {
	createElement: () => {
		const canvas = {
			width: 300,
			height: 150,
			getContext: () => {
				stub.contexts += 1;
				stub.sizes.push(`${canvas.width}x${canvas.height}`);
				return fakeGl;
			},
		};
		return canvas;
	},
});
type DeviceModule = typeof import('pixi-svelte/deviceClass');
const moduleUrl = import.meta.resolve('pixi-svelte/deviceClass');
let instance = 0;
/** A new copy of the module (its memo empty), in a browser with these signals. */
const fresh = async (touch: number, coarse: boolean, scale: number): Promise<DeviceModule> => {
	Object.assign(stub, { touch, coarse, scale, contexts: 0, lost: 0, sizes: [] });
	instance += 1;
	return import(`${moduleUrl}?${instance}`);
};

async function inBrowser() {
	const zoomedOut = await fresh(5, true, 0.5);
	check('zoomed out: ratio = DPR × zoom', zoomedOut.deviceScreenPixelRatio(), 1);
	stub.scale = 3;
	check('a later pinch does not change it', zoomedOut.deviceScreenPixelRatio(), 1);
	check('a phone (the zoom it booted with)', zoomedOut.deviceClass().reason, 'zoomed-out');
	check('… so no GPU context was made', stub.contexts, 0);
	check('KTX2', zoomedOut.compressedTextures(), true);

	const landscape = await fresh(10, true, 1);
	check(
		'a touch tablet not zoomed out: phone by its GPU',
		landscape.deviceClass().reason,
		'phone-gpu',
	);
	landscape.deviceClass();
	landscape.compressedTextures();
	check('one context for the GPU, however often asked', stub.contexts, 1);
	check('… 1×1', stub.sizes[0], '1x1');
	check('… and lost again', stub.lost, 1);

	const desktop = await fresh(0, false, 1);
	check('no touch: desktop', desktop.deviceClass().reason, 'no-touch');
	desktop.compressedTextures();
	check('… and no GPU context at all', stub.contexts, 0);

	const pinned = await fresh(10, true, 1);
	(globalThis as unknown as { window: { location: { search: string } } }).window.location.search =
		'?quality=high';
	check('?quality=high: WebP', pinned.compressedTextures(), false);
	check('… with no GPU context', stub.contexts, 0);
}

void inBrowser().then(() => {
	if (failures) throw new Error(`${failures} device class check(s) failed`);
	console.log('\n✓ device class: all checks pass');
});
