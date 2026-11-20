import type { FlipbookClip } from 'engine-flipbook';
import type { SceneProjection } from 'engine-layout';
import { singleFlight } from '$lib/characters/singleFlight';
import type { WholeComponent } from '$lib/characters/characterWhole';

/**
 * What `/characters` reads beside the config it holds, once for both of its views
 * (`GET /api/characters/whole`): the components a character can be drawn as with their clip
 * blocks, every clip id of the project, each clip under a character's prefix in full, and the
 * projections of the project's screens, and the project's rigs by bundle name. A read only; the clips are chosen by the STORED config.
 */
export class WholeRead {
	components = $state.raw<WholeComponent[]>([]);
	clipIds = $state.raw<string[]>([]);
	clips = $state.raw<FlipbookClip[]>([]);
	projections = $state.raw<SceneProjection[]>([]);
	/** The project's rigs a sheet can name, and why they could not be listed. */
	rigs = $state.raw<{ name: string; shared: boolean }[]>([]);
	rigsError = $state('');
	loading = $state(false);
	error = $state('');
	/** The first read is in; a later one keeps what is on screen until it lands. */
	read = $state(false);

	readonly clipById = $derived(Object.fromEntries(this.clips.map((c) => [c.id, c])));

	constructor(private readonly projectKey: string) {}

	/** Read again. A call during a read is not dropped: it reruns once when that read lands, and
	 *  settles with the rerun (`singleFlight`). */
	readonly load = singleFlight(() => this.#read());

	async #read(): Promise<void> {
		this.loading = true;
		this.error = '';
		try {
			const tab = this.projectKey ? `?projectKey=${encodeURIComponent(this.projectKey)}` : '';
			const res = await fetch(`/api/characters/whole${tab}`);
			if (!res.ok) {
				const out = (await res.json().catch(() => ({}))) as { message?: string };
				this.error = out.message ?? `Could not read the characters (HTTP ${res.status}).`;
				return;
			}
			const out = (await res.json()) as {
				components: WholeComponent[];
				clipIds: string[];
				clips: FlipbookClip[];
				projections: SceneProjection[];
				rigs?: { name: string; shared: boolean }[];
				rigsError?: string;
			};
			this.components = out.components;
			this.clipIds = out.clipIds;
			this.clips = out.clips;
			this.projections = out.projections;
			this.rigs = out.rigs ?? [];
			this.rigsError = out.rigsError ?? '';
			this.read = true;
		} catch {
			this.error = 'Could not read the characters (network error).';
		} finally {
			this.loading = false;
		}
	}
}
