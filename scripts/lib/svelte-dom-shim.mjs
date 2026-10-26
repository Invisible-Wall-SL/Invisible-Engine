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
	cloneNode(deep) {
		const copy = new this.constructor(this.data);
		if (deep) for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
		return copy;
	}
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

/**
 * A component whose markup has several roots (`{#each}` beside `{@render}`) is cloned from a
 * `<template>` holding only anchors: `<!>` comments and the whitespace between them. Any real
 * element in one would mean a component draws DOM, which none of these gates expects.
 */
class Template extends Element {
	content = new DocumentFragment();
	set innerHTML(html) {
		const anchors = /<!(?:--([\s\S]*?)--)?>|([^<]+)/g;
		if (html.replace(anchors, ''))
			throw new Error(`svelte-dom-shim: a template with elements: ${html}`);
		this.content = new DocumentFragment();
		for (const [, comment, text] of html.matchAll(anchors)) {
			this.content.appendChild(text === undefined ? new Comment(comment ?? '') : new Text(text));
		}
	}
}

Object.assign(globalThis, {
	window: globalThis,
	Node,
	Element,
	Text,
	Comment,
	DocumentFragment,
	document: {
		createElement: (tag) => (tag === 'template' ? new Template() : new Element()),
		createTextNode: (data) => new Text(data),
		createComment: (data) => new Comment(data),
		createDocumentFragment: () => new DocumentFragment(),
		addEventListener() {},
		removeEventListener() {},
	},
});
