import type { WinTextDoc } from 'engine-layout';
import { ZodDefault, ZodObject, ZodOptional, ZodRecord, ZodString, type ZodTypeAny } from 'zod';
import { winTextDocKey } from '../../projectPaths';
import { loadWinTextDocWithEtag, saveWinTextDoc, winTextDocSchema } from '../../winTextStorage';
import { AdapterError, defineOp } from '../adapter';
import { baseEtagProp, baseOf, preconditionOf, projectOf, validated } from './docs';

/**
 * Invisible Win Text adapters (PLAN 2.6), through `winTextStorage.ts`: the tool's own load and
 * `saveWinTextDoc` (Zod validation, `If-Match`, carry-over of fields a newer launcher wrote). The
 * doc is sparse, so an edit names one template by its path and a blank value clears it back to
 * the game's coded default.
 */

/** The doc's authored blocks: every top-level field but the bookkeeping ones. */
const BLOCKS = Object.keys(winTextDocSchema.shape).filter(
	(k) => k !== 'version' && k !== 'updatedAt',
);
const PATH = `^(${BLOCKS.join('|')})(\\.[A-Za-z0-9_{}-]{1,60}){0,2}$`;

/**
 * Whether `path` names a TEMPLATE (a string) in the doc's schema. The save drops an unknown field
 * with a warning rather than refusing it, so a mistyped path would vanish without this.
 */
function isTemplatePath(path: string): boolean {
	let node: ZodTypeAny = winTextDocSchema;
	for (const segment of path.split('.')) {
		while (node instanceof ZodOptional || node instanceof ZodDefault) node = node._def.innerType;
		if (node instanceof ZodObject) {
			const next = (node.shape as Record<string, ZodTypeAny>)[segment];
			if (!next) return false;
			node = next;
		} else if (node instanceof ZodRecord) {
			node = node._def.valueType as ZodTypeAny;
		} else {
			return false;
		}
	}
	while (node instanceof ZodOptional || node instanceof ZodDefault) node = node._def.innerType;
	return node instanceof ZodString;
}

/** `doc` with the template at `path` set to `value`, creating the families on the way. */
function withTemplate(
	doc: Record<string, unknown>,
	path: string,
	value: string,
): Record<string, unknown> {
	const [head, ...rest] = path.split('.');
	if (rest.length === 0) return { ...doc, [head]: value };
	const inner = doc[head];
	const family =
		typeof inner === 'object' && inner !== null && !Array.isArray(inner)
			? (inner as Record<string, unknown>)
			: {};
	return { ...doc, [head]: withTemplate(family, rest.join('.'), value) };
}

export const getDoc = defineOp<
	Record<string, never>,
	{ doc: WinTextDoc; existed: boolean; blocks: string[]; baseEtag: string }
>({
	tool: 'wintext',
	name: 'get_doc',
	description:
		"The project's Win Text templates (sparse: a missing template uses the game's coded default) and the baseEtag to hand back to wintext.update_doc.",
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	agents: ['builder'],
	scope: 'project',
	write: false,
	handler: async (ctx) => {
		const { clientKey, projectKey } = projectOf(ctx);
		const { doc, etag, existed } = await loadWinTextDocWithEtag(clientKey, projectKey);
		return { doc, existed, blocks: BLOCKS, baseEtag: baseOf(etag) };
	},
});

export const updateDoc = defineOp<
	{ edits: { path: string; value: string }[]; baseEtag: string },
	{ doc: WinTextDoc; baseEtag: string }
>({
	tool: 'wintext',
	name: 'update_doc',
	description:
		'Set Win Text templates by path, e.g. `amountFormat`, `toast.full`, `winLevels.big`, `lineMessage.byCount.5`. A blank value clears the template. Placeholders such as {count} and {symbolName} are kept as written.',
	inputSchema: {
		type: 'object',
		properties: {
			edits: {
				type: 'array',
				maxItems: 64,
				items: {
					type: 'object',
					properties: {
						path: { type: 'string', pattern: PATH },
						value: { type: 'string', maxLength: 500 },
					},
					required: ['path', 'value'],
					additionalProperties: false,
				},
			},
			baseEtag: baseEtagProp,
		},
		required: ['edits', 'baseEtag'],
		additionalProperties: false,
	},
	agents: ['builder'],
	scope: 'project',
	write: true,
	writes: (_input, scope) => [winTextDocKey(scope.clientKey, scope.projectKey)],
	handler: async (ctx, { edits, baseEtag }) => {
		if (edits.length === 0) throw new AdapterError(400, 'invalid_input', 'Name at least one edit.');
		const unknown = edits.map((e) => e.path).filter((path) => !isTemplatePath(path));
		if (unknown.length) {
			throw new AdapterError(400, 'invalid_input', `No such template: ${unknown.join(', ')}.`);
		}
		const { clientKey, projectKey } = projectOf(ctx);
		const { doc, corrupt } = await loadWinTextDocWithEtag(clientKey, projectKey);
		if (corrupt) {
			throw new AdapterError(
				409,
				'unreadable_doc',
				"The project's win text doc is unreadable. A person must repair it in Invisible Win Text.",
			);
		}
		let next = doc as unknown as Record<string, unknown>;
		for (const { path, value } of edits) next = withTemplate(next, path, value);
		const saved = await validated(() =>
			saveWinTextDoc(clientKey, projectKey, next, preconditionOf(baseEtag), ctx.savedBy),
		);
		return { doc: saved.doc, baseEtag: baseOf(saved.etag) };
	},
});

export const WINTEXT_OPS = [getDoc, updateDoc];
