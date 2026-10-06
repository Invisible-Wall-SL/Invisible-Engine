import { Color } from '../math';
import { BlendMode } from '../data';
import {
	BoundingBoxAttachment,
	ClippingAttachment,
	MeshAttachment,
	PathAttachment,
	RegionAttachment,
	type TextureRegion,
} from '../attachments';
import { SkeletonClipping } from '../clipping';
import type { Skeleton } from '../skeleton';
import type { Slot } from '../slot';
import { OrthoCamera } from './camera';
import { managed, type ContextLike, type ManagedWebGLRenderingContext } from './context';
import type { GLTexture } from './texture';

const TEXTURED_VS = `
attribute vec2 aPosition;
attribute vec4 aLight;
attribute vec4 aDark;
attribute vec2 aUV;
uniform mat4 uProjection;
varying vec4 vLight;
varying vec4 vDark;
varying vec2 vUV;
void main() {
	vLight = aLight;
	vDark = aDark;
	vUV = aUV;
	gl_Position = uProjection * vec4(aPosition, 0.0, 1.0);
}`;

// Two-color tint. Premultiplied: dark.a = 1 and both colors arrive premultiplied; straight: dark.a = 0.
const TEXTURED_FS = `
precision mediump float;
varying vec4 vLight;
varying vec4 vDark;
varying vec2 vUV;
uniform sampler2D uTexture;
void main() {
	vec4 tex = texture2D(uTexture, vUV);
	gl_FragColor.a = tex.a * vLight.a;
	gl_FragColor.rgb = ((tex.a - 1.0) * vDark.a + 1.0 - tex.rgb) * vDark.rgb + tex.rgb * vLight.rgb;
}`;

const SHAPE_VS = `
attribute vec2 aPosition;
attribute vec4 aColor;
uniform mat4 uProjection;
varying vec4 vColor;
void main() {
	vColor = aColor;
	gl_Position = uProjection * vec4(aPosition, 0.0, 1.0);
}`;

const SHAPE_FS = `
precision mediump float;
varying vec4 vColor;
void main() { gl_FragColor = vColor; }`;

interface Program {
	program: WebGLProgram;
	attributes: Array<{ location: number; size: number }>;
	stride: number;
	projection: WebGLUniformLocation | null;
	texture: WebGLUniformLocation | null;
}

function compile(gl: WebGLRenderingContext, vs: string, fs: string, attributes: Array<[string, number]>): Program {
	const shader = (type: number, src: string): WebGLShader => {
		const s = gl.createShader(type) as WebGLShader;
		gl.shaderSource(s, src);
		gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(s)}`);
		return s;
	};
	const program = gl.createProgram() as WebGLProgram;
	gl.attachShader(program, shader(gl.VERTEX_SHADER, vs));
	gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fs));
	attributes.forEach(([name], i) => gl.bindAttribLocation(program, i, name));
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Program: ${gl.getProgramInfoLog(program)}`);
	return {
		program,
		attributes: attributes.map(([, size], i) => ({ location: i, size })),
		stride: attributes.reduce((n, [, size]) => n + size, 0),
		projection: gl.getUniformLocation(program, 'uProjection'),
		texture: gl.getUniformLocation(program, 'uTexture'),
	};
}

const MAX_VERTICES = 10920;
/** srcColor, dstColor, srcAlpha, dstAlpha. */
type Blend = [number, number, number, number];
const QUAD = [0, 1, 2, 2, 3, 0];

/** Debug overlay switches and colors (drawn with the shape renderer). */
export class SkeletonDebugRenderer {
	boneLineColor = new Color(1, 0, 0, 1);
	boneOriginColor = new Color(0, 1, 0, 1);
	attachmentLineColor = new Color(0, 0, 1, 0.5);
	triangleLineColor = new Color(1, 0.64, 0, 0.5);
	pathColor = new Color().setFromString('FF7F00');
	clipColor = new Color(0.8, 0, 0, 2);
	aabbColor = new Color(0, 1, 0, 0.5);
	drawBones = true;
	drawRegionAttachments = true;
	drawBoundingBoxes = true;
	drawMeshHull = true;
	drawMeshTriangles = true;
	drawPaths = true;
	drawSkeletonXY = false;
	drawClipping = true;
	premultipliedAlpha = false;
	scale = 1;
	boneWidth = 2;
}

/**
 * Draws skeletons, shapes and debug overlays with WebGL through an orthographic `camera`, in call
 * order between `begin()` and `end()`.
 */
export class SceneRenderer {
	readonly context: ManagedWebGLRenderingContext;
	readonly canvas: HTMLCanvasElement;
	readonly gl: WebGLRenderingContext;
	camera: OrthoCamera;
	skeletonDebugRenderer = new SkeletonDebugRenderer();
	twoColorTint: boolean;
	private textured: Program;
	private shapes: Program;
	private vbo: WebGLBuffer;
	private ibo: WebGLBuffer;
	private vertices: Float32Array;
	private indices = new Uint16Array(MAX_VERTICES * 3);
	private vertexCount = 0;
	private indexCount = 0;
	private program: Program | null = null;
	private mode = 0;
	private texture: GLTexture | null = null;
	private srcColor = 0;
	private dstColor = 0;
	private srcAlpha = 0;
	private dstAlpha = 0;
	private clipper = new SkeletonClipping();
	private world: number[] = [];
	private drawing = false;

	constructor(canvas: HTMLCanvasElement, context: ContextLike, twoColorTint = true) {
		this.canvas = canvas;
		this.context = managed(context);
		this.gl = this.context.gl;
		this.twoColorTint = twoColorTint;
		this.camera = new OrthoCamera(canvas.width, canvas.height);
		const gl = this.gl;
		this.textured = compile(gl, TEXTURED_VS, TEXTURED_FS, [
			['aPosition', 2],
			['aLight', 4],
			['aDark', 4],
			['aUV', 2],
		]);
		this.shapes = compile(gl, SHAPE_VS, SHAPE_FS, [
			['aPosition', 2],
			['aColor', 4],
		]);
		this.vertices = new Float32Array(MAX_VERTICES * this.textured.stride);
		this.vbo = gl.createBuffer() as WebGLBuffer;
		this.ibo = gl.createBuffer() as WebGLBuffer;
	}

	begin(): void {
		this.camera.update();
		this.drawing = true;
		this.program = null;
		this.texture = null;
		this.srcColor = this.dstColor = this.srcAlpha = this.dstAlpha = 0;
	}

	end(): void {
		this.flush();
		this.drawing = false;
		const gl = this.gl;
		for (const a of [...this.textured.attributes]) gl.disableVertexAttribArray(a.location);
	}

	resize(): void {
		const canvas = this.canvas;
		const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
		const w = Math.round(canvas.clientWidth * dpr);
		const h = Math.round(canvas.clientHeight * dpr);
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		this.gl.viewport(0, 0, canvas.width, canvas.height);
		this.camera.setViewport(canvas.width, canvas.height);
		this.camera.update();
	}

	private use(program: Program, mode: number, texture: GLTexture | null, blend: Blend): void {
		const [src, dst, srcA, dstA] = blend;
		if (
			this.program === program &&
			this.mode === mode &&
			this.texture === texture &&
			this.srcColor === src &&
			this.dstColor === dst &&
			this.srcAlpha === srcA &&
			this.dstAlpha === dstA
		)
			return;
		this.flush();
		this.program = program;
		this.mode = mode;
		this.texture = texture;
		this.srcColor = src;
		this.dstColor = dst;
		this.srcAlpha = srcA;
		this.dstAlpha = dstA;
	}

	private flush(): void {
		const program = this.program;
		if (!program || this.indexCount === 0) {
			this.vertexCount = 0;
			this.indexCount = 0;
			return;
		}
		const gl = this.gl;
		gl.useProgram(program.program);
		gl.uniformMatrix4fv(program.projection, false, this.camera.projectionView);
		if (this.texture) {
			this.texture.bind(0);
			gl.uniform1i(program.texture, 0);
		}
		gl.enable(gl.BLEND);
		gl.blendFuncSeparate(this.srcColor, this.dstColor, this.srcAlpha, this.dstAlpha);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
		gl.bufferData(gl.ARRAY_BUFFER, this.vertices.subarray(0, this.vertexCount * program.stride), gl.DYNAMIC_DRAW);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices.subarray(0, this.indexCount), gl.DYNAMIC_DRAW);
		let offset = 0;
		for (const a of program.attributes) {
			gl.enableVertexAttribArray(a.location);
			gl.vertexAttribPointer(a.location, a.size, gl.FLOAT, false, program.stride * 4, offset * 4);
			offset += a.size;
		}
		for (let i = program.attributes.length; i < this.textured.attributes.length; i++) gl.disableVertexAttribArray(i);
		gl.drawElements(this.mode, this.indexCount, gl.UNSIGNED_SHORT, 0);
		this.vertexCount = 0;
		this.indexCount = 0;
	}

	/** Appends `count` vertices (`stride` floats each, via `write`) and their indices. */
	private push(count: number, indices: ArrayLike<number>, write: (v: Float32Array, at: number, i: number) => void): void {
		const program = this.program as Program;
		if (this.vertexCount + count > MAX_VERTICES || this.indexCount + indices.length > this.indices.length) this.flush();
		const base = this.vertexCount;
		for (let i = 0; i < count; i++) write(this.vertices, (base + i) * program.stride, i);
		for (let i = 0; i < indices.length; i++) this.indices[this.indexCount + i] = base + indices[i];
		this.vertexCount += count;
		this.indexCount += indices.length;
	}

	/** Color and alpha factors per blend mode. Alpha accumulates like the color it pairs with, so a
	 * transparent canvas composites the same as an opaque one would show. */
	private blendFunc(mode: BlendMode, pma: boolean): Blend {
		const gl = this.gl;
		switch (mode) {
			case BlendMode.Additive:
				return [pma ? gl.ONE : gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE];
			case BlendMode.Multiply:
				return [gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
			case BlendMode.Screen:
				return [gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_COLOR];
		}
		return [pma ? gl.ONE : gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
	}

	/** Draws a skeleton's regions and meshes in draw order, clipped by its clipping attachments.
	 * Only slots whose draw-order position is in [slotRangeStart, slotRangeEnd] when given. */
	drawSkeleton(skeleton: Skeleton, premultipliedAlpha = false, slotRangeStart = -1, slotRangeEnd = -1): void {
		const clipper = this.clipper;
		const pma = premultipliedAlpha;
		const sc = skeleton.color;
		let inRange = slotRangeStart === -1;
		const world = this.world;
		for (let i = 0; i < skeleton.drawOrder.length; i++) {
			const slot = skeleton.drawOrder[i];
			if (slotRangeStart >= 0 && slotRangeStart === slot.data.index) inRange = true;
			if (!inRange || !slot.bone.active) {
				clipper.clipEndWithSlot(slot);
				if (slotRangeEnd >= 0 && slotRangeEnd === slot.data.index) inRange = false;
				continue;
			}
			if (slotRangeEnd >= 0 && slotRangeEnd === slot.data.index) inRange = false;
			const attachment = slot.getAttachment();
			if (attachment instanceof ClippingAttachment) {
				clipper.clipStart(slot, attachment);
				continue;
			}
			let positions: ArrayLike<number>;
			let uvs: ArrayLike<number>;
			let triangles: ArrayLike<number>;
			let region: TextureRegion | null;
			let color: Color;
			if (attachment instanceof RegionAttachment) {
				world.length = 8;
				attachment.computeWorldVertices(slot, world, 0, 2);
				positions = world;
				uvs = attachment.uvs;
				triangles = QUAD;
				region = attachment.region;
				color = attachment.color;
			} else if (attachment instanceof MeshAttachment) {
				const n = attachment.worldVerticesLength;
				world.length = n;
				attachment.computeWorldVertices(slot, 0, n, world, 0, 2);
				positions = world;
				uvs = attachment.uvs;
				triangles = attachment.triangles;
				region = attachment.region;
				color = attachment.color;
			} else {
				clipper.clipEndWithSlot(slot);
				continue;
			}
			const texture = pageTexture(region);
			// A zero-alpha slot is still drawn: with straight alpha a screen slot adds its texture's
			// color whatever its alpha.
			const a = sc.a * slot.color.a * color.a;
			if (!texture) {
				clipper.clipEndWithSlot(slot);
				continue;
			}
			if (clipper.isClipping()) {
				clipper.clipTrianglesUnpacked(positions, triangles, triangles.length, uvs);
				positions = clipper.clippedVertices;
				uvs = clipper.clippedUVs;
				triangles = clipper.clippedTriangles;
			}
			if (triangles.length) {
				const m = pma ? a : 1;
				const r = sc.r * slot.color.r * color.r * m;
				const g = sc.g * slot.color.g * color.g * m;
				const b = sc.b * slot.color.b * color.b * m;
				const dark = slot.darkColor;
				const dr = dark ? dark.r * (pma ? a : 1) : 0;
				const dg = dark ? dark.g * (pma ? a : 1) : 0;
				const db = dark ? dark.b * (pma ? a : 1) : 0;
				const da = dark ? (pma ? 1 : 0) : 1;
				this.use(this.textured, this.gl.TRIANGLES, texture, this.blendFunc(slot.data.blendMode, pma));
				const p = positions;
				const t = uvs;
				this.push(uvs.length >> 1, triangles, (v, at, k) => {
					v[at] = p[k * 2];
					v[at + 1] = p[k * 2 + 1];
					v[at + 2] = r;
					v[at + 3] = g;
					v[at + 4] = b;
					v[at + 5] = a;
					v[at + 6] = dr;
					v[at + 7] = dg;
					v[at + 8] = db;
					v[at + 9] = da;
					v[at + 10] = t[k * 2];
					v[at + 11] = t[k * 2 + 1];
				});
			}
			clipper.clipEndWithSlot(slot);
		}
		clipper.clipEnd();
	}

	private shape(mode: number): void {
		const gl = this.gl;
		this.use(this.shapes, mode, null, [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA]);
	}

	private colored(points: number[], indices: number[], color: Color, color2?: Color): void {
		const c2 = color2 ?? color;
		this.push(points.length >> 1, indices, (v, at, k) => {
			const c = k % 2 === 1 ? c2 : color;
			v[at] = points[k * 2];
			v[at + 1] = points[k * 2 + 1];
			v[at + 2] = c.r;
			v[at + 3] = c.g;
			v[at + 4] = c.b;
			v[at + 5] = c.a;
		});
	}

	line(x: number, y: number, x2: number, y2: number, color: Color = Color.WHITE, color2?: Color): void {
		this.shape(this.gl.LINES);
		this.colored([x, y, x2, y2], [0, 1], color, color2);
	}

	/** A circle outline, or a filled disc. `segments` 0 picks a count from the radius. */
	circle(filled: boolean, x: number, y: number, radius: number, color: Color = Color.WHITE, segments = 0): void {
		const n = segments > 0 ? segments : Math.max(1, Math.floor(6 * Math.cbrt(radius)));
		const points: number[] = [];
		for (let i = 0; i < n; i++) {
			const t = (i / n) * Math.PI * 2;
			points.push(x + Math.cos(t) * radius, y + Math.sin(t) * radius);
		}
		if (filled) {
			points.push(x, y);
			const indices: number[] = [];
			for (let i = 0; i < n; i++) indices.push(n, i, (i + 1) % n);
			this.shape(this.gl.TRIANGLES);
			this.colored(points, indices, color);
		} else {
			const indices: number[] = [];
			for (let i = 0; i < n; i++) indices.push(i, (i + 1) % n);
			this.shape(this.gl.LINES);
			this.colored(points, indices, color);
		}
	}

	rect(filled: boolean, x: number, y: number, width: number, height: number, color: Color = Color.WHITE): void {
		this.polygon([x, y, x + width, y, x + width, y + height, x, y + height], 0, 4, color, filled);
	}

	triangle(filled: boolean, x: number, y: number, x2: number, y2: number, x3: number, y3: number, color: Color = Color.WHITE): void {
		this.polygon([x, y, x2, y2, x3, y3], 0, 3, color, filled);
	}

	/** A closed polygon outline from `count` points starting at point `offset`, or a filled fan. */
	polygon(vertices: ArrayLike<number>, offset: number, count: number, color: Color = Color.WHITE, filled = false): void {
		const points: number[] = [];
		for (let i = 0; i < count; i++) points.push(vertices[(offset + i) * 2], vertices[(offset + i) * 2 + 1]);
		const indices: number[] = [];
		if (filled) for (let i = 1; i < count - 1; i++) indices.push(0, i, i + 1);
		else for (let i = 0; i < count; i++) indices.push(i, (i + 1) % count);
		this.shape(filled ? this.gl.TRIANGLES : this.gl.LINES);
		this.colored(points, indices, color);
	}

	/** Bones, attachment outlines, mesh hulls/triangles, bounding boxes, paths and clip polygons. */
	drawSkeletonDebug(skeleton: Skeleton, _premultipliedAlpha = false, ignoredBones?: string[]): void {
		const d = this.skeletonDebugRenderer;
		const world = this.world;
		const s = d.scale;
		const visible = (slot: Slot): boolean => slot.bone.active;
		if (d.drawRegionAttachments)
			for (const slot of skeleton.slots) {
				const att = slot.getAttachment();
				if (!(att instanceof RegionAttachment) || !visible(slot)) continue;
				world.length = 8;
				att.computeWorldVertices(slot, world, 0, 2);
				this.polygon(world, 0, 4, d.attachmentLineColor);
			}
		if (d.drawMeshHull || d.drawMeshTriangles)
			for (const slot of skeleton.slots) {
				const att = slot.getAttachment();
				if (!(att instanceof MeshAttachment) || !visible(slot)) continue;
				const n = att.worldVerticesLength;
				world.length = n;
				att.computeWorldVertices(slot, 0, n, world, 0, 2);
				if (d.drawMeshTriangles) {
					const t = att.triangles;
					for (let i = 0; i < t.length; i += 3) {
						const a = t[i] * 2;
						const b = t[i + 1] * 2;
						const c = t[i + 2] * 2;
						this.triangle(false, world[a], world[a + 1], world[b], world[b + 1], world[c], world[c + 1], d.triangleLineColor);
					}
				}
				if (d.drawMeshHull && att.hullLength > 0) {
					const hull = att.hullLength >> 1;
					this.polygon(world, 0, hull, d.attachmentLineColor);
				}
			}
		if (d.drawBoundingBoxes)
			for (const slot of skeleton.slots) {
				const att = slot.getAttachment();
				if (!(att instanceof BoundingBoxAttachment) || !visible(slot)) continue;
				const n = att.worldVerticesLength;
				world.length = n;
				att.computeWorldVertices(slot, 0, n, world, 0, 2);
				this.polygon(world, 0, n >> 1, d.aabbColor);
			}
		if (d.drawPaths)
			for (const slot of skeleton.slots) {
				const att = slot.getAttachment();
				if (!(att instanceof PathAttachment) || !visible(slot)) continue;
				const n = att.worldVerticesLength;
				world.length = n;
				att.computeWorldVertices(slot, 0, n, world, 0, 2);
				for (let i = 2; i + 7 < n + (att.closed ? 2 : 0); i += 6) {
					const x1 = world[i];
					const y1 = world[i + 1];
					const x2 = world[(i + 6) % n];
					const y2 = world[(i + 7) % n];
					this.line(x1, y1, world[(i + 2) % n], world[(i + 3) % n], d.pathColor);
					this.line(x2, y2, world[(i + 4) % n], world[(i + 5) % n], d.pathColor);
					this.line(x1, y1, x2, y2, d.pathColor);
				}
			}
		if (d.drawClipping)
			for (const slot of skeleton.slots) {
				const att = slot.getAttachment();
				if (!(att instanceof ClippingAttachment) || !visible(slot)) continue;
				const n = att.worldVerticesLength;
				world.length = n;
				att.computeWorldVertices(slot, 0, n, world, 0, 2);
				this.polygon(world, 0, n >> 1, d.clipColor);
			}
		if (d.drawBones)
			for (const bone of skeleton.bones) {
				if (!bone.active || ignoredBones?.includes(bone.data.name)) continue;
				const len = bone.data.length;
				const x = len * bone.a + bone.worldX;
				const y = len * bone.c + bone.worldY;
				if (len > 0) this.line(bone.worldX, bone.worldY, x, y, d.boneLineColor);
				this.circle(true, bone.worldX, bone.worldY, 3 * s, d.boneOriginColor, 8);
			}
		if (d.drawSkeletonXY) this.circle(true, skeleton.x, skeleton.y, 4 * s, d.boneOriginColor, 8);
	}

	dispose(): void {
		const gl = this.gl;
		gl.deleteBuffer(this.vbo);
		gl.deleteBuffer(this.ibo);
		gl.deleteProgram(this.textured.program);
		gl.deleteProgram(this.shapes.program);
	}

	get isDrawing(): boolean {
		return this.drawing;
	}
}

function pageTexture(region: TextureRegion | null): GLTexture | null {
	if (!region) return null;
	const own = region.texture as GLTexture | null;
	if (own && 'bind' in own) return own;
	const page = (region as unknown as { page?: { texture?: unknown } }).page?.texture as GLTexture | undefined;
	return page && 'bind' in page ? page : null;
}
