/**
 * The Custom GLSL page (`shaderPages.mjs`; `shaderCompile.mjs` draws it in CI) on WebGL1 or WebGL2.
 *
 * `?glsl=1`: every sample body the checker takes (`customGlsl.samples.ts`), the example nodes together,
 * 200 random bodies from the grammar and every broken or one-slip body the checker takes, ten to a
 * graph, each
 * compiled through the real `ElementFxFilter` and drawn. A body the checker takes but the driver
 * refuses is a checker bug: the page names it (each body of a failing graph is drawn alone) and its
 * code, and `shaderCompile.mjs` fails on the line it logs.
 *
 * `?failsafe=1`: the runtime fail-safe. Three custom effects are registered: one that draws, one with
 * a Custom GLSL function whose body was broken after it was checked (as a driver the checker cannot
 * foresee would refuse it), and a plain graph broken the same way. Played through `playElementFx`
 * beside a plain element, the broken ones draw the element as it is (their pass left out), the other
 * effect and the plain element draw as ever, nothing throws, the context stays, and each broken pass
 * is logged once however long and often it plays. Pixi's own error lines for the broken programs are
 * the expected ones here: the page takes them and logs an error only for a claim that does not hold.
 */
import {
	Application,
	Container,
	FillGradient,
	Graphics,
	Ticker,
	type WebGLRenderer,
} from 'pixi.js';
import {
	setCustomElementFx,
	type CustomElementFx,
} from '@fxroot/packages/constants-shared/elementFx';
import {
	CUSTOM_GLSL_EFFECT_COST_MAX,
	CUSTOM_GLSL_EFFECT_SAMPLES_MAX,
	REFERENCE_GRAPHS,
	compileShaderEffect,
	compileShaderGraph,
	customGlslDef,
	customGlslIssues,
	type ShaderGraphDoc,
} from '@fxroot/packages/engine-shadergraph/index';
import {
	CUSTOM_GLSL_EXAMPLES,
	VALID_GLSL,
	customGlslChain,
	generatedGlsl,
	mutatedGlsl,
	nearMissGlsl,
	type GlslSample,
} from '@fxroot/packages/engine-shadergraph/customGlsl.samples';
import { playElementFx } from '@fxroot/packages/pixi-svelte/src/lib/elementFx/runtime';
import { graphFilter } from '@fxroot/packages/pixi-svelte/src/lib/elementFx/custom';

const COLS = 8;
const CELL_W = 170;
const CELL_H = 190;

const makeCard = (): Container => {
	const card = new Container();
	const fill = new FillGradient(0, 0, 120, 140);
	fill.addColorStop(0, 0xff4d6d);
	fill.addColorStop(0.5, 0xffb703);
	fill.addColorStop(1, 0x3a86ff);
	card.addChild(
		new Graphics()
			.roundRect(-60, -70, 120, 140, 18)
			.fill(fill)
			.stroke({ width: 4, color: 0xffffff }),
		new Graphics().star(0, -10, 5, 34, 16).fill(0xffffff),
		new Graphics().rect(-40, 30, 80, 16).fill(0x111111),
	);
	return card;
};

const nodeOf = (sample: GlslSample) => ({ id: 'g', type: 'customGlsl', x: 0, y: 0, glsl: sample });

const accepted = (sample: GlslSample): boolean =>
	!customGlslIssues(nodeOf(sample)).some((i) => i.level === 'error');

const page = window as unknown as {
	rows: string[];
	ready: boolean;
	failsafe?: Record<string, unknown>;
};

/** Draw `doc` on `card` through the runtime's own filter, as a custom effect's graph pass draws. */
const drawn = (app: Application, card: Container, doc: ShaderGraphDoc): string[] => {
	const result = compileShaderGraph(doc);
	if (!result.ok) return [`does not compile: ${result.issues.map((i) => i.message).join('; ')}`];
	const filter = graphFilter(doc.id, {
		body: result.shader.body,
		uniforms: result.shader.uniforms,
	});
	filter.set('uFx', 0.5, 0.5, 1, 0);
	card.filters = [filter];
	const report = console.error;
	const logged: string[] = [];
	console.error = (...args: unknown[]) => logged.push(args.map(String).join(' '));
	try {
		app.renderer.render({ container: card });
	} catch (error) {
		logged.push(`threw ${(error as Error).message}`);
	} finally {
		console.error = report;
	}
	return logged;
};

async function bodies(app: Application): Promise<void> {
	/** `samples` in graphs of up to `size`, each within what an effect's Custom GLSL may spend. */
	const chunks = (samples: GlslSample[], size: number): GlslSample[][] => {
		const out: GlslSample[][] = [];
		let cost = 0;
		let reads = 0;
		for (const sample of samples) {
			const def = customGlslDef(nodeOf(sample));
			const last = out[out.length - 1];
			if (
				!last ||
				last.length === size ||
				cost + def.cost > CUSTOM_GLSL_EFFECT_COST_MAX ||
				reads + (def.samples ?? 0) > CUSTOM_GLSL_EFFECT_SAMPLES_MAX
			) {
				out.push([sample]);
				cost = def.cost;
				reads = def.samples ?? 0;
			} else {
				last.push(sample);
				cost += def.cost;
				reads += def.samples ?? 0;
			}
		}
		return out;
	};
	const generated = Array.from({ length: 200 }, (_, n) => generatedGlsl(5, n));
	const mutated = Array.from({ length: 700 }, (_, n) => mutatedGlsl(13, n)).filter(accepted);
	const near = nearMissGlsl().filter(accepted);
	const groups: { name: string; samples: GlslSample[] }[] = [
		...VALID_GLSL.map((sample) => ({ name: sample.name, samples: [sample] })),
		{ name: 'examples', samples: [...CUSTOM_GLSL_EXAMPLES] },
		...chunks(generated, 10).map((samples, i) => ({ name: `generated ${i}`, samples })),
		...chunks(mutated, 10).map((samples, i) => ({ name: `mutated ${i}`, samples })),
		...chunks(near, 10).map((samples, i) => ({ name: `near ${i}`, samples })),
	];
	for (const sample of generated)
		if (!accepted(sample)) console.error(`${sample.name}: the checker refuses a generated body`);
	const rows: string[] = [];
	for (const [i, group] of groups.entries()) {
		const row = Math.floor(i / COLS);
		rows[row] = `${rows[row] ? `${rows[row]} | ` : ''}${group.name}`;
		const card = makeCard();
		const cell = new Container();
		cell.position.set((i % COLS) * CELL_W + CELL_W / 2, row * CELL_H + CELL_H / 2);
		cell.addChild(card);
		app.stage.addChild(cell);
		const failed = drawn(app, card, customGlslChain(`glsl-${i}`, group.samples));
		if (!failed.length) continue;
		// Name the body the driver refused: each alone.
		const culprits = group.samples.filter(
			(sample) => drawn(app, makeCard(), customGlslChain('alone', [sample])).length > 0,
		);
		for (const sample of culprits.length ? culprits : group.samples)
			console.error(
				`${sample.name}: the checker takes this body, the driver refuses it: ${failed.join(' ').replace(/\s+/g, ' ').slice(0, 400)}\n${sample.code}`,
			);
	}
	app.renderer.resize(COLS * CELL_W, rows.length * CELL_H);
	app.renderer.render(app.stage);
	page.rows = rows;
	page.ready = true;
}

async function failSafe(app: Application): Promise<void> {
	const report = console.error;
	const warn = console.warn;
	const errors: string[] = [];
	const warnings: string[] = [];
	console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
	console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
	const claims: [boolean, string][] = [];
	const claim = (ok: boolean, label: string): void => void claims.push([ok, label]);
	const effectOf = (doc: ShaderGraphDoc): CustomElementFx => {
		const result = compileShaderEffect(doc);
		if (!result.ok) throw new Error(`${doc.id}: ${result.issues.map((i) => i.message).join('; ')}`);
		return { ...result.effect, passes: [], motion: undefined, padding: 0 };
	};
	const good = effectOf(customGlslChain('glsl-good', [CUSTOM_GLSL_EXAMPLES[0]]));
	const glsl = effectOf(customGlslChain('glsl-broken', [CUSTOM_GLSL_EXAMPLES[0]]));
	glsl.shader = {
		...glsl.shader,
		body: glsl.shader.body.replace('color.rgb *= tint;', 'color.rgb *= tint * notDeclared;'),
	};
	const plainDoc = REFERENCE_GRAPHS[0];
	const plain = effectOf(plainDoc);
	plain.shader = {
		...plain.shader,
		body: plain.shader.body.replace(
			'void main(void)\n{',
			'void main(void)\n{\n    float broken = nope;',
		),
	};
	const registered = setCustomElementFx([good, glsl, plain]);
	claim(
		registered.length === 3,
		'the registry takes the broken effects (it cannot see a driver’s verdict)',
	);

	const ticker = new Ticker();
	ticker.autoStart = false;
	ticker.stop();
	const host = { ticker, renderer: app.renderer };
	const cards = ['glsl-broken', 'plain-broken', 'good', 'plain'].map((name, i) => {
		const card = makeCard();
		card.position.set(i * CELL_W + CELL_W / 2, CELL_H / 2);
		app.stage.addChild(card);
		return { name, card };
	});
	const play = (card: Container, id: string) =>
		playElementFx(card, { kind: `custom:${id}`, pose: () => ({ progress: 0.5 }) }, host);
	const plays = [
		play(cards[0].card, glsl.spec.kind.slice(7)),
		play(cards[1].card, plain.spec.kind.slice(7)),
		play(cards[2].card, good.spec.kind.slice(7)),
	];
	claim(
		plays.every((p) => p.active),
		'all three play',
	);
	const gl = (app.renderer as WebGLRenderer).gl;
	const frame = (): string | undefined => {
		ticker.update(performance.now());
		try {
			app.renderer.render(app.stage);
			return undefined;
		} catch (error) {
			return (error as Error).message;
		}
	};
	const pixelAt = (x: number, y: number): number[] => {
		const out = new Uint8Array(4);
		gl.readPixels(x, app.renderer.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
		return [...out];
	};
	/** A pixel of card `i`, `dx`, `dy` from its centre. */
	const at = (i: number, dx: number, dy: number): number[] =>
		pixelAt(i * CELL_W + CELL_W / 2 + dx, CELL_H / 2 + dy);
	const near = (a: number[], b: number[]): boolean => a.every((v, k) => Math.abs(v - b[k]) <= 2);
	const spots: [number, number][] = [
		[0, 0],
		[-30, -40],
		[20, 35],
		[45, 50],
	];
	const thrown = frame();
	claim(
		thrown === undefined,
		`a frame with the broken passes draws without throwing${thrown ? `: ${thrown}` : ''}`,
	);
	const asItIs = (i: number): boolean =>
		spots.every(([dx, dy]) => near(at(i, dx, dy), at(3, dx, dy)));
	claim(
		asItIs(0) && asItIs(1),
		'each broken pass draws its element as it is (the plain one beside it)',
	);
	claim(
		spots.some(([dx, dy]) => !near(at(2, dx, dy), at(3, dx, dy))),
		'the effect that compiles draws as ever, in the same frame',
	);
	const filters = cards.slice(0, 3).map(({ card }) => card.filters?.[0]);
	claim(
		filters[0]?.enabled === false && filters[1]?.enabled === false && filters[2]?.enabled === true,
		'the broken passes are disabled, the good one is not',
	);
	const pixiErrors = (): number =>
		errors.filter((e) => e.includes('Could not initialize shader')).length;
	const leftOut = (): number =>
		warnings.filter((w) => w.includes('did not compile on this GPU')).length;
	claim(
		pixiErrors() === 2 && leftOut() === 2,
		`each broken pass is logged once (driver errors ${pixiErrors()}, left out ${leftOut()})`,
	);
	for (let k = 0; k < 5; k++) frame();
	const again = makeCard();
	again.position.set(4 * CELL_W + CELL_W / 2, CELL_H / 2);
	app.stage.addChild(again);
	const later = play(again, glsl.spec.kind.slice(7));
	const afterThrown = frame();
	claim(
		afterThrown === undefined &&
			later.active &&
			asItIs(0) &&
			spots.every(([dx, dy]) => near(at(4, dx, dy), at(3, dx, dy))),
		'later frames, and the broken effect played again on another element, still draw the element as it is',
	);
	claim(
		pixiErrors() === 2 && leftOut() === 2,
		`and nothing more is logged (driver errors ${pixiErrors()}, left out ${leftOut()})`,
	);
	claim(!gl.isContextLost(), 'the WebGL context is not lost');
	console.error = report;
	console.warn = warn;
	for (const [ok, label] of claims) if (!ok) console.error(`failsafe: ${label}`);
	page.failsafe = Object.fromEntries(claims.map(([ok, label]) => [label, ok]));
	page.rows = ['glsl broken | plain broken | good | plain | glsl broken again'];
	page.ready = true;
}

(async () => {
	const query = new URLSearchParams(location.search);
	const app = new Application();
	await app.init({
		width: 5 * CELL_W,
		height: CELL_H,
		background: 0x20232a,
		preference: 'webgl',
		preferWebGLVersion: query.get('gl') === '1' ? 1 : 2,
		antialias: false,
		autoStart: false,
		sharedTicker: false,
		resolution: 1,
		preserveDrawingBuffer: true,
	});
	document.body.appendChild(app.canvas);
	if (query.get('failsafe') === '1') await failSafe(app);
	else await bodies(app);
})();
