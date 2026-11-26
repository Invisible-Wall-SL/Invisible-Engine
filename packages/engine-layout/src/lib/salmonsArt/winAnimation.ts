import {
	Container,
	Graphics,
	Sprite,
	Text,
	type Application,
	type Texture,
	type Ticker,
} from 'pixi.js';

import type { ArtMount } from '../arcadeArt.svelte';

/**
 * SALMONS' WIN ANIMATION, as the original drew it (`GuiltyForever/Salmon-`
 * `client/rendering/WinAnimation.js`), on the round's end: a dark overlay, the big fish (golden for
 * the winner, pink for everyone else), the title, a loser's subtitle and the button that leaves for
 * a new river. On the winner's device the fish bobs and lays eggs that fall, bounce and pile up.
 * Drawn in screen px over the whole canvas, in place of the win screen's node
 * (`referenceLayouts/salmonsScreens.ts`); the button calls `onNext` at once and reads "Joining…"
 * from then on, and the fish swims off while the device does what it asked.
 *
 * THE NEXT GAME BY ITSELF (owner, 2026-11-26: "it should starts automatically"): on a device that
 * played the round (`WinShown.count`), "Next game in N" counts {@link NEXT_GAME_SECONDS} over the
 * button and does what the button does at 0. It counts only for someone watching: not on a hidden
 * page, and a page hidden once while it counts, or the screen taken away, stops it for good; the
 * button then waits for its press, as it always did.
 */

/** The original's pixel font; a device without it falls back to its monospace. */
export const PIXEL_FONT = "'Press Start 2P', monospace";

/** The original's action button (`.action-btn`): purple, a red rim, round corners. */
export const BUTTON = {
	fill: 0x5d275d,
	stroke: 0xb13e53,
	selected: 0xffdd57,
	radius: 8,
	padding: 20,
};

export type PixelButton = {
	view: Container;
	width: number;
	height: number;
	/** Show it chosen (a toggle's rim turns yellow). */
	select: (on: boolean) => void;
	/** Say something else on it (its size stays). */
	relabel: (label: string) => void;
	destroy: () => void;
};

/** A button in the original's style, `fontSize` px, its centre at the view's place; hovered it
 *  grows by 5 %. */
export function pixelButton(label: string, onTap: () => void, fontSize = 16): PixelButton {
	const view = new Container();
	const bg = new Graphics();
	const text = new Text({
		text: label,
		style: { fontFamily: PIXEL_FONT, fontSize, fill: 0xffffff, align: 'center' },
	});
	text.anchor.set(0.5);
	const width = text.width + BUTTON.padding * 2;
	const height = text.height + BUTTON.padding * 2;
	const paint = (rim: number) =>
		bg
			.clear()
			.roundRect(-width / 2, -height / 2, width, height, BUTTON.radius)
			.fill(BUTTON.fill)
			.stroke({ width: 4, color: rim });
	paint(BUTTON.stroke);
	view.addChild(bg, text);
	view.eventMode = 'static';
	view.cursor = 'pointer';
	view.onpointerover = () => view.scale.set(1.05);
	view.onpointerout = () => view.scale.set(1);
	view.onpointertap = onTap;
	return {
		view,
		width,
		height,
		select: (on) => paint(on ? BUTTON.selected : BUTTON.stroke),
		relabel: (next) => {
			text.text = next;
		},
		destroy: () => view.destroy({ children: true }),
	};
}

/** Who won the round, whether it is this device's player, and whether the next game starts by
 *  itself (the device played the round). */
export type WinShown = { winner: string; won: boolean; count: boolean };

/** How long the win screen counts before it joins the next game by itself, s. */
export const NEXT_GAME_SECONDS = 10;

/** Whether a container is drawn: it and every parent visible (its screen is shown). */
export const onScreen = (view: Container) => {
	for (let at: Container | null = view; at; at = at.parent) if (!at.visible) return false;
	return true;
};

/** Whether the page is in view (a page with no document, as in a gate, is). */
const pageShown = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/** What the button that leaves for a new river says. */
const labelOf = (shown: WinShown | undefined) =>
	shown?.won ? 'Join New Game' : 'Start New Session';

/** A box on the canvas, px. */
type Box = { x: number; y: number; w: number; h: number };

export type WinAnimation = {
	mount: ArtMount;
	/** Start the animation for a round's end, or take it away (`undefined`). */
	show: (shown: WinShown | undefined) => void;
	/** What it draws now (the probe's). */
	drawn: () => {
		shown: boolean;
		title: string;
		eggs: number;
		leaving: boolean;
		/** What the button says now. */
		label: string;
		button: { x: number; y: number } | undefined;
		/** The seconds "Next game in" shows, `null` when it does not count. */
		next: number | null;
		/** Why the count is not running: it was never asked for, it is still to start (the screen
		 *  not up yet), it was stopped (a hidden page, the screen taken away), or it has run out
		 *  or the button was pressed. */
		count: 'off' | 'pending' | 'running' | 'stopped' | 'done';
		/** Where the title, the subtitle, the button and "Next game in" are drawn, each one's box on
		 *  the canvas while it shows (the probe's). */
		boxes: Partial<Record<'title' | 'subtitle' | 'button' | 'next', Box>>;
	};
	destroy: () => void;
};

const START_DELAY_MS = 50;
const OVERLAY_ALPHA = 0.6;
const OLD_FISH = 50;
const EGG = {
	everyMs: 200,
	max: 1000,
	texR: 15,
	gravity: 800,
	bounce: 0.22,
	friction: 0.82,
	restVy: 8,
	cell: 25,
	restitution: 0.4,
};
const EGG_COLOURS: readonly (readonly [number, number, number])[] = [
	[0xffb3c6, 0xff6090, 0xfff0f5],
	[0xffd6e0, 0xff80a0, 0xfff5f8],
];
const EXIT = { pxPerSecond: 1200 };
/** What the button says from its press until the device has done what it asked. */
const JOINING = 'Joining…';
/** "Next game in N": its size, colour and gap over the button, px. */
const NEXT = { fontSize: 14, fill: 0xffffff, gap: 16 };

type Egg = {
	sprite: Sprite;
	x: number;
	y: number;
	vx: number;
	vy: number;
	r: number;
	rest: boolean;
};

/** An egg's texture: a shadow, the egg a little up and left of it, a highlight and its dot. */
function eggTexture(app: Application, [base, shadow, light]: readonly [number, number, number]) {
	const r = EGG.texR;
	const g = new Graphics()
		.circle(r, r, r)
		.fill(shadow)
		.circle(r * 0.92, r * 0.92, r * 0.85)
		.fill(base)
		.circle(r * 0.65, r * 0.55, r * 0.35)
		.fill(light)
		.circle(r * 0.55, r * 0.45, r * 0.12)
		.fill(0xffffff);
	const texture = app.renderer.generateTexture(g);
	g.destroy();
	return texture;
}

/** Push overlapping eggs apart on a grid of {@link EGG.cell} px, bouncing them off each other. */
function collideEggs(eggs: Egg[]) {
	const grid = new Map<string, Egg[]>();
	for (const egg of eggs) {
		const key = `${Math.floor(egg.x / EGG.cell)},${Math.floor(egg.y / EGG.cell)}`;
		const cell = grid.get(key);
		if (cell) cell.push(egg);
		else grid.set(key, [egg]);
	}
	for (const a of eggs) {
		const cx = Math.floor(a.x / EGG.cell);
		const cy = Math.floor(a.y / EGG.cell);
		for (let gx = cx - 1; gx <= cx + 1; gx++)
			for (let gy = cy - 1; gy <= cy + 1; gy++)
				for (const b of grid.get(`${gx},${gy}`) ?? []) {
					if (b === a || b.sprite.uid < a.sprite.uid) continue;
					const dx = b.x - a.x;
					const dy = b.y - a.y;
					const d = Math.hypot(dx, dy);
					const overlap = a.r + b.r - d;
					if (!(d > 0) || overlap <= 0) continue;
					const nx = dx / d;
					const ny = dy / d;
					a.x -= (nx * overlap) / 2;
					a.y -= (ny * overlap) / 2;
					b.x += (nx * overlap) / 2;
					b.y += (ny * overlap) / 2;
					const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
					if (vn >= 0) continue;
					const j = (-(1 + EGG.restitution) * vn) / 2;
					a.vx -= j * nx;
					a.vy -= j * ny;
					b.vx += j * nx;
					b.vy += j * ny;
					if (Math.abs(a.vy) >= EGG.restVy) a.rest = false;
					if (Math.abs(b.vy) >= EGG.restVy) b.rest = false;
				}
	}
}

/** A view's box on the canvas, whole px. */
const boxOf = (view: Container): Box => {
	const box = view.getBounds();
	return {
		x: Math.round(box.x),
		y: Math.round(box.y),
		w: Math.round(box.width),
		h: Math.round(box.height),
	};
};

export function createWinAnimation(
	fish: { golden: Texture; pink: Texture },
	onNext: () => void,
): WinAnimation {
	const root = new Container();
	let app: Application | undefined;
	let shown: WinShown | undefined;
	let clock = 0;
	let since = 0;
	let built:
		| {
				overlay: Graphics;
				fish: Sprite;
				title: Text;
				subtitle: Text | undefined;
				button: PixelButton;
				next: Text;
				eggs: Container;
				size: { w: number; h: number };
				fishScale: number;
				speedScale: number;
				bob: number;
		  }
		| undefined;
	const eggs: Egg[] = [];
	let eggTextures: Texture[] = [];
	let lastEggAt = -Infinity;
	let exitAt: number | undefined;
	let count: ReturnType<WinAnimation['drawn']>['count'] = 'off';
	let countFrom = 0;

	const press = () => {
		if (exitAt !== undefined) return;
		exitAt = clock;
		if (count !== 'off') count = 'done';
		built?.button.relabel(JOINING);
		onNext();
	};
	const onVisibility = () => {
		if (!pageShown() && (count === 'pending' || count === 'running')) count = 'stopped';
	};
	const watchPage = (on: boolean) => {
		if (typeof document === 'undefined') return;
		if (on) document.addEventListener('visibilitychange', onVisibility);
		else document.removeEventListener('visibilitychange', onVisibility);
	};

	const clear = () => {
		for (const egg of eggs) egg.sprite.destroy();
		eggs.length = 0;
		built?.overlay.destroy();
		built?.fish.destroy();
		built?.title.destroy();
		built?.subtitle?.destroy();
		built?.button.destroy();
		built?.next.destroy();
		built?.eggs.destroy();
		built = undefined;
	};

	/** Lay the screen out for the canvas's size, as the original did for a window. */
	const build = (won: WinShown, w: number, h: number) => {
		clear();
		const portrait = h > w;
		const fishScale = portrait ? Math.max(4, (w * 0.77) / OLD_FISH) : 14;
		const overlay = new Graphics().rect(0, 0, w, h).fill({ color: 0x000000, alpha: OVERLAY_ALPHA });
		overlay.eventMode = 'static';
		const texture = won.won ? fish.golden : fish.pink;
		const big = new Sprite(texture);
		big.anchor.set(0.5);
		big.scale.set((OLD_FISH * fishScale) / texture.width);
		big.position.set(w / 2, h / 2 + (portrait ? 20 : 40));
		const titleSize = portrait ? Math.max(20, Math.floor(w / 14)) : 48;
		const title = new Text({
			text: won.won ? 'You Won!' : `${won.winner} won!!!`,
			style: {
				fontFamily: PIXEL_FONT,
				fontSize: titleSize,
				fill: won.won ? 0xffdd57 : 0xff7777,
				align: 'center',
				wordWrap: true,
				wordWrapWidth: w * 0.85,
				dropShadow: { color: 0x000000, alpha: 1, blur: 0, distance: 4, angle: Math.PI / 4 },
			},
		});
		title.anchor.set(0.5, 1);
		title.position.set(w / 2, h / 2 + (portrait ? -Math.min(120, h * 0.15) : -200));
		const subtitle = won.won
			? undefined
			: new Text({
					text: 'Praise the Salmon!!!',
					style: {
						fontFamily: PIXEL_FONT,
						fontSize: portrait ? Math.max(12, Math.floor(w / 28)) : 20,
						fill: 0xffaaaa,
						align: 'center',
					},
				});
		subtitle?.anchor.set(0.5, 0);
		subtitle?.position.set(w / 2, title.y + 14);
		const button = pixelButton(labelOf(won), press);
		// Built again (the window changed) after the press: it is still joining.
		if (exitAt !== undefined) button.relabel(JOINING);
		button.view.position.set(portrait ? w / 2 : 40 + button.width / 2, h - 80 + button.height / 2);
		const next = new Text({
			text: '',
			style: {
				fontFamily: PIXEL_FONT,
				fontSize: NEXT.fontSize,
				fill: NEXT.fill,
				align: 'center',
				stroke: { color: 0x000000, width: 4 },
			},
		});
		next.anchor.set(0.5, 1);
		next.position.set(Math.round(button.view.x), button.view.y - button.height / 2 - NEXT.gap);
		next.visible = false;
		const layer = new Container();
		root.addChild(overlay, layer, big, title, ...(subtitle ? [subtitle] : []), button.view, next);
		built = {
			overlay,
			fish: big,
			title,
			subtitle,
			button,
			next,
			eggs: layer,
			size: { w, h },
			fishScale,
			speedScale: portrait ? Math.min(1, w / 900) : 1,
			bob: big.y,
		};
	};

	const layEggs = (w: number, h: number) => {
		const b = built;
		const pixi = app;
		if (!b || !pixi || eggs.length >= EGG.max) return;
		if (!eggTextures.length) eggTextures = EGG_COLOURS.map((c) => eggTexture(pixi, c));
		const count = 1 + Math.floor(Math.random() * 3);
		for (let i = 0; i < count && eggs.length < EGG.max; i++) {
			const r = 7 + Math.random() * 5;
			const sprite = new Sprite(eggTextures[Math.floor(Math.random() * eggTextures.length)]);
			sprite.anchor.set(0.5);
			sprite.scale.set(r / EGG.texR);
			b.eggs.addChild(sprite);
			eggs.push({
				sprite,
				x: Math.min(w, b.fish.x - 16 * b.fishScale + (Math.random() - 0.5) * 12),
				y: Math.min(h, b.fish.y + 4 * b.fishScale + (Math.random() - 0.5) * 12),
				vx: (-150 - Math.random() * 80) * b.speedScale,
				vy: 30 + Math.random() * 60,
				r,
				rest: false,
			});
		}
	};

	const stepEggs = (dt: number, w: number, h: number) => {
		for (const egg of eggs) {
			egg.x += egg.vx * dt;
			if (egg.rest) egg.vx *= EGG.friction;
			else {
				egg.vy += EGG.gravity * dt;
				egg.y += egg.vy * dt;
			}
			const floor = h - egg.r;
			if (egg.y >= floor) {
				egg.y = floor;
				if (!egg.rest) {
					egg.vy = -egg.vy * EGG.bounce;
					egg.vx *= EGG.friction;
					if (Math.abs(egg.vy) < EGG.restVy) {
						egg.vy = 0;
						egg.rest = true;
					}
				}
			} else egg.rest = false;
			if (egg.x < egg.r) {
				egg.x = egg.r;
				egg.vx = -egg.vx * EGG.restitution;
			} else if (egg.x > w - egg.r) {
				egg.x = w - egg.r;
				egg.vx = -egg.vx * EGG.restitution;
			}
		}
		collideEggs(eggs);
		for (const egg of eggs) egg.sprite.position.set(egg.x, egg.y);
	};

	/** Run the count once the screen is up; at 0 do what the button does. */
	const countDown = (b: NonNullable<typeof built>) => {
		if (count === 'pending' && onScreen(root)) {
			count = 'running';
			countFrom = clock;
		}
		if (count === 'running' && (!onScreen(root) || !pageShown())) count = 'stopped';
		const leftMs = NEXT_GAME_SECONDS * 1000 - (clock - countFrom);
		if (count === 'running' && leftMs <= 0) press();
		b.next.visible = count === 'running';
		if (count === 'running') b.next.text = `Next game in ${Math.ceil(leftMs / 1000)}`;
	};

	const tick = (ticker: Ticker) => {
		const dtMs = Math.min(50, ticker.deltaMS);
		clock += dtMs;
		if (!shown || !app) return;
		const w = app.screen.width;
		const h = app.screen.height;
		if (clock - since < START_DELAY_MS) return;
		if (!built || built.size.w !== w || built.size.h !== h) build(shown, w, h);
		const b = built;
		if (!b) return;
		countDown(b);
		const dt = dtMs / 1000;
		if (exitAt !== undefined) {
			b.fish.x += EXIT.pxPerSecond * dt;
		} else if (shown.won) {
			b.bob += Math.sin((clock / 1000) * 8) * 0.5 * (dtMs / (1000 / 60));
			b.fish.y = b.bob;
		}
		if (shown.won) {
			if (exitAt === undefined && clock - lastEggAt >= EGG.everyMs) {
				lastEggAt = clock;
				layEggs(w, h);
			}
			stepEggs(dt, w, h);
		}
	};

	const stop = () => {
		app?.ticker.remove(tick);
		app = undefined;
	};

	return {
		mount: (into, pixi) => {
			stop();
			app = pixi;
			into.addChild(root);
			pixi.ticker.add(tick);
			watchPage(true);
			return () => {
				stop();
				watchPage(false);
				into.removeChild(root);
			};
		},
		show: (next) => {
			if (next?.winner === shown?.winner && next?.won === shown?.won) return;
			clear();
			shown = next;
			since = clock;
			lastEggAt = -Infinity;
			exitAt = undefined;
			count = next?.count ? (pageShown() ? 'pending' : 'stopped') : 'off';
		},
		drawn: () => ({
			shown: built !== undefined,
			title: built?.title.text ?? '',
			eggs: eggs.length,
			leaving: exitAt !== undefined,
			label: built ? (exitAt !== undefined ? JOINING : labelOf(shown)) : '',
			button: built && {
				x: Math.round(built.button.view.toGlobal({ x: 0, y: 0 }).x),
				y: Math.round(built.button.view.toGlobal({ x: 0, y: 0 }).y),
			},
			next:
				built && count === 'running'
					? Math.ceil((NEXT_GAME_SECONDS * 1000 - (clock - countFrom)) / 1000)
					: null,
			count,
			boxes: built
				? {
						title: boxOf(built.title),
						...(built.subtitle ? { subtitle: boxOf(built.subtitle) } : {}),
						button: boxOf(built.button.view),
						...(built.next.visible ? { next: boxOf(built.next) } : {}),
					}
				: {},
		}),
		destroy: () => {
			stop();
			watchPage(false);
			clear();
			for (const texture of eggTextures) texture.destroy(true);
			eggTextures = [];
			root.destroy({ children: true });
		},
	};
}
