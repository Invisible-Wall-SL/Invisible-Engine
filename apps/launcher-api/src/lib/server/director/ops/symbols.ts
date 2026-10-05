import { SYMBOL_STATES } from 'engine-layout';
import { symbolsDocKey } from '../../projectPaths';
import {
	loadSymbolsDocWithEtag,
	saveSymbolsDoc,
	type SymbolCell,
	type SymbolsDoc,
} from '../../symbolsStorage';
import { AdapterError, defineOp, type AdapterContext } from '../adapter';
import { baseEtagProp, baseOf, preconditionOf, projectOf, validated } from './docs';

/**
 * Invisible Symbols State Machine adapters (PLAN 2.6), through `symbolsStorage.ts`: the same load
 * and the same `saveSymbolsDoc` (Zod validation, backup before the PUT, `If-Match`) the `/symbols`
 * page saves with. The animator binds art to a symbol's states; the doc's other blocks (win line,
 * highlight, flights, …) are carried through untouched.
 */

const SYMBOL = '^[A-Za-z0-9_]{1,32}$';

export interface SymbolBinding {
	type: 'sprite' | 'spine' | 'flipbook';
	assetKey: string;
	animationName?: string;
	clipId?: string;
	sizeRatios?: { width: number; height: number };
	loop?: boolean;
	fps?: number;
	direction?: 'forward' | 'reverse' | 'pingpong';
	flipX?: boolean;
	flipY?: boolean;
}

async function loadForWrite(ctx: AdapterContext) {
	const { clientKey, projectKey } = projectOf(ctx);
	const loaded = await loadSymbolsDocWithEtag(clientKey, projectKey);
	if (loaded.corrupt) {
		throw new AdapterError(
			409,
			'unreadable_doc',
			"The project's symbols doc is unreadable. A person must repair it in Invisible Symbols.",
		);
	}
	return loaded;
}

export const getMap = defineOp<
	Record<string, never>,
	{
		states: readonly string[];
		symbols: SymbolsDoc['symbols'];
		names: NonNullable<SymbolsDoc['names']>;
		baseEtag: string;
	}
>({
	tool: 'symbols',
	name: 'get_map',
	description:
		"The project's symbol × state bindings (sparse: an unbound state falls back to the game's coded art), the symbols' display names, and the baseEtag to hand back to symbols.set_state.",
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	agents: ['animator'],
	scope: 'project',
	write: false,
	handler: async (ctx) => {
		const { doc, etag } = await loadForWrite(ctx);
		return {
			states: SYMBOL_STATES,
			symbols: doc.symbols,
			names: doc.names ?? {},
			baseEtag: baseOf(etag),
		};
	},
});

export const setState = defineOp<
	{ symbol: string; state: string; binding: SymbolBinding; baseEtag: string },
	{ symbol: string; state: string; cell: SymbolCell; baseEtag: string }
>({
	tool: 'symbols',
	name: 'set_state',
	description:
		"Bind one symbol's state to art: a sprite region, a Spine animation or a Flipbook clip. Replaces that one cell and keeps its decoration layers; every other binding is untouched.",
	inputSchema: {
		type: 'object',
		properties: {
			symbol: { type: 'string', description: 'The symbol id, e.g. H1.', pattern: SYMBOL },
			state: { type: 'string', enum: SYMBOL_STATES },
			binding: {
				type: 'object',
				properties: {
					type: { type: 'string', enum: ['sprite', 'spine', 'flipbook'] },
					assetKey: {
						type: 'string',
						description:
							'The art: `<manifest key>::<region>` for a sprite, the Spine bundle for spine, the clip sheet for flipbook.',
						minLength: 1,
						maxLength: 400,
					},
					animationName: { type: 'string', minLength: 1, maxLength: 120 },
					clipId: { type: 'string', minLength: 1, maxLength: 120 },
					sizeRatios: {
						type: 'object',
						properties: {
							width: { type: 'number', minimum: 0, maximum: 10 },
							height: { type: 'number', minimum: 0, maximum: 10 },
						},
						required: ['width', 'height'],
						additionalProperties: false,
					},
					loop: { type: 'boolean' },
					fps: { type: 'number', minimum: 1, maximum: 240 },
					direction: { type: 'string', enum: ['forward', 'reverse', 'pingpong'] },
					flipX: { type: 'boolean' },
					flipY: { type: 'boolean' },
				},
				required: ['type', 'assetKey'],
				additionalProperties: false,
			},
			baseEtag: baseEtagProp,
		},
		required: ['symbol', 'state', 'binding', 'baseEtag'],
		additionalProperties: false,
	},
	agents: ['animator'],
	scope: 'project',
	write: true,
	writes: (_input, scope) => [symbolsDocKey(scope.clientKey, scope.projectKey)],
	handler: async (ctx, { symbol, state, binding, baseEtag }) => {
		const { clientKey, projectKey } = projectOf(ctx);
		const { doc } = await loadForWrite(ctx);
		const states = { ...doc.symbols[symbol] } as Record<string, SymbolCell>;
		const layers = states[state]?.layers;
		states[state] = { ...binding, ...(layers ? { layers } : {}) } as SymbolCell;
		const next = { ...doc, symbols: { ...doc.symbols, [symbol]: states } };
		const saved = await validated(() =>
			saveSymbolsDoc(clientKey, projectKey, next, preconditionOf(baseEtag), 'auto', {
				savedBy: ctx.savedBy,
			}),
		);
		return {
			symbol,
			state,
			cell: (saved.doc.symbols[symbol] as Record<string, SymbolCell>)[state],
			baseEtag: baseOf(saved.etag),
		};
	},
});

export const SYMBOLS_OPS = [getMap, setState];
