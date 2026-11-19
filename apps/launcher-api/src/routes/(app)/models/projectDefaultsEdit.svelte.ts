/**
 * One edit session over the project's defaults per model class: the Game Config's `models` block,
 * edited from the Invisible Model Viewer's "Game Config defaults" card.
 *
 * The block is one key of the whole Game Config, which `/config` and `/characters` edit under the
 * `gameConfig` lease. So that lease is taken only while a session is open ({@link begin} to
 * {@link end}): held for as long as the page is, it would lock both tools for everyone while an
 * artist only looks at models. A session reads the doc fresh, edits a draft of the block, and
 * saves the doc it loaded with that one key swapped, by compare-and-swap on the ETag it loaded.
 * It never creates a Game Config and never forces a save.
 *
 * MUST stay `.svelte.ts`: the runes below are compiler transforms.
 */
import type { ModelClass, ModelLodScreenSize } from 'constants-shared/modelTiers';
import { LeaseState } from '$lib/leaseState.svelte';
import type { InheritedModelSettings, TierOverrides } from '$lib/models/modelProfile';
import {
	classDefaultsOf,
	inheritedFromBlock,
	modelsBlockOf,
	rebaseModelsBlock,
	setClassScreenSize,
	setClassTiers,
	withModelsBlock,
	type ClassDefaults,
} from '$lib/models/projectDefaults';
import { SaveState } from '$lib/saveState.svelte';
import type { GameConfigModels } from '$lib/server/modelConfig';
import { fetchGameConfig, putGameConfig, type GameConfigBody } from './models.client';

/** The Game Config is one doc per project: its lease's `docKey` is the tool id, as on `/config`. */
const LEASE_DOC = 'gameConfig';

const same = (a: unknown, b: unknown): boolean =>
	JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface ProjectDefaultsEditOptions {
	clientKey: string;
	projectKey: string;
	/** False when the user does not hold Invisible Game Config: nothing here then does anything. */
	enabled: boolean;
	/**
	 * The store holds `block`: read as a session opened or reloaded, or just saved (`saved`). The
	 * page follows it. Awaited with the session's controls off, so it must not reject.
	 */
	onStored: (block: GameConfigModels | undefined, saved: boolean) => Promise<void>;
}

export class ProjectDefaultsEdit {
	readonly lease: LeaseState;
	readonly saveState: SaveState;
	/** The class the card shows. */
	cls = $state<ModelClass>('prop');

	#opts: ProjectDefaultsEditOptions;
	#editing = $state(false);
	/** A lease switch, a read of the Game Config or a save with its follow-up is in flight. */
	#busy = $state(false);
	#missing = $state(false);
	#error = $state('');
	/** The Game Config as loaded: what a save sends back with its `models` key swapped. */
	#doc = $state.raw<GameConfigBody | null>(null);
	#stored = $state.raw<GameConfigModels | undefined>(undefined);
	#draft = $state.raw<GameConfigModels | undefined>(undefined);
	#dirty = $derived(this.#editing && !same(this.#draft, this.#stored));
	#disposed = false;

	constructor(opts: ProjectDefaultsEditOptions) {
		this.#opts = opts;
		this.lease = new LeaseState({
			toolId: 'gameConfig',
			clientKey: opts.clientKey,
			projectKey: opts.projectKey,
			docKey: '',
			enabled: opts.enabled,
		});
		this.saveState = new SaveState({
			blockWhen: () => this.lease.readOnly,
			save: async ({ baseEtag }) => {
				const doc = this.#doc;
				if (!doc || !baseEtag)
					return {
						ok: false,
						reason: 'error',
						message: 'The Game Config is not loaded. Press Done, then edit again.',
					};
				const answer = await putGameConfig(
					opts.projectKey,
					withModelsBlock(doc, this.#draft),
					baseEtag,
				);
				if (!answer.ok)
					return {
						ok: false,
						reason: answer.conflict ? 'conflict' : 'error',
						message: answer.message,
					};
				// The draft becomes the block the server kept: a value it dropped is gone from the page.
				this.#doc = answer.doc;
				this.#stored = modelsBlockOf(answer.doc);
				this.#draft = this.#stored;
				return { ok: true, etag: answer.etag };
			},
		});
	}

	/** A session is open: the Game Config is loaded and the card shows its draft of the block. */
	get editing(): boolean {
		return this.#editing;
	}
	get busy(): boolean {
		return this.#busy;
	}
	/** The last {@link begin} found no Game Config to edit. */
	get missing(): boolean {
		return this.#missing;
	}
	/** Why the Game Config could not be read. */
	get error(): string {
		return this.#error;
	}
	/** Someone else holds the Game Config: the session shows the stored block, read-only. */
	get readOnly(): boolean {
		return this.lease.readOnly;
	}
	get canEdit(): boolean {
		return this.#editing && !this.#busy && !this.lease.readOnly && !this.saveState.busy;
	}
	get dirty(): boolean {
		return this.#dirty;
	}
	/** The block as edited, saved or not. */
	get draft(): GameConfigModels | undefined {
		return this.#draft;
	}
	/** What the draft sets for the class shown. */
	get own(): ClassDefaults {
		return classDefaultsOf(this.#draft, this.cls);
	}
	/** What the class shown inherits under the draft: its entry over the code defaults. */
	get layer(): InheritedModelSettings {
		return inheritedFromBlock(this.cls, this.#draft);
	}

	/**
	 * The unsaved draft changes what a model of `cls` derives. Only its tiers count: the screen
	 * sizes change when a level draws, not a derived byte.
	 */
	changesDeriveOf(cls: ModelClass): boolean {
		return (
			this.#dirty &&
			!same(inheritedFromBlock(cls, this.#draft).tiers, inheritedFromBlock(cls, this.#stored).tiers)
		);
	}

	/**
	 * Open a session showing `cls`: take the Game Config lease, then read the doc fresh. With no
	 * Game Config, or one that cannot be read, the lease is given back and no session opens.
	 */
	async begin(cls: ModelClass): Promise<void> {
		if (!this.#opts.enabled || this.#editing || this.#busy || this.#disposed) return;
		this.#busy = true;
		this.#missing = false;
		this.cls = cls;
		try {
			await this.lease.switchDoc(LEASE_DOC);
			// The page may have gone while the lease was asked for: it is given back below.
			const read = this.#disposed ? 'failed' : await this.#read(false);
			if (read !== 'ok' || this.#disposed) {
				await this.#close();
				return;
			}
			this.#editing = true;
			await this.#opts.onStored(this.#stored, false);
		} finally {
			this.#busy = false;
		}
	}

	/** Close the session and give the lease back. The caller asks first when {@link dirty}. */
	async end(): Promise<void> {
		if (!this.#editing || this.#busy) return;
		this.#busy = true;
		this.#error = '';
		try {
			await this.#close();
		} finally {
			this.#busy = false;
		}
	}

	/**
	 * Read the Game Config again, after someone else saved it. `keepDraft` carries what this
	 * session changed onto their block (`rebaseModelsBlock`), unsaved: the next save writes it into
	 * THEIR doc, and what they changed in a class this session left alone stays theirs.
	 */
	async reload(keepDraft: boolean): Promise<void> {
		if (!this.#editing || this.#busy) return;
		this.#busy = true;
		try {
			// A Game Config that is gone or unreadable now leaves the session open with its draft.
			const read = await this.#read(keepDraft);
			if (read === 'missing')
				this.#error =
					'The Game Config can no longer be read, so nothing was loaded. Your defaults are still here; open Invisible Game Config to see what happened to it.';
			else if (read === 'ok') await this.#opts.onStored(this.#stored, false);
		} finally {
			this.#busy = false;
		}
	}

	/** Save the loaded Game Config with the draft as its `models` block. */
	async save(): Promise<void> {
		if (!this.canEdit || !this.#dirty) return;
		this.#busy = true;
		try {
			if (await this.saveState.save()) await this.#opts.onStored(this.#stored, true);
		} finally {
			this.#busy = false;
		}
	}

	setTiers(tiers: TierOverrides | undefined): void {
		if (this.canEdit) this.#draft = setClassTiers(this.#draft, this.cls, tiers);
	}
	setScreenSize(size: ModelLodScreenSize | undefined): void {
		if (this.canEdit) this.#draft = setClassScreenSize(this.#draft, this.cls, size);
	}
	/** Back to the code defaults for everything the class shown sets. */
	clearClass(): void {
		if (!this.canEdit) return;
		this.#draft = setClassScreenSize(
			setClassTiers(this.#draft, this.cls, undefined),
			this.cls,
			undefined,
		);
	}

	/** The page is hidden or unloading: give the lease back now. Expiry is the backstop. */
	release(): void {
		this.lease.release();
	}

	/** The page is gone. A lease still being asked for is given back when it lands. */
	dispose(): void {
		this.#disposed = true;
		this.lease.release();
	}

	async #read(keepDraft: boolean): Promise<'ok' | 'missing' | 'failed'> {
		this.#error = '';
		let found: Awaited<ReturnType<typeof fetchGameConfig>>;
		try {
			found = await fetchGameConfig(this.#opts.projectKey);
		} catch (e) {
			const why = e instanceof Error ? e.message : 'network error';
			this.#error = `The Game Config could not be read (${why}).`;
			return 'failed';
		}
		if (!found.doc || !found.etag) {
			// Only an opening session says "no Game Config": one that is open keeps its draft.
			this.#missing = !this.#editing;
			return 'missing';
		}
		const before = this.#stored;
		this.#doc = found.doc;
		this.#stored = modelsBlockOf(found.doc);
		this.#draft = keepDraft ? rebaseModelsBlock(before, this.#draft, this.#stored) : this.#stored;
		this.saveState.adoptEtag(found.etag);
		return 'ok';
	}

	async #close(): Promise<void> {
		this.#editing = false;
		this.#doc = null;
		this.#stored = undefined;
		this.#draft = undefined;
		this.saveState.adoptEtag(null);
		await this.lease.switchDoc(null);
	}
}
