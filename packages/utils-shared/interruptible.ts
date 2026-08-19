export const createInterruptible = () => {
	type ResolveArgs = { interrupted: boolean };
	type Resolve = (args: ResolveArgs) => void;

	let resolveList: Resolve[] = [];

	// This wait MUST always settle. It sits on the animation path (win count-ups, reel slides), and
	// every call site simply continues the sequence after it — so a promise that never settles is a
	// permanently stuck win presentation or a reel that never lands. A `targetToWait` that throws
	// therefore settles as NOT interrupted (the wait is over; nothing cut it short) and the error is
	// logged rather than swallowed. Rejecting instead would leave the sequence just as stuck — no
	// call site catches — only louder. The executor is deliberately NOT async: an async executor
	// drops the rejection on the floor and strands the promise forever.
	const add = (targetToWait: () => Promise<any>) =>
		new Promise<ResolveArgs>((resolve) => {
			resolveList.push(resolve);
			const settle = () => resolve({ interrupted: false });
			const onError = (error: unknown) =>
				console.error('[interruptible] wait failed, continuing as not interrupted:', error);
			try {
				targetToWait().catch(onError).then(settle, settle);
			} catch (error) {
				onError(error);
				settle();
			}
		});

	const clear = () => (resolveList = []);
	const getLength = () => resolveList.length;
	const interrupt = () => resolveList.forEach((resolve) => resolve({ interrupted: true }));

	return {
		add,
		clear,
		getLength,
		interrupt,
	};
};
