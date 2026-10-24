import { transcribeLocal, limitedBody } from "@/src/server";
export const runtime = "nodejs";

export async function POST(request: Request) {
	const url = new URL(request.url);
	if (request.headers.get("origin") !== `${url.protocol}//${request.headers.get("host") ?? url.host}`) return Response.json({ error: "Same-origin request required" }, { status: 403 });
	if (Number(request.headers.get("content-length")) > 640_000) return Response.json({ error: "Audio chunk is too long" }, { status: 413 });
	try {
		const bytes = await limitedBody(request, 640_000);
		if (!bytes.length || bytes.length % 2) return Response.json({ error: "Expected 16 kHz mono PCM16 audio" }, { status: 400 });
		return Response.json({ text: await transcribeLocal(Buffer.from(bytes)) });
	} catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Local transcription failed" }, { status: error instanceof RangeError ? 413 : 503 }); }
}
