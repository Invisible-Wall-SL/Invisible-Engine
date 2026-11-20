import type { RigFacts, RigFactsByName } from '$lib/characters/rigFacts';
import type { LoadedRig, RigLoader } from '$lib/characters/rigLoad.client';

/**
 * What `/characters` has read of the project's rigs, for a sheet whose source is a rig
 * (`docs/design/character-pipeline.md` step C6b): each rig's facts (its animations, skins, bones
 * and cost) by bundle name, asked for the first time a sheet names it
 * (`GET /api/characters/rig`), and the rig itself for the preview (`rigLoad.client.ts`, fetched
 * with the runtime only when a preview draws). Reads only. A rig not read yet is in neither
 * `facts` nor `failed`: the cards say "reading…", not "nothing plays". What is read is kept for
 * the page's life, until `again` asks for it anew (a rig saved again in the Rigger).
 */
export class RigRead {
	facts = $state.raw<RigFactsByName>({});
	/** Why a rig could not be read, by name. */
	failed = $state.raw<Readonly<Record<string, string>>>({});
	/** The rigs asked for, so each is read once. Not reactive: nothing is drawn from it. */
	#asked: Record<string, true> = {};
	#loader: Promise<RigLoader> | undefined;
	#gone = false;

	constructor(private readonly projectKey: string) {}

	/** Read the facts of each rig named that was not asked for yet. */
	want(names: readonly string[]): void {
		for (const name of names) {
			if (!name || Object.hasOwn(this.#asked, name)) continue;
			this.#asked[name] = true;
			void this.#read(name);
		}
	}

	/** Read a rig again, or every rig read so far: its facts, and the rig itself the next time a
	 *  preview draws it. What is on screen stays until the new read lands. */
	again(name?: string): void {
		const names = name ? [name] : Object.keys({ ...this.facts, ...this.failed });
		for (const rig of names) delete this.#asked[rig];
		this.failed = Object.fromEntries(
			Object.entries(this.failed).filter(([n]) => !names.includes(n)),
		);
		void this.#loader?.then((loader) => names.forEach((rig) => loader.forget(rig)));
		this.want(names);
	}

	async #read(name: string): Promise<void> {
		const fail = (why: string): void => {
			this.facts = Object.fromEntries(Object.entries(this.facts).filter(([n]) => n !== name));
			this.failed = { ...this.failed, [name]: why };
		};
		try {
			const tab = this.projectKey ? `&projectKey=${encodeURIComponent(this.projectKey)}` : '';
			const res = await fetch(`/api/characters/rig?name=${encodeURIComponent(name)}${tab}`);
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
