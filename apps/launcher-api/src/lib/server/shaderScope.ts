import { error, type Cookies } from '@sveltejs/kit';
import { SHADER_CUSTOM_GLSL_CAPABILITY, SHADER_PUBLISH_CAPABILITY } from '$lib/roles';
import { userHasCapability } from './launcherAuth';
import { gate, type ToolScope } from './toolScope';

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
export const canPublishSharedShaders = async (locals: App.Locals): Promise<boolean> =>
	!!locals.user && (await userHasCapability(locals.user, SHADER_PUBLISH_CAPABILITY));

/** Whether `locals.user` may add Custom GLSL or change its code or ports (`shaderCustomGlsl`). */
export const canWriteCustomGlsl = async (locals: App.Locals): Promise<boolean> =>
	!!locals.user && (await userHasCapability(locals.user, SHADER_CUSTOM_GLSL_CAPABILITY));

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
