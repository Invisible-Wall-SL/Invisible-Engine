/**
 * Invisible Flow v2 — the checks for game variables, the key map and tick chains
 * (`docs/design/game-families.md` §3.1–§3.2, §2.2 #3). Called by `validateFlowDoc`; a doc that
 * declares no variable and holds none of these nodes gets no issue from here.
 *
 *  - `variable-type` / `variable-duplicate` / `variable-scope` / `variable-shadows-money` on the
 *    declarations themselves;
 *  - `variable-unknown`, `variable-scope` (a mode's variable used outside its mode) and
 *    `variable-type` (a toggle of a number, a threshold on a bool…) on the nodes and `$var` reads;
 *  - `variable-shadows-money` on a variable fed to a money value in an RGS game;
 *  - `variable-server-owned` on a variable an online room writes (`server`): one naming no room
 *    value, one not game-scoped, and a Set or Change of it (the online twin of the money rule);
 *  - `tick-async` (a tick chain waits on something) and `tick-fast` (a tick under 100 ms);
 *  - `input-unknown` (an On Input naming an action the key map lacks).
 */

import { flattenGroups } from './collapse';
import type { PinContext } from './pins';
import type { DataSource, FlowDoc, FlowVariable, FunctionLibraryDoc, Graph, Node } from './types';
import type { FlowIssue } from './validate';
import {
	SERVER_VARIABLE_SOURCES,
	coerceVariableValue,
	docVariables,
	serverSourceFits,
	type FlowVariableDecl,
} from './variables';

/** The engine values that are money (§2.2 #3): a variable may not take one's name. */
export const MONEY_VALUE_NAMES: readonly string[] = ['balance', 'win', 'totalWin', 'bet'];

/** The action params that put an amount of money on screen: a variable may not feed one in an RGS
 *  game, where money comes only from books (§2.2 #3). */
export const MONEY_ACTION_PARAMS: Readonly<Record<string, readonly string[]>> = {
	setWinBookEventAmount: ['amount'],
	setBetAmount: ['amount'],
	winUpdate: ['amount'],
	freeSpinOutroCountUp: ['amount'],
	showMessage: ['amount'],
};

/** A tick under this period is warned about: per-frame work belongs to the mechanic (§3.2). */
export const TICK_MIN_MS = 100;

const VARIABLE_TYPES: ReadonlySet<string> = new Set(['int', 'float', 'bool', 'string', 'enum']);
const VARIABLE_SCOPES: ReadonlySet<string> = new Set(['game', 'round', 'mode']);

const at = (variable: string): FlowIssue['at'] => ({ on: 'variable', variable });

/** The declaration checks, once per doc. `outcome` absent ⇒ an RGS game (every slot). */
export const variableDeclIssues = (doc: FlowDoc, outcome: PinContext['outcome']): FlowIssue[] => {
	const issues: FlowIssue[] = [];
	const seen = new Set<string>();
	for (const v of docVariables(doc)) {
		const where = v.mode ? ` in the '${v.mode}' section` : '';
		if (!v.id) {
			issues.push({
				code: 'variable-type',
				severity: 'error',
				message: `a variable${where} has no id`,
				at: at(''),
			});
			continue;
		}
		if (seen.has(v.id)) {
			issues.push({
				code: 'variable-duplicate',
				severity: 'error',
				message: `variable '${v.id}' is declared twice — every variable needs its own id`,
				at: at(v.id),
				...(v.mode ? { mode: v.mode } : {}),
			});
		}
		seen.add(v.id);
		if (!VARIABLE_TYPES.has(v.type)) {
			issues.push({
				code: 'variable-type',
				severity: 'error',
				message: `variable '${v.id}' has no known type (int, float, bool, string or enum)`,
				at: at(v.id),
			});
		} else if (v.type === 'enum' && !(v.values ?? []).length) {
			issues.push({
				code: 'variable-type',
				severity: 'error',
				message: `enum variable '${v.id}' lists no values`,
				at: at(v.id),
			});
		} else if (!initialFits(v)) {
			issues.push({
				code: 'variable-type',
				severity: 'error',
				message: `variable '${v.id}' starts at ${JSON.stringify(v.initial)}, which is not a ${v.type}${
					v.type === 'enum' ? ` (${(v.values ?? []).join(', ')})` : ''
				}`,
				at: at(v.id),
			});
		}
		if (!VARIABLE_SCOPES.has(v.scope)) {
			issues.push({
				code: 'variable-scope',
				severity: 'error',
				message: `variable '${v.id}' has no known scope (game, round or mode)`,
				at: at(v.id),
			});
		} else if (v.mode && v.scope !== 'mode') {
			issues.push({
				code: 'variable-scope',
				severity: 'error',
				message: `variable '${v.id}' is declared in the '${v.mode}' section, so its scope is 'mode', not '${v.scope}'`,
				at: at(v.id),
				mode: v.mode,
			});
		} else if (!v.mode && v.scope === 'mode') {
			issues.push({
				code: 'variable-scope',
				severity: 'error',
				message: `variable '${v.id}' is mode-scoped but declared for the whole game — declare it in its mode's section`,
				at: at(v.id),
			});
		}
		if ((outcome ?? 'rgs') === 'rgs' && MONEY_VALUE_NAMES.includes(v.id)) {
			issues.push({
				code: 'variable-shadows-money',
				severity: 'error',
				message: `variable '${v.id}' is named after a money value — in a real-money game the ${v.id} comes only from the server; rename it`,
				at: at(v.id),
			});
		}
		if (v.server !== undefined) issues.push(...serverDeclIssues(v));
	}
	return issues;
};

/** A server-owned variable names a room value it can hold, and is never reset by Flow. */
const serverDeclIssues = (v: FlowVariableDecl): FlowIssue[] => {
	const kind = Object.hasOwn(SERVER_VARIABLE_SOURCES, v.server ?? '')
		? SERVER_VARIABLE_SOURCES[v.server ?? '']
		: undefined;
	if (!kind) {
		return [
			{
				code: 'variable-server-owned',
				severity: 'error',
				message: `variable '${v.id}' mirrors '${v.server}', which is not a room value (${Object.keys(SERVER_VARIABLE_SOURCES).join(', ')})`,
				at: at(v.id),
			},
		];
	}
	const issues: FlowIssue[] = [];
	if (VARIABLE_TYPES.has(v.type) && !serverSourceFits(v.type, kind)) {
		issues.push({
			code: 'variable-type',
			severity: 'error',
			message: `variable '${v.id}' is a ${v.type}, but the room's ${v.server} is a ${kind}`,
			at: at(v.id),
		});
	}
	if (v.scope !== 'game') {
		issues.push({
			code: 'variable-server-owned',
			severity: 'error',
			message: `variable '${v.id}' mirrors the room's ${v.server}, so its scope is 'game': only the room changes it`,
			at: at(v.id),
			...(v.mode ? { mode: v.mode } : {}),
		});
	}
	return issues;
};

/** Does the variable's `initial` store as its type exactly (a 1.5 is not an int)? */
const initialFits = (v: FlowVariable): boolean => {
	const stored = coerceVariableValue(v, v.initial);
	return stored !== undefined && Object.is(stored, v.initial);
};

/** Every `DataSource` a node carries: its `inputs`, a branch's guard operands, a compute's operands. */
const sourcesOf = (node: Node): { pin: string; src: DataSource }[] => {
	const out = Object.entries(node.inputs ?? {}).map(([pin, src]) => ({ pin, src }));
	if (node.kind === 'branch') {
		for (const group of ['all', 'any'] as const) {
			(node.guard[group] ?? []).forEach((c, i) => {
				out.push({ pin: `${group}.${i}.left`, src: c.left });
				out.push({ pin: `${group}.${i}.right`, src: c.right });
			});
		}
	}
	if (node.kind === 'compute') {
		const op = node.compute;
		if (op.op === 'member') out.push({ pin: 'on', src: op.on });
		else out.push({ pin: 'a', src: op.a }, { pin: 'b', src: op.b });
	}
	return out;
};

const variableOfNode = (node: Node): string | undefined =>
	node.kind === 'setVariable' || node.kind === 'changeVariable' || node.kind === 'onVariable'
		? node.variable
		: undefined;

/**
 * The checks on one graph's nodes (`modeId` ⇒ a mode's section). The variable checks run only when
 * the context carries the doc's variables (`ctx.variables`; `validateFlowDoc` always passes them, an
 * empty list for a doc that declares none) — a bare caller is never judged on them.
 */
export const variableNodeIssues = (
	graph: Graph,
	ctx: PinContext,
	modeId: string | undefined,
	doc: Pick<FlowDoc, 'inputs'>,
): FlowIssue[] => {
	const issues: FlowIssue[] = [];
	const known = ctx.variables;
	const byId = new Map<string, FlowVariableDecl>((known ?? []).map((v) => [v.id, v]));
	const judge = (node: Node, id: string, pin: string | undefined): FlowVariableDecl | undefined => {
		const where: FlowIssue['at'] = pin
			? { on: 'pin', node: node.id, pin }
			: { on: 'node', node: node.id };
		const decl = byId.get(id);
		if (!decl) {
			issues.push({
				code: 'variable-unknown',
				severity: 'error',
				message: `${node.kind} node '${node.id}' uses variable '${id}', which the flow does not declare`,
				at: where,
			});
			return undefined;
		}
		if (decl.mode && decl.mode !== modeId) {
			issues.push({
				code: 'variable-scope',
				severity: 'error',
				message: `variable '${id}' belongs to the '${decl.mode}' mode, but node '${node.id}' uses it ${
					modeId ? `in the '${modeId}' section` : 'in the global graph'
				}`,
				at: where,
			});
		}
		return decl;
	};

	if (known) {
		for (const node of graph.nodes) {
			for (const { pin, src } of sourcesOf(node)) {
				if (src.kind === 'accessor' && src.path.on === 'var') judge(node, src.path.id, pin);
			}
			const id = variableOfNode(node);
			if (id === undefined) continue;
			const decl = judge(node, id, undefined);
			if (!decl) continue;
			if (decl.server && (node.kind === 'setVariable' || node.kind === 'changeVariable')) {
				issues.push({
					code: 'variable-server-owned',
					severity: 'error',
					message: `${node.kind === 'setVariable' ? 'set' : 'change'} node '${node.id}' writes '${id}', which the room owns (its ${decl.server}) — Flow may only read it`,
					at: { on: 'node', node: node.id },
				});
			}
			const numeric = decl.type === 'int' || decl.type === 'float';
			if (node.kind === 'changeVariable') {
				const ok = node.op === 'toggle' ? decl.type === 'bool' : numeric;
				if (!ok) {
					issues.push({
						code: 'variable-type',
						severity: 'error',
						message:
							node.op === 'toggle'
								? `change node '${node.id}' toggles '${id}', which is a ${decl.type}, not a bool`
								: `change node '${node.id}' adds to '${id}', which is a ${decl.type}, not a number`,
						at: { on: 'node', node: node.id },
					});
				}
			}
			if (node.kind === 'onVariable' && node.on === 'crosses') {
				if (!numeric) {
					issues.push({
						code: 'variable-type',
						severity: 'error',
						message: `on-variable node '${node.id}' watches '${id}' cross a threshold, but '${id}' is a ${decl.type}, not a number`,
						at: { on: 'node', node: node.id },
					});
				} else if (typeof node.threshold !== 'number' || !Number.isFinite(node.threshold)) {
					issues.push({
						code: 'variable-type',
						severity: 'error',
						message: `on-variable node '${node.id}' watches '${id}' cross a threshold but sets none`,
						at: { on: 'node', node: node.id },
					});
				}
			}
			if (node.kind === 'setVariable' && decl.type === 'enum') {
				const src = node.inputs?.value;
				if (src?.kind === 'literal' && !(decl.values ?? []).includes(String(src.value))) {
					issues.push({
						code: 'variable-type',
						severity: 'error',
						message: `set node '${node.id}' sets '${id}' to ${JSON.stringify(src.value)}, which is not one of ${(decl.values ?? []).join(', ')}`,
						at: { on: 'pin', node: node.id, pin: 'value' },
					});
				}
			}
		}
		if ((ctx.outcome ?? 'rgs') === 'rgs') issues.push(...moneyFeedIssues(graph));
	}

	const actions = new Set((doc.inputs ?? []).map((b) => b.action));
	for (const node of graph.nodes) {
		if (node.kind === 'onInput' && !actions.has(node.action)) {
			issues.push({
				code: 'input-unknown',
				severity: 'warning',
				message: `on-input node '${node.id}' listens for '${node.action}', which no key is mapped to — add it in the key map`,
				at: { on: 'node', node: node.id },
			});
		}
	}
	issues.push(...tickIssues(graph, ctx.library));
	return issues;
};

/** Does the value at data-in `(node, pin)` come from a variable — a `$var` read, an On Variable's
 *  data-out, or a compute over one? */
const fedByVariable = (
	graph: Graph,
	nodeId: string,
	pin: string,
	seen: Set<string> = new Set(),
): boolean => {
	const key = `${nodeId}\u0000${pin}`;
	if (seen.has(key)) return false;
	seen.add(key);
	const edge = graph.data.find((e) => e.to.node === nodeId && e.to.pin === pin);
	const node = graph.nodes.find((n) => n.id === nodeId);
	if (!edge) {
		const src = node?.inputs?.[pin];
		return src?.kind === 'accessor' && src.path.on === 'var';
	}
	const from = graph.nodes.find((n) => n.id === edge.from.node);
	if (!from) return false;
	if (from.kind === 'onVariable') return true;
	if (from.kind !== 'compute') return false;
	return sourcesOf(from).some(
		({ pin: operand, src }) =>
			(src.kind === 'accessor' && src.path.on === 'var') ||
			(src.kind === 'wire' && fedByVariable(graph, from.id, operand, seen)),
	);
};

const moneyFeedIssues = (graph: Graph): FlowIssue[] =>
	graph.nodes.flatMap((node) => {
		if (node.kind !== 'action') return [];
		return (MONEY_ACTION_PARAMS[node.ref] ?? [])
			.filter((pin) => fedByVariable(graph, node.id, pin))
			.map((pin): FlowIssue => ({
				code: 'variable-shadows-money',
				severity: 'error',
				message: `action '${node.ref}' (${node.id}) shows a variable as money — in a real-money game the ${pin} comes only from the server's books`,
				at: { on: 'pin', node: node.id, pin },
			}));
	});

/** What a tick chain may not do: wait. Each returns why, or `undefined`. */
const waitOf = (node: Node, library: FunctionLibraryDoc, depth = 0): string | undefined => {
	switch (node.kind) {
		case 'delay':
			return 'a Delay';
		case 'fireCue':
			return node.await ? `an awaited cue '${node.ref}'` : undefined;
		case 'playCinematic':
			return node.awaitComplete && !node.loop ? `an awaited cinematic '${node.ref}'` : undefined;
		case 'showContainer':
			return node.awaitComplete ? `a held Show of '${node.ref}'` : undefined;
		case 'waitForState':
			return 'a Wait for state';
		case 'functionCall': {
			if (depth > 8) return undefined;
			const fn = library.functions.find((f) => f.id === node.ref);
			if (!fn) return undefined;
			for (const inner of flattenGroups(fn.body).nodes) {
				const why = waitOf(inner, library, depth + 1);
				if (why) return `function '${fn.name}', which holds ${why}`;
			}
			return undefined;
		}
		default:
			return undefined;
	}
};

/** `tick-async` on any node a tick chain reaches that waits; `tick-fast` on a tick under 100 ms. */
const tickIssues = (graph: Graph, library: FunctionLibraryDoc): FlowIssue[] => {
	const issues: FlowIssue[] = [];
	const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
	for (const tick of graph.nodes) {
		if (tick.kind !== 'onTick') continue;
		if (tick.every === undefined || !(tick.every >= TICK_MIN_MS)) {
			issues.push({
				code: 'tick-fast',
				severity: 'warning',
				message: `tick '${tick.id}' fires ${
					tick.every ? `every ${tick.every} ms` : 'every frame'
				} — Flow's tick is for game rules (spawn every 800 ms); per-frame work belongs to the mechanic. Use ${TICK_MIN_MS} ms or more`,
				at: { on: 'node', node: tick.id },
			});
		}
		const seen = new Set<string>();
		const queue = graph.exec.filter((e) => e.from.node === tick.id).map((e) => e.to.node);
		for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
			if (seen.has(id)) continue;
			seen.add(id);
			const node = byId.get(id);
			if (!node) continue;
			const why = waitOf(node, library);
			if (why) {
				issues.push({
					code: 'tick-async',
					severity: 'error',
					message: `tick '${tick.id}' reaches ${why} (${node.id}) — a tick chain must not wait; start a timer instead`,
					at: { on: 'node', node: node.id },
				});
			}
			for (const e of graph.exec) if (e.from.node === id) queue.push(e.to.node);
		}
	}
	return issues;
};

/** The entry kinds P10.3 adds — like an `event`, none may take an exec wire in. */
export const STATE_ENTRY_KINDS: ReadonlySet<Node['kind']> = new Set([
	'onVariable',
	'onTick',
	'onTimer',
	'onInput',
]);
