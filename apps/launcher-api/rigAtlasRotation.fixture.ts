/**
 * Offline fixture for `clockwiseOnPage` — run with node (it strips the types):
 *   node apps/launcher-api/rigAtlasRotation.fixture.ts
 *
 * The rewrite has to touch exactly the rotations of ONE page: a rig atlas can carry a second page
 * (Rigger text), and a region can be NAMED like a property. Turning the wrong line reads a region
 * a half-turn off in the game, with nothing in the editor to show it, because the editor reads the
 * bundle's own atlas, not this one.
 */

import { clockwiseOnPage } from './src/lib/server/rigAtlasRotation.ts';

let failures = 0;
const check = (label: string, actual: string, expected: string): void => {
	if (actual === expected) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n--- expected\n${expected}\n--- actual\n${actual}`);
};

const atlas = [
	'S_Sheet.webp',
	'size:4096,6000',
	'filter:Linear,Linear',
	'T_BigWin_Background',
	'bounds:2462,0,1920,1080',
	'rotate:90',
	'T_BigWin_Boyo',
	'bounds:0,1922,765,1080',
	'rotate_icon',
	'bounds:10,10,4,4',
	'T_Trimmed',
	'bounds:1082,1154,631,835',
	'offsets:3,5,640,840',
	'  rotate: true',
	'',
	'rigtext-c31dfc4e1ce56742.png',
	'size:223,68',
	'filter:Linear,Linear',
	'text/you_won/en',
	'bounds:2,2,219,64',
	'rotate:90',
	'',
].join('\n');

console.log('\nonly the named page turns, every form of a quarter turn, nothing else');
check(
	'S_Sheet.webp',
	clockwiseOnPage(atlas, 'S_Sheet.webp'),
	atlas
		.replace('bounds:2462,0,1920,1080\nrotate:90', 'bounds:2462,0,1920,1080\nrotate:270')
		.replace('  rotate: true', '  rotate:270'),
);
check(
	'the second page alone',
	clockwiseOnPage(atlas, 'rigtext-c31dfc4e1ce56742.png'),
	atlas.replace('bounds:2,2,219,64\nrotate:90', 'bounds:2,2,219,64\nrotate:270'),
);
check('a page the atlas does not have', clockwiseOnPage(atlas, 'other.webp'), atlas);
// The runtime's parser is case-sensitive and reads this as no rotation, so it stays that way.
const shouting = 'S_Sheet.webp\nsize:64,48\nT_Upper\nbounds:0,0,8,4\nROTATE: TRUE\n';
check(
	'an upper-case rotate line is not a quarter turn',
	clockwiseOnPage(shouting, 'S_Sheet.webp'),
	shouting,
);

console.log('\nCRLF line endings survive as LF, the way the runtime reads them');
check(
	'S_Sheet.webp (CRLF)',
	clockwiseOnPage(atlas.replace(/\n/g, '\r\n'), 'S_Sheet.webp'),
	clockwiseOnPage(atlas, 'S_Sheet.webp'),
);

if (failures > 0) {
	console.log(`\n${failures} failed`);
	process.exit(1);
}
console.log('\nall passed');
