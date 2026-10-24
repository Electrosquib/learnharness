import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { ROOT } from "../../config.ts";

interface Worker {
	process: ChildProcessWithoutNullStreams;
	ready: Promise<string>;
	pending: Map<number, { resolve: (text: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>;
	sequence: number;
}
const global = globalThis as typeof globalThis & { __lhWhisper?: Worker };

function worker(): Worker {
	if (global.__lhWhisper) return global.__lhWhisper;
	const localPython = path.join(ROOT, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
	const python = process.env.LH_WHISPER_PYTHON ?? (fs.existsSync(localPython) ? localPython : "python");
	const child = spawn(python, ["-u", path.join(ROOT, "scripts/local_whisper.py")], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
	let ready!: (device: string) => void;
	let failed!: (error: Error) => void;
	const current: Worker = { process: child, sequence: 0, pending: new Map(), ready: new Promise((resolve, reject) => { ready = resolve; failed = reject; }) };
	global.__lhWhisper = current;
	const bootTimer = setTimeout(() => { fail(new Error("Local speech model did not start within 120 seconds.")); child.kill(); }, 120_000);
	function fail(error: Error) {
		clearTimeout(bootTimer);
		failed(error);
		for (const request of current.pending.values()) { clearTimeout(request.timer); request.reject(error); }
		current.pending.clear();
		if (global.__lhWhisper === current) global.__lhWhisper = undefined;
	}
	createInterface({ input: child.stdout }).on("line", (line) => {
		try {
			const reply = JSON.parse(line) as { ready?: boolean; device?: string; id?: number; text?: string; error?: string };
			if (reply.ready) { clearTimeout(bootTimer); ready(reply.device ?? "cpu"); return; }
			if (reply.id === undefined) { if (reply.error) fail(new Error(reply.error)); return; }
			const request = current.pending.get(reply.id);
			if (!request) return;
			clearTimeout(request.timer); current.pending.delete(reply.id);
			if (reply.error) request.reject(new Error(reply.error)); else request.resolve(reply.text ?? "");
		} catch { fail(new Error("Invalid response from local speech worker.")); child.kill(); }
	});
	child.stderr.on("data", () => {}); // Native libraries log here; never mix those lines into the protocol.
	child.on("error", () => fail(new Error("Could not start local speech. Install scripts/requirements-stt.txt in .venv or set LH_WHISPER_PYTHON.")));
	child.on("exit", () => fail(new Error("Local speech worker stopped. Retry dictation.")));
	process.once("exit", () => child.kill());
	return current;
}

export async function warmWhisper() { return { engine: "faster-whisper", device: await worker().ready }; }

export async function transcribeLocal(pcm: Buffer): Promise<string> {
	if (!pcm.length || pcm.length > 640_000 || pcm.length % 2) throw new Error("Send up to 20 seconds of 16 kHz mono PCM16 audio.");
	const current = worker();
	await current.ready;
	if (current.pending.size >= 2) throw new Error("Local speech is busy. Retry dictation.");
	const id = ++current.sequence;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => { current.pending.delete(id); reject(new Error("Local transcription timed out.")); current.process.kill(); }, 60_000);
		current.pending.set(id, { resolve, reject, timer });
		current.process.stdin.write(JSON.stringify({ id, audio: pcm.toString("base64") }) + "\n", (error) => {
			if (error) { clearTimeout(timer); current.pending.delete(id); reject(error); }
		});
	});
}
