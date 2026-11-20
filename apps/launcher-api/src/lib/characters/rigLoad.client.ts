/**
 * A project rig loaded for Invisible Characters' preview, as the game loads one: the atlas text,
 * each page as a Pixi texture, and the skeleton through the runtime's own reader
 * (`engine-rig/pixi`). The files are named by `GET /api/characters/rig`, which also reads the
 * rig's facts; a rig it could not read has the facts of what was loaded here instead.
 *
 * Modelled on `routes/(app)/fx/fxRig.client.ts`: the pages are fetched and decoded by hand,
 * because Pixi's `Assets` picks a loader by a URL's extension and the streamer's URL has none.
 */
import * as RIG from 'engine-rig/pixi';
import { ImageSource, type TextureSource } from 'pixi.js';

import { rigFactsOfData } from './rigCost';
import type { RigFacts } from './rigFacts';

export interface LoadedRig {
	/** The rig's bundle name, as a sheet stores it. */
	name: string;
	data: RIG.SkeletonData;
	facts: RigFacts;
}

export interface RigLoader {
	/** The rig named, loaded once: a second call is handed the first one's. Rejects with a
	 *  sentence saying why it could not be loaded. */
	load(rig: string): Promise<LoadedRig>;
	/** Forget a rig loaded, so the next `load` of it reads it again (it was saved again in the
	 *  Rigger). Its textures are kept until `dispose`: a look may still draw them. */
	forget(rig: string): void;
	/** Free every texture loaded. Looks drawn from them must be destroyed first. */
	dispose(): void;
}

interface RigAnswer {
	found?: boolean;
	reason?: string;
	message?: string;
	facts?: RigFacts;
	descriptor?: {
		format: 'skel' | 'json';
		atlasText: string;
		skeletonUrl: string;
		pageNames: string[];
		pageUrls: string[];
	};
}

async function pageSource(url: string, premultiplied: boolean): Promise<TextureSource> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`One of its images could not be read (HTTP ${res.status}).`);
	const blob = await res.blob();
	// As Pixi's own image loader decodes one: a page that is already premultiplied is left as it is.
	const resource = await (premultiplied
		? createImageBitmap(blob, { premultiplyAlpha: 'none' })
		: createImageBitmap(blob));
	return new ImageSource({
		resource,
		alphaMode: premultiplied ? 'premultiplied-alpha' : 'premultiply-alpha-on-upload',
	});
}

/** A loader for the project the page is on; `projectKey` refuses a tab left on another project. */
export function createRigLoader(projectKey?: string): RigLoader {
	const loaded = new Map<string, Promise<LoadedRig>>();
	const sources: TextureSource[] = [];
	let disposed = false;

	async function read(rig: string): Promise<LoadedRig> {
		const params = new URLSearchParams({ name: rig });
		if (projectKey) params.set('projectKey', projectKey);
		const res = await fetch(`/api/characters/rig?${params.toString()}`);
		const answer = (await res.json().catch(() => ({}))) as RigAnswer;
		const { descriptor } = answer;
		if (!res.ok || !descriptor)
			throw new Error(
				answer.reason ?? answer.message ?? `The rig could not be read (HTTP ${res.status}).`,
			);

		const atlas = new RIG.TextureAtlas(descriptor.atlasText);
		const urlOf = new Map(descriptor.pageNames.map((name, i) => [name, descriptor.pageUrls[i]]));
		for (const page of atlas.pages) {
			const url = urlOf.get(page.name);
			if (!url)
				throw new Error(`Its atlas names the image "${page.name}", which it does not have.`);
			const source = await pageSource(url, page.pma);
			if (disposed) {
				source.destroy();
				throw new Error('The preview was closed.');
			}
			sources.push(source);
			page.setTexture(RIG.RigPageTexture.from(source));
		}

		const file = await fetch(descriptor.skeletonUrl);
		if (!file.ok) throw new Error(`Its skeleton could not be read (HTTP ${file.status}).`);
		const loader = new RIG.AtlasAttachmentLoader(atlas);
		const data =
			descriptor.format === 'skel'
				? new RIG.SkeletonBinary(loader).readSkeletonData(new Uint8Array(await file.arrayBuffer()))
				: new RIG.SkeletonJson(loader).readSkeletonData(await file.text());
		return { name: rig, data, facts: answer.facts ?? rigFactsOfData(rig, data) };
	}

	return {
		load(rig) {
			let pending = loaded.get(rig);
			if (!pending) {
				pending = read(rig);
				loaded.set(rig, pending);
				// A rig that failed is asked for again the next time, not remembered as failed.
				pending.catch(() => {
					if (loaded.get(rig) === pending) loaded.delete(rig);
				});
			}
			return pending;
		},
		forget(rig) {
			loaded.delete(rig);
		},
		dispose() {
			disposed = true;
			loaded.clear();
			for (const source of sources.splice(0)) source.destroy();
		},
	};
}
