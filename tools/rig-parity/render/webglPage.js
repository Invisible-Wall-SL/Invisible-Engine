// Browser side of render-webgl.mjs: draws with whichever runtime is `window.spine` — the vendored
// reference WebGL runtime or engine-rig/webgl — and returns base64 RGBA pixels.
(() => {
	const SPINE = window.spine;
	let canvas = null;
	let gl = null;
	let renderer = null;

	function ensure(size) {
		if (canvas && canvas.width === size) return;
		canvas = document.createElement('canvas');
		canvas.width = canvas.height = size;
		document.body.appendChild(canvas);
		gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
		renderer = new SPINE.SceneRenderer(canvas, gl);
	}

	function load(am) {
		return new Promise((resolve, reject) => {
			const tick = () => {
				if (!am.isLoadingComplete()) return void setTimeout(tick, 10);
				const errs = am.getErrors();
				if (errs && Object.keys(errs).length) reject(new Error(JSON.stringify(errs)));
				else resolve();
			};
			tick();
		});
	}

	function toBase64(bytes) {
		let s = '';
		for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
		return btoa(s);
	}

	window.renderPose = async (pose) => {
		ensure(pose.size);
		const am = new SPINE.AssetManager(gl);
		am.loadTextureAtlas(pose.atlas);
		if (pose.skeleton.endsWith('.skel')) am.loadBinary(pose.skeleton);
		else am.loadJson(pose.skeleton);
		await load(am);
		const loader = new SPINE.AtlasAttachmentLoader(am.require(pose.atlas));
		const raw = am.require(pose.skeleton);
		const data = pose.skeleton.endsWith('.skel')
			? new SPINE.SkeletonBinary(loader).readSkeletonData(raw)
			: new SPINE.SkeletonJson(loader).readSkeletonData(raw);
		const skeleton = new SPINE.Skeleton(data);
		const state = new SPINE.AnimationState(new SPINE.AnimationStateData(data));
		if (pose.animation) state.setAnimation(0, pose.animation, true);
		state.update(pose.time);
		state.apply(skeleton);
		skeleton.update(pose.time);
		skeleton.updateWorldTransform(SPINE.Physics.update);
		if (pose.hideBlend !== undefined)
			for (const slot of skeleton.slots) if (slot.data.blendMode === pose.hideBlend) slot.setAttachment(null);
		const w = data.width || 400;
		const h = data.height || 400;
		const cam = renderer.camera;
		cam.position.x = data.width ? data.x + data.width / 2 : 0;
		cam.position.y = data.height ? data.y + data.height / 2 : 0;
		cam.viewportWidth = cam.viewportHeight = pose.size;
		cam.zoom = Math.max(w, h) / (pose.size * 0.9);
		gl.viewport(0, 0, pose.size, pose.size);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		renderer.begin();
		renderer.drawSkeleton(skeleton, false);
		if (pose.debug) {
			const d = renderer.skeletonDebugRenderer;
			d.drawBones = false;
			d.drawRegionAttachments = false;
			d.drawBoundingBoxes = false;
			d.drawMeshHull = true;
			d.drawMeshTriangles = true;
			d.drawClipping = false;
			d.drawPaths = false;
			renderer.drawSkeletonDebug(skeleton, false);
		}
		renderer.end();
		const out = new Uint8Array(pose.size * pose.size * 4);
		gl.readPixels(0, 0, pose.size, pose.size, gl.RGBA, gl.UNSIGNED_BYTE, out);
		am.dispose();
		return toBase64(out);
	};
	window.ready = true;
})();
