<script lang="ts">
	import {
		LAYER_BAND_BACKGROUND,
		LAYER_BAND_BACKGROUND_CODED,
		sceneLayerZIndex,
	} from 'engine-layout';
	import { deviceClass, deviceScreenPixelRatio, getContextApp } from 'pixi-svelte';

	import { getAllContexts, mount, unmount } from 'svelte';

	import ArcadeStage, { type Props } from './ArcadeStage.svelte';
	import Graphics3dPanel, { type Graphics3dPanelProps } from './Graphics3dPanel.svelte';
	import { bakedBundleData, bakedGameConfig } from '../editor-scenes';
	import { registerDeterminismArcade } from '../game/determinism';
	import { registerBoardEffects } from '../game/flowBoardEffects';
	import { gameMechanic } from '../game/mechanic';
	import { online3dSession, sessionView3d } from '../game/online3d';
	import { showUnplayable3d } from '../game/unplayable3d';
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
	 * canvas's pixel-ratio cap. From there the 3D canvas adapts on its own (`engine-3d`
	 * `createQuality3d`, the 2D controller's rules on a 3D ladder): its pixel ratio drops first,
	 * then its shadows, while the HUD keeps its own resolution. `?render3d=low|medium|high` pins the
	 * caps of `quarter` / `half` / `full` and stops it adapting; `?perf=1` exposes a readout as
	 * `window.__IE_3D_QUALITY__()`.
	 */

	const props: Props = $props();
	const app = getContextApp();
	// The Graphics panel is mounted on demand outside this tree; it reads the game's contexts (the
	// popup's event emitter) like any component inside it.
	const contexts = getAllContexts();
	const room3d = online3dSession();
	// An online game in the 2D room: the stock stage plays it.
	const room2d = gameMechanic().room && !room3d;

	/**
	 * The stage layers that would paint over the world, by their `zIndex` among the Pixi stage's
	 * children (where `Game.svelte` mounts every screen): the coded `<Background>` band and every
	 * authored `space: 'background'` screen — at its band on the coded path, at its screen-list slot
	 * under a flow (`sceneLayerZIndex`, as the flow mounts it). The Pixi canvas sits ABOVE the world,
	 * so a full-bleed background there would cover all of it; the 3D build does not draw them.
	 */
	const backdropLayers = (scenes: Props['scenes']): ReadonlySet<number> =>
		new Set([
			LAYER_BAND_BACKGROUND,
			LAYER_BAND_BACKGROUND_CODED,
			...scenes
				.filter((scene) => scene.space === 'background')
				.map((scene) => sceneLayerZIndex([...scenes], scene.id))
				.filter((z) => z !== undefined),
		]);

	/** Why this device cannot play the 3D field, said on its own screen (`showUnplayable3d`)
	 *  rather than leaving the HUD over an empty page. */
	class Unplayable3d extends Error {}

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
	 *  interpolated; the level is the room's own `arcade.world3d`. The room view belongs to the
	 *  session (`sessionView3d`), so a remounted stage keeps its input `seq`, predictor and home. */
	const online = (three: Engine3d, session: NonNullable<typeof room3d>): Field3d => {
		let world;
		try {
			world = three.world3dOf(session.world3d);
		} catch (error) {
			console.error('[engine-3d] the room plays an arcade.world3d this device cannot read', error);
		}
		if (!world) throw new Unplayable3d('this device cannot read the level the room plays');
		const { room } = session;
		const level = world;
		const view = sessionView3d(session, () =>
			three.createRoomView3d({
				meId: room.sessionId,
				world: level,
				tickHz: session.tickHz,
				patchHz: session.patchHz,
				send: (input) => {
					const handle = room.input();
					Object.assign(handle.data, input);
					handle.send();
				},
			}),
		);
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
			// The view and its state listener live with the room (`game/online3d.ts`).
			release: () => {},
		};
	};

	$effect(() => {
		const pixi = app.stateApp.pixiApplication;
		const canvas = world3dCanvas();
		if (room2d || !pixi || !canvas) return;
		const background = pixi.renderer.background;
		const alpha = background.alpha;
		background.alpha = 0;

		let gone = false;
		// What the mount takes, given back in reverse: each piece is pushed as it is taken, so a
		// throw part-way through still frees what came before it (the WebGL context above all).
		const undo: (() => void)[] = [];
		const release = () => {
			for (let step = undo.pop(); step; step = undo.pop()) step();
		};
		const listen = <E extends Event>(
			target: EventTarget,
			type: string,
			handler: (event: E) => void,
		) => {
			const listener = handler as EventListener;
			target.addEventListener(type, listener);
			undo.push(() => target.removeEventListener(type, listener));
		};
		import('engine-3d')
			.then((three) => {
				if (gone) return;
				// three.js draws with WebGL 2 only (WebGL 1 is gone since r163): say so, not a blank page.
				const gpu = three.readGpu3d();
				if (!gpu.maxTextureSize)
					throw new Unplayable3d('this browser or device does not offer WebGL 2, which it needs');
				const scene = props.scenes.find((s) => s.camera);
				const rig = three.resolveRig3d((scene?.camera as { rig3d?: unknown } | undefined)?.rig3d);
				// Online, the room view and its state listener live with the room (`game/online3d.ts`);
				// a failure below gives the seat back, and leaving detaches them.
				const field = room3d ? online(three, room3d) : offline(three);
				undo.push(() => field.release());
				const follow = three.createFollow3d(rig);
				const models = (bakedBundleData() as { models?: unknown } | undefined)?.models;
				const hasModels = ((models as { models?: unknown[] } | undefined)?.models?.length ?? 0) > 0;
				const tierInput = {
					pin: typeof __IE_MODEL_TIER__ === 'string' ? __IE_MODEL_TIER__ : null,
					forced: new URLSearchParams(window.location.search).get('tier'),
					deviceClass: deviceClass().class,
					gpu,
					// The tiers this build has model copies of (the bundle's models index): a tier the
					// export did not write is never chosen and loaded as the `full` files by accident.
					published: three.publishedTiersOf(models),
				};
				let choice = three.chooseTier3d({ ...tierInput, setting: three.readGraphicsSetting() });
				const pin = three.render3dPin(window.location.search);
				let caps = pin ?? three.CAPS_3D[choice.tier];
				console.info(
					`[engine-3d] tier ${choice.tier} (${choice.why})${pin ? ', caps pinned by ?render3d=' : ''}`,
				);
				const world = three.mountWorld3d({ canvas, caps });
				undo.push(() => world.destroy());
				// The antialiasing the canvas was made with: a context attribute, fixed until a reload.
				const mountedAntialias = caps.antialias;
				let quality = three.createQuality3d(caps, { pinned: !!pin });

				// The Graphics panel (T4): `openGraphics` from the 3D layout's HUD. A pick applies the
				// new tier's caps at once; what a reload must apply (MSAA, model files) says so.
				let panel: ReturnType<typeof mount> | undefined;
				let note: string | undefined;
				const panelProps = (): Graphics3dPanelProps => ({
					options: choice.offered.map((value) => ({
						value,
						label: three.GRAPHICS_SETTING_LABELS[value],
					})),
					current: three.graphicsSettingOf(three.readGraphicsSetting()) ?? 'auto',
					loads: `Now: ${choice.tier}${pin ? ' (caps pinned by ?render3d=)' : ''}`,
					note,
					onpick: pick,
					onclose: closePanel,
				});
				const closePanel = () => {
					if (panel) void unmount(panel);
					panel = undefined;
				};
				const openPanel = () => {
					closePanel();
					panel = mount(Graphics3dPanel, {
						target: document.body,
						props: panelProps(),
						context: contexts,
					});
				};
				function pick(value: string) {
					const setting = three.graphicsSettingOf(value);
					if (!setting) return;
					three.writeGraphicsSetting(setting);
					const before = choice.tier;
					choice = three.chooseTier3d({ ...tierInput, setting });
					if (!pin) {
						caps = three.CAPS_3D[choice.tier];
						quality = three.createQuality3d(caps);
						world.setShadows(caps.shadows, caps.shadowMapSize);
						world.setPixelRatio(pixelRatio());
					}
					// MSAA is fixed with the canvas; model files are chosen once, at load.
					const later =
						caps.antialias !== mountedAntialias || (hasModels && choice.tier !== before);
					note = later ? 'Some of this applies the next time the game loads.' : undefined;
					console.info(`[engine-3d] graphics ${setting}: tier ${choice.tier} (${choice.why})`);
					openPanel();
				}
				registerBoardEffects({ openGraphics: openPanel });
				undo.push(() => {
					registerBoardEffects({});
					closePanel();
				});
				if (new URLSearchParams(window.location.search).get('perf') === '1') {
					window.__IE_3D_QUALITY__ = () => ({ tier: choice, ...quality.snapshot() });
					window.__IE_3D_GRAPHICS__ = openPanel;
					undo.push(() => {
						window.__IE_3D_QUALITY__ = window.__IE_3D_GRAPHICS__ = undefined;
					});
				}
				world.setLevel(field.colliders);
				const keys = three.listenKeys3d(window);
				undo.push(() => keys.release());
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
				undo.push(unregisterProbe);

				let aim: { x: number; y: number; z: number } | undefined;
				const backdrops = backdropLayers(props.scenes);
				const pixelRatio = () =>
					Math.min(deviceScreenPixelRatio(), caps.maxPixelRatio) * quality.level.resolution;
				const fit = () => {
					world.setPixelRatio(pixelRatio());
					world.resize(window.innerWidth, window.innerHeight);
				};
				fit();

				let target: { x: number; y: number; z: number } | undefined;
				const tick = () => {
					if (document.visibilityState !== 'visible') return;
					// A flow shows and hides screens at any time, so every frame.
					for (const layer of pixi.stage.children)
						if (backdrops.has(layer.zIndex)) layer.renderable = false;
					const stepped = quality.frame(pixi.ticker.elapsedMS, true);
					if (stepped) {
						world.setShadows(stepped.shadows, stepped.shadowMapSize);
						console.info(`[engine-3d] quality: ${stepped.step}`);
					}
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
					quality.visibilityChanged();
					if (document.visibilityState === 'visible') field.resync();
				};

				pixi.ticker.add(tick);
				undo.push(() => {
					pixi.ticker.remove(tick);
					for (const layer of pixi.stage.children)
						if (backdrops.has(layer.zIndex)) layer.renderable = true;
				});
				listen(window, 'resize', fit);
				listen(pixi.canvas, 'pointerdown', forward);
				listen(pixi.canvas, 'pointermove', forward);
				listen(pixi.canvas, 'pointerleave', leave);
				listen(document, 'visibilitychange', visibility);
			})
			.catch((error: unknown) => {
				if (gone) return;
				// The world never came up (no WebGL 2, the 3D chunk did not load, a level this device
				// cannot read): put the page back as it was and say why, over the HUD.
				release();
				background.alpha = alpha;
				showUnplayable3d(
					error instanceof Unplayable3d
						? error.message
						: `its 3D view could not start in this browser (${String(error)})`,
				);
				// A seat this device cannot play is given back.
				room3d?.room.leave().catch(() => {});
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
