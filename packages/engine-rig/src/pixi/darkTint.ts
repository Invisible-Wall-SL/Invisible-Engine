import { GlProgram, Shader, type Texture } from 'pixi.js';

const vertex = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
	mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
	gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
	vUV = aUV;
}`;

// Two-color tint on premultiplied textures: the light color multiplies, the dark color fills in
// where the texture is dark. uColor is the mesh's premultiplied light color (tint × alpha).
const fragment = /* glsl */ `
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uColor;
uniform vec3 uDark;
void main() {
	vec4 tex = texture(uTexture, vUV);
	vec3 dark = uDark * uColor.a;
	finalColor.a = tex.a * uColor.a;
	finalColor.rgb = (tex.a - tex.rgb) * dark + tex.rgb * uColor.rgb;
}`;

let program: GlProgram | null = null;

/** A mesh shader for one slot with a dark color. `uDark` is updated per frame. */
export function createDarkTintShader(texture: Texture): Shader {
	program ??= GlProgram.from({ vertex, fragment, name: 'invisible-rig-dark-tint' });
	return new Shader({
		glProgram: program,
		resources: {
			uTexture: texture.source,
			uSampler: texture.source.style,
			darkUniforms: { uDark: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' } },
		},
	});
}
