/** Bound streamed uploads too: Content-Length is optional and cannot be trusted. */
export async function limitedBody(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
	const reader = request.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = []; let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) { await reader.cancel(); throw new RangeError("Request exceeds the upload size limit."); }
			chunks.push(value);
		}
	} finally { reader.releaseLock(); }
	const result = new Uint8Array(size); let offset = 0;
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
	return result;
}
