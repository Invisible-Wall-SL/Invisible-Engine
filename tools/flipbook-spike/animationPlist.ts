/**
 * Invisible Flipbook — headless harness for the cocos2d ANIMATION plist:
 *
 *   pnpm --filter flipbook-spike run anim
 *
 * This format is read AND written, and files we emit must stay loadable by a stock cocos2d
 * `AnimationCache`. So the contract under test is: the standard keys are exactly where cocos
 * expects them, our `iw*` extensions ride alongside without disturbing them, foreign extensions
 * survive a round-trip, and — the whole point of the format — an animation can HOLD a frame and
 * run frames out of numeric order, neither of which filename detection can express.
 */

import {
	ANIMATION_PLIST_FORMAT,
	AnimationPlistError,
	animationToClip,
	clipToAnimation,
	clipsToAnimationPlist,
	frameNameToRegion,
	parseAnimationPlist,
	serializeAnimationPlist,
} from 'engine-flipbook';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};

// A hand-written file in the shape a real cocos2d project ships: a HOLD (00 twice), a
// NON-MONOTONIC jump (07 before 03), and a foreign extension key we must not eat.
const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>animations</key>
	<dict>
		<key>shield_idle</key>
		<dict>
			<key>frames</key>
			<array>
				<string>anim-sym-pic1_00.png</string>
				<string>anim-sym-pic1_00.png</string>
				<string>anim-sym-pic1_07.png</string>
				<string>anim-sym-pic1_03.png</string>
			</array>
			<key>delayPerUnit</key><real>0.04</real>
			<key>loops</key><integer>1</integer>
			<key>restoreOriginalFrame</key><false/>
			<key>someOtherToolKey</key><string>keep me</string>
		</dict>
	</dict>
	<key>properties</key>
	<dict>
		<key>format</key><integer>2</integer>
		<key>spritesheets</key>
		<array><string>anim-sym-pic1_0.plist</string></array>
	</dict>
</dict>
</plist>`;

console.log('animation plist — parsing');
const doc = parseAnimationPlist(SAMPLE);
assert(doc.animations.length === 1, 'one animation parsed');
const anim = doc.animations[0];
assert(anim.name === 'shield_idle', 'the animation name is the dict key');
assert(anim.frames.length === 4, 'all four frame entries survive');
assert(anim.delayPerUnit === 0.04, 'delayPerUnit reads as a real');
assert(
	anim.loops === 1 && anim.restoreOriginalFrame === false,
	'loops + restoreOriginalFrame read',
);
assert(doc.spritesheets.join(',') === 'anim-sym-pic1_0.plist', 'properties.spritesheets read');
assert(doc.format === ANIMATION_PLIST_FORMAT, 'format 2 accepted');

console.log('animation plist — what filename detection CANNOT express');
assert(
	anim.frames[0] === anim.frames[1],
	'a repeated frame (a HOLD) is preserved, not de-duplicated',
);
assert(
	anim.frames.map(frameNameToRegion).join(',') ===
		'anim-sym-pic1_00,anim-sym-pic1_00,anim-sym-pic1_07,anim-sym-pic1_03',
	'frames stay in AUTHORED order, not numeric order',
);

console.log('animation plist — refuses what it is not');
const SHEET_PLIST = `<?xml version="1.0"?><plist version="1.0"><dict>
	<key>frames</key><dict/><key>metadata</key><dict/></dict></plist>`;
try {
	parseAnimationPlist(SHEET_PLIST);
	assert(false, 'a sprite-SHEET plist is refused');
} catch (e) {
	assert(
		e instanceof AnimationPlistError && /sprite-SHEET/.test(e.message),
		'a sprite-SHEET plist is refused, and the message SAYS that is what it is',
	);
}
try {
	parseAnimationPlist(SAMPLE.replace('<integer>2</integer>', '<integer>1</integer>'));
	assert(false, 'format 1 is refused');
} catch (e) {
	assert(e instanceof AnimationPlistError, 'an unsupported format version is refused');
}

console.log('animation plist — round-trip');
const round = parseAnimationPlist(serializeAnimationPlist(doc));
assert(round.animations[0].frames.join(',') === anim.frames.join(','), 'frames round-trip exactly');
assert(round.animations[0].delayPerUnit === 0.04, 'timing round-trips');
assert(
	round.animations[0].extra.someOtherToolKey === 'keep me',
	"another tool's extension key survives a pass through ours",
);
// Byte-level stability: serialising twice must produce the same file, or every save churns git.
assert(
	serializeAnimationPlist(round) === serializeAnimationPlist(doc),
	'serialisation is stable (re-serialising a re-parsed doc is identical)',
);
// The standard keys must be exactly where cocos looks for them.
const xml = serializeAnimationPlist(doc);
for (const key of [
	'animations',
	'frames',
	'delayPerUnit',
	'loops',
	'restoreOriginalFrame',
	'spritesheets',
]) {
	assert(
		xml.includes(`<key>${key}</key>`),
		`the emitted file carries the standard <key>${key}</key>`,
	);
}
assert(xml.startsWith('<?xml'), 'the emitted file starts with the XML declaration');
assert(xml.includes('<!DOCTYPE plist'), 'the emitted file carries the plist DOCTYPE');

console.log('animation plist — animation → clip');
const SHEETS = [
	{
		assetKey: 'c/p/manifests/atlas_manifest_page0.json',
		regions: ['anim-sym-pic1_00', 'anim-sym-pic1_03'],
	},
	{ assetKey: 'c/p/manifests/atlas_manifest_page1.json', regions: ['anim-sym-pic1_07'] },
];
const clip = animationToClip(anim, SHEETS);
assert(clip.name === 'shield_idle', 'the clip takes the animation name');
assert(clip.fps === 25, 'fps is derived from delayPerUnit (1 / 0.04 = 25)');
assert(clip.loop === false, 'loops:1 with no iwLoop ⇒ a one-shot');
assert(clip.assetKey === SHEETS[0].assetKey, 'primary = the sheet holding the most frames');
assert(
	clip.frames.join(',') ===
		`anim-sym-pic1_00,anim-sym-pic1_00,${SHEETS[1].assetKey}::anim-sym-pic1_07,anim-sym-pic1_03`,
	'frames on the primary stay bare; the one on another page is scoped to it',
);

// A frame no sheet packs must stay visible, not silently disappear here.
const orphan = animationToClip({ ...anim, frames: ['ghost.png'] }, SHEETS);
assert(
	orphan.frames.join(',') === 'ghost',
	'a frame no sheet packs is kept, for the dangling report',
);

console.log('animation plist — clip → animation');
const back = clipToAnimation(clip);
assert(
	back.frames.join(',') === 'anim-sym-pic1_00,anim-sym-pic1_00,anim-sym-pic1_07,anim-sym-pic1_03',
	'frames are written BARE — cocos resolves names from one global cache, so a scoped ref would not load',
);
assert(Math.abs(back.delayPerUnit - 0.04) < 1e-6, 'fps converts back to delayPerUnit');
assert(back.extra.iwLoop === false, 'the explicit loop flag is recorded in our namespace');
// `loops` is a play COUNT: 0 means zero plays, not "forever", and a stock runtime handed 0 may
// render nothing. We always write 1 — the value every cocos runtime treats identically — and
// keep the real intent in `iwLoop`.
assert(back.loops === 1, 'loops is written as 1 for a one-shot clip');
assert(
	clipToAnimation({ ...clip, loop: true }).loops === 1,
	'loops is ALSO 1 for a looping clip — never 0, which would mean zero plays',
);
assert(
	clipToAnimation({ ...clip, loop: true }).extra.iwLoop === true,
	'a looping clip carries its intent in iwLoop instead',
);
assert(
	back.extra.iwId === clip.id,
	'the clip id rides along so a re-import updates, not duplicates',
);
const sheetMap = back.extra.iwFrameSheets as Record<string, string>;
assert(
	sheetMap && sheetMap['2'] === SHEETS[1].assetKey,
	'the per-frame sheet of frame 2 is preserved',
);

console.log('animation plist — clip → plist → clip keeps a multipacked clip intact');
const written = serializeAnimationPlist(clipsToAnimationPlist([clip], ['page0.plist']));
const reparsed = parseAnimationPlist(written);
const reclip = animationToClip(reparsed.animations[0], SHEETS);
assert(
	reclip.frames.join(',') === clip.frames.join(','),
	'the multipacked frame list survives the round-trip',
);
assert(reclip.fps === clip.fps && reclip.loop === clip.loop, 'fps + loop survive the round-trip');
assert(reclip.id === clip.id, 'the clip id survives, so a re-import updates the same clip');

console.log('');
if (failures > 0) {
	console.error(`FLIPBOOK ANIMATION PLIST: ${failures} FAILURE(S)`);
	process.exit(1);
}
console.log('FLIPBOOK ANIMATION PLIST: PASSED');
