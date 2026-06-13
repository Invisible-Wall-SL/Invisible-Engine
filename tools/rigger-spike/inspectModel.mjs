// Invisible Rigger — Phase 1: skeleton inspector read-model.
//
// Pure view-model builders that turn a runtime SkeletonData into the structures
// the read-only viewer/inspector renders: a bone hierarchy tree, setup-pose bone
// world transforms (origin + tip — what the bone OVERLAY draws), slots in draw
// order, skins + their attachments, and the animation list. No rendering here —
// this is the data the `/rigger` Svelte page will consume.
//
// Phase 1 leans on the official runtime for forward-kinematics (setup-pose world
// transforms); Phase 2+ will compute FK from our own editable document.

export function buildInspector(skeletonData, spine) {
	const { Skeleton, Physics } = spine;
	const sk = new Skeleton(skeletonData);
	sk.setToSetupPose();
	try {
		sk.updateWorldTransform(Physics.update);
	} catch {
		sk.updateWorldTransform();
	}

	const round = (n) => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : n);
	const hex = (c) =>
		c
			? '#' +
				[c.r, c.g, c.b, c.a]
					.map((v) => Math.round(v * 255).toString(16).padStart(2, '0'))
					.join('')
			: null;

	// ---- bones: flat list with local + setup-pose world transforms ----------
	const bones = sk.bones.map((b, i) => ({
		index: i,
		name: b.data.name,
		parent: b.parent ? b.parent.data.name : null,
		length: round(b.data.length),
		local: {
			x: round(b.data.x),
			y: round(b.data.y),
			rotation: round(b.data.rotation),
			scaleX: round(b.data.scaleX),
			scaleY: round(b.data.scaleY),
			shearX: round(b.data.shearX),
			shearY: round(b.data.shearY),
		},
		// what the overlay draws: origin -> tip line, plus world rotation for the bone shape
		world: {
			x: round(b.worldX),
			y: round(b.worldY),
			rotation: round(Math.atan2(b.c, b.a) * 180 / Math.PI),
			tipX: round(b.worldX + b.data.length * b.a),
			tipY: round(b.worldY + b.data.length * b.c),
		},
	}));

	// ---- bone hierarchy tree -------------------------------------------------
	const byName = new Map(bones.map((b) => [b.name, { ...b, children: [] }]));
	const roots = [];
	for (const b of byName.values()) {
		if (b.parent && byName.has(b.parent)) byName.get(b.parent).children.push(b);
		else roots.push(b);
	}
	const boneTree = roots;

	// ---- slots in DRAW ORDER -------------------------------------------------
	const slots = sk.drawOrder.map((slot, z) => ({
		z,
		name: slot.data.name,
		bone: slot.boneData ? slot.boneData.name : slot.bone?.data.name,
		attachment: slot.data.attachmentName || null,
		color: hex(slot.data.color),
		blend: slot.data.blendMode,
	}));

	// ---- skins + their attachments ------------------------------------------
	const slotName = (idx) => sk.slots[idx]?.data.name ?? `#${idx}`;
	const skins = skeletonData.skins.map((skin) => {
		const atts = (skin.getAttachments ? skin.getAttachments() : []).map((e) => ({
			slot: slotName(e.slotIndex),
			name: e.name,
			type: e.attachment.constructor.name.replace('Attachment', '').toLowerCase(),
			weighted: e.attachment.constructor.name === 'MeshAttachment' && !!(e.attachment.bones && e.attachment.bones.length),
		}));
		atts.sort((a, b) => a.slot.localeCompare(b.slot) || a.name.localeCompare(b.name));
		return { name: skin.name, attachmentCount: atts.length, attachments: atts };
	});

	// ---- constraints + animations -------------------------------------------
	const constraints = {
		ik: skeletonData.ikConstraints.map((c) => c.name),
		transform: skeletonData.transformConstraints.map((c) => c.name),
		path: skeletonData.pathConstraints.map((c) => c.name),
	};
	const animations = skeletonData.animations
		.map((a) => ({ name: a.name, duration: round(a.duration), timelines: a.timelines.length }))
		.sort((a, b) => a.name.localeCompare(b.name));

	return {
		meta: {
			name: skeletonData.name || null,
			spine: skeletonData.version || null,
			x: round(skeletonData.x),
			y: round(skeletonData.y),
			width: round(skeletonData.width),
			height: round(skeletonData.height),
			fps: round(skeletonData.fps),
		},
		counts: {
			bones: bones.length,
			slots: slots.length,
			skins: skins.length,
			animations: animations.length,
			ik: constraints.ik.length,
			transform: constraints.transform.length,
			path: constraints.path.length,
		},
		bones,
		boneTree,
		slots,
		skins,
		constraints,
		animations,
	};
}
