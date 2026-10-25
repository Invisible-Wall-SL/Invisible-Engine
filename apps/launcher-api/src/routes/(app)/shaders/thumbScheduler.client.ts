/**
 * When Invisible Shader Graph's node thumbnails draw (`/shaders`, design §8 step 7): what each
 * node's output looks like on the element, at the preview's `t` and strength, its params at their
 * defaults. What to draw is the pure model's (`probeDoc`, `probeKeys`, `liveThumbs` in
 * `shaderEditor.ts`); the drawing is `ThumbRenderer`'s, one WebGL context for every node;
 * `ShaderThumbs` is the page's handle on it. The cost is kept down:
 * - an edit is applied a quarter second after the last one, and only nodes whose probe changed
 *   (their key: the node and everything upstream) compile and draw again; compiled probes are kept
 *   by key and programs by GLSL, so an unchanged node never recompiles;
 * - while the playhead moves, thumbnails that read the time redraw five times a second at most;
 * - only thumbnails on screen draw, the {@link THUMB_LIVE_CAP} nearest the selection or the view's
 *   centre, each frame's work stopping after a few milliseconds; the rest keep their last picture;
 * - a node whose probe does not compile shows a neutral placeholder;
 * - turned off, the renderer and its context are freed.
 */
import { readCustomElementFx, type ElementFxParamSpec } from 'constants-shared/elementFx';
import {
	compileShaderEffect,
	type ShaderGraphAnalysis,
	type ShaderGraphDoc,
} from 'engine-shadergraph';
import type { PreviewBackground } from './shaderPreview.client';
import {
	THUMB_LIVE_CAP,
	liveThumbs,
	probeDoc,
	probeKeys,
	type GraphScope,
	type ThumbSpot,
} from './shaderEditor';
import {
	THUMB_PX,
	ThumbRenderer,
	type ThumbMoment,
	type ThumbProgram,
} from './shaderThumbs.client';

/** What the preview shows, which the thumbnails follow. */
export interface ThumbView {
	t: number;
	intensity: number;
	/** One play, for the seconds a posed effect reads. */
	durationMs: number;
	/** The atlas region on the element, else the sample card. */
	region: { manifestKey: string; name: string } | undefined;
	background: PreviewBackground;
}

/** What a node's canvas shows: `live` drawn now, `still` an earlier picture, `wait` none yet,
 *  `none` the placeholder of a probe that does not compile. */
export type ThumbState = 'live' | 'still' | 'wait' | 'none';

const EDIT_DEBOUNCE_MS = 250;
const VIEW_INTERVAL_MS = 200;
const FRAME_BUDGET_MS = 8;
const PROBES_KEPT = 600;

type Probe = ({ ok: true; timed: boolean } & ThumbProgram) | { ok: false };

const resolution = (): number => Math.min(2, Math.max(1, window.devicePixelRatio || 1));

export class ThumbScheduler {
	private enabled = true;
	/** No WebGL: it said so, and draws nothing. */
	private failed = false;

	private readonly canvases = new Map<string, HTMLCanvasElement>();
	private readonly ids = new WeakMap<Element, string>();
	private readonly visible = new Set<string>();
	private observer: IntersectionObserver | undefined;
	private viewport: MutationObserver | undefined;
	private pane: HTMLElement | undefined;
	private moved = 0;

	/** The doc last given to {@link update}, as given; {@link doc} is the copy being drawn. */
	private received: ShaderGraphDoc | null = null;
	private doc: ShaderGraphDoc | null = null;
	private analysis: ShaderGraphAnalysis | undefined;
	/** The graph the canvas shows: the effect's (`null`), or a subgraph's body. */
	private scope: GraphScope = null;
	private keys = new Map<string, string>();
	private params = new Map<string, ElementFxParamSpec>();
	private pending: {
		doc: ShaderGraphDoc | null;
		analysis: ShaderGraphAnalysis | undefined;
		scope: GraphScope;
	} | null = null;
	private editTimer: ReturnType<typeof setTimeout> | undefined;
	private selected = new Set<string>();

	private view: ThumbView = {
		t: 0,
		intensity: 1,
		durationMs: 1000,
		region: undefined,
		background: 'dark',
	};
	private moment: Omit<ThumbMoment, 'params'> = { t: 0, seconds: 0, intensity: 1 };
	private momentKey = '';
	private momentAt = 0;
	private viewTimer: ReturnType<typeof setTimeout> | undefined;
	private regionWanted = '';
	/** The element the renderer draws now: `sample`, or the region's key once loaded. */
	private elementShown = 'sample';

	private readonly probes = new Map<string, Probe>();
	private readonly drawn = new Map<string, string>();

	private renderer: ThumbRenderer | undefined;
	private starting = false;
	private frame = 0;
	private destroyed = false;
	private readonly onFrame = (): void => this.tick();

	/** `onFailure` hears once why nothing can draw (no WebGL). */
	constructor(private readonly onFailure: (message: string) => void) {}

	/** Draw, or stop and free the renderer and its context. */
	setEnabled(on: boolean): void {
		if (on === this.enabled) return;
		this.enabled = on;
		if (on) this.schedule();
		else this.stop();
	}

	/** Node `id`'s thumbnail canvas, drawn into while it is on screen; the result lets it go. */
	mount(id: string, canvas: HTMLCanvasElement): () => void {
		const size = Math.round(THUMB_PX * resolution());
		canvas.width = size;
		canvas.height = size;
		canvas.dataset.thumb = 'wait' satisfies ThumbState;
		this.canvases.set(id, canvas);
		this.ids.set(canvas, id);
		this.drawn.delete(id);
		this.watch(canvas);
		this.schedule();
		return () => {
			this.observer?.unobserve(canvas);
			if (this.canvases.get(id) !== canvas) return;
			this.canvases.delete(id);
			this.visible.delete(id);
			this.drawn.delete(id);
		};
	}

	/**
	 * The graph as edited, the analysis of what the canvas shows (`scope`: the effect, or a
	 * subgraph's body) and the selected nodes. Another graph or scope is applied at once; an edit to
	 * the same one after {@link EDIT_DEBOUNCE_MS} of quiet.
	 */
	update(
		doc: ShaderGraphDoc | null,
		analysis: ShaderGraphAnalysis | undefined,
		selected: readonly string[],
		scope: GraphScope = null,
	): void {
		if (this.destroyed) return;
		const picked = new Set(selected);
		if (picked.size !== this.selected.size || selected.some((id) => !this.selected.has(id))) {
			this.selected = picked;
			this.schedule();
		}
		if (doc === this.received && scope === (this.pending?.scope ?? this.scope)) return;
		this.received = doc;
		this.pending = { doc, analysis, scope };
		clearTimeout(this.editTimer);
		const another = !doc || !this.doc || doc.id !== this.doc.id || scope !== this.scope;
		if (another) this.applyPending();
		else this.editTimer = setTimeout(() => this.applyPending(), EDIT_DEBOUNCE_MS);
	}

	/** Follow the preview: its playhead and strength (at most every {@link VIEW_INTERVAL_MS} while
	 *  they move), its element and its backdrop. */
	setView(view: ThumbView): void {
		if (this.destroyed) return;
		this.view = view;
		const region = view.region ? `${view.region.manifestKey}\n${view.region.name}` : '';
		if (region !== this.regionWanted) {
			this.regionWanted = region;
			void this.showElement();
		}
		if (this.keyOf(view) === this.momentKey || this.viewTimer) return;
		const wait = this.momentAt + VIEW_INTERVAL_MS - performance.now();
		if (wait <= 0) this.applyView();
		else
			this.viewTimer = setTimeout(() => {
				this.viewTimer = undefined;
				this.applyView();
			}, wait);
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		clearTimeout(this.editTimer);
		clearTimeout(this.viewTimer);
		clearTimeout(this.moved);
		this.stop();
		this.observer?.disconnect();
		this.viewport?.disconnect();
		this.canvases.clear();
	}

	private keyOf(view: ThumbView): string {
		return `${view.t}|${view.intensity}|${view.durationMs}`;
	}

	private applyView(): void {
		const { t, intensity } = this.view;
		// A graph that does not compile leaves the preview without a length: the doc has one.
		const durationMs = this.view.durationMs || this.doc?.durationMs || 1000;
		this.momentKey = this.keyOf(this.view);
		this.moment = { t, seconds: (t * durationMs) / 1000, intensity };
		this.momentAt = performance.now();
		this.schedule();
	}

	/** The graph to draw from now on: a copy, its probes' keys, its params. */
	private applyPending(): void {
		const next = this.pending;
		this.pending = null;
		if (!next) return;
		// A copy: the page's doc is reactive state, and this one is read every frame.
		this.doc = next.doc ? (JSON.parse(JSON.stringify(next.doc)) as ShaderGraphDoc) : null;
		this.analysis = next.analysis;
		this.scope = next.scope;
		this.keys = this.doc ? probeKeys(this.doc, this.scope) : new Map();
		this.params = new Map((this.doc?.params ?? []).map((p) => [p.id, p]));
		this.schedule();
	}

	private watch(canvas: HTMLCanvasElement): void {
		this.observer ??= new IntersectionObserver((entries) => {
			for (const entry of entries) {
				const id = this.ids.get(entry.target);
				if (!id) continue;
				if (entry.isIntersecting) this.visible.add(id);
				else this.visible.delete(id);
			}
			this.schedule();
		});
		this.observer.observe(canvas);
		const pane = canvas.closest<HTMLElement>('.svelte-flow') ?? undefined;
		if (!pane || pane === this.pane) return;
		this.pane = pane;
		this.viewport?.disconnect();
		// A pan or zoom with every thumbnail still on screen changes which are nearest the centre.
		const moving = pane.querySelector('.svelte-flow__viewport');
		if (!moving) return;
		this.viewport = new MutationObserver(() => {
			if (this.moved) return;
			this.moved = window.setTimeout(() => {
				this.moved = 0;
				this.schedule();
			}, VIEW_INTERVAL_MS);
		});
		this.viewport.observe(moving, { attributes: true, attributeFilter: ['style'] });
	}

	private schedule(): void {
		if (this.frame || this.destroyed || !this.enabled) return;
		this.frame = requestAnimationFrame(this.onFrame);
	}

	/** Free the renderer; the canvases keep their pictures until drawn again. */
	private stop(): void {
		if (this.frame) cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.renderer?.destroy();
		this.renderer = undefined;
		this.drawn.clear();
	}

	private start(): void {
		if (this.starting || this.failed) return;
		this.starting = true;
		ThumbRenderer.create(resolution()).then(
			(made) => {
				this.starting = false;
				if (this.destroyed || !this.enabled || this.renderer) {
					made.destroy();
					return;
				}
				this.renderer = made;
				this.elementShown = 'sample';
				this.drawn.clear();
				void this.showElement();
				this.schedule();
			},
			() => {
				this.starting = false;
				this.failed = true;
				this.onFailure('Thumbnails need WebGL, which this browser did not provide.');
			},
		);
	}

	/** Put the preview's element on the renderer: the card at once, a region once loaded. */
	private async showElement(): Promise<void> {
		const renderer = this.renderer;
		const wanted = this.regionWanted;
		if (!renderer) return;
		if (!wanted) {
			renderer.useSampleCard();
			this.elementShown = 'sample';
			this.schedule();
			return;
		}
		const [manifestKey, name] = wanted.split('\n');
		let shown = wanted;
		try {
			if (!(await renderer.useRegion(manifestKey, name))) return;
		} catch {
			shown = 'sample';
		}
		if (renderer !== this.renderer) return;
		this.elementShown = shown;
		this.schedule();
	}

	/** The compiled probe of node `id` under `key`: kept by key, so an unchanged node reuses it. */
	private probe(id: string, key: string): Probe {
		const hit = this.probes.get(key);
		if (hit) {
			this.probes.delete(key);
			this.probes.set(key, hit);
			return hit;
		}
		const made = this.doc ? probeDoc(this.doc, id, this.analysis, this.scope) : undefined;
		const compiled = made ? compileShaderEffect(made.doc) : undefined;
		// The runtime's own reader: a probe the game would refuse draws nothing here either.
		const effect = compiled?.ok ? readCustomElementFx(compiled.effect) : undefined;
		const body = effect?.shader.body ?? '';
		const probe: Probe = effect
			? {
					ok: true,
					body,
					uniforms: effect.shader.uniforms,
					timed: /\buFx\b/.test(body.slice(body.indexOf('void main'))),
				}
			: { ok: false };
		this.probes.set(key, probe);
		if (this.probes.size > PROBES_KEPT) this.probes.delete(this.probes.keys().next().value ?? '');
		return probe;
	}

	/** The thumbnails to keep live: on screen, nearest the selection or the view's centre. */
	private liveIds(): string[] {
		const frame = this.pane?.getBoundingClientRect();
		const centre = frame
			? { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 }
			: { x: 0, y: 0 };
		const spots: ThumbSpot[] = [];
		for (const [id, canvas] of this.canvases) {
			if (!this.visible.has(id) || !this.keys.has(id)) continue;
			const r = canvas.getBoundingClientRect();
			spots.push({ id, x: r.left + r.width / 2, y: r.top + r.height / 2, visible: true });
		}
		return liveThumbs(spots, centre, this.selected, THUMB_LIVE_CAP);
	}

	/** One frame's work: draw what changed among the live thumbnails, within the frame's budget. */
	private tick(): void {
		this.frame = 0;
		if (!this.enabled || this.destroyed || !this.doc || !this.canvases.size) return;
		const renderer = this.renderer;
		if (!renderer) {
			this.start();
			return;
		}
		const began = performance.now();
		const live = this.liveIds();
		const kept = new Set(live);
		for (const [id, canvas] of this.canvases) {
			if (!kept.has(id))
				canvas.dataset.thumb = (this.drawn.has(id) ? 'still' : 'wait') satisfies ThumbState;
		}
		renderer.setPadding(this.doc.padding ?? 0);
		const moment: ThumbMoment = { ...this.moment, params: this.params };
		const scene = `${this.elementShown}|${this.doc.padding ?? 0}`;
		let unfinished = false;
		for (const id of live) {
			if (performance.now() - began > FRAME_BUDGET_MS) {
				unfinished = true;
				break;
			}
			const canvas = this.canvases.get(id) as HTMLCanvasElement;
			const key = this.keys.get(id) as string;
			const probe = this.probe(id, key);
			const want = probe.ok
				? `${key}|${scene}|${probe.timed ? this.momentKey : ''}`
				: `none|${key}`;
			if (this.drawn.get(id) !== want) {
				if (probe.ok) renderer.draw(probe, moment, canvas);
				else canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
				this.drawn.set(id, want);
			}
			canvas.dataset.thumb = (probe.ok ? 'live' : 'none') satisfies ThumbState;
		}
		if (unfinished) this.schedule();
		else if (renderer.worn) {
			// A fresh context frees the programs this one compiled; the pictures stay till redrawn.
			this.stop();
			this.schedule();
		}
	}
}
