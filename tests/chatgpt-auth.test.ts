import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import type { OAuthCredential } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-chatgpt-"));
process.env.LH_AUTH_FILE = path.join(temp, "auth.json");
process.env.LH_DATA_DIR = path.join(temp, "data");
process.env.OPENAI_API_KEY = "api-key-must-not-be-used";
const store = await import("../src/store/chatgpt-auth.ts");
const auth = await import("../src/server/chatgpt-auth.ts");
const { piModels, piEngineForSpec } = await import("../src/agent/models.ts");
const { catalogProviders, modelCatalog } = await import("../src/server/model-catalog.ts");
const { providerKeyPresent } = await import("../src/server/keys.ts");
const { callCost } = await import("../src/core/prices.ts");
const providerId = "openai-chatgpt";
const credential: OAuthCredential = { type: "oauth", access: "secret-access", refresh: "secret-refresh", expires: Date.now() + 3_600_000 };
after(() => fs.rmSync(temp, { recursive: true, force: true }));

it("subscription auth never falls back to an OpenAI API key", async () => {
	assert.equal(await piModels().getAuth(providerId), undefined);
	assert.equal(providerKeyPresent(providerId), false);
	assert.equal(catalogProviders().find((p) => p.id === providerId)?.keyPresent, false);
	assert.equal(modelCatalog().models.some((m) => m.provider === providerId), false);
});

it("persists an installation ID and credentials separately from API keys", async () => {
	const id = await store.chatGPTDeviceId();
	assert.equal(await store.chatGPTDeviceId(), id);
	await store.chatGPTCredentials.modify(providerId, async () => credential);
	assert.equal(store.chatGPTConnected(), true);
	assert.equal(providerKeyPresent(providerId), true);
	assert.equal((await piModels().getAuth(providerId))?.auth.apiKey, credential.access);
	assert.equal(fs.existsSync(path.join(temp, "auth.json")), false);
	assert.equal(JSON.stringify(auth.chatGPTStatus()).includes("secret-"), false);
	const models = modelCatalog().models.filter((m) => m.provider === providerId);
	assert.ok(models.length > 0);
	const first = models[0]!;
	assert.ok(models.some((m) => m.input.includes("image")));
	assert.equal(piEngineForSpec({ provider: providerId, id: first.id }).model.provider, providerId);
	assert.equal(callCost({ inputTokens: 100, outputTokens: 100 }, `${providerId}:${first.id}`), null);
	if (process.platform !== "win32") assert.equal(fs.statSync(store.CHATGPT_AUTH_FILE).mode & 0o777, 0o600);
});

it("refreshes an expired credential once under concurrent requests and persists the result", async () => {
	const provider = piModels().getProvider(providerId)!;
	const oauth = provider.auth.oauth!;
	let refreshes = 0;
	piModels().setProvider({ ...provider, auth: { oauth: { ...oauth, async refresh() {
		refreshes++;
		await new Promise((resolve) => setTimeout(resolve, 20));
		return { ...credential, access: "refreshed-access" };
	} } } });
	await store.chatGPTCredentials.modify(providerId, async () => ({ ...credential, expires: 0 }));
	const results = await Promise.all([piModels().getAuth(providerId), piModels().getAuth(providerId)]);
	assert.equal(refreshes, 1);
	assert.ok(results.every((r) => r?.auth.apiKey === "refreshed-access"));
	const refreshed = await store.chatGPTCredentials.read(providerId);
	assert.equal(refreshed?.type === "oauth" && refreshed.access, "refreshed-access");
	piModels().setProvider(provider);
});

it("applies native subscription payload guards despite the separate billing provider ID", async () => {
	const engine = piEngineForSpec({ provider: providerId, id: "gpt-6.1-sol", thinkingLevel: "high" });
	let inspected = false;
	await engine.streamFn(engine.model, normalizeContext({ messages: [
		{ role: "system", content: "Teach prerequisites.", timestamp: 1, toolsAdded: [{ name: "check", description: "Check a concept", parameters: Type.Object({ concept: Type.String() }) }] },
		{ role: "user", content: "Fractions", timestamp: 2 },
	] }), { onPayload(payload) {
		const request = payload as { input: { type?: string; role?: string }[]; reasoning?: { effort?: string }; prompt_cache_retention?: string; prompt_cache_options?: unknown };
		assert.ok(request.input.every((item) => item.type !== "configuration_update" && item.type !== "tool_search_call" && item.type !== "tool_search_output"));
		assert.equal(request.prompt_cache_retention, undefined);
		assert.equal(request.prompt_cache_options, undefined);
		assert.equal(request.reasoning?.effort, "high");
		inspected = true;
		throw new Error("Stop before network: payload inspected");
	} }).result();
	assert.equal(inspected, true);
});

it("disconnect removes tokens, preserves the host ID, and closes the model gate", async () => {
	const id = await store.chatGPTDeviceId();
	await auth.disconnectChatGPT();
	assert.equal(store.chatGPTConnected(), false);
	assert.equal(providerKeyPresent(providerId), false);
	assert.equal(await store.chatGPTDeviceId(), id);
	assert.equal(fs.readFileSync(store.CHATGPT_AUTH_FILE, "utf8").includes("secret-"), false);
});

it("runs browser sign-in and manual completion without exposing credentials", async () => {
	const provider = piModels().getProvider(providerId)!;
	const oauth = provider.auth.oauth!;
	piModels().setProvider({ ...provider, auth: { oauth: { ...oauth, async login(interaction, options) {
		assert.ok(options?.getDeviceId?.());
		interaction.notify({ type: "auth_url", url: "https://auth.openai.com/test-login" });
		assert.equal(await interaction.prompt({ type: "manual_code", message: "Redirect", signal: interaction.signal }), "http://127.0.0.1/callback");
		return credential;
	} } } });
	const started = await auth.startChatGPTLogin();
	assert.equal(started.pending, true);
	assert.equal(started.url, "https://auth.openai.com/test-login");
	await auth.startChatGPTLogin("http://127.0.0.1/callback");
	for (let i = 0; i < 100 && auth.chatGPTStatus().pending; i++) await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(auth.chatGPTStatus().connected, true);
	assert.equal(auth.chatGPTStatus().pending, false);
	assert.equal(auth.chatGPTStatus().url, undefined);
	await auth.disconnectChatGPT();
	piModels().setProvider(provider);
});

it("blocks cross-origin sign-in and logout requests", async () => {
	const route = await import("../app/api/chatgpt/route.ts");
	for (const method of ["POST", "DELETE"] as const) {
		const response = await route[method](new Request("http://localhost:3000/api/chatgpt", { method, headers: { origin: "https://other.example" } }));
		assert.equal(response.status, 403);
	}
	const response = await route.GET();
	assert.equal(response.headers.get("cache-control"), "no-store");
	assert.equal((await response.json()).connected, false);
	const local = await route.DELETE(new Request("http://localhost:3000/api/chatgpt", {
		method: "DELETE", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
	}));
	assert.equal(local.status, 200, "compare the browser origin with the original Host header");
});
