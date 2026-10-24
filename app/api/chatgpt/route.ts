import { chatGPTStatus, startChatGPTLogin, disconnectChatGPT } from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
	try { return Response.json(chatGPTStatus(), { headers: { "Cache-Control": "no-store" } }); }
	catch { return Response.json({ error: "Could not read ChatGPT credentials" }, { status: 500 }); }
}

async function mutate(request: Request, disconnect = false) {
	// Next's internal URL can use localhost while the browser uses 127.0.0.1.
	const url = new URL(request.url);
	const origin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
	if (request.headers.get("origin") !== origin) {
		return Response.json({ error: "Same-origin request required" }, { status: 403 });
	}
	try {
		if (disconnect) return Response.json(await disconnectChatGPT());
		const body: unknown = await request.json();
		if (!body || typeof body !== "object" || Array.isArray(body) ||
			("code" in body && (typeof body.code !== "string" || body.code.length > 8192))) {
			return Response.json({ error: "Expected an optional redirect URL" }, { status: 400 });
		}
		return Response.json(await startChatGPTLogin("code" in body ? body.code as string : undefined));
	} catch { return Response.json({ error: "ChatGPT connection failed. Retry sign-in." }, { status: 400 }); }
}

export async function POST(request: Request) { return mutate(request); }
export async function DELETE(request: Request) { return mutate(request, true); }
