import type Anthropic from '@anthropic-ai/sdk';
import type { Effort } from '../agents.ts';
import { ANALYST_OUTPUT_SCHEMA, parseAnalystOutput, type AnalystOutput } from './schema.ts';

/**
 * The one model call the analysis makes per image (ADR-0005): a vision message held to the
 * structured-output schema, behind a transport seam so the fixture can answer from a file. The real
 * transport is the Anthropic SDK; nothing else in the analysis knows the API exists.
 */

export interface VisionRequest {
	model: string;
	effort: Effort | null;
	/** Stable across the run's images: the agent's prompt plus the template's catalogue; cached. */
	system: string;
	/** This image's instructions: its tag, size and the fidelity mode. */
	prompt: string;
	image: { mediaType: 'image/png' | 'image/jpeg'; base64: string };
}

export interface Usage {
	inputTokens: number;
	outputTokens: number;
	cacheReadInputTokens: number;
	cacheCreationInputTokens: number;
}

export interface VisionAnswer {
	output: AnalystOutput;
	usage: Usage;
	/** The model that answered — a refusal fallback can differ from the one asked. */
	model: string;
}

export interface ModelTransport {
	analyze(request: VisionRequest): Promise<VisionAnswer>;
}

export type VisionErrorCode = 'refusal' | 'truncated' | 'no_text' | 'bad_json' | 'bad_shape';

export class VisionError extends Error {
	readonly code: VisionErrorCode;
	constructor(code: VisionErrorCode, message: string) {
		super(message);
		this.name = 'VisionError';
		this.code = code;
	}
}

export const sumUsage = (usages: Usage[]): Usage =>
	usages.reduce(
		(acc, u) => ({
			inputTokens: acc.inputTokens + u.inputTokens,
			outputTokens: acc.outputTokens + u.outputTokens,
			cacheReadInputTokens: acc.cacheReadInputTokens + u.cacheReadInputTokens,
			cacheCreationInputTokens: acc.cacheCreationInputTokens + u.cacheCreationInputTokens,
		}),
		{ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
	);

/** Parse a model's text as the analyst's answer, naming what is wrong with it otherwise. */
export function readAnswerText(text: string): AnalystOutput {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new VisionError('bad_json', 'The answer is not JSON.');
	}
	const parsed = parseAnalystOutput(value);
	if (!parsed.ok) throw new VisionError('bad_shape', parsed.errors.join('; '));
	return parsed.output;
}

/**
 * The Anthropic SDK transport. Thinking is on by default on Claude Opus 5.5 and depth comes from
 * `effort`; the system block is cached because it repeats for every image of a run; a refusal is
 * routed by the server's default fallback chain, and the answering model is reported.
 */
export function anthropicTransport(client: Anthropic): ModelTransport {
	return {
		async analyze(request) {
			const response = await client.beta.messages.create({
				model: request.model,
				max_tokens: 16000,
				betas: ['server-side-fallback-2026-07-01'],
				fallbacks: 'default',
				system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
				messages: [
					{
						role: 'user',
						content: [
							{
								type: 'image',
								source: {
									type: 'base64',
									media_type: request.image.mediaType,
									data: request.image.base64,
								},
							},
							{ type: 'text', text: request.prompt },
						],
					},
				],
				output_config: {
					...(request.effort ? { effort: request.effort } : {}),
					format: { type: 'json_schema', schema: ANALYST_OUTPUT_SCHEMA },
				},
			});
			if (response.stop_reason === 'refusal') {
				throw new VisionError('refusal', 'The model declined to analyse this image.');
			}
			if (response.stop_reason === 'max_tokens') {
				throw new VisionError('truncated', 'The answer hit max_tokens before it was complete.');
			}
			const text = response.content.find((b) => b.type === 'text');
			if (!text) throw new VisionError('no_text', 'The answer carries no text block.');
			return {
				output: readAnswerText(text.text),
				usage: {
					inputTokens: response.usage.input_tokens,
					outputTokens: response.usage.output_tokens,
					cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
					cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
				},
				model: response.model,
			};
		},
	};
}
