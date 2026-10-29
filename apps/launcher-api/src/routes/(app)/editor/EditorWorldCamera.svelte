<script lang="ts">
	import {
		SCENE_PROJECTIONS,
		hasWorldCamera,
		sceneProjection,
		sceneWorld,
		type Scene,
		type SceneCamera,
		type SceneProjection,
	} from 'engine-layout';
	import {
		cameraFields,
		seedWorld,
		setSceneCamera,
		setSceneProjection,
		setSceneWorldOn,
		setSceneWorldSize,
	} from '$lib/editor/worldCameraEdit';

	/**
	 * A `game` screen's WORLD and CAMERA (game-families §4.4, P10.12): a play field bigger than the
	 * design box, framed by a camera the arcade loop steps. The stage draws the world's bounds and
	 * the camera's first frame; the editor runs no game, so nothing here previews the camera moving.
	 */
	type Props = {
		scene: Scene;
		/** The active layout's design box — what a new world is seeded from and what the camera frames. */
		main: { width: number; height: number };
		onChange: () => void;
	};
	const { scene, main, onChange }: Props = $props();

	// What the game reads: a world or a camera (a hand-written camera-only screen counts too).
	const hasWorld = $derived(hasWorldCamera(scene));
	const world = $derived(sceneWorld(scene));
	const cam = $derived(cameraFields(scene));

	const num = (v: number): number => (Number.isFinite(v) ? v : 0);

	function setWorldOn(on: boolean): void {
		setSceneWorldOn(scene, on, main);
		onChange();
	}

	function setSize(side: 'w' | 'h', v: number): void {
		if (setSceneWorldSize(scene, side, v)) onChange();
	}

	const PROJECTION_LABEL: Record<'flat' | SceneProjection, string> = {
		flat: 'flat (top-down / side)',
		isometric: 'isometric (2:1 diamonds)',
	};

	function setProjection(projection: 'flat' | SceneProjection): void {
		if (setSceneProjection(scene, projection)) onChange();
	}

	function setCamera(patch: Partial<SceneCamera>): void {
		setSceneCamera(scene, patch);
		onChange();
	}
</script>

<div class="world-camera">
	<label
		class="check"
		title="Give this play field a WORLD bigger than the screen: the camera shows the part of it the game frames, and scrolls as the player moves (or on its own). The dashed orange box on the stage is the world; the blue box is the camera's first frame — the design box at the world's top-left."
	>
		<input
			type="checkbox"
			checked={hasWorld}
			onchange={(e) => setWorldOn(e.currentTarget.checked)}
		/>
		<span>World and camera</span>
		<span class="note">
			{hasWorld
				? 'the screen frames part of a larger world'
				: `off — tick to start a ${seedWorld(main).w} × ${seedWorld(main).h} world`}
		</span>
	</label>

	{#if hasWorld}
		{#if world}
			<div class="row">
				<label class="field">
					<span>world width</span>
					<input
						type="number"
						step="10"
						min="1"
						value={world.w}
						oninput={(e) => setSize('w', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>world height</span>
					<input
						type="number"
						step="10"
						min="1"
						value={world.h}
						oninput={(e) => setSize('h', e.currentTarget.valueAsNumber)}
					/>
				</label>
			</div>
		{/if}

		<div class="row">
			<label
				class="field wide"
				title="The tag of the body the camera follows (the first body carrying it). Empty = the camera stays where Flow puts it."
			>
				<span>follow tag</span>
				<input
					type="text"
					value={cam.follow}
					placeholder="player"
					onchange={(e) => setCamera({ follow: e.currentTarget.value })}
				/>
			</label>
		</div>
		<div class="row">
			<label
				class="field"
				title="A box centred on the view the followed body moves in without moving the camera, px."
			>
				<span>dead zone w</span>
				<input
					type="number"
					step="10"
					min="0"
					value={cam.deadZone.w}
					oninput={(e) =>
						setCamera({ deadZone: { ...cam.deadZone, w: num(e.currentTarget.valueAsNumber) } })}
				/>
			</label>
			<label class="field">
				<span>dead zone h</span>
				<input
					type="number"
					step="10"
					min="0"
					value={cam.deadZone.h}
					oninput={(e) =>
						setCamera({ deadZone: { ...cam.deadZone, h: num(e.currentTarget.valueAsNumber) } })}
				/>
			</label>
		</div>
		<div class="row">
			<label
				class="field"
				title="Seconds the camera takes to close most of the way to its aim. 0 = it snaps."
			>
				<span>smoothing s</span>
				<input
					type="number"
					step="0.05"
					min="0"
					value={cam.smoothing}
					oninput={(e) => setCamera({ smoothing: num(e.currentTarget.valueAsNumber) })}
				/>
			</label>
			<label
				class="field"
				title="Seconds of the followed body's velocity the camera leads it by. 0 = none."
			>
				<span>look-ahead s</span>
				<input
					type="number"
					step="0.05"
					min="0"
					value={cam.lookAhead}
					oninput={(e) => setCamera({ lookAhead: num(e.currentTarget.valueAsNumber) })}
				/>
			</label>
		</div>
		<div class="row">
			<label
				class="field"
				title="Scroll the camera on its own, px per second (a runner, a shooter). An axis that scrolls does not follow."
			>
				<span>auto-scroll x</span>
				<input
					type="number"
					step="10"
					value={cam.autoScroll.x}
					oninput={(e) =>
						setCamera({ autoScroll: { ...cam.autoScroll, x: num(e.currentTarget.valueAsNumber) } })}
				/>
			</label>
			<label class="field">
				<span>auto-scroll y</span>
				<input
					type="number"
					step="10"
					value={cam.autoScroll.y}
					oninput={(e) =>
						setCamera({ autoScroll: { ...cam.autoScroll, y: num(e.currentTarget.valueAsNumber) } })}
				/>
			</label>
		</div>
		<label
			class="check"
			title="Keep the view inside the world. Untick to let it show past the edges."
		>
			<input
				type="checkbox"
				checked={cam.clampToWorld}
				onchange={(e) => setCamera({ clampToWorld: e.currentTarget.checked })}
			/>
			<span>Clamp to world</span>
		</label>
		<label
			class="field"
			title="How the game draws this world. Isometric draws the ground 2:1 isometric (a rectangle becomes the diamond it covers), its tilemaps as 2:1 diamonds painted on a diamond grid, and the spawned characters upright, nearer ones in front. The game still moves everything on the flat world: only the drawing changes. The stage here draws the other nodes flat."
		>
			<span>projection</span>
			<select
				value={sceneProjection(scene) ?? 'flat'}
				onchange={(e) => setProjection(e.currentTarget.value as 'flat' | SceneProjection)}
			>
				{#each SCENE_PROJECTIONS as p (p)}
					<option value={p}>{PROJECTION_LABEL[p]}</option>
				{/each}
			</select>
		</label>
	{/if}
</div>

<style>
	.world-camera {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 6px 0;
	}
	.check {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		font-size: 12px;
		color: #ccc;
		cursor: pointer;
	}
	.note {
		flex-basis: 100%;
		font-size: 11px;
		color: #777;
	}
	.row {
		display: flex;
		gap: 6px;
		align-items: flex-end;
	}
	.field {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.field.wide {
		flex: 1 1 100%;
	}
	.field span {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #777;
	}
	.field input,
	.field select {
		background: #0b0b10;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		padding: 6px 8px;
		color: #e8e8ee;
		font-size: 12px;
		font-family: inherit;
		width: 100%;
		box-sizing: border-box;
	}
	.field input:focus,
	.field select:focus {
		outline: none;
		border-color: #6b5bff;
	}
</style>
