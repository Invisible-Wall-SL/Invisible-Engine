import type { RigFacts, RigFactsByName } from '$lib/characters/rigFacts';
import type { LoadedRig, RigLoader } from '$lib/characters/rigLoad.client';

/**
 * What `/characters` has read of the project's rigs, for a sheet whose source is a rig
 * (`docs/design/character-pipeline.md` step C6b): each rig's facts (its animations, skins, bones
 * and cost) by bundle name, asked for the first time a sheet names it
 * (`GET /api/characters/rig`), and the rig itself for the preview (`rigLoad.client.ts`, fetched
 * with the runtime only when a preview draws). Reads only. A rig not read yet is in neither
 * `facts` nor `failed`: the cards say "reading…", not "nothing plays".
 */
export class RigRead {
	facts = $state.raw<RigFactsByName>({});
	/** Why a rig could not be read, by name. */
	failed = $state.raw<Readonly<Record<string, string>>>({});
	readonly #asked = new Set<string>();
	#loader: Promise<RigLoader> | undefined;
	#gone = false;

	constructor(private readonly projectKey: string) {}

	/** Read the facts of each rig named that was not asked for yet. */
	want(names: readonly string[]): void {
		for (const name of names) {
			if (!name || this.#asked.has(name)) continue;
			this.#asked.add(name);
			void this.#read(name);
		}
	}

	/** Ask again for a rig that could not be read. */
	again(name: string): void {
		this.#asked.delete(name);
		this.failed = Object.fromEntries(Object.entries(this.failed).filter(([n]) => n !== name));
		this.want([name]);
	}

	async #read(name: string): Promise<void> {
		const fail = (why: string): void => {
			this.failed = { ...this.failed, [name]: why };
		};
		try {
			const params = new URLSearchParams({ name });
			if (this.projectKey) params.set('projectKey', this.projectKey);
			const res = await fetch(`/api/characters/rig?${params.toString()}`);
			const out = (await res.json().catch(() => ({}))) as {
				facts?: RigFacts;
				reason?: string;
				message?: string;
			};
			if (out.facts) this.facts = { ...this.facts, [name]: out.facts };
			else fail(out.reason ?? out.message ?? `The rig could not be read (HTTP ${res.status}).`);
		} catch {
			fail('The rig could not be read (network error).');
		}
	}

	/** The rig loaded for a preview, once; the runtime and Pixi are fetched with the first. */
	readonly load = async (rig: string): Promise<LoadedRig> => {
		this.#loader ??= import('$lib/characters/rigLoad.client').then((module) => {
			const loader = module.createRigLoader(this.projectKey || undefined);
			if (this.#gone) loader.dispose();
			return loader;
		});
		return (await this.#loader).load(rig);
	};

	/** Free what the previews loaded. Call when the page goes. */
	dispose(): void {
		this.#gone = true;
		void this.#loader?.then((loader) => loader.dispose());
	}
}
