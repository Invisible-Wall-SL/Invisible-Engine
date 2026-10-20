// The DOM a MOUNTED Svelte component needs when nothing it renders is DOM: a tree of nodes for
// Svelte's anchors (the comments `{#if}`, `{#each}` and child components hang off), nothing drawn.
//
// Shared by the gates that compile a real `.svelte` file and mount it through Svelte's own client
// runtime and scheduler — the code path a browser runs — so a reactive loop or a stalled effect
// shows up the way it would in game (`verify-pot-meter-mount.mjs`, `check-cinematic-ticker.mjs`).
// A Pixi component renders no elements, so this is all of the document it reaches.

class Node {
	parentNode = null;
	childNodes = [];
	get firstChild() {
		return this.childNodes[0] ?? null;
	}
	get lastChild() {
		return this.childNodes.at(-1) ?? null;
	}
	get nextSibling() {
		const siblings = this.parentNode?.childNodes;
		return siblings ? (siblings[siblings.indexOf(this) + 1] ?? null) : null;
	}
	insertBefore(node, ref) {
		const nodes = node instanceof DocumentFragment ? [...node.childNodes] : [node];
		for (const child of nodes) {
			child.remove();
			const at = ref ? this.childNodes.indexOf(ref) : -1;
			this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, child);
			child.parentNode = this;
		}
		return node;
	}
	appendChild(node) {
		return this.insertBefore(node, null);
	}
	append(...nodes) {
		for (const node of nodes) this.insertBefore(node, null);
	}
	removeChild(node) {
		node.remove();
		return node;
	}
	before(...nodes) {
		for (const node of nodes) this.parentNode?.insertBefore(node, this);
	}
	after(...nodes) {
		const next = this.nextSibling;
		for (const node of nodes) this.parentNode?.insertBefore(node, next);
	}
	remove() {
		const siblings = this.parentNode?.childNodes;
		if (siblings) siblings.splice(siblings.indexOf(this), 1);
		this.parentNode = null;
	}
	set textContent(_) {
		for (const child of [...this.childNodes]) child.remove();
	}
	addEventListener() {}
	removeEventListener() {}
}
export class Element extends Node {}
class DocumentFragment extends Node {}
class CharacterData extends Node {
	constructor(data = '') {
		super();
		this.data = data;
	}
	get nodeValue() {
		return this.data;
	}
}
class Text extends CharacterData {}
class Comment extends CharacterData {}

Object.assign(globalThis, {
	window: globalThis,
	Node,
	Element,
	Text,
	Comment,
	DocumentFragment,
	document: {
		createElement: () => new Element(),
		createTextNode: (data) => new Text(data),
		createComment: (data) => new Comment(data),
		createDocumentFragment: () => new DocumentFragment(),
		addEventListener() {},
		removeEventListener() {},
	},
});
