import { error, type Cookies } from '@sveltejs/kit';
import { SHADER_EFFECTS_READ_TOOLS, SHADER_READ_TOOLS, SHADER_TOOL } from '$lib/accessRules';
import { SHADER_CUSTOM_GLSL_CAPABILITY, SHADER_PUBLISH_CAPABILITY } from '$lib/roles';
import { userHasCapability } from './launcherAuth';
import { gate, type ToolScope } from './toolScope';

/** A read set as a gate's alternatives: every tool in it but `/shaders`, the gate's own. */
const besidesShaders = (tools: readonly string[]): string[] =>
	tools.filter((tool) => tool !== SHADER_TOOL);

/**
 * Who reaches Invisible Shader Graph docs: `/shaders` reads and writes them; every other tool in
 * {@link SHADER_READ_TOOLS} reads them. A read stays on the session's project.
 */
export const shaderReadScope = (locals: App.Locals, cookies: Cookies): Promise<ToolScope> =>
	gate(locals, cookies, {
		tool: SHADER_TOOL,
		altTools: besidesShaders(SHADER_READ_TOOLS),
		forbiddenMessage: 'Your role does not have access to shader effects.',
	});

/**
 * Who reads a project's compiled shader effects, and nothing else of its graphs:
 * {@link SHADER_EFFECTS_READ_TOOLS}. Only `GET /api/shaders/effects` takes it.
 */
export const shaderEffectsReadScope = (locals: App.Locals, cookies: Cookies): Promise<ToolScope> =>
	gate(locals, cookies, {
		tool: SHADER_TOOL,
		altTools: besidesShaders(SHADER_EFFECTS_READ_TOOLS),
		forbiddenMessage: 'Your role does not have access to shader effects.',
	});

export const shaderWriteScope = (locals: App.Locals, cookies: Cookies): Promise<ToolScope> =>
	gate(locals, cookies, {
		tool: SHADER_TOOL,
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
