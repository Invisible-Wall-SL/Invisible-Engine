<script lang="ts">
	import { LAYER_BAND_BACKGROUND_CODED } from 'engine-layout';
	import { deviceClass, deviceScreenPixelRatio, getContextApp } from 'pixi-svelte';

	import ArcadeStage, { type Props } from './ArcadeStage.svelte';
	import { bakedGameConfig } from '../editor-scenes';
	import { registerDeterminismArcade } from '../game/determinism';
	import { gameMechanic } from '../game/mechanic';
	import { world3dCanvas } from '../game/world3dCanvas';

	/**
	 * THE 3D PLAY FIELD (`docs/design/3d-games.md`), compiled only into the `arcade3d` runtime
	 * (`families/arcade3d.ts`). three.js draws the world in its own canvas under the Pixi canvas
	 * (reserved before Pixi's context exists, `game/world3dCanvas.ts`), so the HUD draws over the
	 * world and takes every pointer it hits; what it does not take is forwarded to the world's
	 * picking. `engine-3d` is imported dynamically: three.js is its own lazy chunk, fetched when the
	 * play field mounts.
	 *
	 * Offline, the field is `motion3d`'s: one player on the config's `arcade.world3d` level (the
	 * block the 3D room reads; the placeholder arena without one), moved by the keys (`engine-3d`
	 * `createPlay3d`), stepped by the game's ticker so a paused ticker or a hidden tab pauses it.
	 * Online, the stock arcade stage runs the room until the 3D room lands (runtime step 4).
	 *
	 * The tier is chosen once, at mount (`engine-3d` `chooseTier3d`: the build's pin, `?tier=`, the
	 * player's Graphics setting, then the device), and its caps decide MSAA, the shadows and the 3D
	 * canvas's pixel-ratio cap. That ratio may sit below the HUD's, and follows the 2D
	 * render-quality controller down: when `renderQuality.ts` lowers the Pixi resolution, the world
	 * drops by the same factor.
	 */

	const props: Props = $props();
	const app = getContextApp();
	const online = gameMechanic().room;

	/** The lowest share of the cap the 2D controller may push the world to. */
	const MIN_QUALITY_SCALE = 0.5;

	/** What the walk below reads of a Pixi container. */
	type Node = { zIndex: number; renderable: boolean; destroyed: boolean; children: Node[] };

	/** The container Game.svelte wraps the coded `<Background>` in, when it renders it. */
	const codedBackground = (root: Node): Node | undefined => {
		const queue: Node[] = [root];
		for (let depth = 0; depth < 4 && queue.length; depth++)
			for (const node of queue.splice(0)) {
				for (const child of node.children) {
					if (child.zIndex === LAYER_BAND_BACKGROUND_CODED) return child;
					queue.push(child);
				}
			}
		return undefined;
	};

	$effect(() => {
		const pixi = app.stateApp.pixiApplication;
		const canvas = world3dCanvas();
		if (online || !pixi || !canvas) return;
		const background = pixi.renderer.background;
		const alpha = background.alpha;
		background.alpha = 0;
		const startResolution = pixi.renderer.resolution;

		let gone = false;
		let release = () => {};
		import('engine-3d').then((three) => {
			if (gone) return;
			const scene = props.scenes.find((s) => s.camera);
			const rig = three.resolveRig3d((scene?.camera as { rig3d?: unknown } | undefined)?.rig3d);
			// The raw config's `arcade.world3d` (`game-config` drops it); none ⇒ the placeholder arena.
			let field = three.playField3d(undefined);
			try {
				const raw = bakedGameConfig() as { arcade?: { world3d?: unknown } } | undefined;
				field = three.playField3d(raw?.arcade?.world3d);
			} catch (error) {
				console.error(
					'[engine-3d] arcade.world3d is not playable; the placeholder arena shows',
					error,
				);
			}
			const arena = field.level;
			const level = three.createLevel3d(arena);
			const play = three.createPlay3d({ level, spawn: arena.spawn, spec: field.motion });
			const follow = three.createFollow3d(rig);
			const choice = three.chooseTier3d({
				pin: typeof __IE_MODEL_TIER__ === 'string' ? __IE_MODEL_TIER__ : null,
				forced: new URLSearchParams(window.location.search).get('tier'),
				setting: three.readGraphicsSetting(),
				deviceClass: deviceClass().class,
				gpu: three.readGpu3d(),
				// No model loads yet: every tier counts as published until the models index is
				// registered in the bundle (hard rule 8, session 1c's chain).
				published: three.MODEL_TIERS,
			});
			const caps = three.CAPS_3D[choice.tier];
			console.info(`[engine-3d] tier ${choice.tier} (${choice.why})`);
			const world = three.mountWorld3d({ canvas, caps });
			world.setLevel(arena.colliders);
			const keys = three.listenKeys3d(window);
			// The determinism probe reads the 3D field as it reads the 2D one: `y` is the height here.
			const unregisterProbe = registerDeterminismArcade({
				read: () => ({
					steps: play.steps,
					bodies: play.bodies().map((b) => ({
						id: b.id,
						x: b.x,
						y: b.y,
						z: b.z,
						vx: b.vx,
						vy: play.player.vy,
						tags: b.kind === 'hero' ? ['player'] : [],
						grounded: play.player.grounded,
					})),
				}),
			});

			let aim: { x: number; y: number; z: number } | undefined;
			let hidden: Node | undefined;
			// The renderQuality hook: the world's ratio scales with the HUD's current resolution.
			const pixelRatio = () =>
				Math.min(deviceScreenPixelRatio(), caps.maxPixelRatio) *
				Math.max(MIN_QUALITY_SCALE, pixi.renderer.resolution / startResolution);
			const fit = () => {
				world.setPixelRatio(pixelRatio());
				world.resize(window.innerWidth, window.innerHeight);
			};
			fit();

			const tick = () => {
				if (document.visibilityState !== 'visible') return;
				if (!hidden || hidden.destroyed) hidden = codedBackground(pixi.stage);
				if (hidden) hidden.renderable = false;
				world.setPixelRatio(pixelRatio());
				const stick = keys.read();
				const body = play.player;
				const move = three.moveAxes(stick.right, stick.forward, rig.yaw);
				const yaw = aim
					? three.yawToward(aim.x - body.x, aim.z - body.z)
					: move.mx || move.mz
						? three.yawToward(move.mx, move.mz)
						: body.yaw;
				play.advance(pixi.ticker.deltaMS, { ...move, yaw, buttons: stick.buttons });
				const bodies = play.bodies();
				const target = follow.step(pixi.ticker.deltaMS, bodies[0]);
				world.sync(bodies, { target, rig });
			};

			// A pointer the HUD does not take (no interactive Pixi object under it) aims in the world.
			const point = { x: 0, y: 0 };
			const forward = (event: PointerEvent) => {
				pixi.renderer.events.mapPositionToPoint(point, event.clientX, event.clientY);
				const taken = pixi.renderer.events.rootBoundary.hitTest(point.x, point.y);
				if (taken && taken !== pixi.stage) return;
				if (event.type === 'pointermove' && event.buttons === 0 && event.pointerType !== 'mouse')
					return;
				aim = world.pick(event.clientX, event.clientY);
				world.setAim(aim);
			};
			const leave = () => {
				aim = undefined;
				world.setAim(undefined);
			};
			const visibility = () => {
				if (document.visibilityState === 'visible') play.resync();
			};

			pixi.ticker.add(tick);
			window.addEventListener('resize', fit);
			pixi.canvas.addEventListener('pointerdown', forward);
			pixi.canvas.addEventListener('pointermove', forward);
			pixi.canvas.addEventListener('pointerleave', leave);
			document.addEventListener('visibilitychange', visibility);
			release = () => {
				pixi.ticker.remove(tick);
				window.removeEventListener('resize', fit);
				pixi.canvas.removeEventListener('pointerdown', forward);
				pixi.canvas.removeEventListener('pointermove', forward);
				pixi.canvas.removeEventListener('pointerleave', leave);
				document.removeEventListener('visibilitychange', visibility);
				keys.release();
				unregisterProbe();
				if (hidden && !hidden.destroyed) hidden.renderable = true;
				world.destroy();
			};
		});
		return () => {
			gone = true;
			release();
			background.alpha = alpha;
		};
	});
</script>

{#if online}
	<ArcadeStage {...props} />
{/if}
