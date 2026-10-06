import {
	Bounds,
	Container,
	Mesh,
	MeshGeometry,
	Ticker,
	type ContainerOptions,
	type DestroyOptions,
	type PointData,
	type Shader,
	type Texture,
} from 'pixi.js';
import { AnimationState, AnimationStateData } from '../animationState';
import { ClippingAttachment, MeshAttachment, RegionAttachment } from '../attachments';
import { BlendMode, type SkeletonData } from '../data';
import { SkeletonClipping } from '../clipping';
import { Physics } from '../physics';
import { Skeleton } from '../skeleton';
import { Vector2 } from '../math';
import type { Bone } from '../bone';
import type { Slot } from '../slot';
import { RigPageTexture } from './pageTexture';
import { createDarkTintShader } from './darkTint';

export interface RigViewOptions extends ContainerOptions {
	skeletonData: SkeletonData;
	/** Advance with the ticker every frame (default true). Off: call `update(dt)` yourself. */
	autoUpdate?: boolean;
	ticker?: Ticker;
	/** Draw every slot with the two-color shader, not only slots that have a dark color. */
	darkTint?: boolean;
}

interface SlotObject {
	slot: Slot;
	container: Container;
	followAttachmentTimeline: boolean;
	followSlotColor: boolean;
}

interface SlotMesh {
	mesh: Mesh;
	/** The two-color shader, for a slot drawn with a dark color. */
	darkShader: Shader | null;
	positions: Float32Array;
	uvs: Float32Array;
	indices: Uint32Array;
}

const QUAD = [0, 1, 2, 2, 3, 0];
const BLEND: Record<BlendMode, 'normal' | 'add' | 'multiply' | 'screen'> = {
	[BlendMode.Normal]: 'normal',
	[BlendMode.Additive]: 'add',
	[BlendMode.Multiply]: 'multiply',
	[BlendMode.Screen]: 'screen',
};

const channel = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 255);

/** A skeleton drawn by Pixi: one mesh per visible slot, in draw order, with any slot objects placed
 * at their slot's depth. Coordinates inside are skeleton coordinates (y down). */
export class RigView extends Container {
	skeleton: Skeleton;
	state: AnimationState;
	/** Called after animations are applied and before world transforms are computed. */
	beforeUpdateWorldTransforms: (view: RigView) => void = () => {};
	/** Called after world transforms are computed. */
	afterUpdateWorldTransforms: (view: RigView) => void = () => {};

	private slotMeshes: Array<SlotMesh | undefined> = [];
	private slotObjects = new Map<Slot, SlotObject>();
	private clipper = new SkeletonClipping();
	private scratch: number[] = [];
	private drawn: Container[] = [];
	private darkTint: boolean;
	private _autoUpdate = false;
	private neverUpdated = true;
	private _ticker: Ticker;
	private readonly tick = (ticker: Ticker): void => this.internalUpdate(ticker.deltaMS / 1000);

	constructor(options: RigViewOptions | SkeletonData) {
		// Structural, not instanceof: data read by another copy of the runtime is still data.
		const opts: RigViewOptions = 'skeletonData' in options ? options : { skeletonData: options };
		const { skeletonData, autoUpdate = true, ticker, darkTint = false, ...containerOptions } = opts;
		super(containerOptions);
		this.skeleton = new Skeleton(skeletonData);
		this.skeleton.yDown = true;
		this.state = new AnimationState(new AnimationStateData(skeletonData));
		this.darkTint = darkTint;
		this._ticker = ticker ?? Ticker.shared;
		this.autoUpdate = autoUpdate;
		// Pose the setup skeleton so it can draw before the first update, without starting physics:
		// the simulation begins at the first `update`, from the pose its animations give.
		this.skeleton.updateWorldTransform(Physics.none);
		this.onRender = () => this.syncDisplay();
		this.syncDisplay();
	}

	get autoUpdate(): boolean {
		return this._autoUpdate;
	}

	set autoUpdate(value: boolean) {
		if (value === this._autoUpdate) return;
		this._autoUpdate = value;
		if (value) this._ticker.add(this.tick);
		else this._ticker.remove(this.tick);
	}

	get ticker(): Ticker {
		return this._ticker;
	}

	set ticker(value: Ticker) {
		if (value === this._ticker) return;
		if (this._autoUpdate) {
			this._ticker.remove(this.tick);
			value.add(this.tick);
		}
		this._ticker = value;
	}

	/** Advances animations and physics by `dt` seconds and poses the skeleton. */
	update(dt: number): void {
		this.internalUpdate(dt);
	}

	protected internalUpdate(dt: number): void {
		this.neverUpdated = false;
		const { state, skeleton } = this;
		state.update(dt);
		skeleton.update(dt);
		state.apply(skeleton);
		this.beforeUpdateWorldTransforms(this);
		skeleton.updateWorldTransform(Physics.update);
		this.afterUpdateWorldTransforms(this);
		this.syncDisplay();
	}

	/** Bounds of the current pose, in this container's local space. */
	get bounds(): Bounds {
		// Asked before any update: apply what is queued at time 0 first, so the bounds are those of
		// the pose the first frame will show.
		if (this.neverUpdated) this.internalUpdate(0);
		const offset = new Vector2();
		const size = new Vector2();
		this.skeleton.getBounds(offset, size, this.scratch, this.clipper);
		if (!Number.isFinite(offset.x)) return new Bounds(0, 0, 0, 0);
		return new Bounds(offset.x, offset.y, offset.x + size.x, offset.y + size.y);
	}

	/** World position of a bone, in this container's local space. */
	getBonePosition(bone: string | Bone, out: PointData = { x: 0, y: 0 }): PointData | undefined {
		const b = typeof bone === 'string' ? this.skeleton.findBone(bone) : bone;
		if (!b) return undefined;
		out.x = b.worldX;
		out.y = b.worldY;
		return out;
	}

	/** Moves a bone so its world position is `position` (container local space). */
	setBonePosition(bone: string | Bone, position: PointData): void {
		const b = typeof bone === 'string' ? this.skeleton.findBone(bone) : bone;
		if (!b) throw new Error(`Bone not found: ${bone}`);
		const p = new Vector2(position.x, position.y);
		if (b.parent) b.parent.worldToLocal(p);
		else {
			p.x -= this.skeleton.x;
			p.y -= this.skeleton.y;
		}
		b.x = p.x;
		b.y = p.y;
	}

	skeletonToPixiWorldCoordinates(point: PointData): void {
		this.worldTransform.apply(point, point);
	}

	pixiWorldCoordinatesToSkeleton(point: PointData): void {
		this.worldTransform.applyInverse(point, point);
	}

	pixiWorldCoordinatesToBone(point: PointData, bone: Bone): void {
		this.pixiWorldCoordinatesToSkeleton(point);
		const p = new Vector2(point.x, point.y);
		if (bone.parent) bone.parent.worldToLocal(p);
		point.x = p.x;
		point.y = p.y;
	}

	private resolveSlot(slot: number | string | Slot): Slot {
		const found =
			typeof slot === 'number'
				? this.skeleton.slots[slot]
				: typeof slot === 'string'
					? this.skeleton.findSlot(slot)
					: slot;
		if (!found) throw new Error(`Slot not found: ${slot}`);
		return found;
	}

	/** Draws `container` at a slot's depth, following its bone. A slot holds one object: adding
	 * another replaces it. */
	addSlotObject(
		slot: number | string | Slot,
		container: Container,
		options: { followAttachmentTimeline?: boolean; followSlotColor?: boolean } = {},
	): void {
		const s = this.resolveSlot(slot);
		this.removeSlotObject(container);
		const previous = this.slotObjects.get(s);
		if (previous) this.removeSlotObject(previous.container);
		this.slotObjects.set(s, {
			slot: s,
			container,
			followAttachmentTimeline: options.followAttachmentTimeline ?? false,
			followSlotColor: options.followSlotColor ?? false,
		});
		this.syncDisplay();
	}

	removeSlotObject(slotOrContainer: number | string | Slot | Container): void {
		for (const [slot, entry] of this.slotObjects) {
			const match =
				slotOrContainer instanceof Container
					? entry.container === slotOrContainer
					: slot === this.resolveSlot(slotOrContainer);
			if (!match) continue;
			this.slotObjects.delete(slot);
			if (entry.container.parent === this) this.removeChild(entry.container);
			this.drawn = this.drawn.filter((c) => c !== entry.container);
			return;
		}
	}

	removeSlotObjects(): void {
		for (const entry of [...this.slotObjects.values()]) this.removeSlotObject(entry.container);
	}

	getSlotObject(slot: number | string | Slot): Container | undefined {
		return this.slotObjects.get(this.resolveSlot(slot))?.container;
	}

	private placeSlotObject(entry: SlotObject): void {
		const { slot, container } = entry;
		const bone = slot.bone;
		container.position.set(bone.worldX, bone.worldY);
		let sx = 1;
		let sy = 1;
		for (let b: Bone | null = bone; b; b = b.parent) {
			sx *= b.scaleX;
			sy *= b.scaleY;
		}
		container.angle = bone.getWorldRotationX() - (sx < 0 ? 180 : 0);
		container.scale.set(
			bone.getWorldScaleX() * Math.sign(sx || 1),
			bone.getWorldScaleY() * Math.sign(sy || 1),
		);
		container.visible = bone.active && (!entry.followAttachmentTimeline || !!slot.attachment);
		if (entry.followSlotColor) {
			const c = slot.color;
			container.tint = (channel(c.r) << 16) | (channel(c.g) << 8) | channel(c.b);
			container.alpha = c.a * this.skeleton.color.a;
		}
	}

	/** Rebuilds every slot's mesh from the current pose and restores draw order. Runs before each
	 * render, and after `update`. */
	syncDisplay(): void {
		const skeleton = this.skeleton;
		const clipper = this.clipper;
		const order: Container[] = [];
		const used = new Set<number>();
		for (const slot of skeleton.drawOrder) {
			const object = this.slotObjects.get(slot);
			if (object) {
				this.placeSlotObject(object);
				order.push(object.container);
			}
			const attachment = slot.getAttachment();
			if (!slot.bone.active) {
				clipper.clipEndWithSlot(slot);
				continue;
			}
			if (attachment instanceof ClippingAttachment) {
				clipper.clipStart(slot, attachment);
				continue;
			}
			if (attachment instanceof RegionAttachment || attachment instanceof MeshAttachment) {
				const shown = this.drawAttachment(slot, attachment);
				if (shown) {
					order.push(shown);
					used.add(slot.data.index);
				}
			}
			clipper.clipEndWithSlot(slot);
		}
		clipper.clipEnd();
		this.slotMeshes.forEach((m, i) => {
			if (m && !used.has(i)) m.mesh.visible = false;
		});
		this.restoreOrder(order);
	}

	private restoreOrder(order: Container[]): void {
		const same =
			order.length === this.drawn.length &&
			order.every((c, i) => c === this.drawn[i] && c.parent === this);
		if (same) return;
		for (const c of this.drawn) if (c.parent === this && !order.includes(c)) this.removeChild(c);
		order.forEach((c, i) => {
			if (c.parent !== this) this.addChildAt(c, Math.min(i, this.children.length));
			else this.setChildIndex(c, Math.min(i, this.children.length - 1));
		});
		this.drawn = order;
	}

	private drawAttachment(slot: Slot, attachment: RegionAttachment | MeshAttachment): Mesh | null {
		const skeletonColor = this.skeleton.color;
		const slotColor = slot.color;
		const color = attachment.color;
		const alpha = skeletonColor.a * slotColor.a * color.a;
		const region = attachment instanceof RegionAttachment ? attachment : attachment;
		let positions: ArrayLike<number>;
		let uvs: ArrayLike<number>;
		let triangles: ArrayLike<number>;
		const scratch = this.scratch;
		if (attachment instanceof RegionAttachment) {
			scratch.length = 8;
			attachment.computeWorldVertices(slot, scratch, 0, 2);
			positions = scratch;
			uvs = attachment.uvs;
			triangles = QUAD;
		} else {
			const n = attachment.worldVerticesLength;
			scratch.length = n;
			attachment.computeWorldVertices(slot, 0, n, scratch, 0, 2);
			positions = scratch;
			uvs = attachment.uvs;
			triangles = attachment.triangles;
		}
		const page = region.region?.texture;
		if (!(page instanceof RigPageTexture) || alpha <= 0) return null;
		if (this.clipper.isClipping()) {
			this.clipper.clipTrianglesUnpacked(positions, triangles, triangles.length, uvs);
			if (!this.clipper.clippedTriangles.length) return null;
			positions = this.clipper.clippedVertices;
			uvs = this.clipper.clippedUVs;
			triangles = this.clipper.clippedTriangles;
		}
		const dark = this.darkTint || !!slot.darkColor;
		const entry = this.slotMesh(slot.data.index, page.texture, dark);
		const mesh = entry.mesh;
		this.writeGeometry(entry, positions, uvs, triangles);
		if (mesh.texture !== page.texture) {
			mesh.texture = page.texture;
			if (entry.darkShader) {
				entry.darkShader.resources.uTexture = page.texture.source;
				entry.darkShader.resources.uSampler = page.texture.source.style;
			}
		}
		const r = skeletonColor.r * slotColor.r * color.r;
		const g = skeletonColor.g * slotColor.g * color.g;
		const b = skeletonColor.b * slotColor.b * color.b;
		mesh.tint = (channel(r) << 16) | (channel(g) << 8) | channel(b);
		mesh.alpha = alpha;
		mesh.blendMode = BLEND[slot.data.blendMode];
		if (entry.darkShader) {
			const d = slot.darkColor;
			const u = entry.darkShader.resources.darkUniforms.uniforms.uDark as Float32Array;
			u[0] = d ? d.r : 0;
			u[1] = d ? d.g : 0;
			u[2] = d ? d.b : 0;
		}
		mesh.visible = true;
		return mesh;
	}

	private slotMesh(index: number, texture: Texture, dark: boolean): SlotMesh {
		const existing = this.slotMeshes[index];
		if (existing && !!existing.darkShader === dark) return existing;
		if (existing) existing.mesh.destroy();
		const geometry = new MeshGeometry({
			positions: new Float32Array(8),
			uvs: new Float32Array(8),
			indices: new Uint32Array(QUAD),
		});
		geometry.batchMode = 'batch';
		const darkShader = dark ? createDarkTintShader(texture) : null;
		const mesh = darkShader
			? new Mesh({ geometry, texture, shader: darkShader })
			: new Mesh({ geometry, texture });
		const entry: SlotMesh = {
			mesh: mesh as unknown as Mesh,
			darkShader,
			positions: geometry.positions,
			uvs: geometry.uvs,
			indices: geometry.indices as Uint32Array,
		};
		this.slotMeshes[index] = entry;
		return entry;
	}

	private writeGeometry(
		entry: SlotMesh,
		positions: ArrayLike<number>,
		uvs: ArrayLike<number>,
		triangles: ArrayLike<number>,
	): void {
		const geometry = entry.mesh.geometry;
		const vertexFloats = uvs.length;
		if (entry.positions.length !== vertexFloats) {
			entry.positions = new Float32Array(vertexFloats);
			entry.uvs = new Float32Array(vertexFloats);
			entry.positions.set(Array.prototype.slice.call(positions, 0, vertexFloats));
			entry.uvs.set(uvs as ArrayLike<number>);
			geometry.positions = entry.positions;
			geometry.uvs = entry.uvs;
		} else {
			for (let i = 0; i < vertexFloats; i++) entry.positions[i] = positions[i];
			geometry.getBuffer('aPosition').update();
			let changed = false;
			for (let i = 0; i < vertexFloats; i++)
				if (entry.uvs[i] !== uvs[i]) {
					entry.uvs[i] = uvs[i];
					changed = true;
				}
			if (changed) geometry.getBuffer('aUV').update();
		}
		let same = entry.indices.length === triangles.length;
		for (let i = 0; same && i < triangles.length; i++) same = entry.indices[i] === triangles[i];
		if (!same) {
			entry.indices = new Uint32Array(triangles);
			geometry.indices = entry.indices;
		}
	}

	destroy(options?: DestroyOptions): void {
		this.autoUpdate = false;
		this.onRender = null;
		this.removeSlotObjects();
		for (const m of this.slotMeshes) m?.mesh.destroy();
		this.slotMeshes = [];
		this.state.clearListeners();
		this.state.clearTracks();
		super.destroy(options);
	}
}
