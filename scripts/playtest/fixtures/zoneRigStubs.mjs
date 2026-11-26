// The stub rigs the zone-art playtests draw zones and trees with (`zone-art-play.mjs`,
// `salmons-play.mjs --zone-rig`), as a publish exports a rig: `deploy/editor-art/<name>/` holds its
// page, its atlas and its skeleton (`editorArt.spines` lists it under its bundle name).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const CYAN = [0x00, 0xff, 0xff];
export const YELLOW = [0xff, 0xff, 0x00];

/** One slot of a 64 × 32 drawing (its Bounds box), cyan in its setup pose; `blink` shows the
 *  yellow one half way through each second. */
export const BLINK_RIG = {
	page: { w: 128, h: 32, paint: (x) => (x < 64 ? CYAN : YELLOW) },
	atlas: [
		'size: 128,32',
		'filter: Nearest,Nearest',
		'cyan',
		'bounds: 0,0,64,32',
		'yellow',
		'bounds: 64,0,64,32',
	],
	skeleton: {
		skeleton: { spine: '4.2.0', x: -32, y: -16, width: 64, height: 32 },
		bones: [{ name: 'root' }],
		slots: [{ name: 'body', bone: 'root', attachment: 'cyan' }],
		skins: [
			{
				name: 'default',
				attachments: {
					body: { cyan: { width: 64, height: 32 }, yellow: { width: 64, height: 32 } },
				},
			},
		],
		animations: {
			blink: {
				slots: {
					body: {
						attachment: [
							{ name: 'cyan' },
							{ time: 0.5, name: 'yellow' },
							{ time: 1, name: 'cyan' },
						],
					},
				},
			},
		},
	},
};

const TREE_BONES = [
	'trunk0',
	'trunk1',
	'trunk2',
	'trunk3',
	'branchA',
	'branchB',
	'branchC',
	'branchD',
];
const TREE_PARTS = [
	['bark0', 'trunk0', 'bark'],
	['bark1', 'trunk1', 'bark'],
	['leavesA', 'branchA', 'leaves'],
	['leavesB', 'branchB', 'leaves'],
	['leavesC', 'branchC', 'leaves'],
	['leavesD', 'branchD', 'leaves'],
];

/** A tree of a trunk of 4 bones and 4 branches, 6 parts drawn (green leaves, brown bark), every
 *  bone swaying over 2 s: a modest rig, what a tree in the forest might be. */
export const TREE_RIG = {
	page: { w: 64, h: 64, paint: (_x, y) => (y < 32 ? [0x20, 0x90, 0x30] : [0x6a, 0x40, 0x20]) },
	atlas: [
		'size: 64,64',
		'filter: Linear,Linear',
		'leaves',
		'bounds: 0,0,64,32',
		'bark',
		'bounds: 0,32,64,32',
	],
	skeleton: {
		skeleton: { spine: '4.2.0', x: -48, y: 0, width: 96, height: 144 },
		bones: [
			{ name: 'root' },
			{ name: 'trunk0', parent: 'root', rotation: 90, length: 30 },
			{ name: 'trunk1', parent: 'trunk0', x: 30, length: 30 },
			{ name: 'trunk2', parent: 'trunk1', x: 30, length: 30 },
			{ name: 'trunk3', parent: 'trunk2', x: 30, length: 30 },
			{ name: 'branchA', parent: 'trunk2', x: 10, rotation: 40, length: 30 },
			{ name: 'branchB', parent: 'trunk2', x: 20, rotation: -40, length: 30 },
			{ name: 'branchC', parent: 'trunk3', x: 10, rotation: 50, length: 25 },
			{ name: 'branchD', parent: 'trunk3', x: 20, rotation: -50, length: 25 },
		],
		slots: TREE_PARTS.map(([name, bone, attachment]) => ({ name, bone, attachment })),
		skins: [
			{
				name: 'default',
				attachments: Object.fromEntries(
					TREE_PARTS.map(([slot, , name]) => [
						slot,
						{
							[name]:
								name === 'bark'
									? { x: 15, width: 30, height: 16 }
									: { x: 15, width: 48, height: 24 },
						},
					]),
				),
			},
		],
		animations: {
			sway: {
				bones: Object.fromEntries(
					TREE_BONES.map((bone, i) => [
						bone,
						{
							rotate: [{ value: 0 }, { time: 1, value: i % 2 ? 6 : -6 }, { time: 2, value: 0 }],
						},
					]),
				),
			},
		},
	},
};

/**
 * Write `rig` under `<snapshot>/deploy/editor-art/<name>/` as a publish exports it, its page made
 * by `png(w, h, paint)`; returns its `editorArt.spines` entry.
 */
export function exportStubRig(snapshot, name, rig, png) {
	const folder = join(snapshot, 'deploy', 'editor-art', name);
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, `${name}.png`), png(rig.page.w, rig.page.h, rig.page.paint));
	writeFileSync(join(folder, `${name}.atlas`), [`${name}.png`, ...rig.atlas, ''].join('\n'));
	writeFileSync(join(folder, `${name}.json`), JSON.stringify(rig.skeleton));
	return {
		key: name,
		atlas: `editor-art/${name}/${name}.atlas`,
		skeleton: `editor-art/${name}/${name}.json`,
		scale: 1,
	};
}
