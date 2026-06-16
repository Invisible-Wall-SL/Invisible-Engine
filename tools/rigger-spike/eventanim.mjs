// Phase 5.4 spike — prove the EVENT channel the rigger will write loads + FIRES through
// spine-core. Format: top-level `events:{name:{int,float,string}}` defs + per-anim
// `animations[a].events=[{time,name,int?,float?,string?}]`.
//   node tools/rigger-spike/eventanim.mjs <skeleton.json> <skeleton.atlas>
import { readFileSync } from 'node:fs';

const CORE = new URL('../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js', import.meta.url).href;
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Physics, MixBlend, MixDirection } = await import(CORE);

const [, , jsonPath, atlasPath] = process.argv;
const atlasText = readFileSync(atlasPath, 'utf8');
function loadData(obj) {
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) { p.width = 2048; p.height = 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(obj);
}

const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
raw.events = Object.assign({}, raw.events, { spikeEvent: { int: 7, float: 1.5, string: 'hi' } });
raw.animations = { evtAnim: { events: [{ time: 0.5, name: 'spikeEvent' }, { time: 1.0, name: 'spikeEvent', int: 9 }] } };

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log(`\n=== Phase 5.4 event channel → reload: ${jsonPath} ===`);

let data = null;
try { data = loadData(raw); } catch (e) { log(false, 'loader REJECTED the authored events — ' + e.message); }
if (data) {
	log(!!data.findEvent('spikeEvent'), 'event definition loads');
	const anim = data.findAnimation('evtAnim');
	log(!!anim, 'animation with an event timeline loads');
	log(Math.abs(anim.duration - 1) < 1e-6, `duration from last event = ${anim.duration}`);
	const sk = new Skeleton(data);
	// apply across t=0.5 with an events collector
	const fired = [];
	sk.setToSetupPose();
	anim.apply(sk, 0.4, 0.6, false, fired, 1, MixBlend.setup, MixDirection.mixIn);
	log(fired.length === 1 && fired[0].data.name === 'spikeEvent', `event fires at 0.5 (got ${fired.length}: ${fired.map((e) => e.data.name).join(',')})`);
	log(fired.length && fired[0].intValue === 7, `event carries its def int value (${fired.length ? fired[0].intValue : '—'})`);
	const fired2 = [];
	anim.apply(sk, 0.9, 1.1, false, fired2, 1, MixBlend.setup, MixDirection.mixIn);
	log(fired2.length === 1 && fired2[0].intValue === 9, `per-key int override fires at 1.0 (${fired2.length ? fired2[0].intValue : '—'})`);
}

console.log(pass ? '\n✅ PASS — authored event defs + timeline load and fire through spine-core.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
