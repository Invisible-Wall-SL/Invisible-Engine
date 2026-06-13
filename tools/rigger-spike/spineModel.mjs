// Invisible Rigger — Phase 0 spike: Spine 4.x skeleton model (parse <-> serialize).
//
// This is a THROWAWAY proof, not production code. Goal: prove we can read a real
// Spine skeleton into our own structured model and re-emit valid Spine JSON that
// the official runtime loader reads back identically — with special focus on the
// WEIGHTED-MESH vertex format, which is the data contract the weight-painting
// feature (Phase 4) stands on.
//
// Strategy: explicitly model the rig structure (skeleton header, bones, slots,
// IK/transform/path constraints, skins + all attachment types incl. decoded
// weighted-mesh vertices, events). Animations + slot draw-order are passed through
// verbatim in v1 (labelled in the report) — Phase 5 will model them.
//
// We emit fields EXPLICITLY (we don't replicate Esoteric's omit-defaults
// minimisation). Phase 0 asks "does the loader get the same data", not "are the
// bytes identical to Esoteric's exporter". Byte-minimisation is a later nicety.

const num = (v, d = 0) => (v === undefined || v === null ? d : v);

// ---- weighted-mesh vertex codec (the headline) -----------------------------
// Spine packs mesh geometry into a flat `vertices` array.
//  - Unweighted: vertices.length === uvs.length (just x,y per vertex, attachment space).
//  - Weighted:   for each vertex -> boneCount, then (boneIndex, x, y, weight) * boneCount,
//                with x,y expressed in EACH influencing bone's local space.
// vertexCount is always uvs.length / 2.
export function decodeVertices(vertices, uvs) {
	const vertexCount = uvs.length / 2;
	const weighted = vertices.length !== uvs.length;
	if (!weighted) {
		const verts = [];
		for (let i = 0; i < vertexCount; i++) {
			verts.push({ x: vertices[i * 2], y: vertices[i * 2 + 1], bones: null });
		}
		return { weighted: false, verts };
	}
	const verts = [];
	let i = 0;
	for (let v = 0; v < vertexCount; v++) {
		const boneCount = vertices[i++];
		const bones = [];
		for (let b = 0; b < boneCount; b++) {
			bones.push({
				bone: vertices[i++],
				x: vertices[i++],
				y: vertices[i++],
				weight: vertices[i++],
			});
		}
		verts.push({ x: null, y: null, bones });
	}
	return { weighted: true, verts };
}

export function encodeVertices(model) {
	const out = [];
	if (!model.weighted) {
		for (const v of model.verts) out.push(v.x, v.y);
		return out;
	}
	for (const v of model.verts) {
		out.push(v.bones.length);
		for (const inf of v.bones) out.push(inf.bone, inf.x, inf.y, inf.weight);
	}
	return out;
}

// ---- attachment parse/serialize -------------------------------------------
function parseAttachment(name, raw) {
	const type = raw.type || 'region';
	const base = { name: raw.name || name, type };
	switch (type) {
		case 'region':
			return {
				...base,
				path: raw.path,
				x: num(raw.x),
				y: num(raw.y),
				scaleX: num(raw.scaleX, 1),
				scaleY: num(raw.scaleY, 1),
				rotation: num(raw.rotation),
				width: raw.width,
				height: raw.height,
				color: raw.color,
				sequence: raw.sequence, // 4.2 sequence attachment (region resolves to name+index)
			};
		case 'mesh': {
			const decoded = decodeVertices(raw.vertices, raw.uvs);
			return {
				...base,
				path: raw.path,
				uvs: raw.uvs,
				triangles: raw.triangles,
				geometry: decoded, // { weighted, verts } — the decoded model
				hull: num(raw.hull),
				edges: raw.edges,
				width: raw.width,
				height: raw.height,
				color: raw.color,
				sequence: raw.sequence, // meshes can be sequences too
			};
		}
		case 'linkedmesh':
			return { ...base, path: raw.path, skin: raw.skin, parent: raw.parent, deform: raw.deform, width: raw.width, height: raw.height, color: raw.color };
		case 'boundingbox':
			return { ...base, vertexCount: raw.vertexCount, vertices: raw.vertices, color: raw.color };
		case 'clipping':
			return { ...base, end: raw.end, vertexCount: raw.vertexCount, vertices: raw.vertices, color: raw.color };
		case 'path':
			return {
				...base,
				closed: !!raw.closed,
				constantSpeed: raw.constantSpeed === undefined ? true : raw.constantSpeed,
				lengths: raw.lengths,
				vertexCount: raw.vertexCount,
				vertices: raw.vertices,
				color: raw.color,
			};
		case 'point':
			return { ...base, x: num(raw.x), y: num(raw.y), rotation: num(raw.rotation), color: raw.color };
		default:
			return { ...base, _raw: raw }; // unknown — carry through verbatim
	}
}

function serializeAttachment(a) {
	const o = {};
	const put = (k, v, skip) => {
		if (v === undefined || v === null) return;
		if (skip !== undefined && v === skip) return;
		o[k] = v;
	};
	if (a.type !== 'region') o.type = a.type;
	switch (a.type) {
		case 'region':
			put('path', a.path);
			put('x', a.x, 0); put('y', a.y, 0);
			put('scaleX', a.scaleX, 1); put('scaleY', a.scaleY, 1);
			put('rotation', a.rotation, 0);
			put('width', a.width); put('height', a.height);
			put('color', a.color);
			put('sequence', a.sequence);
			return o;
		case 'mesh':
			put('path', a.path);
			o.uvs = a.uvs;
			o.triangles = a.triangles;
			o.vertices = encodeVertices(a.geometry);
			put('hull', a.hull, 0);
			put('edges', a.edges);
			put('width', a.width); put('height', a.height);
			put('color', a.color);
			put('sequence', a.sequence);
			return o;
		case 'linkedmesh':
			put('path', a.path); put('skin', a.skin); put('parent', a.parent);
			put('deform', a.deform); put('width', a.width); put('height', a.height); put('color', a.color);
			return o;
		case 'boundingbox':
			put('vertexCount', a.vertexCount); o.vertices = a.vertices; put('color', a.color);
			return o;
		case 'clipping':
			put('end', a.end); put('vertexCount', a.vertexCount); o.vertices = a.vertices; put('color', a.color);
			return o;
		case 'path':
			if (a.closed) o.closed = true;
			if (a.constantSpeed === false) o.constantSpeed = false;
			put('lengths', a.lengths); put('vertexCount', a.vertexCount); o.vertices = a.vertices; put('color', a.color);
			return o;
		case 'point':
			put('x', a.x, 0); put('y', a.y, 0); put('rotation', a.rotation, 0); put('color', a.color);
			return o;
		default:
			return a._raw;
	}
}

// ---- skeleton parse/serialize ---------------------------------------------
export function parseSkeleton(raw) {
	const m = {};
	m.skeleton = raw.skeleton ? { ...raw.skeleton } : {};
	m.bones = (raw.bones || []).map((b) => ({
		name: b.name,
		parent: b.parent,
		length: num(b.length),
		x: num(b.x), y: num(b.y),
		rotation: num(b.rotation),
		scaleX: num(b.scaleX, 1), scaleY: num(b.scaleY, 1),
		shearX: num(b.shearX), shearY: num(b.shearY),
		// 4.1 calls it `transform`, 4.2 `inherit` — preserve whichever is present
		inherit: b.inherit, transform: b.transform,
		color: b.color,
	}));
	m.slots = (raw.slots || []).map((s) => ({
		name: s.name,
		bone: s.bone,
		color: s.color,
		dark: s.dark,
		attachment: s.attachment,
		blend: s.blend,
	}));
	m.ik = raw.ik ? JSON.parse(JSON.stringify(raw.ik)) : undefined;
	m.transform = raw.transform ? JSON.parse(JSON.stringify(raw.transform)) : undefined;
	m.path = raw.path ? JSON.parse(JSON.stringify(raw.path)) : undefined;
	// skins: 4.1/4.2 array form [{ name, attachments: { slot: { att: {...} } } }]
	m.skins = (raw.skins || []).map((sk) => ({
		name: sk.name,
		bones: sk.bones,
		ik: sk.ik,
		transform: sk.transform,
		path: sk.path,
		attachments: Object.fromEntries(
			Object.entries(sk.attachments || {}).map(([slot, atts]) => [
				slot,
				Object.fromEntries(Object.entries(atts).map(([an, ar]) => [an, parseAttachment(an, ar)])),
			]),
		),
	}));
	m.events = raw.events ? JSON.parse(JSON.stringify(raw.events)) : undefined;
	// v1: animations passed through verbatim (Phase 5 will model them)
	m.animations = raw.animations ? JSON.parse(JSON.stringify(raw.animations)) : undefined;
	m._animationsPassThrough = true;
	return m;
}

export function serializeSkeleton(m) {
	const out = {};
	out.skeleton = m.skeleton;
	out.bones = m.bones.map((b) => {
		const o = { name: b.name };
		if (b.parent !== undefined) o.parent = b.parent;
		if (b.length) o.length = b.length;
		if (b.x) o.x = b.x;
		if (b.y) o.y = b.y;
		if (b.rotation) o.rotation = b.rotation;
		if (b.scaleX !== 1) o.scaleX = b.scaleX;
		if (b.scaleY !== 1) o.scaleY = b.scaleY;
		if (b.shearX) o.shearX = b.shearX;
		if (b.shearY) o.shearY = b.shearY;
		if (b.inherit !== undefined) o.inherit = b.inherit;
		if (b.transform !== undefined) o.transform = b.transform;
		if (b.color !== undefined) o.color = b.color;
		return o;
	});
	out.slots = m.slots.map((s) => {
		const o = { name: s.name, bone: s.bone };
		if (s.color !== undefined) o.color = s.color;
		if (s.dark !== undefined) o.dark = s.dark;
		if (s.attachment !== undefined) o.attachment = s.attachment;
		if (s.blend !== undefined) o.blend = s.blend;
		return o;
	});
	if (m.ik) out.ik = m.ik;
	if (m.transform) out.transform = m.transform;
	if (m.path) out.path = m.path;
	out.skins = m.skins.map((sk) => {
		const o = { name: sk.name };
		if (sk.bones) o.bones = sk.bones;
		if (sk.ik) o.ik = sk.ik;
		if (sk.transform) o.transform = sk.transform;
		if (sk.path) o.path = sk.path;
		o.attachments = Object.fromEntries(
			Object.entries(sk.attachments).map(([slot, atts]) => [
				slot,
				Object.fromEntries(Object.entries(atts).map(([an, a]) => [an, serializeAttachment(a)])),
			]),
		);
		return o;
	});
	if (m.events) out.events = m.events;
	if (m.animations) out.animations = m.animations;
	return out;
}
