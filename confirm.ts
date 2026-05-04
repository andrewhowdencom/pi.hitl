export interface ConfirmResult {
	allowed: boolean;
	timedOut: boolean;
}

export async function confirmWithTimeout(
	ui: { confirm(title: string, message: string): Promise<boolean> },
	title: string,
	message: string,
	timeoutMs: number,
): Promise<ConfirmResult> {
	const timeoutPromise = new Promise<ConfirmResult>((resolve) => {
		setTimeout(() => resolve({ allowed: false, timedOut: true }), timeoutMs);
	});

	const confirmPromise = ui.confirm(title, message).then(
		(allowed) => ({ allowed, timedOut: false }),
	);

	return Promise.race([confirmPromise, timeoutPromise]);
}
