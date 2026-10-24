"use client";
import { useEffect, useState } from "react";
import { notifySettingsSaved } from "@/components/settings-signal";

interface Status { connected?: boolean; pending?: boolean; url?: string; error?: string }

export function ChatGPTConnection() {
	const [status, setStatus] = useState<Status>({});
	const [busy, setBusy] = useState(false);
	const [code, setCode] = useState("");
	useEffect(() => {
		let active = true;
		async function read() {
			try {
				const response = await fetch("/api/chatgpt");
				const next: Status = await response.json();
				if (active) setStatus(next);
			} catch { if (active) setStatus({ error: "Could not load ChatGPT connection. Retry sign-in." }); }
		}
		void read();
		const timer = setInterval(() => void read(), 1500);
		return () => { active = false; clearInterval(timer); };
	}, []);
	useEffect(() => {
		if (status.connected !== undefined) notifySettingsSaved("keys");
	}, [status.connected]);

	async function change(method: "POST" | "DELETE", redirect?: string) {
		setBusy(true);
		try {
			const response = await fetch("/api/chatgpt", {
				method, headers: { "Content-Type": "application/json" },
				...(method === "POST" ? { body: JSON.stringify(redirect ? { code: redirect } : {}) } : {}),
			});
			setStatus(await response.json());
			setCode("");
			if (method === "DELETE") notifySettingsSaved("keys");
		} catch { setStatus({ error: "Could not connect. Retry sign-in." }); }
		finally { setBusy(false); }
	}

	return <div className="flex flex-col gap-2 px-1 py-2 text-xs" data-testid="chatgpt-connection">
		<div className="flex items-center justify-between gap-3">
			<span>ChatGPT subscription</span>
			<button type="button" disabled={busy} className="underline disabled:opacity-40"
				onClick={() => void change(status.connected || status.pending ? "DELETE" : "POST")}>
				{busy ? "Connecting…" : status.pending ? "Cancel sign-in" : status.connected ? "Disconnect" : "Sign in with ChatGPT"}
			</button>
		</div>
		<p className="text-muted-foreground">{status.connected ? "ChatGPT plan usage is enabled. Choose openai-chatgpt models for Strong, Cheap and Vision." : "Use your eligible ChatGPT plan allowance. No API key required."}</p>
		{status.connected && <a href="https://chatgpt.com/#settings" target="_blank" rel="noreferrer" className="underline">Manage usage in ChatGPT</a>}
		{status.pending && <>
			{status.url && <a href={status.url} target="_blank" rel="noreferrer" className="underline">Continue sign-in in your browser ↗</a>}
			<p className="text-muted-foreground">Waiting for browser sign-in. This expires after 5 minutes.</p>
			<details><summary className="cursor-pointer">Browser did not return?</summary>
				<form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); void change("POST", code); }}>
					<input aria-label="Final ChatGPT redirect URL" placeholder="Paste the final redirect URL" value={code} onChange={(event) => setCode(event.target.value)} className="min-w-0 flex-1 rounded border bg-background p-1" />
					<button disabled={busy || !code.trim()} type="submit" className="underline">Complete</button>
				</form>
			</details>
		</>}
		{status.error && <p role="alert" className="text-red-500">{status.error}</p>}
	</div>;
}
