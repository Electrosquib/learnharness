import { readStudy, updateStudy, uploadHomework, startStudyLesson, limitedBody } from "@/src/server";
import { connectLamaku, syncLamaku } from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
	try { return Response.json(readStudy(), { headers: { "Cache-Control": "no-store" } }); }
	catch { return Response.json({ error: "Could not read the study record" }, { status: 500 }); }
}

export async function POST(request: Request) {
	const url = new URL(request.url);
	if (request.headers.get("origin") !== `${url.protocol}//${request.headers.get("host") ?? url.host}`) return Response.json({ error: "Same-origin request required" }, { status: 403 });
	try {
		const multipart = request.headers.get("content-type")?.includes("multipart/form-data");
		const bytes = await limitedBody(request, multipart ? 21 * 1024 * 1024 : 64 * 1024);
		if (multipart) {
			if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) throw new Error("Upload at most 20 MB.");
			const form = await new Request(request.url, { method: "POST", headers: request.headers, body: bytes }).formData();
			const file = form.get("file");
			if (!(file instanceof File)) throw new Error("Choose a homework file.");
			const due = form.get("due");
			const material = await uploadHomework(file, typeof due === "string" && due ? due : undefined);
			return Response.json({ state: readStudy(), materialId: material.id });
		}
		const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
		if (!body || typeof body !== "object" || !("action" in body)) throw new Error("Choose a study action.");
		const command = body as { action: unknown; selected?: unknown; autoTeach?: unknown; id?: unknown; prepared?: unknown };
		if (command.action === "connect") await connectLamaku();
		else if (command.action === "sync") await syncLamaku();
		else if (command.action === "configure") {
			if (!Array.isArray(command.selected) || !command.selected.every((id) => typeof id === "string") || typeof command.autoTeach !== "boolean") throw new Error("Choose courses and automatic teaching preference.");
			updateStudy((state) => ({ ...state, selected: (command.selected as string[]).filter((id) => state.courses.some((c) => c.id === id)), autoTeach: command.autoTeach as boolean }));
		} else if (command.action === "prepared") {
			if (typeof command.id !== "string" || typeof command.prepared !== "boolean") throw new Error("Choose a homework item.");
			updateStudy((state) => { const material = state.materials.find((m) => m.id === command.id); if (!material) throw new Error("Homework not found"); material.prepared = command.prepared as boolean; return state; });
		} else if (command.action === "lesson") {
			if (command.id !== undefined && typeof command.id !== "string") throw new Error("Invalid homework identifier");
			return Response.json({ state: readStudy(), lesson: startStudyLesson(command.id as string | undefined) });
		} else if (command.action === "bootstrap") {
			const state = readStudy();
			if (state.selected.length) {
				try { await syncLamaku(); }
				catch (error) { updateStudy((fresh) => ({ ...fresh, syncError: error instanceof Error ? error.message : "Lamakū sync failed" })); }
			}
			const fresh = readStudy();
			return Response.json({ state: fresh, lesson: fresh.autoTeach && !fresh.syncError ? startStudyLesson() : null });
		} else throw new Error("Unknown study action");
		return Response.json({ state: readStudy() });
	} catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Study action failed" }, { status: 400 }); }
}
