/**
 * The turn's request, the budget projection and the per-response cost (PLAN 3.4, 3.7) — the pure
 * parts of the turn loop:
 *
 *   pnpm --filter director-worker check:model
 *
 * Pinned:
 *  - every request is `tool_choice: auto` with `strict` tools (forced choice is a 400 on 5.5);
 *  - adaptive thinking + the definition's effort + the server-side refusal fallback on Opus/Sonnet
 *    5.5; a thinking budget below `max_tokens` and no effort or fallback on Haiku 4.5;
 *  - the cached prefix (tools + system) is byte-identical across turns and runs;
 *  - strict schemas drop the constraints strict mode rejects and keep every object closed;
 *  - the projection prices the whole request uncached and refuses an unpriced model;
 *  - a fallback-served response is billed per iteration at each iteration's model.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { costOfResponse, parsePricing, seedRenderUsd } from 'director-costs';
import { loadAgents, pricedModels } from './agents.ts';
import {
	DEFAULT_OUTPUT_TOKENS,
	IMAGE_TOKENS,
	overCap,
	projectCall,
	projectQueuedGpu,
	unreportedSeconds,
} from './budget.ts';
import {
	buildRequest,
	modelProfile,
	strictSchema,
	toolId,
	toolName,
	type ToolSpec,
} from './model.ts';
import {
	answerContent,
	capImages,
	MAX_IMAGE_BASE64_PER_REQUEST,
	MAX_IMAGES_PER_REQUEST,
	MAX_RESULT_CHARS,
} from './toolResult.ts';
import { KNOWN_TOOLS, WORKER_TOOLS } from './tools.ts';
import { workerToolSpecs } from './workerTools.ts';

let checks = 0;
let failures = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a !== e) {
		failures++;
		console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`);
	}
};

const root = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const pricing = parsePricing(JSON.parse(readFileSync(root('pricing.json'), 'utf8')));
const agents = loadAgents(root('agents'), {
	models: pricedModels(root('pricing.json')),
	tools: KNOWN_TOOLS,
});

const ADAPTER: ToolSpec = {
	id: 'atlas.get_region',
	description: 'Read a region.',
	inputSchema: {
		type: 'object',
		properties: {
			atlas: { type: 'string', description: 'The atlas.', pattern: '^[a-z]+$', maxLength: 120 },
			count: { type: 'integer', minimum: 1, maximum: 8 },
			names: { type: 'array', maxItems: 4, items: { type: 'string', minLength: 1 } },
			base: {
				type: 'object',
				properties: { etag: { type: 'string', maxLength: 200 } },
				required: ['etag'],
				additionalProperties: false,
			},
		},
		required: ['atlas'],
		additionalProperties: false,
	},
};

// ── Tool names and strict schemas ──
check(
	'tool names have no dot and map back',
	toolId(toolName('atlas.queue_variants')),
	'atlas.queue_variants',
);
check(
	'a tool name matches the API pattern',
	/^[a-zA-Z0-9_-]{1,128}$/.test(toolName('run.get_state')),
	true,
);
const strict = strictSchema(ADAPTER.inputSchema);
const unsupported = JSON.stringify(strict).match(
	/"(pattern|minLength|maxLength|minimum|maximum|maxItems)"/g,
);
check('strict schemas carry no keyword strict mode rejects', unsupported, null);
check(
	'a dropped constraint is kept in the description',
	(strict.properties as Record<string, { description: string }>).atlas.description,
	'The atlas. (pattern: "^[a-z]+$"; maxLength: 120)',
);
check(
	'nested objects stay closed',
	(strict.properties as Record<string, { additionalProperties: boolean }>).base
		.additionalProperties,
	false,
);
const specs = workerToolSpecs([...agents.keys()]);
check('every worker tool has a spec', Object.keys(specs).sort(), [...WORKER_TOOLS].sort());
check(
	'every worker tool schema is closed',
	Object.values(specs)
		.filter((s) => s.inputSchema.additionalProperties !== false)
		.map((s) => s.id),
	[],
);
check(
	'run.assign_task offers every agent but the coordinator and the mockup analyst (the worker runs it)',
	(specs['run.assign_task'].inputSchema.properties as { agent: { enum: string[] } }).agent.enum,
	[...agents.keys()].filter((a) => a !== 'coordinator' && a !== 'mockup-analyst').sort(),
);

// ── Requests per model ──
const history = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Go.' }] }];
for (const agent of agents.values()) {
	const request = buildRequest(agent, [ADAPTER], history);
	const name = `${agent.name} (${agent.model})`;
	const profile = modelProfile(agent.model);
	check(`${name}: tool_choice is auto`, request.tool_choice, { type: 'auto' });
	check(
		`${name}: every tool is strict`,
		request.tools?.every((t) => 'strict' in t && t.strict),
		true,
	);
	check(
		`${name}: the system block is a cache breakpoint`,
		(request.system as { cache_control?: unknown }[])[0].cache_control,
		{ type: 'ephemeral' },
	);
	check(`${name}: the conversation is cached`, request.cache_control, { type: 'ephemeral' });
	if (agent.model === 'claude-haiku-4-5-20251001') {
		check(`${name}: a thinking budget`, request.thinking?.type, 'enabled');
		const budget = (request.thinking as { budget_tokens: number }).budget_tokens;
		check(
			`${name}: the budget is ≥ 1024 and below max_tokens`,
			budget >= 1024 && budget < request.max_tokens,
			true,
		);
		check(`${name}: no effort`, request.output_config, undefined);
		check(`${name}: no server-side fallback`, request.fallbacks, undefined);
	} else {
		check(`${name}: adaptive thinking`, request.thinking, { type: 'adaptive' });
		check(`${name}: effort from the definition`, request.output_config, { effort: agent.effort });
		check(
			`${name}: the server-side refusal fallback`,
			[request.fallbacks, request.betas],
			['default', ['server-side-fallback-2026-07-01']],
		);
	}
	check(`${name}: max_tokens from the profile`, request.max_tokens, profile.maxTokens);
}
const coordinator = agents.get('coordinator')!;
const prefix = (r: ReturnType<typeof buildRequest>) => JSON.stringify([r.tools, r.system]);
const later = buildRequest(
	coordinator,
	[ADAPTER],
	[
		...history,
		{ role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
		{ role: 'user', content: [{ type: 'text', text: 'Owner: next.' }] },
	],
);
check(
	'the cached prefix is byte-identical across turns',
	prefix(later),
	prefix(buildRequest(coordinator, [ADAPTER], history)),
);
let threw = false;
try {
	modelProfile('claude-opus-5');
} catch {
	threw = true;
}
check(
	'a model with no request profile is refused (fallback-only models are priced, not callable)',
	threw,
	true,
);

// ── Budget projection ──
const request = buildRequest(coordinator, [ADAPTER], history);
const inputTokens = Math.ceil(JSON.stringify(request).length / 4);
const opus = pricing.perMTok['claude-opus-5-5'];
check(
	'the projection prices every input token uncached plus the default output',
	projectCall(request, pricing, undefined),
	(inputTokens * opus.input + DEFAULT_OUTPUT_TOKENS * opus.output) / 1_000_000,
);
check(
	"the projection uses the agent's largest output so far",
	projectCall(request, pricing, 20_000),
	(inputTokens * opus.input + 20_000 * opus.output) / 1_000_000,
);
threw = false;
try {
	projectCall({ ...request, model: 'claude-unknown' }, pricing, undefined);
} catch {
	threw = true;
}
check('an unpriced model cannot be projected', threw, true);

// ── Image answers (9G.0) ──
const PNG = 'iVBORw0KGgo=';
const img = (body: unknown) => answerContent(body, true);
check(
	'an image answer is its other fields as text, then the image block',
	img({
		region: 'H1',
		id: '00002',
		bytes: 9,
		image: { mediaType: 'image/png', base64: PNG },
	}),
	[
		{ type: 'text', text: '{"region":"H1","id":"00002","bytes":9}' },
		{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
	],
);
check(
	'a non-image answer is its JSON string, as before',
	answerContent({ region: 'H1', variants: [{ id: '1' }] }),
	JSON.stringify({ region: 'H1', variants: [{ id: '1' }] }),
);
check('an array answer is its JSON string', answerContent([1, { image: 2 }]), '[1,{"image":2}]');
check(
	'a text answer over the cap is cut, marked',
	(img({ t: 'x'.repeat(MAX_RESULT_CHARS) }) as string).endsWith('…[truncated]'),
	true,
);
check(
	'an unsupported type keeps the text, drops the base64 and says why',
	img({ id: '1', image: { mediaType: 'image/svg+xml', base64: PNG } }),
	'{"id":"1","imageNotShown":"the image type image/svg+xml is not one the model can be shown"}',
);
check(
	'a field that is not base64 is dropped with a note',
	img({ image: { mediaType: 'image/png', base64: 'not base64!' } }),
	'{"imageNotShown":"the image data is not base64"}',
);
check(
	'an image over 5 MB is dropped, never cut',
	img({ image: { mediaType: 'image/png', base64: 'A'.repeat(5 * 1024 * 1024 + 4) } }),
	'{"imageNotShown":"the image is over 5 MB"}',
);
check('a non-object image field is not an image answer', img({ image: 'x' }), '{"image":"x"}');
const withImage = [
	{
		type: 'tool_result' as const,
		tool_use_id: 'toolu_1',
		content: img({ id: '1', image: { mediaType: 'image/png', base64: PNG } }),
	},
];

check(
	'a stored image result reads back byte-identical (JSON round trip)',
	JSON.stringify(JSON.parse(JSON.stringify(withImage))),
	JSON.stringify(withImage),
);
check(
	'an answer of an op not flagged as an image op stays text, whatever fields it has',
	answerContent({ doc: 'wintext', image: { mediaType: 'image/png', base64: PNG } }),
	JSON.stringify({ doc: 'wintext', image: { mediaType: 'image/png', base64: PNG } }),
);
check(
	'the 5 MB limit is on the base64 string: 5 MB of it is still shown, one more group is not',
	[
		Array.isArray(img({ image: { mediaType: 'image/png', base64: 'A'.repeat(5 * 1024 * 1024) } })),
		Array.isArray(
			img({ image: { mediaType: 'image/png', base64: 'A'.repeat(5 * 1024 * 1024 + 4) } }),
		),
	],
	[true, false],
);

// ── The images of one request are capped (9G.0) ──
const imageTurn = (label: string, base64: string) => ({
	role: 'user' as const,
	content: [
		{
			type: 'tool_result' as const,
			tool_use_id: `toolu_${label}`,
			content: img({ region: 'R', id: label, image: { mediaType: 'image/png', base64 } }),
		},
	],
});
const imagesIn = (messages: { content: unknown }[]) =>
	JSON.stringify(messages).split('"type":"image"').length - 1;
const many = Array.from({ length: MAX_IMAGES_PER_REQUEST + 30 }, (_, i) =>
	imageTurn(String(i).padStart(3, '0'), PNG),
);
const capped = capImages(many);
check(
	'past the image count only the newest stay images',
	[imagesIn(capped), imagesIn(capped.slice(30)), imagesIn(capped.slice(0, 30))],
	[MAX_IMAGES_PER_REQUEST, MAX_IMAGES_PER_REQUEST, 0],
);
check(
	'an older image is a text stub naming what it was',
	(capped[0].content[0].content as { text: string }[])[1],
	{ type: 'text', text: '[image shown earlier: R/000]' },
);
check(
	'capping does not touch the stored rows, and is the same every time',
	[
		JSON.stringify(many) === JSON.stringify(many.map((m) => structuredClone(m))),
		JSON.stringify(capImages(many)) === JSON.stringify(capped),
	],
	[true, true],
);
const fat = 'A'.repeat(Math.floor(MAX_IMAGE_BASE64_PER_REQUEST / 2.5));
const heavy = capImages(Array.from({ length: 6 }, (_, i) => imageTurn(`h${i}`, fat)));
check(
	'past the byte cap only the newest that fit stay images',
	[imagesIn(heavy), imagesIn(heavy.slice(4))],
	[2, 2],
);
check(
	'a capped request is valid: every tool_result keeps its tool_use_id and content',
	heavy.every(
		(m) =>
			Array.isArray((m.content[0] as { content: unknown }).content) && m.content[0].tool_use_id,
	),
	true,
);
check(
	'a short history is returned as it is',
	capImages(many.slice(0, 3)).every((m, i) => m === many[i]),
	true,
);
const turnWith = (content: unknown) =>
	buildRequest(coordinator, [ADAPTER], [
		...history,
		{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content }] },
	] as never);
const plain = projectCall(turnWith('{}'), pricing, undefined);
const priced = projectCall(
	turnWith(img({ image: { mediaType: 'image/png', base64: 'A'.repeat(400_000) } })),
	pricing,
	undefined,
);
check(
	'the projection counts an image at its token ceiling, not its base64 length',
	priced > plain && priced - plain < ((IMAGE_TOKENS + 200) * opus.input) / 1_000_000,
	true,
);
check('at the cap is over it', overCap(24, 1, 25), true);
check('below the cap is not', overCap(23.99, 1, 25), false);
check(
	'renders in flight project at the mean billed render each',
	projectQueuedGpu(2, 0.25, 9),
	0.5,
);
check(
	'a submit projects itself on top of the renders in flight',
	projectQueuedGpu(2, 0.25, 9) + projectQueuedGpu(1, 0.25, 9),
	0.75,
);
check(
	'before the first billed render each projects at the seed, so the cap fails closed',
	projectQueuedGpu(3, null, 0.5),
	1.5,
);
check(
	'the seed is a stand-in only: a billed mean replaces it',
	projectQueuedGpu(3, 0.25, 0.5),
	0.75,
);
check('nothing in flight projects nothing', projectQueuedGpu(0, 5, 9), 0);
const dearest = Math.max(...Object.values(pricing.runpod.perSecondByGpu));
check(
	"the seed is pricing.json's seed seconds at the dearest GPU",
	seedRenderUsd(pricing),
	pricing.runpod.seedSecondsPerRender * dearest,
);
check(
	'a pricing with no GPU priced seeds nothing (and can bill nothing)',
	seedRenderUsd({ ...pricing, runpod: { ...pricing.runpod, perSecondByGpu: {} } }),
	0,
);
check(
	"unreported jobs are estimated at the render's own mean per reported job",
	unreportedSeconds(2, 4, 100, 600),
	50,
);
check(
	'…or at the seed seconds when none of its jobs reported a time',
	unreportedSeconds(3, 0, 0, 600),
	1800,
);

// ── Cost of a response ──
const usage = {
	input_tokens: 1000,
	output_tokens: 500,
	cache_read_input_tokens: 0,
	cache_creation_input_tokens: 0,
};
check(
	'a plain response is billed at its model',
	costOfResponse({ model: 'claude-sonnet-5-5', usage }, pricing).usd,
	(1000 * 2 + 500 * 10) / 1_000_000,
);
const fellBack = costOfResponse(
	{
		model: 'claude-sonnet-5',
		usage: {
			...usage,
			iterations: [
				{ type: 'message', model: 'claude-sonnet-5-5', input_tokens: 1000, output_tokens: 0 },
				{ type: 'fallback_message', model: 'claude-sonnet-5', ...usage },
			],
		},
	},
	pricing,
);
check('a fallback-served response is billed per iteration, each at its own model', fellBack, {
	usd: (1000 * 2) / 1_000_000 + (1000 * 2 + 500 * 10) / 1_000_000,
	input: 2000,
	output: 500,
	cacheRead: 0,
	cacheWrite: 0,
});

console.log(`model: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
