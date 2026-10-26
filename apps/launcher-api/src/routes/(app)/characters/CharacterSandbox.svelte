<script lang="ts">
	/**
	 * The SANDBOX play field (`docs/design/game-families.md` §5.1): the selected character, a
	 * keyboard-driven dummy player (tag `player`), draggable walls and an optional drawn path, run by
	 * `$lib/characters/sandbox.ts` (`engine-mechanics` at a fixed step). Placeholder shapes only —
	 * never project art. Nothing here is saved; a character edit resets the run.
	 */
	import { onMount, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import type { ArcadeBody, ArcadeCharacter } from 'game-config';
	import {
		DEFAULT_WALLS,
		PLAYER_TAG,
		SANDBOX_PATH,
		createSandbox,
		wallAt,
		type Sandbox,
		type SandboxSnapshot,
		type SandboxWall,
	} from '$lib/characters/sandbox';

	let {
		character,
		body,
		field,
		hz,
		onstate,
	}: {
		character: ArcadeCharacter;
		body: ArcadeBody | undefined;
		field: { w: number; h: number };
		hz: number;
		/** The brain's state as the run goes, for the canvas to light. */
		onstate?: (state: string | undefined) => void;
	} = $props();

	const KEYS: Record<string, string> = {
		ArrowLeft: 'left',
		ArrowRight: 'right',
		ArrowUp: 'up',
		ArrowDown: 'down',
		a: 'left',
		d: 'right',
		w: 'up',
		s: 'down',
		A: 'left',
		D: 'right',
		W: 'up',
		S: 'down',
	};

	let seed = $state('1');
	let playing = $state(true);
	let tool = $state<'move' | 'path'>('move');
	let drive = $state<'controller' | 'brain'>('controller');
	let walls = $state<SandboxWall[]>(untrack(() => DEFAULT_WALLS(field)));
	let path = $state<{ x: number; y: number }[]>([]);
	let snap = $state<SandboxSnapshot | null>(null);
	let canvas = $state<HTMLCanvasElement | null>(null);

	const held = new SvelteSet<string>();
	let pointer: { x: number; y: number } | undefined;
	let sandbox: Sandbox | null = null;
	let dragging: { kind: 'player' | 'character' } | { kind: 'wall'; id: string } | null = null;

	const both = $derived(!!character.controller && !!character.brain);
	const W = 640;
	const scale = $derived(W / field.w);
	const H = $derived(Math.round(field.h * scale));

	/** Rebuild the run: a new seed, a character edit, the walls or the path. */
	function reset(): void {
		sandbox = createSandbox({
			character: $state.snapshot(character) as ArcadeCharacter,
			body: body ? ($state.snapshot(body) as ArcadeBody) : undefined,
			field,
			seed,
			walls: $state.snapshot(walls),
			path: path.length >= 2 ? $state.snapshot(path) : undefined,
			hz,
			drive,
		});
		snap = sandbox.snapshot();
		onstate?.(snap.state);
		draw();
	}

	/** What the run is built from; a change restarts it. A state card's place is not. */
	let built = '';
	$effect(() => {
		const key = JSON.stringify([character, body, seed, drive, path.length, field], (k, v) =>
			k === 'pos' ? undefined : v,
		);
		if (key === built) return;
		built = key;
		untrack(reset);
	});

	onMount(() => {
		let last = performance.now();
		let raf = 0;
		const frame = (now: number) => {
			const ms = Math.min(now - last, 100);
			last = now;
			if (playing && sandbox) {
				const before = snap?.state;
				sandbox.advance(ms, { held: [...held], pointer });
				snap = sandbox.snapshot();
				if (snap.state !== before) onstate?.(snap.state);
				draw();
			}
			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);
		return () => cancelAnimationFrame(raf);
	});

	function stepOnce(): void {
		if (!sandbox) return;
		sandbox.step({ held: [...held], pointer });
		snap = sandbox.snapshot();
		onstate?.(snap.state);
		draw();
	}

	function toField(e: PointerEvent): { x: number; y: number } {
		const rect = canvas!.getBoundingClientRect();
		return {
			x: ((e.clientX - rect.left) / rect.width) * field.w,
			y: ((e.clientY - rect.top) / rect.height) * field.h,
		};
	}

	const near = (a: { x: number; y: number }, b: { x: number; y: number }, r: number) =>
		Math.hypot(a.x - b.x, a.y - b.y) <= r;

	function onPointerDown(e: PointerEvent): void {
		canvas?.focus();
		const at = toField(e);
		if (tool === 'path') {
			path = [...path, { x: Math.round(at.x), y: Math.round(at.y) }];
			return;
		}
		canvas?.setPointerCapture(e.pointerId);
		if (snap && near(at, snap.character, 30)) dragging = { kind: 'character' };
		else if (snap && near(at, snap.player, 30)) dragging = { kind: 'player' };
		else {
			const wall = wallAt(walls, at);
			if (wall) dragging = { kind: 'wall', id: wall.id };
			else pointer = at;
		}
	}
	function onPointerMove(e: PointerEvent): void {
		const at = toField(e);
		if (pointer) pointer = at;
		if (!dragging || !sandbox) return;
		if (dragging.kind === 'wall') {
			const id = dragging.id;
			walls = walls.map((w) => (w.id === id ? { ...w, x: at.x, y: at.y } : w));
			sandbox.setWall(walls.find((w) => w.id === id)!);
		} else sandbox.place(dragging.kind, at);
		snap = sandbox.snapshot();
		draw();
	}
	function onPointerUp(): void {
		dragging = null;
		pointer = undefined;
	}

	function onKey(e: KeyboardEvent, down: boolean): void {
		const action = KEYS[e.key];
		if (!action) return;
		e.preventDefault();
		if (down) held.add(action);
		else held.delete(action);
	}

	function addWall(): void {
		const n = walls.length + 1;
		walls = [...walls, { id: `wall${n}`, x: field.w / 2, y: field.h / 2, w: 120, h: 24 }];
		reset();
	}

	function draw(): void {
		const ctx = canvas?.getContext('2d');
		if (!ctx || !snap) return;
		const k = scale;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.fillStyle = '#0b0e13';
		ctx.fillRect(0, 0, canvas!.width, canvas!.height);
		ctx.strokeStyle = '#1a1f28';
		ctx.lineWidth = 1;
		for (let x = 0; x <= field.w; x += 80) {
			ctx.beginPath();
			ctx.moveTo(x * k, 0);
			ctx.lineTo(x * k, field.h * k);
			ctx.stroke();
		}
		for (let y = 0; y <= field.h; y += 80) {
			ctx.beginPath();
			ctx.moveTo(0, y * k);
			ctx.lineTo(field.w * k, y * k);
			ctx.stroke();
		}
		ctx.fillStyle = '#3a4150';
		for (const w of walls) ctx.fillRect((w.x - w.w / 2) * k, (w.y - w.h / 2) * k, w.w * k, w.h * k);
		if (path.length) {
			ctx.strokeStyle = '#c9a7ff';
			ctx.setLineDash([6, 5]);
			ctx.beginPath();
			path.forEach((p, i) => (i ? ctx.lineTo(p.x * k, p.y * k) : ctx.moveTo(p.x * k, p.y * k)));
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.fillStyle = '#c9a7ff';
			for (const p of path) {
				ctx.beginPath();
				ctx.arc(p.x * k, p.y * k, 3, 0, Math.PI * 2);
				ctx.fill();
			}
		}
		const shape = (
			b: SandboxSnapshot['player'],
			fill: string,
			label: string,
			sub?: string,
		): void => {
			ctx.fillStyle = fill;
			ctx.strokeStyle = '#0b0e13';
			if (b.shape === 'circle') {
				ctx.beginPath();
				ctx.arc(b.x * k, b.y * k, b.r * k, 0, Math.PI * 2);
				ctx.fill();
			} else if (b.shape === 'box') {
				ctx.fillRect((b.x - b.w / 2) * k, (b.y - b.h / 2) * k, b.w * k, b.h * k);
			}
			ctx.fillStyle = '#e6e9ef';
			ctx.font = '11px system-ui, sans-serif';
			ctx.textAlign = 'center';
			const top = b.shape === 'circle' ? b.r : b.shape === 'box' ? b.h / 2 : 0;
			ctx.fillText(label, b.x * k, (b.y - top) * k - 4);
			if (sub) {
				ctx.fillStyle = '#7ee0c0';
				ctx.fillText(sub, b.x * k, (b.y - top) * k - 16);
			}
		};
		shape(snap.player, '#3d7dd8', PLAYER_TAG);
		shape(snap.character, '#e08a3c', snap.character.label, snap.state);
		// Facing: a tick on the side the character last moved to.
		ctx.strokeStyle = '#ffd7a8';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(snap.character.x * k, snap.character.y * k);
		ctx.lineTo((snap.character.x + snap.facing * 18) * k, snap.character.y * k);
		ctx.stroke();
		ctx.fillStyle = '#ff6b6b';
		for (const s of snap.shots) {
			ctx.beginPath();
			ctx.arc(s.x * k, s.y * k, s.r * k + 1, 0, Math.PI * 2);
			ctx.fill();
		}
	}
</script>

<div class="sandbox">
	<div class="bar">
		<button type="button" onclick={() => (playing = !playing)}
			>{playing ? '❚❚ Pause' : '▶ Play'}</button
		>
		<button type="button" onclick={stepOnce} disabled={playing} title="One fixed step">Step</button>
		<button type="button" onclick={reset} title="Back to the start, same seed">↺ Reset</button>
		<label class="seed"
			>Seed <input bind:value={seed} spellcheck="false" title="Same seed ⇒ same run" /></label
		>
		{#if both}
			<label
				>Driven by
				<select bind:value={drive}>
					<option value="controller">controller (you)</option>
					<option value="brain">brain (a bot)</option>
				</select>
			</label>
		{/if}
		<span class="spacer"></span>
		<button type="button" class:on={tool === 'move'} onclick={() => (tool = 'move')}>Move</button>
		<button
			type="button"
			class:on={tool === 'path'}
			onclick={() => (tool = 'path')}
			title="Click the field to add path points">Draw path</button
		>
		{#if path.length}<button type="button" onclick={() => (path = [])}>Clear path</button>{/if}
		<button type="button" onclick={addWall}>＋ Wall</button>
	</div>
	<canvas
		bind:this={canvas}
		width={W}
		height={H}
		tabindex="0"
		aria-label="Sandbox play field: arrow keys or WASD move the player"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onkeydown={(e) => onKey(e, true)}
		onkeyup={(e) => onKey(e, false)}
		onblur={() => held.clear()}
	></canvas>
	<p class="help">
		Click the field, then arrow keys / WASD move {snap?.driver === 'controller'
			? 'the character (its controller)'
			: 'the dummy player'}. Drag the player, the character or a wall. Press on empty space to give
		a pointer controller its pointer. A drawn path stands in for every path a state names (and for
		<code>{SANDBOX_PATH}</code>).
	</p>
	{#if snap}
		<dl class="readout">
			<dt>Brain state</dt>
			<dd>{snap.state ?? '— (no brain)'}</dd>
			<dt>Driven by</dt>
			<dd>{snap.driver}</dd>
			<dt>Speed</dt>
			<dd>{snap.speed.toFixed(1)} px/s</dd>
			<dt>Facing</dt>
			<dd>{snap.facing === 1 ? 'right' : 'left'}</dd>
			<dt>Shots hit the player</dt>
			<dd>{snap.hits}</dd>
			<dt>Step</dt>
			<dd>{snap.steps}</dd>
			{#each Object.entries(snap.animInputs) as [input, value] (input)}
				<dt>input <code>{input}</code></dt>
				<dd>{typeof value === 'number' ? value.toFixed(2) : String(value)}</dd>
			{/each}
		</dl>
	{/if}
</div>

<style>
	.sandbox {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		font-size: 12px;
	}
	.bar .spacer {
		flex: 1;
	}
	.bar button.on {
		border-color: #5db0ff;
		color: #5db0ff;
	}
	.seed input {
		width: 70px;
	}
	canvas {
		width: 100%;
		max-width: 640px;
		border: 1px solid #2a2f38;
		border-radius: 8px;
		outline: none;
		touch-action: none;
		cursor: crosshair;
	}
	canvas:focus {
		border-color: #5db0ff;
	}
	.help {
		margin: 0;
		font-size: 12px;
		color: #8b93a1;
	}
	.readout {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 2px 12px;
		margin: 0;
		font-size: 12px;
	}
	.readout dt {
		color: #8b93a1;
	}
	.readout dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
	}
</style>
