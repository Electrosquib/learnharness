import { configureModelCredentials, piModels } from "../agent/models.ts";
import { chatGPTConnected, chatGPTCredentials, chatGPTDeviceId } from "../store/chatgpt-auth.ts";

configureModelCredentials(chatGPTCredentials);
export { chatGPTConnected };

interface Login {
	controller: AbortController;
	url?: string;
	error?: string;
	pending: boolean;
	answer?: (value: string) => void;
	done?: Promise<void>;
}
const state = globalThis as typeof globalThis & { __lhChatGPTLogin?: Login };

export function chatGPTStatus() {
	const login = state.__lhChatGPTLogin;
	return { connected: chatGPTConnected(), pending: login?.pending ?? false, url: login?.url, error: login?.error };
}

export async function startChatGPTLogin(code?: string) {
	if (code !== undefined) {
		const login = state.__lhChatGPTLogin;
		if (!login?.pending || !login.answer) throw new Error("No ChatGPT sign-in is waiting for a redirect URL");
		login.answer(code);
		return chatGPTStatus();
	}
	if (state.__lhChatGPTLogin?.pending) return chatGPTStatus();
	const deviceId = await chatGPTDeviceId();
	// Recheck after IO: two simultaneous clicks must not start two callback listeners.
	if (state.__lhChatGPTLogin?.pending) return chatGPTStatus();
	const login: Login = { controller: new AbortController(), pending: true };
	state.__lhChatGPTLogin = login;
	const timeout = setTimeout(() => login.controller.abort(), 5 * 60_000);
	let ready!: () => void;
	const started = new Promise<void>((resolve) => { ready = resolve; });
	login.done = piModels().login("openai-chatgpt", "oauth", {
		signal: login.controller.signal,
		notify(event) {
			if (event.type === "auth_url") { login.url = event.url; ready(); }
		},
		prompt(prompt) {
			return new Promise<string>((resolve, reject) => {
				const signal = prompt.signal ?? login.controller.signal;
				const abort = () => reject(new Error("Sign-in cancelled"));
				if (signal.aborted) return abort();
				signal.addEventListener("abort", abort, { once: true });
				login.answer = (value) => { signal.removeEventListener("abort", abort); resolve(value); };
			});
		},
	}, { getDeviceId: () => deviceId, agentName: "LearnHarness" }).then(() => {}, () => {
		// Provider errors may contain token responses; expose only a safe recovery message.
		login.error = login.controller.signal.aborted ? "Sign-in cancelled or timed out. Try again." : "ChatGPT sign-in failed. Check plan eligibility and that port 1455 is free, then retry.";
	}).finally(() => { clearTimeout(timeout); login.pending = false; login.url = undefined; ready(); });
	await started;
	return chatGPTStatus();
}

export async function disconnectChatGPT() {
	const login = state.__lhChatGPTLogin;
	login?.controller.abort();
	await login?.done;
	await piModels().logout("openai-chatgpt");
	state.__lhChatGPTLogin = undefined;
	return chatGPTStatus();
}
