import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { CredentialStore, OAuthCredential } from "@earendil-works/pi-ai";
import { AUTH_FILE } from "../../config.ts";

export const CHATGPT_AUTH_FILE = path.join(path.dirname(AUTH_FILE), "chatgpt-auth.json");
interface SavedAuth { deviceId: string; credential?: OAuthCredential }

function read(): SavedAuth | undefined {
	try {
		const saved = JSON.parse(fs.readFileSync(CHATGPT_AUTH_FILE, "utf8")) as SavedAuth;
		if (typeof saved.deviceId !== "string" || !/^[0-9a-f-]{36}$/i.test(saved.deviceId)) throw new Error("Invalid ChatGPT device ID");
		const c = saved.credential;
		if (c && (c.type !== "oauth" || typeof c.access !== "string" || typeof c.refresh !== "string" || !Number.isFinite(c.expires))) {
			throw new Error("Invalid ChatGPT credentials; reconnect your account");
		}
		return saved;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function write(saved: SavedAuth) {
	const temp = `${CHATGPT_AUTH_FILE}.${process.pid}.tmp`;
	try {
		fs.writeFileSync(temp, JSON.stringify(saved), { mode: 0o600 });
		fs.chmodSync(temp, 0o600);
		fs.renameSync(temp, CHATGPT_AUTH_FILE);
	} finally {
		fs.rmSync(temp, { force: true });
	}
}

// Serialize refresh/login/logout across requests and server processes.
async function locked<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
	fs.mkdirSync(path.dirname(CHATGPT_AUTH_FILE), { recursive: true });
	const lock = `${CHATGPT_AUTH_FILE}.lock`;
	const deadline = Date.now() + 60_000;
	for (;;) {
		signal?.throwIfAborted();
		try { fs.mkdirSync(lock); break; }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			// Refresh is bounded by pi-ai's timeout; reclaim a lock left by a crashed process.
			try {
				if (Date.now() - fs.statSync(lock).mtimeMs > 120_000) { fs.rmdirSync(lock); continue; }
			} catch (checkError) {
				if ((checkError as NodeJS.ErrnoException).code === "ENOENT") continue;
				throw checkError;
			}
			if (Date.now() > deadline) throw new Error("ChatGPT credential store is busy. Close other LearnHarness instances and retry.");
			await delay(50, undefined, { signal });
		}
	}
	try { return await fn(); }
	finally { fs.rmdirSync(lock); }
}

export function chatGPTConnected(): boolean { return read()?.credential !== undefined; }

export async function chatGPTDeviceId(): Promise<string> {
	return locked(async () => {
		const saved = read() ?? { deviceId: randomUUID() };
		write(saved);
		return saved.deviceId;
	});
}

export const chatGPTCredentials: CredentialStore = {
	async read(id) { return id === "openai-chatgpt" ? read()?.credential : undefined; },
	async list() { return chatGPTConnected() ? [{ providerId: "openai-chatgpt", type: "oauth" }] : []; },
	async modify(id, fn, options) {
		if (id !== "openai-chatgpt") throw new Error("Unsupported subscription provider");
		return locked(async () => {
			const saved = read() ?? { deviceId: randomUUID() };
			const next = await fn(saved.credential);
			if (next) {
				if (next.type !== "oauth") throw new Error("ChatGPT requires subscription sign-in");
				write({ ...saved, credential: next });
			}
			return next ?? saved.credential;
		}, options?.signal);
	},
	async delete(id, options) {
		if (id !== "openai-chatgpt") return;
		await locked(async () => {
			const saved = read();
			if (saved) write({ deviceId: saved.deviceId });
		}, options?.signal);
	},
};
