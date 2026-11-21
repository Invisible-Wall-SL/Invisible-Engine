// "Click 💾 Save and wait for that save", for the browser spikes on the Rigger's view.html.
//
// A save is not over when it posts, nor when it sets an ETag: it still reads the rig list back
// before it clears `saveToR2.busy`, and while busy a second save is dropped. A spike that waits on
// a post, an ETag or a fixed time and then saves again, or reads what was sent, flakes on a loaded
// runner. This clicks the real button and resolves when the save it started has finished, refused
// or failed. The button calls `saveToR2` by name, so for the click the name answers a Proxy of it
// that keeps the promise; the Proxy forwards `saveToR2.busy` to the real function.
//
//   await evaluate(CLICK_SAVE);
export const CLICK_SAVE = `(() => {
	const real = saveToR2;
	let saving = null;
	saveToR2 = new Proxy(real, { apply: (f, self, args) => (saving = Reflect.apply(f, self, args)) });
	try { document.getElementById("saveBtn").click(); } finally { saveToR2 = real; }
	return saving ? saving.then(() => true) : true;
})()`;
