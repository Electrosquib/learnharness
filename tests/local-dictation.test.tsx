import React, { act } from "react";
import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { useLocalDictation } from "../components/local-dictation.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { React, window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
let stopped = 0;
let closed = 0;
let micFails = false;
const originalFetch = globalThis.fetch;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { async getUserMedia() {
	if (micFails) throw new Error("Microphone permission denied");
	return { getTracks: () => [{ stop() { stopped++; } }] };
} } } });
class AudioContext {
	audioWorklet = { async addModule() {} }; destination = {};
	async resume() {} async close() { closed++; }
	createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
}
let worklet: AudioWorkletNode;
class AudioWorkletNode {
	port = { onmessage: (_event: { data: unknown }) => {}, postMessage: (_value: string) => queueMicrotask(() => this.port.onmessage({ data: { type: "flushed" } })) };
	constructor() { worklet = this; }
	connect() {} disconnect() {}
}
Object.assign(globalThis, { AudioContext, AudioWorkletNode });
let root: Root | undefined;
let host: HTMLElement;
const appended: string[] = [];
const warm = async () => "cuda";
function Fixture() {
	const dictation = useLocalDictation((text) => appended.push(text), () => {}, warm);
	return <div><output>{dictation.phase}</output><p data-live>{dictation.interim}</p><p data-error>{dictation.error}</p><button onClick={dictation.toggle}>Toggle</button><button onClick={dictation.cancel}>Cancel</button></div>;
}
async function mount() {
	appended.length = 0; stopped = 0; closed = 0;
	host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
	await act(async () => { root!.render(<Fixture />); });
}
async function click(label: string) {
	await act(async () => { const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label)!; button.dispatchEvent(new dom.window.Event("click", { bubbles: true })); });
}
function audio() {
	worklet.port.onmessage({ data: { type: "level", rms: 0.1 } });
	worklet.port.onmessage({ data: { type: "audio", buffer: new Int16Array(16_000).fill(1000) } });
}
afterEach(async () => { await act(async () => { root?.unmount(); }); root = undefined; host?.remove(); globalThis.fetch = originalFetch; micFails = false; });

it("shows local partial text while recording and flushes the final transcript exactly once on stop", async () => {
	const urls: string[] = [];
	globalThis.fetch = async (url, options) => {
		urls.push(String(url));
		assert.equal(options?.headers && (options.headers as Record<string, string>)["Content-Type"], "application/octet-stream");
		return Response.json({ text: "Fractions and linear equations." });
	};
	await mount(); await click("Toggle");
	assert.equal(host.querySelector("output")!.textContent, "recording");
	audio();
	await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1600)); });
	assert.match(host.querySelector("[data-live]")!.textContent!, /Fractions/);
	assert.deepEqual(appended, [], "partial text stays a preview until finalized");
	await click("Toggle");
	assert.deepEqual(appended, ["Fractions and linear equations."]);
	assert.ok(urls.length > 0 && urls.every((url) => url === "/api/stt/transcribe"));
	assert.equal(host.querySelector("output")!.textContent, "idle");
	assert.ok(stopped > 0 && closed > 0);
});

it("cancel discards a late local response and releases the microphone", async () => {
	let reply!: (response: Response) => void;
	globalThis.fetch = () => new Promise((resolve) => { reply = resolve; });
	await mount(); await click("Toggle"); audio();
	await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1600)); });
	await click("Cancel");
	await act(async () => { reply(Response.json({ text: "Must not be appended" })); });
	assert.deepEqual(appended, []);
	assert.equal(host.querySelector("output")!.textContent, "idle");
	assert.ok(stopped > 0);
});

it("microphone denial ends cleanly without sending audio", async () => {
	micFails = true;
	globalThis.fetch = async () => { assert.fail("No audio request is allowed after microphone denial"); };
	await mount(); await click("Toggle");
	assert.equal(host.querySelector("output")!.textContent, "idle");
	assert.match(host.querySelector("[data-error]")!.textContent!, /permission denied/);
});
