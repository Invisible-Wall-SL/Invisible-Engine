import { Container, Graphics, Text } from 'pixi.js';

import { createTouch3d, type TouchButtonId3d, type TouchFrame3d } from './pure/touch';

export type TouchControls3d = {
	/** This frame's input (stick, buttons, look travel); also shows or hides the controls. */
	read(): TouchFrame3d;
	/** The controls hold this pointer: nothing else may act on it (aim, a mouse-style look). */
	owns(pointerId: number): boolean;
	release(): void;
};

export type TouchControlsOptions3d = {
	/** The Pixi canvas: a touch that starts on it may be the controls'. */
	canvas: HTMLCanvasElement;
	/** The HUD container the controls draw in, at `zIndex` (the Pixi stage). */
	parent: Container;
	zIndex: number;
	/** A client point in the parent's units (the HUD's CSS px). */
	toLocal(clientX: number, clientY: number): { x: number; y: number };
	/** An interactive HUD object is under this point: the touch is the HUD's, not the controls'. */
	hudTakes(x: number, y: number): boolean;
	/** The screen, in the parent's units. */
	size(): { width: number; height: number };
	/** Shown from the start (a touch-first device); otherwise from the first touch. */
	shown: boolean;
	/** Hidden for now (a press-to-continue overlay is up). */
	blocked(): boolean;
};

const WHITE = 0xffffff;
const RUN = 0xffb347;

/**
 * The 3D field's touch controls drawn in the Pixi HUD (`pure/touch.ts` decides what each finger
 * does): the stick at the bottom left, jump / attack / interact at the bottom right. Only touch and
 * pen pointers are read, and a touch on an interactive HUD object stays the HUD's. The layer takes
 * no Pixi events, so the HUD's hit test never finds it.
 */
export function mountTouchControls3d(o: TouchControlsOptions3d): TouchControls3d {
	const screen = o.size();
	const touch = createTouch3d(screen.width, screen.height);
	let shown = o.shown;

	const layer = new Container({ zIndex: o.zIndex, eventMode: 'none', visible: false });
	layer.label = 'touchControls3d';
	const base = new Graphics();
	const knob = new Graphics();
	layer.addChild(base, knob);
	const buttons = new Map<TouchButtonId3d, { ring: Graphics; label: Text }>();
	for (const b of touch.layout().buttons) {
		const ring = new Graphics();
		const label = new Text({
			text: b.label,
			style: { fill: WHITE, fontFamily: 'system-ui, sans-serif', fontWeight: '700', fontSize: 16 },
		});
		label.anchor.set(0.5);
		layer.addChild(ring, label);
		buttons.set(b.id, { ring, label });
	}
	o.parent.addChild(layer);

	const place = () => {
		for (const b of touch.layout().buttons) {
			const parts = buttons.get(b.id);
			if (!parts) continue;
			parts.label.position.set(b.x, b.y);
			parts.label.style.fontSize = Math.round(b.r * 0.42);
		}
	};
	const draw = () => {
		const layout = touch.layout();
		const view = touch.view();
		const { stick } = view;
		const r = layout.stickRadius;
		base
			.clear()
			.circle(stick.base.x, stick.base.y, r)
			.fill({ color: 0x000000, alpha: 0.18 })
			.stroke({ width: 2, color: WHITE, alpha: stick.held ? 0.55 : 0.3 });
		knob
			.clear()
			.circle(stick.knob.x, stick.knob.y, r * 0.42)
			.fill({ color: stick.run ? RUN : WHITE, alpha: stick.held ? 0.7 : 0.35 });
		for (const b of layout.buttons) {
			const pressed = view.pressed.has(b.id);
			buttons
				.get(b.id)
				?.ring.clear()
				.circle(b.x, b.y, b.r)
				.fill({ color: 0x000000, alpha: pressed ? 0.45 : 0.25 })
				.stroke({ width: 2, color: WHITE, alpha: pressed ? 0.9 : 0.55 });
		}
	};
	place();
	draw();

	const isTouch = (e: PointerEvent) => e.pointerType === 'touch' || e.pointerType === 'pen';
	const local = (e: PointerEvent) => o.toLocal(e.clientX, e.clientY);
	const down = (e: PointerEvent) => {
		if (!isTouch(e) || o.blocked()) return;
		const p = local(e);
		if (o.hudTakes(p.x, p.y)) return;
		shown = true;
		if (touch.down(e.pointerId, p.x, p.y)) draw();
	};
	const move = (e: PointerEvent) => {
		if (!touch.owns(e.pointerId)) return;
		const p = local(e);
		touch.move(e.pointerId, p.x, p.y);
		draw();
	};
	const up = (e: PointerEvent) => {
		if (!touch.owns(e.pointerId)) return;
		touch.up(e.pointerId);
		draw();
	};
	const resize = () => {
		const s = o.size();
		touch.resize(s.width, s.height);
		place();
		draw();
	};
	const letGoAll = () => {
		touch.clear();
		draw();
	};
	// A drag on the canvas is play, not a page pan: with `touch-action: auto` the browser takes the
	// first move of a thumb as a scroll and cancels the pointer (iOS Safari and Chrome alike).
	const touchAction = o.canvas.style.touchAction;
	o.canvas.style.touchAction = 'none';
	// Capture: on the canvas itself this runs before the stage's own pointer listeners, so they can
	// ask `owns` about the very touch that just came down.
	o.canvas.addEventListener('pointerdown', down, { capture: true });
	window.addEventListener('pointermove', move);
	window.addEventListener('pointerup', up);
	window.addEventListener('pointercancel', up);
	window.addEventListener('resize', resize);
	window.addEventListener('blur', letGoAll);

	return {
		read() {
			const blocked = o.blocked();
			if (blocked) touch.clear();
			const visible = shown && !blocked;
			if (visible && !layer.visible) draw();
			layer.visible = visible;
			return touch.read();
		},
		owns: (id) => touch.owns(id),
		release() {
			o.canvas.removeEventListener('pointerdown', down, { capture: true });
			o.canvas.style.touchAction = touchAction;
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', up);
			window.removeEventListener('resize', resize);
			window.removeEventListener('blur', letGoAll);
			touch.clear();
			layer.destroy({ children: true });
		},
	};
}
