/**
 * A rig's setup draw order (its slots, back to front), as the Rigger page and the launcher both read
 * it. Pure, so the page (through `vendor/rigger-motion.js`) lists what the launcher will build.
 */

/** The last slot of side `s`'s arm (as the cut's `arm_tail`): a prop on a hand is drawn after it. */
export function armTail(slots: readonly string[], s: string): string {
	const start = Math.max(0, slots.indexOf('hair_front'));
	const side = slots.slice(start).filter((n) => n.endsWith(`_${s}`));
	return side[side.length - 1] ?? `hand_${s}`;
}

/** A slot drawn just before or just after the slot it names. */
export interface SlotPlace {
	name: string;
	before?: string;
	after?: string;
}

/** `slots` with each place inserted in turn, as `fitTemplate` inserts a fit's props. */
export function withSlotPlaces(slots: readonly string[], places: readonly SlotPlace[]): string[] {
	const out = [...slots];
	for (const p of places) {
		const at = out.indexOf((p.before ?? p.after)!);
		if (at < 0) continue;
		out.splice(p.after !== undefined ? at + 1 : at, 0, p.name);
	}
	return out;
}

/**
 * `slots` with the ones `order` names drawn in that order (back to front) in the places they hold
 * between them; every other slot stays where it is. A name `slots` lacks is skipped.
 */
export function inDrawOrder(slots: readonly string[], order: readonly string[]): string[] {
	const have = new Set(slots);
	const listed = [...new Set(order.filter((n) => have.has(n)))];
	const named = new Set(listed);
	let next = 0;
	return slots.map((n) => (named.has(n) ? listed[next++] : n));
}

/**
 * Each draw-order layer (slots that move in the draw order as one, `rig3d.layers`) cut to its slots
 * that are still together in `slots`: the longest run of them, the first on a tie. A slot the author
 * drew elsewhere leaves its layer, so a bake never pulls it back.
 */
export function layersTogether(
	layers: Readonly<Record<string, readonly string[]>>,
	slots: readonly string[],
): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	for (const [layer, members] of Object.entries(layers)) {
		const own = new Set(members);
		let best: string[] = [];
		let run: string[] = [];
		for (const n of slots) {
			if (own.has(n)) run.push(n);
			else run = [];
			if (run.length > best.length) best = [...run];
		}
		out[layer] = members.filter((n) => best.includes(n));
	}
	return out;
}
