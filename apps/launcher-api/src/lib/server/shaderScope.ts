import { error, type Cookies } from '@sveltejs/kit';
import { SHADER_PUBLISH_CAPABILITY, roleHasCapability } from '$lib/roles';
import { getRoleOverrides } from './roleToolAccess';
import { gate, type ToolScope } from './toolScope';
import { getToolOverrides } from './userToolAccess';

/**
 * Who reaches Invisible Shader Graph docs. `/shaders` reads and writes them; the tools whose
 * pickers list custom Element FX (the Scene and Component Editors, Symbols, the Flow) read them.
 */
export const shaderReadScope = (locals: App.Locals, cookies: Cookies): Promise<ToolScope> =>
	gate(locals, cookies, {
		tool: 'shaders',
		altTools: ['editor', 'componentEditor', 'symbols', 'flow'],
		forbiddenMessage: 'Your role does not have access to shader effects.',
	});

export const shaderWriteScope = (locals: App.Locals, cookies: Cookies): Promise<ToolScope> =>
	gate(locals, cookies, {
		tool: 'shaders',
		forbiddenMessage: 'Your role does not have access to Invisible Shader Graph.',
	});

/** Whether `locals.user` may write the studio-shared library (`shaderPublish`). */
export async function canPublishSharedShaders(locals: App.Locals): Promise<boolean> {
	const user = locals.user;
	if (!user) return false;
	return roleHasCapability(
		user.role,
		SHADER_PUBLISH_CAPABILITY,
		await getRoleOverrides(user.role),
		await getToolOverrides(user.id),
	);
}

/**
 * Publishing a graph to the studio-shared library, or removing one: `/shaders` plus the
 * `shaderPublish` capability. Every project's set takes in the library, so the tool alone is not
 * enough.
 */
export async function shaderPublishScope(locals: App.Locals, cookies: Cookies): Promise<ToolScope> {
	const scope = await shaderWriteScope(locals, cookies);
	if (!(await canPublishSharedShaders(locals))) {
		throw error(403, 'Your role cannot publish to the shared shader library.');
	}
	return scope;
}
