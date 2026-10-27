// Writes SALMONS (game-families P10.16) as the documents a project holds, at the R2 keys the
// launcher reads them from, under `--out` — for a person with R2 access to put in the `salmons`
// project (docs/status/salmons.md "Owner steps"). It writes nothing to R2 itself.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/salmons/export.mjs --out <dir> [--client invisible_wall] [--project salmons]
//
// Writes:
//   <client>/<project>/config/config.json   the online game config (`engine-mechanics` salmons.js)
//   <client>/<project>/editor/scenes.json   the river layout (`engine-layout` salmons.ts)
//   editor/<project>/components/<id>.json   the three characters' placeholder looks

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { salmonsConfig, salmonsRiver } from '../../packages/engine-mechanics/src/salmons.js';
import {
	SALMONS_CHARACTER_COMPONENTS,
	salmonsReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import { normalizeGameConfigDoc } from '../../packages/game-config/index.ts';
import { validateFamily } from '../../packages/game-config/src/familyValidate.ts';

const { values: opt } = parseArgs({
	options: {
		out: { type: 'string' },
		client: { type: 'string', default: 'invisible_wall' },
		project: { type: 'string', default: 'salmons' },
	},
});
if (!opt.out) throw new Error('--out <dir> is required');
const out = resolve(opt.out);
const write = (key, doc) => {
	const path = join(out, key);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(doc, null, '\t')}\n`);
	console.log(`  ${key}`);
};

const river = salmonsRiver();
const config = normalizeGameConfigDoc(salmonsConfig(river));
const errors = validateFamily(config).filter((issue) => issue.severity === 'error');
if (errors.length)
	throw new Error(`the Salmons config does not validate: ${JSON.stringify(errors)}`);
const layout = { ...salmonsReferenceLayout(river), projectKey: opt.project };

console.log(`Salmons (river ${river.seed}) → ${out}`);
write(`${opt.client}/${opt.project}/config/config.json`, config);
write(`${opt.client}/${opt.project}/editor/scenes.json`, layout);
for (const def of SALMONS_CHARACTER_COMPONENTS)
	write(`editor/${opt.project}/components/${def.id}.json`, def);
