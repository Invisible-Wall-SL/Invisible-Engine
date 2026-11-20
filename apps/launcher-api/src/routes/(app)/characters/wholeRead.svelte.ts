import type { FlipbookClip } from 'engine-flipbook';
import type { SceneProjection } from 'engine-layout';
import type { PickSheet } from '$lib/pickSheets';
import { singleFlight } from '$lib/characters/singleFlight';
import type { WholeComponent } from '$lib/characters/characterWhole';
import { fetchRegions, type RegionSet } from '../editor/editorRegions.client';

/**
 * What `/characters` reads beside the config it holds, once for both of its views
 * (`GET /api/characters/whole`): the components a character can be drawn as with their clip
 * blocks, every clip id of the project, each clip under a character's prefix in full, and the
 * projections of the project's screens, the project's rigs by bundle name, and its atlases and
 * sheets by manifest key (what a still image is picked from). A read only; the clips are chosen
 * by the STORED config.
 */
export class WholeRead {
	components = $state.raw<WholeComponent[]>([]);
	clipIds = $state.raw<string[]>([]);
	clips = $state.raw<FlipbookClip[]>([]);
	projections = $state.raw<SceneProjection[]>([]);
	/** The project's rigs a sheet can name, and why they could not be listed. */
	rigs = $state.raw<{ name: string; shared: boolean }[]>([]);
	rigsError = $state('');
	/** The project's atlases and sheets a still image is picked from, and why they could not be
	 *  listed. */
	sheets = $state.raw<PickSheet[]>([]);
	sheetsError = $state('');
	loading = $state(false);
	error = $state('');
	/** The first read is in; a later one keeps what is on screen until it lands. */
	read = $state(false);

	readonly clipById = $derived(Object.fromEntries(this.clips.map((c) => [c.id, c])));

	constructor(private readonly projectKey: string) {}

	/** The frames of one of `sheets`, by its key (`GET /api/editor/regions`, cached for the
	 *  session as the region picker caches it). */
	readonly regionsOf = (sheetKey: string): Promise<RegionSet> => fetchRegions(sheetKey);

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
				sheets?: PickSheet[];
				sheetsError?: string;
			};
			this.components = out.components;
			this.clipIds = out.clipIds;
			this.clips = out.clips;
			this.projections = out.projections;
			this.rigs = out.rigs ?? [];
			this.rigsError = out.rigsError ?? '';
			this.sheets = out.sheets ?? [];
			this.sheetsError = out.sheetsError ?? '';
			this.read = true;
		} catch {
			this.error = 'Could not read the characters (network error).';
		} finally {
			this.loading = false;
		}
	}
}
