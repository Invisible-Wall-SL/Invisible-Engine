<script lang="ts">
	import { LAYER_BAND_BACKGROUND_CODED } from 'engine-layout';
	import { deviceClass, deviceScreenPixelRatio, getContextApp } from 'pixi-svelte';

	import ArcadeStage, { type Props } from './ArcadeStage.svelte';
	import { bakedBundleData, bakedGameConfig } from '../editor-scenes';
	import { registerDeterminismArcade } from '../game/determinism';
	import { gameMechanic } from '../game/mechanic';
	import { online3dSession } from '../game/online3d';
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
	 * Online in a 3D room (`game/online3d.ts`), the same world draws the room: `engine-3d`
	 * `createRoomView3d` sends an input each of the room's fixed steps, predicts the own player and
	 * interpolates everyone else (runtime step 4). An online game in the 2D room keeps the stock
	 * arcade stage.
	 *
	 * The tier is chosen once, at mount (`engine-3d` `chooseTier3d`: the build's pin, `?tier=`, the
	 * player's Graphics setting, then the device), and its caps decide MSAA, the shadows and the 3D
	 * canvas's pixel-ratio cap. That ratio may sit below the HUD's, and follows the 2D
	 * render-quality controller down: when `renderQuality.ts` lowers the Pixi resolution, the world
	 * drops by the same factor.
	 */

	const props: Props = $props();
	const app = getContextApp();
	const room3d = online3dSession();
	// An online game in the 2D room: the stock stage plays it.
	const room2d = gameMechanic().room && !room3d;

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

	type Engine3d = typeof import('engine-3d');
	type Aim = { x: number; y: number; z: number } | undefined;

	/** What the world draws, offline or in a room. */
	type Field3d = {
		colliders: readonly import('engine-3d').LevelSpec3d['colliders'][number][];
		/** One frame: the keys (camera-relative) and the aimed point, if any. */
		advance(dtMs: number, stick: import('engine-3d').Stick3d, rigYaw: number, aim: Aim): void;
		bodies(): readonly import('engine-3d').BodyView3d[];
		steps(): number;
		/** The tab is shown again: drop the time it was hidden. */
		resync(): void;
		release(): void;
	};

	/** The offline field: one `motion3d` player on the config's `arcade.world3d` level, or the
	 *  placeholder arena without one. */
	const offline = (three: Engine3d): Field3d => {
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
		const play = three.createPlay3d({
			level: field.built,
			spawn: arena.spawn,
			spec: field.motion,
		});
		return {
			colliders: arena.colliders,
			advance(dtMs, stick, rigYaw, aim) {
				const body = play.player;
				const move = three.moveAxes(stick.right, stick.forward, rigYaw);
				const yaw = aim
					? three.yawToward(aim.x - body.x, aim.z - body.z)
					: move.mx || move.mz
						? three.yawToward(move.mx, move.mz)
						: body.yaw;
				play.advance(dtMs, { ...move, yaw, buttons: stick.buttons });
			},
			bodies: () => play.bodies(),
			steps: () => play.steps,
			resync: () => play.resync(),
			release: () => {},
		};
	};

	/** The 3D room: an input each of its fixed steps, the own player predicted, the rest
	 *  interpolated; the level is the room's own `arcade.world3d`. */
	const online = (three: Engine3d, session: NonNullable<typeof room3d>): Field3d | undefined => {
		let world;
		try {
			world = three.world3dOf(session.world3d);
		} catch (error) {
			console.error('[engine-3d] the room plays an arcade.world3d this device cannot read', error);
		}
		if (!world) return undefined;
		const { room } = session;
		const view = three.createRoomView3d({
			meId: room.sessionId,
			world,
			tickHz: session.tickHz,
			patchHz: session.patchHz,
			send: (input) => {
				const handle = room.input();
				Object.assign(handle.data, input);
				handle.send();
			},
		});
		let live = true;
		const received = (state: unknown) => {
			if (live) view.received(state as import('engine-3d').RoomState3d, performance.now());
		};
		room.onStateChange(received);
		received(room.state);
		return {
			colliders: world.level.colliders,
			advance(dtMs, stick, rigYaw, aim) {
				const me = view.me?.body;
				const face = aim && me ? three.yawToward(aim.x - me.x, aim.z - me.z) : undefined;
				view.frame(dtMs, performance.now(), stick, rigYaw, face);
			},
			bodies: () => view.bodies(),
			steps: () => view.seq,
			// The room went on while the tab was hidden; the next states bring the device up to it.
			resync: () => {},
			release: () => {
				live = false;
			},
		};
	};

	$effect(() => {
		const pixi = app.stateApp.pixiApplication;
		const canvas = world3dCanvas();
		if (room2d || !pixi || !canvas) return;
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
			const field = room3d ? online(three, room3d) : offline(three);
			if (!field) return;
			const follow = three.createFollow3d(rig);
			const choice = three.chooseTier3d({
				pin: typeof __IE_MODEL_TIER__ === 'string' ? __IE_MODEL_TIER__ : null,
				forced: new URLSearchParams(window.location.search).get('tier'),
				setting: three.readGraphicsSetting(),
				deviceClass: deviceClass().class,
				gpu: three.readGpu3d(),
				// The tiers this build has model copies of (the bundle's models index): a tier the
				// export did not write is never chosen and loaded as the `full` files by accident.
				published: three.publishedTiersOf(
					(bakedBundleData() as { models?: unknown } | undefined)?.models,
				),
			});
			const caps = three.CAPS_3D[choice.tier];
			console.info(`[engine-3d] tier ${choice.tier} (${choice.why})`);
			const world = three.mountWorld3d({ canvas, caps });
			world.setLevel(field.colliders);
			const keys = three.listenKeys3d(window);
			// The determinism probe reads the 3D field as it reads the 2D one: `y` is the height here.
			const unregisterProbe = registerDeterminismArcade({
				read: () => ({
					steps: field.steps(),
					bodies: field.bodies().map((b) => ({
						id: b.id,
						x: b.x,
						y: b.y,
						z: b.z,
						vx: b.vx,
						vy: 0,
						tags: b.kind === 'hero' ? ['player'] : [],
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

			let target: { x: number; y: number; z: number } | undefined;
			const tick = () => {
				if (document.visibilityState !== 'visible') return;
				if (!hidden || hidden.destroyed) hidden = codedBackground(pixi.stage);
				if (hidden) hidden.renderable = false;
				world.setPixelRatio(pixelRatio());
				field.advance(pixi.ticker.deltaMS, keys.read(), rig.yaw, aim);
				const bodies = field.bodies();
				const own = bodies.find((b) => b.kind === 'hero');
				if (own) target = follow.step(pixi.ticker.deltaMS, own);
				if (target) world.sync(bodies, { target, rig });
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
				if (document.visibilityState === 'visible') field.resync();
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
				field.release();
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

{#if room2d}
	<ArcadeStage {...props} />
{/if}
