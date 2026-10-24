"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dictation, DictationPhase } from "./dictation.tsx";

interface Capture {
	controller: AbortController; stream?: MediaStream; context?: AudioContext; source?: MediaStreamAudioSourceNode;
	worklet?: AudioWorkletNode; timer?: ReturnType<typeof setInterval>; chunks: Uint8Array[]; size: number;
	finals: string[]; partial?: string; speech: boolean; lastSpeech: number; inFlight?: Promise<void>; stopping?: Promise<void>; flush?: () => void;
}

export function useLocalDictation(append: (text: string) => void, activeChanged: (active: boolean) => void, warm: () => Promise<string>): Dictation {
	const [phase, setPhase] = useState<DictationPhase>("idle");
	const [error, setError] = useState<string | null>(null);
	const [interim, setInterim] = useState("");
	const levelRef = useRef(0);
	const appendRef = useRef(append); appendRef.current = append;
	const changedRef = useRef(activeChanged); changedRef.current = activeChanged;
	const run = useRef<Capture | null>(null);

	const cleanup = useCallback(() => {
		const current = run.current;
		if (current) {
			current.controller.abort(); clearInterval(current.timer);
			current.stream?.getTracks().forEach((track) => track.stop());
			current.source?.disconnect(); current.worklet?.disconnect(); void current.context?.close();
		}
		run.current = null; changedRef.current(false); setPhase("idle"); setInterim("");
	}, []);

	const transcribe = useCallback(async (final = false) => {
		const current = run.current;
		if (!current) return;
		if (current.inFlight) { await current.inFlight; if (final) await transcribe(true); return; }
		if (current.size < 4000 || !current.speech) return;
		const frames = current.chunks.slice();
		const size = current.size;
		const finishSegment = final || size >= 480_000 || Date.now() - current.lastSpeech > 700;
		if (finishSegment) { current.chunks = []; current.size = 0; current.speech = false; }
		const operation = (async () => {
			try {
				const pcm = new Uint8Array(size);
				let offset = 0;
				for (const frame of frames) { pcm.set(frame, offset); offset += frame.byteLength; }
				const response = await fetch("/api/stt/transcribe", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: pcm, signal: current.controller.signal });
				const result = await response.json() as { text?: string; error?: string };
				if (!response.ok) throw new Error(result.error ?? "Local transcription failed");
				if (run.current !== current) return;
				if (finishSegment && result.text) current.finals.push(result.text);
				current.partial = finishSegment ? undefined : result.text;
				setInterim([...current.finals, ...(finishSegment ? [] : [result.text ?? ""])].join(" "));
			} catch (failure) {
				if (run.current !== current || current.controller.signal.aborted) return;
				if (finishSegment) { current.chunks.unshift(...frames); current.size += size; current.speech = true; }
				throw failure;
			}
		})();
		current.inFlight = operation;
		try { await operation; } finally { if (current.inFlight === operation) current.inFlight = undefined; }
	}, []);

	const stop = useCallback(() => {
		const current = run.current;
		if (!current || current.stopping) return;
		setPhase("stopping"); clearInterval(current.timer);
		current.stopping = (async () => {
			try {
				// Include the worklet's last partial 128 ms frame before stopping capture.
				if (current.worklet) await new Promise<void>((resolve) => {
					const timer = setTimeout(resolve, 500);
					current.flush = () => { clearTimeout(timer); resolve(); };
					current.worklet!.port.postMessage("flush");
				});
				current.stream?.getTracks().forEach((track) => track.stop());
				current.source?.disconnect(); current.worklet?.disconnect();
				await transcribe(true);
				if (run.current === current) {
					const text = current.finals.join(" ").trim();
					if (text) appendRef.current(text);
				}
			} catch (failure) {
				if (run.current === current) {
					setError(failure instanceof Error ? failure.message : "Local transcription failed");
					// Keep already finalized words if the final chunk fails.
					const recovered = [...current.finals, current.partial ?? ""].join(" ").trim();
					if (recovered) appendRef.current(recovered);
				}
			} finally { if (run.current === current) cleanup(); }
		})();
	}, [cleanup, transcribe]);

	const start = useCallback(async () => {
		if (run.current) return;
		const current: Capture = { controller: new AbortController(), chunks: [], size: 0, finals: [], speech: false, lastSpeech: Date.now() };
		run.current = current; changedRef.current(true); setError(null); setPhase("connecting");
		try {
			await warm();
			if (run.current !== current) return;
			const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
			if (run.current !== current) { stream.getTracks().forEach((track) => track.stop()); return; }
			current.stream = stream;
			const context = new AudioContext({ sampleRate: 16000 }); current.context = context;
			await context.audioWorklet.addModule("/worklets/pcm-capture.js");
			if (run.current !== current) return;
			await context.resume();
			const worklet = new AudioWorkletNode(context, "pcm-capture"); current.worklet = worklet;
			worklet.port.onmessage = (event: MessageEvent) => {
				if (run.current !== current) return;
				const message = event.data as { type: string; rms?: number; buffer?: Int16Array };
				if (message.type === "level") {
					levelRef.current = message.rms ?? 0;
					if (levelRef.current > 0.008) { current.speech = true; current.lastSpeech = Date.now(); }
				} else if (message.type === "flushed") current.flush?.();
				else if (message.buffer) {
					const frame = new Uint8Array(message.buffer.buffer, message.buffer.byteOffset, message.buffer.byteLength).slice();
					current.chunks.push(frame); current.size += frame.byteLength;
					if (current.size > 630_000) { setError("Local speech is not keeping up. Stopping to preserve this recording."); stop(); }
				}
			};
			current.source = context.createMediaStreamSource(stream); current.source.connect(worklet); worklet.connect(context.destination);
			setPhase("recording");
			current.timer = setInterval(() => {
				if (!current.inFlight) void transcribe().catch((failure: unknown) => { setError(failure instanceof Error ? failure.message : "Local transcription failed"); stop(); });
			}, 1500);
		} catch (failure) { if (run.current === current) { setError(failure instanceof Error ? failure.message : "Microphone unavailable"); cleanup(); } }
	}, [cleanup, stop, transcribe, warm]);

	const finish = useCallback(async () => { stop(); await run.current?.stopping; }, [stop]);
	useEffect(() => () => cleanup(), [cleanup]);
	return { phase, error, interim, levelRef, active: phase !== "idle", toggle: () => { if (run.current) stop(); else void start(); }, stop, finish, cancel: cleanup, clearError: () => setError(null) };
}
