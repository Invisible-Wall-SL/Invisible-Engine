<script lang="ts">
	import { resolveTransform, type LayoutNode, type Scene } from 'engine-layout';
	import { onMount } from 'svelte';

	interface DragPayload {
		kind: string;
		key: string;
		name: string;
	}

	interface Props {
		scene: Scene;
		frameWidth: number;
		frameHeight: number;
		onSpawn: (node: LayoutNode, pos: { x: number; y: number }) => void;
	}

	let { scene, frameWidth, frameHeight, onSpawn }: Props = $props();

	let canvas: HTMLCanvasElement | null = $state(null);
	let wrap: HTMLDivElement | null = $state(null);

	// Viewport: pan offset + zoom, in CSS pixels. World coords are document coords.
	let panX = $state(0);
	let panY = $state(0);
	let zoom = $state(0.5);
	let panning = $state(false);
	let lastXY: [number, number] | null = null;
	let dragOver = $state(false);

	// Image cache keyed by R2 key → loaded HTMLImageElement (or null while loading).
	const images = new Map<string, HTMLImageElement | null>();

	function ensureImage(key: string): HTMLImageElement | null {
		if (images.has(key)) return images.get(key) ?? null;
		images.set(key, null);
		const img = new Image();
		img.onload = () => {
			images.set(key, img);
			schedule();
		};
		img.onerror = () => {
			images.set(key, null);
		};
		img.src = `/api/editor/asset?key=${encodeURIComponent(key)}`;
		return null;
	}

	let rafId = 0;
	function schedule(): void {
		if (rafId) return;
		rafId = requestAnimationFrame(() => {
			rafId = 0;
			draw();
		});
	}

	function resizeCanvas(): void {
		if (!canvas || !wrap) return;
		const dpr = window.devicePixelRatio || 1;
		const w = Math.floor(wrap.clientWidth * dpr);
		const h = Math.floor(wrap.clientHeight * dpr);
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
	}

	function clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
		if (!canvas) return { x: 0, y: 0 };
		const rect = canvas.getBoundingClientRect();
		const cx = clientX - rect.left;
		const cy = clientY - rect.top;
		return { x: (cx - panX) / zoom, y: (cy - panY) / zoom };
	}

	function draw(): void {
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// Background
		ctx.fillStyle = '#0b0b10';
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		// Apply DPR then viewport transform.
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.translate(panX, panY);
		ctx.scale(zoom, zoom);

		// Authoring frame: dashed border matching mainSizesMap.desktop.
		ctx.fillStyle = '#14141c';
		ctx.fillRect(0, 0, frameWidth, frameHeight);
		ctx.lineWidth = 2 / zoom;
		ctx.strokeStyle = '#3a3a4a';
		ctx.setLineDash([12 / zoom, 8 / zoom]);
		ctx.strokeRect(0, 0, frameWidth, frameHeight);
		ctx.setLineDash([]);

		// Nodes.
		for (const node of scene.nodes) {
			drawNode(ctx, node);
		}
	}

	function drawNode(ctx: CanvasRenderingContext2D, node: LayoutNode): void {
		const t = resolveTransform(node, 'desktop');
		if (!t.visible) return;

		ctx.save();
		ctx.translate(t.x, t.y);
		if (t.rotation) ctx.rotate(t.rotation);
		const sx = t.scale?.x ?? 1;
		const sy = t.scale?.y ?? 1;
		if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
		if (t.alpha !== undefined) ctx.globalAlpha = t.alpha;

		if (node.kind === 'sprite') {
			const img = ensureImage(node.assetKey);
			if (img && img.complete && img.naturalWidth > 0) {
				const w = t.width ?? img.naturalWidth;
				const h = t.height ?? img.naturalHeight;
				const ax = t.anchor?.x ?? 0;
				const ay = t.anchor?.y ?? 0;
				ctx.drawImage(img, -w * ax, -h * ay, w, h);
			} else {
				drawPlaceholder(ctx, t.anchor?.x ?? 0.5, t.anchor?.y ?? 0.5, '#3a4a5a', node.label ?? '…');
			}
		} else if (node.kind === 'spine') {
			drawPlaceholder(
				ctx,
				t.anchor?.x ?? 0.5,
				t.anchor?.y ?? 0.5,
				'#4a3a5a',
				`spine: ${node.label ?? node.assetKey}`,
			);
		} else if (node.kind === 'text') {
			ctx.fillStyle = `#${(node.style?.fill ?? 0xffffff).toString(16).padStart(6, '0')}`;
			ctx.font = `${node.style?.fontWeight ?? 'normal'} ${node.style?.fontSize ?? 24}px ${
				node.style?.fontFamily ?? 'sans-serif'
			}`;
			ctx.fillText(node.text, 0, 0);
		} else if (node.kind === 'container') {
			for (const child of node.children) drawNode(ctx, child);
		}

		ctx.restore();
	}

	function drawPlaceholder(
		ctx: CanvasRenderingContext2D,
		ax: number,
		ay: number,
		fill: string,
		label: string,
	): void {
		const w = 160;
		const h = 100;
		ctx.fillStyle = fill;
		ctx.fillRect(-w * ax, -h * ay, w, h);
		ctx.fillStyle = '#e8e8ee';
		ctx.font = '14px sans-serif';
		ctx.fillText(label, -w * ax + 8, -h * ay + 20);
	}

	function onWheel(e: WheelEvent): void {
		e.preventDefault();
		const factor = e.deltaY > 0 ? 0.9 : 1.1;
		const newZoom = Math.max(0.05, Math.min(8, zoom * factor));
		// Zoom around cursor position.
		const rect = canvas?.getBoundingClientRect();
		if (rect) {
			const cx = e.clientX - rect.left;
			const cy = e.clientY - rect.top;
			panX = cx - ((cx - panX) * newZoom) / zoom;
			panY = cy - ((cy - panY) * newZoom) / zoom;
		}
		zoom = newZoom;
		schedule();
	}

	function onMouseDown(e: MouseEvent): void {
		// Right or middle button, or shift+left, pan. Plain left-click does nothing
		// for now (selection is step 6).
		if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey)) {
			panning = true;
			lastXY = [e.clientX, e.clientY];
			e.preventDefault();
		}
	}

	function onWindowMouseMove(e: MouseEvent): void {
		if (!panning || !lastXY) return;
		const dx = e.clientX - lastXY[0];
		const dy = e.clientY - lastXY[1];
		panX += dx;
		panY += dy;
		lastXY = [e.clientX, e.clientY];
		schedule();
	}

	function onWindowMouseUp(): void {
		panning = false;
		lastXY = null;
	}

	function onDragOver(e: DragEvent): void {
		if (!e.dataTransfer) return;
		if (!Array.from(e.dataTransfer.types).includes('application/x-iw-asset')) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
		dragOver = true;
	}

	function onDragLeave(): void {
		dragOver = false;
	}

	function onDrop(e: DragEvent): void {
		dragOver = false;
		if (!e.dataTransfer) return;
		const raw = e.dataTransfer.getData('application/x-iw-asset');
		if (!raw) return;
		e.preventDefault();
		let payload: DragPayload | null = null;
		try {
			payload = JSON.parse(raw) as DragPayload;
		} catch {
			return;
		}
		if (!payload || !payload.key || !payload.kind) return;

		const pos = clientToWorld(e.clientX, e.clientY);
		const node = spawnNode(payload, pos);
		if (node) onSpawn(node, pos);
	}

	function genId(): string {
		return 'n_' + Math.random().toString(36).slice(2, 10);
	}

	function spawnNode(p: DragPayload, pos: { x: number; y: number }): LayoutNode | null {
		const id = genId();
		const base = {
			id,
			label: p.name,
			x: Math.round(pos.x),
			y: Math.round(pos.y),
			anchor: { x: 0.5, y: 0.5 },
			scale: { x: 1, y: 1 },
		};
		switch (p.kind) {
			case 'atlas-page':
			case 'atlas-manifest':
			case 'sheet':
				return { ...base, kind: 'sprite', assetKey: p.key };
			case 'spine':
				return {
					...base,
					kind: 'spine',
					assetKey: p.key,
					defaultAnimation: '',
					loop: false,
				};
			default:
				return null;
		}
	}

	function fitView(): void {
		if (!wrap) return;
		const w = wrap.clientWidth;
		const h = wrap.clientHeight;
		const zx = (w * 0.9) / frameWidth;
		const zy = (h * 0.9) / frameHeight;
		zoom = Math.max(0.05, Math.min(zx, zy, 1));
		panX = (w - frameWidth * zoom) / 2;
		panY = (h - frameHeight * zoom) / 2;
		schedule();
	}

	onMount(() => {
		resizeCanvas();
		fitView();
		const ro = new ResizeObserver(() => {
			resizeCanvas();
			schedule();
		});
		if (wrap) ro.observe(wrap);

		window.addEventListener('mousemove', onWindowMouseMove);
		window.addEventListener('mouseup', onWindowMouseUp);

		return () => {
			ro.disconnect();
			window.removeEventListener('mousemove', onWindowMouseMove);
			window.removeEventListener('mouseup', onWindowMouseUp);
		};
	});

	$effect(() => {
		// Re-render whenever the scene's node list or the frame size changes.
		void scene.nodes.length;
		void frameWidth;
		void frameHeight;
		schedule();
	});
</script>

<div
	bind:this={wrap}
	class="wrap"
	class:dragover={dragOver}
	ondragover={onDragOver}
	ondragleave={onDragLeave}
	ondrop={onDrop}
	oncontextmenu={(e) => e.preventDefault()}
	role="region"
	aria-label="Editor canvas"
>
	<canvas bind:this={canvas} onwheel={onWheel} onmousedown={onMouseDown}></canvas>
	<div class="hint">scroll = zoom · shift/middle/right-drag = pan · drag assets here to spawn</div>
	<button class="fit" onclick={fitView} type="button">Fit</button>
</div>

<style>
	.wrap {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: #0b0b10;
	}
	.wrap.dragover {
		outline: 2px dashed #7ee0c0;
		outline-offset: -8px;
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}
	.hint {
		position: absolute;
		left: 12px;
		bottom: 10px;
		color: #666;
		font-size: 11px;
		pointer-events: none;
		text-shadow: 0 1px 2px #000;
	}
	.fit {
		position: absolute;
		top: 10px;
		right: 10px;
		background: #16161c;
		color: #c8a3ff;
		border: 1px solid #2a2430;
		border-radius: 6px;
		padding: 4px 10px;
		font-size: 11px;
		cursor: pointer;
	}
	.fit:hover {
		border-color: #7ee0c0;
	}
</style>
