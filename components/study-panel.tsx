"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { studyPriorities, studyReason, type StudyState } from "@/src/core";

export function StudyPanel({ configured }: { configured: boolean }) {
	const [open, setOpen] = useState(false);
	const [state, setState] = useState<StudyState>();
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState("");
	const file = useRef<HTMLInputElement>(null);
	const router = useRouter();
	async function request(body: FormData | Record<string, unknown>) {
		setBusy(true); setError("");
		try {
			const response = await fetch("/api/study", body instanceof FormData ? { method: "POST", body } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
			const result = await response.json() as { state?: StudyState; error?: string; materialId?: string; lesson?: { chatId: string } };
			if (!response.ok) throw new Error(result.error ?? "Study request failed");
			if (result.state) setState(result.state);
			if (result.lesson) router.push(`/chat/${result.lesson.chatId}`);
			return result;
		} catch (failure) { setError(failure instanceof Error ? failure.message : "Study request failed"); return null; }
		finally { setBusy(false); }
	}
	useEffect(() => {
		let active = true;
		void fetch("/api/study").then((r) => r.json()).then((saved: StudyState) => { if (active && saved.materials) setState(saved); }).catch(() => { if (active) setError("Could not load study priorities."); });
		return () => { active = false; };
	}, []);
	useEffect(() => {
		if (!configured || !state || sessionStorage.getItem("lh:study-open")) return;
		sessionStorage.setItem("lh:study-open", "1");
		if (state.autoTeach && (state.selected.length || studyPriorities(state).length)) void request({ action: "bootstrap" });
	}, [configured, state]); // One automatic lesson per window; navigating home never creates another.
	useEffect(() => {
		if (!open) return;
		const close = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } };
		window.addEventListener("keydown", close, true);
		return () => window.removeEventListener("keydown", close, true);
	}, [open]);
	return <>
		<button className="pointer-events-auto rounded border bg-card px-3 py-1.5 text-xs" onClick={() => setOpen(true)}>Study priorities & homework</button>
		{open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80" onClick={() => setOpen(false)}>
			<section role="dialog" aria-modal="true" aria-label="Study priorities and homework" className="max-h-[85vh] w-[42rem] max-w-[95vw] overflow-auto rounded-xl border bg-card p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
				<header className="mb-4 flex justify-between gap-4"><h2 className="font-title text-xl">Study priorities & homework</h2><button aria-label="Close study panel" onClick={() => setOpen(false)}>Close</button></header>
				{error && <p role="alert" className="mb-3 text-sm text-red-500">{error}</p>}
				{state?.syncError && <p role="alert" className="mb-3 text-sm text-amber-600">{state.syncError} Cached items remain below.</p>}
				{!configured && <p className="mb-3 text-sm">Set up your Strong, Cheap and Vision models before starting a lesson.</p>}
				<div className="flex flex-wrap gap-3 text-sm">
					<button disabled={busy} className="rounded border px-3 py-2" onClick={() => void request({ action: "connect" }).then((result) => { if (result) setNotice("Sign into Lamakū in the dedicated Chrome window, including Duo. Then click Sync Lamakū."); })}>Connect Lamakū</button>
					<button disabled={busy} className="rounded border px-3 py-2" onClick={() => void request({ action: "sync" })}>{busy ? "Working…" : "Sync Lamakū"}</button>
				</div>
				{notice && <p role="status" className="mt-2 text-sm text-muted-foreground">{notice}</p>}
				{state?.lastSync && <p className="mt-2 text-xs text-muted-foreground">Last synced: {new Date(state.lastSync).toLocaleString()}</p>}
				{state && <fieldset disabled={busy} className="my-4 flex flex-col gap-2 text-sm">
					<legend className="mb-2 font-medium">Courses to follow</legend>
					{!state.courses.length && <p className="text-muted-foreground">Connect, sign in, then sync to find your courses.</p>}
					{state.courses.map((course) => <label key={course.id} className="flex gap-2"><input type="checkbox" checked={state.selected.includes(course.id)} onChange={(event) => void request({ action: "configure", selected: event.target.checked ? [...state.selected, course.id] : state.selected.filter((id) => id !== course.id), autoTeach: state.autoTeach })} />{course.title}</label>)}
					<label className="mt-2 flex gap-2"><input type="checkbox" checked={state.autoTeach} onChange={(event) => void request({ action: "configure", selected: state.selected, autoTeach: event.target.checked })} />Start or resume my priority lesson when I open LearnHarness</label>
				</fieldset>}
				<form className="my-4 flex flex-col gap-2 border-t pt-4 text-sm" onSubmit={(event) => {
					event.preventDefault(); const form = new FormData(event.currentTarget); const due = form.get("due");
					if (typeof due === "string" && due) form.set("due", new Date(`${due}T23:59:00`).toISOString());
					void request(form).then((result) => { if (result && file.current) file.current.value = ""; if (result?.materialId && configured) void request({ action: "lesson", id: result.materialId }); });
				}}>
					<label className="font-medium" htmlFor="homework-file">Prepare for uploaded homework</label>
					<input id="homework-file" ref={file} type="file" name="file" required accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md" disabled={busy} />
					<label className="flex gap-2">Due date (optional)<input type="date" name="due" className="rounded border bg-background px-2" /></label>
					<button disabled={busy} type="submit" className="w-fit rounded border px-3 py-2">Read homework</button>
					<p className="text-xs text-muted-foreground">PDF, photo or text, up to 20 MB. Photos use your Vision model. Material is kept locally and sent to your selected model for teaching.</p>
				</form>
				<h3 className="mb-2 font-medium">What to learn next</h3>
				<ul className="space-y-3">{state && studyPriorities(state).map((item) => <li key={item.id} className="rounded border p-3 text-sm">
					<div className="flex justify-between gap-3"><span>{item.title}</span><button disabled={busy || !configured} className="shrink-0 underline" onClick={() => void request({ action: "lesson", id: item.id })}>{item.chatId ? "Resume lesson" : "Teach prerequisites"}</button></div>
					<p className="mt-1 text-xs text-muted-foreground">{studyReason(item)}{item.due ? ` · ${new Date(item.due).toLocaleString()}` : ""}</p>
					{item.url && <a href={item.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs underline">Course source ↗</a>}
					<button disabled={busy} onClick={() => void request({ action: "prepared", id: item.id, prepared: true })} className="ml-3 text-xs underline">I’m ready to attempt this</button>
				</li>)}</ul>
				{state?.materials.some((m) => m.prepared) && <details className="mt-4 text-sm"><summary>Prepared homework</summary>{state.materials.filter((m) => m.prepared).map((m) => <div key={m.id} className="mt-2 flex justify-between gap-3">{m.title}<button disabled={busy} className="underline" onClick={() => void request({ action: "prepared", id: m.id, prepared: false })}>Review again</button></div>)}</details>}
			</section>
		</div>}
	</>;
}
