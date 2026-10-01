import type * as PIXI from 'pixi.js';

/**
 * NAMED ANCHORS — "where on screen is the thing called X right now", for code that has to aim at a
 * mounted container it does not own (a flight flying into the win meter or a layout node). An
 * `<Anchor name>` registers the container it is mounted in; {@link resolveAnchor} returns the most
 * recently registered one that is still on screen. Registering draws nothing and adds no child, so
 * an anchor cannot move anything's paint order.
 */
const anchors = new Map<string, PIXI.Container[]>();

export const registerAnchor = (name: string, container: PIXI.Container): (() => void) => {
	const list = anchors.get(name) ?? [];
	list.push(container);
	anchors.set(name, list);
	return () => {
		const current = anchors.get(name);
		if (!current) return;
		const index = current.lastIndexOf(container);
		if (index >= 0) current.splice(index, 1);
		if (current.length === 0) anchors.delete(name);
	};
};

/** Visible all the way up and not destroyed — a hidden HUD variant must not catch the flight. */
const isShown = (container: PIXI.Container): boolean => {
	for (let node: PIXI.Container | null = container; node; node = node.parent) {
		if (node.destroyed || !node.visible || node.alpha <= 0) return false;
	}
	return true;
};

export const resolveAnchor = (name: string): PIXI.Container | undefined => {
	const list = anchors.get(name);
	if (!list) return undefined;
	for (let i = list.length - 1; i >= 0; i--) {
		if (isShown(list[i])) return list[i];
	}
	return undefined;
};

/**
 * The anchor's centre in GLOBAL (stage) coordinates: the centre of its bounds, or its origin when it
 * has no extent yet.
 */
export const resolveAnchorPoint = (name: string): { x: number; y: number } | undefined => {
	const container = resolveAnchor(name);
	if (!container) return undefined;
	const bounds = container.getBounds();
	if (bounds.width > 0 && bounds.height > 0) {
		return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
	}
	const origin = container.toGlobal({ x: 0, y: 0 });
	return { x: origin.x, y: origin.y };
};
