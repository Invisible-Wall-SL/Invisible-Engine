import { json } from '@sveltejs/kit';
import { requireDirectorAccess } from '$lib/server/director/access';
import { answering, jsonBody, NO_STORE } from '$lib/server/director/api';
import { promptCaller } from '$lib/server/director/promptAccess';
import {
	MAX_PROMPT_BODY_LENGTH,
	MAX_PROMPT_NAME_LENGTH,
	createPrompt,
	listPrompts,
} from '$lib/server/director/prompts';
import type { RequestHandler } from './$types';

/**
 * `GET /api/director/prompts` lists the saved prompts of the clients the caller may target (the New
 * game form's client list); `POST` saves one: `{ clientKey, name, body }`. A name is unique per
 * client, ignoring case (409 `name_taken`). Session-gated on the `director` tool.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const user = await requireDirectorAccess(locals);
	const caller = await promptCaller(user);
	return json(
		{
			prompts: await listPrompts(caller),
			limits: { name: MAX_PROMPT_NAME_LENGTH, body: MAX_PROMPT_BODY_LENGTH },
		},
		{ headers: NO_STORE },
	);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireDirectorAccess(locals);
	const input = await jsonBody(request);
	return answering(async () => {
		const prompt = await createPrompt(await promptCaller(user), input);
		return json({ prompt }, { status: 201, headers: NO_STORE });
	});
};
