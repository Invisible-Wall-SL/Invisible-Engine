/**
 * The twins of the six built-in BREAK kinds (step 8b): the element as it is (the Output alone), and a
 * Break Output naming the kind, starting at once (`at` 0: the whole play is the break, as the
 * built-in's is; an assemble's pieces fly in over all of it), each of its params tied to the effect's
 * param of the same id. The break is the built-in's own code, so the twin breaks as it does: the
 * still is cut from the element through the graph's pass, which leaves it as it is.
 */

import { elementFxSpec } from 'constants-shared/elementFx';
import { BREAK_KINDS, BREAK_OUTPUT, type BreakKind } from '../break';
import type { BuiltinTwin } from '../twins';
import type { GraphNode } from '../types';
import { twinGraph } from './graph';

const COLUMN = 300;
const ROW = 96;

const breakTwin = (kind: BreakKind): BuiltinTwin => {
	const g = twinGraph(kind, {});
	g.output();
	const doc = g.doc();
	const [output] = doc.nodes;
	const params = elementFxSpec(kind).params;
	const brk: GraphNode = {
		id: `${BREAK_OUTPUT}${doc.nodes.length + params.length + 1}`,
		type: BREAK_OUTPUT,
		x: output.x,
		y: output.y + 2 * ROW,
		values: { kind, at: 0 },
	};
	params.forEach((param, i) => {
		const id = `param${doc.nodes.length + 1}`;
		doc.nodes.push({
			id,
			type: 'param',
			x: output.x - COLUMN,
			y: brk.y + i * ROW,
			values: { param: param.id },
		});
		doc.wires.push({ from: { node: id, port: 'out' }, to: { node: brk.id, port: param.id } });
	});
	doc.nodes.push(brk);
	return { kind, doc };
};

export const BREAK_TWINS: readonly BuiltinTwin[] = BREAK_KINDS.map(breakTwin);

/** Whether `twin` is a break's: it has a Break Output. */
export const isBreakTwin = (twin: BuiltinTwin): boolean =>
	twin.doc.nodes.some((node) => node.type === BREAK_OUTPUT);
