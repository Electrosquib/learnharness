import { warmWhisper } from "@/src/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The existing warm-up URL now starts a local model; no token or cloud request. */
export async function GET() {
	try { return Response.json(await warmWhisper(), { headers: { "Cache-Control": "no-store" } }); }
	catch (error) { return Response.json({ message: error instanceof Error ? error.message : "Local speech is unavailable" }, { status: 503 }); }
}
