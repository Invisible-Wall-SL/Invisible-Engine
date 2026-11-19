<script lang="ts">
	import { LAYER_BAND_BACKGROUND_CODED } from 'engine-layout';
	import { deviceClass, deviceScreenPixelRatio, getContextApp } from 'pixi-svelte';

	import ArcadeStage, { type Props } from './ArcadeStage.svelte';
	import type { ModelExportIndex } from 'constants-shared/models';

	import { bakedBundleData, bakedGameConfig } from '../editor-scenes';
	import { gameAssetsBase } from '../game/assets';
	import { attachCamera3dFlow, type Camera3dFlowHost } from '../game/camera3dFlow';
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
	 * canvas's pixel-ratio cap. That ratio may sit below the HUD's, and follows the 2D
	 * render-quality controller down: when `renderQuality.ts` lowers the Pixi resolution, the world
	 * drops by the same factor.
	 *
	 * Characters (Phase 2): a body whose character has a look (`arcade.world3d.looks`) is drawn as
	 * that model from the bundle's models index at the chosen tier, cloned per body, with its clip
	 * libraries on its own mixer (`engine-3d` `createCast3d`); the capsule stands in until it loads.
	 * `window.__IE_WORLD3D__` reports them to the playtests.
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
		onEvents?(listener: (events: readonly { type: string; id: string }[]) => void): () => void;
	};

	/** The offline field: one `motion3d` player on the config's `arcade.world3d` level, or the
	 *  placeholder arena without one. */
	const offline = (three: Engine3d): Field3d => {
		let field = three.playField3d(undefined);
		const raw = bakedGameConfig() as { arcade?: { world3d?: unknown } } | undefined;
		try {
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
				const spec = three.motionFor3d(world, body.character ?? '');
				return spec.speed * spec.sprint;
			},
			onEvents: session.onEvents,
			release: () => {
				live = false;
			},
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
		const startResolution = pixi.renderer.resolution;

		let gone = false;
		let release = () => {};
		import('engine-3d').then((three) => {
			if (gone) return;
			const scene = props.scenes.find((s) => s.camera);
			const rig = three.resolveRig3d((scene?.camera as { rig3d?: unknown } | undefined)?.rig3d);
			const field = room3d ? online(three, room3d) : offline(three);
			if (!field) return;
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
			const models = bundle?.models?.models.length
				? three.createCharacterModels3d({
						renderer: world.renderer,
						index: bundle.models,
						tier: choice.tier,
						base: bundle.assetBase ?? gameAssetsBase(),
						caps,
						fovDeg: rig.fov,
					})
				: undefined;
			const cast = models
				? three.createCast3d({ models, looks, anims: anims.docs, topSpeed: field.topSpeed })
				: undefined;
			world.setLooks(cast);
			world.setOverlay(cast ? (renderer, camera) => cast.drawOverlay(renderer, camera) : undefined);
			let ownId: string | undefined;
			// Another player's attack (and, with combat, a hit) arrives as the room's one-shot; the
			// own attack was predicted on the press.
			const unlisten = field.onEvents?.((events) => {
				for (const event of events) {
					const trigger = three.ROOM_TRIGGERS3D[event.type];
					if (trigger && !(trigger === 'attack' && event.id === ownId))
						cast?.trigger(event.id, trigger);
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
						states: cast?.animators.get(id)?.states(),
						weights: cast?.animators.get(id)?.weights(),
					})),
				/** Fire a trigger on a body's graph (the playtests' flinch, until combat raises `hit`). */
				trigger: (id: string, trigger: string) => cast?.trigger(id, trigger),
			};
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
						grounded: b.grounded,
						tags: b.kind === 'hero' ? ['player'] : [],
						...(b.kind === 'hero' && field.grounded() !== undefined
							? { grounded: field.grounded() }
							: {}),
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
				if (!hidden || hidden.destroyed) hidden = codedBackground(pixi.stage);
				if (hidden) hidden.renderable = false;
				world.setPixelRatio(pixelRatio());
				const dt = pixi.ticker.deltaMS;
				const face = view?.aims ? three.yawUnitsOf(view.yaw) : undefined;
				const stick = keys.read();
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
				view = director.frame(dt, targetOf, {
					lookX: look.x,
					lookY: look.y,
					zoom: look.zoom,
					aiming: look.aiming,
				});
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
				models?.setFov(view.pose.fov);
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
				if (document.visibilityState === 'visible') field.resync();
			};

			pixi.ticker.add(tick);
			window.addEventListener('resize', fit);
			pixi.canvas.addEventListener('pointerdown', forward);
			pixi.canvas.addEventListener('pointermove', forward);
			pixi.canvas.addEventListener('pointerleave', leave);
			window.addEventListener('pointerup', letGo);
			pixi.canvas.addEventListener('wheel', wheel, { passive: true });
			pixi.canvas.addEventListener('contextmenu', menu);
			document.addEventListener('visibilitychange', visibility);
			const detachFlow = attachCamera3dFlow(camera.flow);
			// For the playtest and the console: the director, and what it showed last frame.
			const debug = window as { __IE_CAMERA3D__?: unknown };
			debug.__IE_CAMERA3D__ = { director, view: () => view };
			release = () => {
				pixi.ticker.remove(tick);
				window.removeEventListener('resize', fit);
				pixi.canvas.removeEventListener('pointerdown', forward);
				pixi.canvas.removeEventListener('pointermove', forward);
				pixi.canvas.removeEventListener('pointerleave', leave);
				window.removeEventListener('pointerup', letGo);
				pixi.canvas.removeEventListener('wheel', wheel);
				pixi.canvas.removeEventListener('contextmenu', menu);
				document.removeEventListener('visibilitychange', visibility);
				detachFlow();
				delete debug.__IE_CAMERA3D__;
				keys.release();
				unregisterProbe();
				field.release();
				unlisten?.();
				cast?.dispose();
				models?.dispose();
				delete probe.__IE_WORLD3D__;
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
