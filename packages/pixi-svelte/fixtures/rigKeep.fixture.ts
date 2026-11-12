/**
 * Offline fixture for a rig kept between plays (`src/lib/rigKeep.ts`, `<RigProvider parked
 * restart>`), against real `RigView`s on the shipped rigs and a ticker of their own:
 *
 *   pnpm check:all --only rigKeep
 *
 * Pins, for the win frame (`anticipation`, `payframe`) and a symbol rig with an event
 * (`symbols3/W`), after a play of another animation, a stretch put away and a restart in place:
 *   - every frame of the next play is the frame a NEW view draws — the pose (each bone's world
 *     transform, each slot's attachment and colours, the draw order, the skeleton clock), the events
 *     it fires, and what it hands Pixi (each slot mesh in order, its geometry, texture, tint, alpha,
 *     blend mode, and which are shown);
 *   - put away, its update is off the ticker and it is hidden: ticks move nothing and fire nothing;
 *   - the first pose of the play measures as a new view's first pose does (what `<BaseRigProvider>`
 *     sizes, and pivots a rig with no authored box, by), a rig exported without a box included;
 *   - brought back for a new play, its update runs after every listener registered before it, as a
 *     new view's would; brought back within a play, it keeps its place.
 */
import { DOMAdapter, Ticker, TextureSource, type Container } from 'pixi.js';
import { AtlasAttachmentLoader, SkeletonJson, TextureAtlas, type SkeletonData } from 'engine-rig';
import { RigPageTexture, RigView } from 'engine-rig/pixi';

import { bringRigBack, putRigAway, restartRigPose } from '../src/lib/rigKeep.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

// A dark-tinted slot builds its shader, which asks a canvas for its float precision; Node has none.
DOMAdapter.set({
	...DOMAdapter.get(),
	createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement,
});

type Fs = { readFileSync(path: URL, encoding: 'utf8'): string };
// Imported by name at run time: this package's tsconfig carries no Node types.
void import('node:' + 'fs').then(({ readFileSync }: Fs) =>
	run((path) => readFileSync(new URL(path, import.meta.url), 'utf8')),
);

function run(read: (path: string) => string): void {
	const SPINES = '../../../apps/lines/static/assets/spines';
	const load = (dir: string, json: string, atlas: string): SkeletonData => {
		const pages = new TextureAtlas(read(`${SPINES}/${dir}/${atlas}`));
		for (const page of pages.pages) {
			const source = new TextureSource({ width: page.width || 1024, height: page.height || 1024 });
			page.setTexture(RigPageTexture.from(source));
		}
		const data = new SkeletonJson(new AtlasAttachmentLoader(pages)).readSkeletonData(
			JSON.parse(read(`${SPINES}/${dir}/${json}`)),
		);
		return data;
	};

	const FRAME = 1000 / 60;
	const round = (n: number) => Math.round(n * 1e4) / 1e4;

	/** What one frame draws, by slot rather than by object identity. */
	const snapshot = (rig: RigView, events: string[]): string => {
		rig.syncDisplay();
		const meshes = (rig as unknown as { slotMeshes: ({ mesh: Container } | undefined)[] })
			.slotMeshes;
		const sk = rig.skeleton;
		const drawn = rig.children.map((child) => {
			const slot = meshes.findIndex((entry) => entry?.mesh === child);
			if (slot < 0) return { other: child.constructor.name, visible: child.visible };
			const mesh = child as unknown as {
				visible: boolean;
				tint: number;
				alpha: number;
				blendMode: string;
				texture: { uid: number };
				geometry: { positions: Float32Array; uvs: Float32Array; indices: Uint32Array };
			};
			return {
				slot,
				visible: mesh.visible,
				tint: mesh.tint,
				alpha: round(mesh.alpha),
				blend: mesh.blendMode,
				texture: mesh.texture.uid,
				positions: Array.from(mesh.geometry.positions, round),
				uvs: Array.from(mesh.geometry.uvs, round),
				indices: Array.from(mesh.geometry.indices),
			};
		});
		return JSON.stringify({
			time: round(sk.time),
			bones: sk.bones.map((b) => [b.a, b.b, b.c, b.d, b.worldX, b.worldY].map(round)),
			slots: sk.slots.map((s) => [
				s.attachment?.name ?? null,
				[s.color.r, s.color.g, s.color.b, s.color.a].map(round),
				s.darkColor ? [s.darkColor.r, s.darkColor.g, s.darkColor.b].map(round) : null,
			]),
			order: sk.drawOrder.map((s) => s.data.index),
			events,
			drawn: drawn.filter((d) => !('slot' in d) || d.visible),
		});
	};

	/** No stock rig has physics: a chain whose tip a physics constraint sways as its root moves. */
	const PHYSICS = {
		skeleton: { spine: '4.2.0', width: 120, height: 120 },
		bones: [
			{ name: 'root' },
			{ name: 'arm', parent: 'root', length: 50, x: 10 },
			{ name: 'tip', parent: 'arm', length: 30, x: 50 },
		],
		physics: [
			{
				name: 'sway',
				bone: 'tip',
				x: 1,
				y: 1,
				rotate: 1,
				inertia: 0.6,
				strength: 80,
				damping: 0.8,
				gravity: 30,
			},
		],
		animations: {
			swing: {
				bones: {
					root: {
						translate: [
							{ time: 0, x: 0, y: 0 },
							{ time: 0.5, x: 40, y: -10 },
							{ time: 1, x: 0, y: 0 },
						],
					},
				},
			},
			rest: {
				bones: {
					root: {
						rotate: [
							{ time: 0, value: 0 },
							{ time: 1, value: 30 },
						],
					},
				},
			},
		},
	};

	function boxless(data: SkeletonData): SkeletonData {
		data.width = 0;
		data.height = 0;
		return data;
	}

	const measured = (rig: RigView): string => {
		const b = rig.bounds;
		return [b.x, b.y, b.width, b.height].map(round).join(',');
	};

	/** A play as `<RigTrack>` starts one: the animation set and posed at once. */
	const start = (rig: RigView, animation: string, events: string[]): void => {
		rig.state.addListener({
			event: (_entry, ev) => events.push(`${ev.data.name}@${round(ev.time)}`),
		});
		rig.state.setAnimation(0, animation, true);
		rig.update(0);
	};

	const newTicker = () => {
		const ticker = new Ticker();
		ticker.autoStart = false;
		ticker.stop();
		return ticker;
	};

	type Case = { label: string; data: SkeletonData; before: string; next: string; mix?: number };
	const CASES: Case[] = [
		{
			label: 'the win frame (anticipation, payframe after anticipation_loop)',
			data: load('anticipation', 'anticipation.json', 'anticipation.atlas'),
			before: 'anticipation_loop',
			next: 'payframe',
		},
		{
			label: 'the win frame again (payframe after payframe)',
			data: load('anticipation', 'anticipation.json', 'anticipation.atlas'),
			before: 'payframe',
			next: 'payframe',
		},
		{
			label: 'a symbol rig with an event (W, wild_dynamite after wild_dynamite_land)',
			data: load('symbols3', 'W.json', 'symbols3.atlas'),
			before: 'wild_dynamite_land',
			next: 'wild_dynamite',
		},
		{
			label: 'a symbol rig with an event again (W, wild_dynamite after wild_dynamite)',
			data: load('symbols3', 'W.json', 'symbols3.atlas'),
			before: 'wild_dynamite',
			next: 'wild_dynamite',
		},
		{
			// A rig's state may mix one animation into the next; a new view has nothing to mix from.
			label: 'a symbol rig whose animations mix (W, wild_dynamite after wild_dynamite_land)',
			data: load('symbols3', 'W.json', 'symbols3.atlas'),
			before: 'wild_dynamite_land',
			next: 'wild_dynamite',
			mix: 0.25,
		},
		{
			label: 'a rig exported without a box (W, wild_dynamite_land after wild_dynamite)',
			data: boxless(load('symbols3', 'W.json', 'symbols3.atlas')),
			before: 'wild_dynamite',
			next: 'wild_dynamite_land',
		},
		{
			label: 'a rig with physics (a swaying tip, rest after swing)',
			data: new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(''))).readSkeletonData(
				PHYSICS,
			),
			before: 'swing',
			next: 'rest',
		},
	];

	type Internal = { internalUpdate: (dt: number) => void };

	for (const { label, data, before, next, mix } of CASES) {
		console.log(label);
		// One ticker for both, so both are handed the same deltas, as the game's shared ticker hands them.
		const ticker = newTicker();
		let t = 0;
		const tick = () => ticker.update((t += FRAME));
		ticker.update(t);
		const kept = new RigView({ skeletonData: data, ticker });
		if (mix) kept.state.data.defaultMix = mix;
		const earlier: string[] = [];
		start(kept, before, earlier);
		for (let i = 0; i < 47; i++) tick();
		kept.state.clearListeners();

		putRigAway(kept);
		const away = snapshot(kept, []);
		let updates = 0;
		const internal = (kept as unknown as Internal).internalUpdate.bind(kept);
		(kept as unknown as Internal).internalUpdate = (dt) => {
			updates += 1;
			internal(dt);
		};
		const awayEvents: string[] = [];
		kept.state.addListener({ event: (_e, ev) => awayEvents.push(ev.data.name) });
		for (let i = 0; i < 40; i++) tick();
		check(
			'put away: hidden and off the ticker',
			!kept.visible && !kept.autoUpdate && ticker.count === 0,
		);
		check(
			'put away: forty ticks update nothing, fire nothing and move nothing',
			updates === 0 && awayEvents.length === 0 && snapshot(kept, []) === away,
			`${updates} updates, ${awayEvents.length} events`,
		);
		kept.state.clearListeners();
		(kept as unknown as Internal).internalUpdate = internal;

		bringRigBack(kept, true);
		restartRigPose(kept);
		check(
			'brought back: shown and on the ticker once',
			kept.visible && kept.autoUpdate && ticker.count === 1,
		);
		const fresh = new RigView({ skeletonData: data, ticker });
		if (mix) fresh.state.data.defaultMix = mix;
		const keptEvents: string[] = [];
		const freshEvents: string[] = [];
		start(kept, next, keptEvents);
		start(fresh, next, freshEvents);
		check(
			'its first pose measures as a new view’s',
			measured(kept) === measured(fresh) &&
				(data.slots.length === 0 || Number(measured(fresh).split(',')[2]) > 0),
			`${measured(kept)} vs ${measured(fresh)}`,
		);
		let first = -1;
		let detail = '';
		let fired = 0;
		for (let frame = 0; frame <= 150 && first < 0; frame++) {
			if (frame > 0) tick();
			fired += freshEvents.length;
			const want = snapshot(fresh, freshEvents.splice(0));
			const got = snapshot(kept, keptEvents.splice(0));
			if (want !== got) {
				first = frame;
				const at = [...want].findIndex((c, i) => c !== got[i]);
				detail = `frame ${frame} differs at ${at}:\n       new  …${want.slice(Math.max(0, at - 80), at + 120)}\n       kept …${got.slice(Math.max(0, at - 80), at + 120)}`;
			}
		}
		check('every frame of the next play is a new view’s (151 frames)', first < 0, detail);
		if (label.includes('event')) check('…the play fires its events', fired > 0, `${fired} events`);
		fresh.destroy();
		kept.destroy();
	}

	console.log('the ticker: where a play puts the rig’s update');
	{
		const data = CASES[0].data;
		const ticker = newTicker();
		ticker.update(0);
		const order: string[] = [];
		const tagged = (name: string) => {
			const rig = new RigView({ skeletonData: data, ticker });
			const internal = (
				rig as unknown as { internalUpdate: (dt: number) => void }
			).internalUpdate.bind(rig);
			(rig as unknown as { internalUpdate: (dt: number) => void }).internalUpdate = (dt) => {
				order.push(name);
				internal(dt);
			};
			return rig;
		};
		const a = tagged('a');
		tagged('b');
		let t = 0;
		const tick = () => {
			order.length = 0;
			ticker.update((t += FRAME));
			return order.join(',');
		};
		check('two views update in the order they were built', tick() === 'a,b');
		putRigAway(a);
		check('put away, the first is skipped', tick() === 'b');
		tagged('c');
		bringRigBack(a, true);
		check(
			'a new play puts it after every update registered before it, as a new view would be',
			tick() === 'b,c,a',
		);
		bringRigBack(a, false);
		check(
			'brought back within a play, it keeps its place',
			tick() === 'b,c,a' && ticker.count === 3,
		);
		putRigAway(a);
		bringRigBack(a, false);
		check('…and is registered again if it was away', tick() === 'b,c,a' && ticker.count === 3);
		tagged('d');
		bringRigBack(a, false);
		check('within a play it stays ahead of an update registered after it', tick() === 'b,c,a,d');
		bringRigBack(a, true);
		check(
			'a new play while it is drawn moves it after that update, as a remount would',
			tick() === 'b,c,d,a' && ticker.count === 4,
		);
	}

	console.log('the components a kept rig is drawn by');
	{
		const source = (name: string) => read(`../src/lib/components/${name}`);
		const provider = source('RigProvider.svelte');
		check(
			'RigProvider tells its subtree when it is put away and when a play starts, only when kept',
			/if \(parked !== undefined\) \{\s*setContextRigParked\(\(\) => !!parked\);\s*setContextRestart\(\(\) => restart\);\s*\}/.test(
				provider,
			),
		);
		const base = source('BaseRigProvider.svelte');
		check(
			'BaseRigProvider puts it away and brings it back where its mount ran, only when kept',
			/const parked = getContextRigParked\(\);\s*\/\*\*[\s\S]*?\*\/\s*const dormant = parked \? undefined : getContextDormant\(\);\s*const builtAsleep = !!dormant && untrack\(dormant\);\s*const play = parked\s*\? getContextRestart\(\)\s*: builtAsleep\s*\? \(\) => \(dormant\?\.\(\) \? 'asleep' : 'shown'\)\s*: undefined;/.test(
				base,
			) &&
				/\$effect\.pre\(\(\) => \{\s*const now = play\?\.\(\);\s*if \(parked\(\)\) \{\s*putRigAway\(rig\);\s*return;\s*\}\s*bringRigBack\(rig, now !== shown\);/.test(
					base,
				),
		);
		check(
			'…and one built on a screen not shown yet is put away until the show, then brought back as a new view',
			/if \(dormant && builtAsleep\) \{\s*let woke = false;\s*\$effect\.pre\(\(\) => \{\s*if \(woke\) return;\s*if \(dormant\(\)\) \{\s*putRigAway\(rig\);\s*return;\s*\}\s*woke = true;\s*bringRigBack\(rig, true\);/.test(
				base,
			),
		);
		const effects = [...base.matchAll(/\$effect\(\(\) => \{\n\t\t([^\n]*)\n/g)].map((m) => m[1]);
		check(
			'…and measures, skins and localises it again at each play (four effects)',
			effects.filter((line) => line === 'void play?.();').length === 4 &&
				/if \(play\) rig\.pivot\.set\(0, 0\);/.test(base),
			effects.join(' | '),
		);
		const track = source('RigTrack.svelte');
		check(
			'RigTrack starts again through restartRigPose and applies nothing while put away',
			/onRestart\(restart, \(\) => \{\s*restartRigPose\(rig\);/.test(track) &&
				/\$effect\(\(\) => \{\s*if \(parked\?\.\(\)\) return;/.test(track),
		);
		for (const name of ['RiggedEffect.svelte', 'RiggedFlipbook.svelte']) {
			const bound = source(name);
			check(
				`${name.replace('.svelte', '')} lets its content go while put away and ignores beats then`,
				/if \(parked\) \{\s*\$effect\.pre\(\(\) => \{\s*if \(parked\(\)\) untrack\(dormant\);/.test(
					bound,
				) && /const fire = \([^)]*\): void => \{\s*if \(parked\?\.\(\)\) return;/.test(bound),
			);
		}
		const clip = source('RiggedFlipbook.svelte');
		check(
			'RiggedFlipbook keeps its clip from its first beat: started again per beat, hidden while down',
			/setContextRestart\(\(\) => runId\);\s*let fired = false;\s*const drawn = \$derived\(\(fired \|\|= runId > 0\)\);\s*\$effect\.pre\(\(\) => \{\s*fbLocal\.visible = runId > 0;\s*\}\);/.test(
				clip,
			) &&
				/\{#if drawn\}/.test(clip) &&
				!/\{#key runId\}/.test(clip) &&
				(clip.match(/<Flipbook clip=\{props\.clip\} anchor=\{0\.5\} play=\{runId > 0\} \/>/g) ?? [])
					.length === 2 &&
				clip.indexOf('const restart = getContextRestart();') < clip.indexOf('setContextRestart('),
		);
		const sprite = source('AnimatedSprite.svelte');
		check(
			'…which AnimatedSprite starts again from its first frame when the restart moves, and stops when not playing',
			/void restart\?\.\(\);[\s\S]*?gotoAndPlay\(0\);\s*\} else \{\s*animatedSprite\.gotoAndStop\(0\);/.test(
				sprite,
			),
		);
	}

	if (failures) throw new Error(`rigKeep.fixture: ${failures} FAILED`);
	console.log('\nrigKeep.fixture: all ok');
}
