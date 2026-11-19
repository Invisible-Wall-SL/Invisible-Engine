<script lang="ts">
	import {
		LAYER_BAND_BACKGROUND,
		LAYER_BAND_BACKGROUND_CODED,
		LAYER_BAND_INPUT_MASK,
		LAYER_BAND_TAKEOVER,
		sceneLayerZIndex,
	} from 'engine-layout';
	import { deviceClass, deviceScreenPixelRatio, getContextApp } from 'pixi-svelte';

	import { getAllContexts, mount, unmount } from 'svelte';

	import type { ModelExportIndex } from 'constants-shared/models';

	import ArcadeStage, { type Props } from './ArcadeStage.svelte';
	import Graphics3dPanel, { type Graphics3dPanelProps } from './Graphics3dPanel.svelte';
	import { bakedBundleData, bakedGameConfig } from '../editor-scenes';
	import {
		attachCamera3dFlow,
		registerCamera3dFlow,
		type Camera3dFlowHost,
	} from '../game/camera3dFlow';
	import { gameAssetsBase } from '../game/assets';
	import { registerDeterminismArcade } from '../game/determinism';
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
	 * The camera is `engine-3d`'s director (Phase 2, animation evaluation §4): the rigs of the
	 * config's `arcade.world3d.camera` block (or the defaults, `follow` being the screen's
	 * `camera.rig3d` view), switched and shaken by Flow (`game/camera3dFlow.ts`), pulled in against
	 * the level's colliders, and authored moves played from a camera-moves GLB. It is local: only
	 * the aim leaves the device. The keys map through the heading on screen, so "forward" stays
	 * "into the screen" whichever rig shows it. A drag on empty HUD looks (orbit, shoulder, first
	 * person), the wheel zooms the orbit, the right button aims the shoulder.
	 *
	 * The tier is chosen once, at mount (`engine-3d` `chooseTier3d`: the build's pin, `?tier=`, the
	 * player's Graphics setting, then the device), and its caps decide MSAA, the shadows and the 3D
	 * canvas's pixel-ratio cap. From there the 3D canvas adapts on its own (`engine-3d`
	 * `createQuality3d`, the 2D controller's rules on a 3D ladder): its pixel ratio drops first,
	 * then its shadows, while the HUD keeps its own resolution. `?render3d=low|medium|high` pins the
	 * caps of `quarter` / `half` / `full` and stops it adapting; `?perf=1` exposes a readout as
	 * `window.__IE_3D_QUALITY__()`.
	 *
	 * Characters (Phase 2): a body whose character has a look (`arcade.world3d.looks`) is drawn as
	 * that model from the bundle's models index at the chosen tier, cloned per body, with its clip
	 * libraries on its own mixer (`engine-3d` `createCast3d`); the capsule stands in until it loads.
	 * `window.__IE_WORLD3D__` reports them to the playtests.
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

	/** The touch controls' layer: over every screen of the list, under the pinned band. */
	const TOUCH_CONTROLS_Z = LAYER_BAND_TAKEOVER - 100;

	/** Why this device cannot play the 3D field, said on its own screen (`showUnplayable3d`)
	 *  rather than leaving the HUD over an empty page. */
	class Unplayable3d extends Error {}

	type Engine3d = typeof import('engine-3d');
	type Aim = { x: number; y: number; z: number } | undefined;

	/** What the world draws, offline or in a room. */
	type Field3d = {
		colliders: readonly import('engine-3d').LevelSpec3d['colliders'][number][];
		/** One frame: the keys (camera-relative, through the heading on screen `rigYaw`, degrees),
		 *  then the facing: the camera's (`face`, uint16) while the rig aims, else the aimed point. */
		advance(
			dtMs: number,
			stick: import('engine-3d').Stick3d,
			rigYaw: number,
			aim: Aim,
			face: number | undefined,
			pitch: number,
		): void;
		/** The own player's deaths so far and where the last one happened (offline: a fall past the
		 *  death plane; online: none until the room says a player died, Phase 3). */
		deaths(): { count: number; at: { x: number; y: number; z: number } | undefined };
		/** The own player stands on something (offline; online the room does not say). */
		grounded(): boolean | undefined;
		/** The raw `arcade.world3d` block: its `camera` is the director's. */
		world3d: unknown;
		bodies(): readonly import('engine-3d').BodyView3d[];
		steps(): number;
		/** The tab is shown again: drop the time it was hidden. */
		resync(): void;
		release(): void;
		/** A body's top speed (m/s): what 1 is on its animation's local move axes. */
		topSpeed(body: import('engine-3d').BodyView3d): number;
		/** The room's one-shots, for the characters (online only). */
		onEvents?(
			listener: (events: readonly { type: string; id?: string; target?: unknown }[]) => void,
		): () => void;
	};

	/** The offline field: one `motion3d` player on the config's `arcade.world3d` level, or the
	 *  placeholder arena without one. */
	const offline = (three: Engine3d): Field3d => {
		let field = three.playField3d(undefined);
		const raw = bakedGameConfig() as { arcade?: { world3d?: unknown } } | undefined;
		try {
			// A generated level offline: the seed `?level_seed=` names, else 1.
			const seed = Number(new URLSearchParams(window.location.search).get('level_seed') ?? 1);
			field = three.playField3d(raw?.arcade?.world3d, Number.isFinite(seed) ? seed : 1);
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
			world3d: field.source === 'config' ? raw?.arcade?.world3d : undefined,
			advance(dtMs, stick, rigYaw, aim, face) {
				const body = play.player;
				const move = three.moveAxes(stick.right, stick.forward, rigYaw);
				const yaw =
					face ??
					(aim
						? three.yawToward(aim.x - body.x, aim.z - body.z)
						: move.mx || move.mz
							? three.yawToward(move.mx, move.mz)
							: body.yaw);
				play.advance(dtMs, { ...move, yaw, buttons: stick.buttons });
			},
			bodies: () => play.bodies(),
			steps: () => play.steps,
			deaths: () => ({ count: play.falls, at: play.fellAt }),
			grounded: () => play.player.grounded,
			resync: () => play.resync(),
			release: () => {},
			topSpeed: () => field.motion.speed * field.motion.sprint,
		};
	};

	/** The 3D room: an input each of its fixed steps, the own player predicted, the rest
	 *  interpolated; the level is the room's own `arcade.world3d`, made from its seed when it
	 *  names a generator. The room view belongs to the session (`sessionView3d`), so a remounted
	 *  stage keeps its input `seq`, predictor and home. */
	const online = (three: Engine3d, session: NonNullable<typeof room3d>): Field3d => {
		let world;
		try {
			const authored = three.world3dOf(session.world3d);
			world = authored && three.generatedWorld3d(authored, session.seed ?? 0).world;
		} catch (error) {
			const why = error instanceof Error ? error.message : String(error);
			throw new Unplayable3d(`this device cannot read the game's 3D world (${why})`);
		}
		if (!world) throw new Unplayable3d('the room plays no 3D world');
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
				fallRespawns: !session.crash,
			}),
		);
		return {
			colliders: world.level.colliders,
			world3d: session.world3d,
			advance(dtMs, stick, rigYaw, aim, face, pitch) {
				const me = view.me?.body;
				const toward = aim && me ? three.yawToward(aim.x - me.x, aim.z - me.z) : undefined;
				view.frame(dtMs, performance.now(), stick, rigYaw, face ?? toward, pitch);
			},
			bodies: () => view.bodies(),
			steps: () => view.seq,
			deaths: () => ({ count: 0, at: undefined }),
			grounded: () => undefined,
			// The room went on while the tab was hidden; the next states bring the device up to it.
			resync: () => {},
			topSpeed: (body) => {
				const spec = three.motionFor3d(level, body.character ?? '');
				return spec.speed * spec.sprint;
			},
			onEvents: session.onEvents,
			// The view and its state listener live with the room (`game/online3d.ts`).
			release: () => {},
		};
	};

	/** The shake's stream is `<seed>:camera` (`engine-3d` `createShake3d`): the arcade seed when the
	 *  URL pins one (`?arseed=`), else a fresh one (seeded under `?ie_determinism=`). */
	const cameraSeed = () =>
		new URLSearchParams(window.location.search).get('arseed') ||
		String(Math.floor(Math.random() * 2 ** 32));

	/** The camera director for a field, the Flow's handle on it, and its moves (loaded in the
	 *  background: a move asked for before they land waits for them). */
	const cameraOf = (three: Engine3d, rig: import('engine-3d').Rig3d, field: Field3d) => {
		let config = three.camera3dOf(undefined, rig);
		try {
			config = three.camera3dOf((field.world3d as { camera?: unknown } | undefined)?.camera, rig);
		} catch (error) {
			console.error(
				'[engine-3d] arcade.world3d.camera is not usable; the default rigs show',
				error,
			);
		}
		const director = three.createCameraDirector3d({
			rigs: config.rigs,
			active: config.active,
			follow: 'player',
			seed: cameraSeed(),
			colliders: field.colliders,
			shake: config.shake,
			blend: config.blend,
			lens: config.lens,
		});
		const url = config.moves
			? new URL(config.moves, document.baseURI).href
			: three.SAMPLE_CAMERA_MOVES_URL;
		const moves = three.loadCameraMoves3d(url).catch((error) => {
			console.error(`[engine-3d] the camera moves at ${url} did not load`, error);
			return new Map<string, import('engine-3d').CameraMove3d>();
		});
		const playMove = async (clip: string, opts: import('engine-3d').PlayMove3d): Promise<void> => {
			const move = (await moves).get(clip);
			if (!move) {
				console.warn(`[engine-3d] no camera move "${clip}" in ${url}`);
				return;
			}
			await director.playMove(move, opts);
		};
		if (config.intro) {
			const { move, ...opts } = config.intro;
			void playMove(move, opts);
		}
		const flow: Camera3dFlowHost = {
			activate: (id, blendMs, ease) => {
				const known = (three.CAMERA_EASES as readonly string[]).includes(ease ?? '');
				const blend = {
					blendMs,
					...(known ? { ease: ease as import('engine-3d').CameraEase3d } : {}),
				};
				if (!director.activate(id, blend)) console.warn(`[engine-3d] no camera rig "${id}"`);
			},
			shake: (strength, durationMs) => director.shake(strength, durationMs),
			follow: (target) => director.follow(target || 'player'),
			playMove: (clip, blendInMs, blendOutMs, relative) =>
				playMove(clip, {
					...(blendInMs !== undefined ? { blendInMs } : {}),
					...(blendOutMs !== undefined ? { blendOutMs } : {}),
					...(relative ? { space: 'target' as const } : {}),
				}),
			yaw: () => director.view?.yaw ?? 0,
			pitch: () => director.view?.pitch ?? 0,
		};
		return { director, flow, death: config.death };
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
			options?: AddEventListenerOptions,
		) => {
			const listener = handler as EventListener;
			target.addEventListener(type, listener, options);
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
				// The camera's words stay backed beside it (`game/camera3dFlow.ts`).
				registerCamera3dFlow({ openGraphics: openPanel });
				undo.push(() => {
					registerCamera3dFlow();
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
				const bundle = bakedBundleData() as
					{ models?: ModelExportIndex; assetBase?: string } | undefined;
				const raw = bakedGameConfig() as
					{ arcade?: { world3d?: { looks?: unknown; anim?: unknown } } } | undefined;
				const { looks, problems } = three.looksOf3d(raw?.arcade?.world3d?.looks);
				const anims = three.animDocsOf3d(raw?.arcade?.world3d?.anim);
				for (const problem of [...problems, ...anims.problems])
					console.error(`[engine-3d] ${problem}`);
				for (const doc of Object.values(anims.docs))
					for (const issue of three.validateCharacterAnim3d(doc))
						if (issue.level === 'error')
							console.error(`[engine-3d] ${doc.id}.${issue.path}: ${issue.message}`);
				const characters = bundle?.models?.models.length
					? three.createCharacterModels3d({
							renderer: world.renderer,
							index: bundle.models,
							tier: choice.tier,
							base: bundle.assetBase ?? gameAssetsBase(),
							caps,
							fovDeg: rig.fov,
						})
					: undefined;
				const cast = characters
					? three.createCast3d({
							models: characters,
							looks,
							anims: anims.docs,
							topSpeed: field.topSpeed,
						})
					: undefined;
				world.setLooks(cast);
				world.setOverlay(
					cast ? (renderer, camera) => cast.drawOverlay(renderer, camera) : undefined,
				);
				let ownId: string | undefined;
				// Another player's attack, and a hit on anyone (Crash names the struck player its
				// `target`), arrive as the room's one-shots; the own attack was predicted on the press.
				const unlisten = field.onEvents?.((events) => {
					for (const event of events) {
						const trigger = three.ROOM_TRIGGERS3D[event.type];
						const id = typeof event.target === 'string' ? event.target : event.id;
						if (trigger && id && !(trigger === 'attack' && id === ownId))
							cast?.trigger(id, trigger);
					}
				});
				const probe = globalThis as { __IE_WORLD3D__?: unknown };
				probe.__IE_WORLD3D__ = {
					tier: choice.tier,
					characters: () =>
						[...(cast?.characters ?? [])].map(([id, c]) => ({
							id,
							model: c.root.name,
							lods: c.lodLevels(),
							clips: [...c.clips.keys()],
							sockets: ['hand_r', 'head_top'].filter((n) => !!c.socket(n)),
							drawn: c.root.layers.test(world.camera.layers),
							states: cast?.animators.get(id)?.states(),
							weights: cast?.animators.get(id)?.weights(),
						})),
					/** The first-person viewmodel, while one shows. */
					viewmodel: () => {
						const vm = cast?.viewmodel;
						return vm
							? { ready: vm.ready, states: vm.animator?.states(), weights: vm.animator?.weights() }
							: undefined;
					},
					/** Fire a trigger on a body's graph (the playtests' flinch, until combat raises `hit`). */
					trigger: (id: string, trigger: string) => cast?.trigger(id, trigger),
				};
				undo.push(() => {
					unlisten?.();
					cast?.dispose();
					characters?.dispose();
					delete probe.__IE_WORLD3D__;
				});
				const keys = three.listenKeys3d(window);
				undo.push(() => keys.release());
				// Touch play: a stick, look and buttons in the HUD, shown on a touch-first device or from
				// the first touch; under the pinned band, so a celebration still covers them, and hidden
				// while a press-to-continue overlay is up.
				const touchPoint = { x: 0, y: 0 };
				const touch = three.mountTouchControls3d({
					canvas: pixi.canvas,
					parent: pixi.stage,
					zIndex: TOUCH_CONTROLS_Z,
					toLocal(clientX, clientY) {
						pixi.renderer.events.mapPositionToPoint(touchPoint, clientX, clientY);
						return { x: touchPoint.x, y: touchPoint.y };
					},
					hudTakes(x, y) {
						const taken = pixi.renderer.events.rootBoundary.hitTest(x, y);
						return !!taken && taken !== pixi.stage;
					},
					size: () => ({ width: pixi.screen.width, height: pixi.screen.height }),
					shown: window.matchMedia('(pointer: coarse)').matches,
					blocked: () =>
						pixi.stage.children.some(
							(layer) => layer.zIndex === LAYER_BAND_INPUT_MASK && layer.children.length > 0,
						),
				});
				undo.push(() => touch.release());
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
							grounded: b.grounded,
							tags: b.kind === 'hero' ? ['player'] : [],
							...(b.kind === 'hero' && field.grounded() !== undefined
								? { grounded: field.grounded() }
								: {}),
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

				const camera = cameraOf(three, rig, field);
				const { director } = camera;
				let view: import('engine-3d').CameraView3d | undefined;
				let bodies: readonly import('engine-3d').BodyView3d[] = field.bodies();
				/** A followed body: `player` is the own player (online its id is the session's). */
				const bodyOf = (id: string) =>
					id === 'player' ? bodies.find((b) => b.kind === 'hero') : bodies.find((b) => b.id === id);
				// The followed body as the camera reads it: grounded (no bob in the air) where known.
				const targetOf = (id: string) => {
					if (id === 'corpse') return corpse && { ...corpse, vx: 0, vz: 0, yaw: 0 };
					const body = bodyOf(id);
					const grounded = body?.kind === 'hero' ? field.grounded() : undefined;
					return body && grounded !== undefined ? { ...body, grounded } : body;
				};
				const look = { x: 0, y: 0, zoom: 0, aiming: false };
				let clockMs = 0;
				let deaths = field.deaths().count;
				/** Where the own player last died: the ghost looks there (the body id `corpse`). */
				let corpse: { x: number; y: number; z: number } | undefined;
				let respawnAt: number | undefined;
				let attackHeld = false;
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
					const dt = pixi.ticker.deltaMS;
					const fingers = touch.read();
					look.x += fingers.lookX;
					look.y += fingers.lookY;
					const face = view?.aims ? three.yawUnitsOf(view.yaw) : undefined;
					const stick = three.mergeSticks3d(keys.read(), fingers);
					field.advance(
						dt,
						stick,
						view?.yaw ?? rig.yaw,
						view?.aims ? undefined : aim,
						face,
						view?.aims ? view.pitch : 0,
					);
					bodies = field.bodies();
					const own = bodies.find((b) => b.kind === 'hero');
					ownId = own?.id;
					const attack = (stick.buttons & three.BUTTONS3D.attack) !== 0;
					if (attack && !attackHeld && own) cast?.trigger(own.id, 'attack');
					attackHeld = attack;
					clockMs += dt;
					const died = field.deaths();
					if (died.count !== deaths) {
						deaths = died.count;
						if (camera.death && died.at) {
							corpse = died.at;
							director.activate(camera.death.rig, { ease: 'cut' });
							respawnAt = clockMs + camera.death.ms;
						}
					}
					if (respawnAt !== undefined && clockMs >= respawnAt && camera.death) {
						director.deactivate(camera.death.rig, { blendMs: camera.death.blendBackMs });
						respawnAt = undefined;
					}
					view = director.frame(
						dt,
						targetOf,
						{ lookX: look.x, lookY: look.y, zoom: look.zoom, aiming: look.aiming },
						window.innerWidth / Math.max(window.innerHeight, 1),
					);
					look.x = look.y = look.zoom = 0;
					const followed = bodyOf(director.followed ?? 'player');
					const eye = view.pose.position;
					// The camera inside the followed body (first person, a shoulder pressed to a wall)
					// would draw its inside: it is not drawn.
					const inside =
						!!followed &&
						Math.hypot(eye.x - followed.x, eye.z - followed.z) < followed.radius + 0.35 &&
						eye.y > followed.y - 0.1 &&
						eye.y < followed.y + followed.height + 0.2;
					// First person (the live rig, not blending): the own body is hidden and its viewmodel
					// drawn over the world.
					const live = director.rigs.find((r) => r.id === view?.live);
					const firstPerson =
						live?.kind === 'firstPerson' && !view.blending && inside && followed === own;
					cast?.setFirstPerson(firstPerson ? own?.id : undefined, own?.character);
					characters?.setFov(view.pose.fov);
					cast?.animate(bodies, dt, world.camera);
					world.sync(bodies, {
						pose: view.pose,
						focus: followed ?? eye,
						...(inside && followed ? { hide: followed.id } : {}),
					});
				};

				// A pointer the HUD does not take (no interactive Pixi object under it) aims in the world.
				const point = { x: 0, y: 0 };
				/** A press that began on the world (not the HUD): its drag looks. */
				let dragging = false;
				const forward = (event: PointerEvent) => {
					// A touch is the touch controls' (or the HUD's): it never aims or drags a look here.
					if (event.pointerType === 'touch' || touch.owns(event.pointerId)) return;
					if (event.type === 'pointermove' && dragging && event.buttons !== 0) {
						look.x += event.movementX;
						look.y += event.movementY;
					}
					pixi.renderer.events.mapPositionToPoint(point, event.clientX, event.clientY);
					const taken = pixi.renderer.events.rootBoundary.hitTest(point.x, point.y);
					if (taken && taken !== pixi.stage) return;
					if (event.type === 'pointerdown') {
						dragging = true;
						if (event.button === 2) look.aiming = true;
					}
					if (event.type === 'pointermove' && event.buttons === 0 && event.pointerType !== 'mouse')
						return;
					aim = world.pick(event.clientX, event.clientY);
					world.setAim(view?.aims ? undefined : aim);
				};
				const letGo = (event: PointerEvent) => {
					dragging = false;
					if (event.button === 2) look.aiming = false;
				};
				const wheel = (event: WheelEvent) => {
					look.zoom += Math.sign(event.deltaY);
				};
				const menu = (event: Event) => event.preventDefault();
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
				listen(window, 'pointerup', letGo);
				listen(pixi.canvas, 'wheel', wheel, { passive: true });
				listen(pixi.canvas, 'contextmenu', menu);
				listen(document, 'visibilitychange', visibility);
				undo.push(attachCamera3dFlow(camera.flow));
				// For the playtest and the console: the director, and what it showed last frame.
				const debug = window as { __IE_CAMERA3D__?: unknown };
				debug.__IE_CAMERA3D__ = { director, view: () => view };
				undo.push(() => {
					delete debug.__IE_CAMERA3D__;
				});
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
