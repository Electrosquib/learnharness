import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { readStudy, updateStudy } from "../store/study.ts";
import { studyContext, studyPriorities, type StudyMaterial } from "../core/study.ts";
import { newMessageId, type LhMessage } from "../core/native-messages.ts";
import { slotsConfigured } from "../core/settings.ts";
import { readStudyImage, readStudyPdf, studyImageType } from "../agent/study-document.ts";
import { piEngineForSpec } from "../agent/models.ts";
import { providerKeyPresent } from "./keys.ts";
import { stores, effectiveSettings } from "./stores.ts";

export { readStudy, updateStudy };

export async function uploadHomework(file: File, due?: string): Promise<StudyMaterial> {
	if (file.size === 0 || file.size > 20 * 1024 * 1024) throw new Error("Choose a homework file between 1 byte and 20 MB.");
	if (due && !Number.isFinite(Date.parse(due))) throw new Error("Choose a valid due date.");
	const bytes = Buffer.from(await file.arrayBuffer());
	const id = `upload_${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}`;
	const vision = () => {
		const spec = effectiveSettings().models.vision;
		if (!spec || !providerKeyPresent(spec.provider)) throw new Error("Connect your Vision model in Settings before reading photos or scanned PDFs.");
		return piEngineForSpec(spec);
	};
	let text: string;
	const imageType = studyImageType(bytes);
	if (imageType) text = await readStudyImage(bytes, imageType, vision());
	else if (bytes.subarray(0, 5).toString() === "%PDF-") {
		const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-homework-"));
		try {
			const pdf = path.join(temp, "homework.pdf");
			fs.writeFileSync(pdf, bytes, { mode: 0o600 });
			text = await readStudyPdf(pdf, vision);
		} finally { fs.rmSync(temp, { recursive: true, force: true }); }
	} else {
		if (!/\.(txt|md)$/i.test(file.name) || bytes.includes(0)) throw new Error("Upload a PDF, PNG, JPEG, WebP, TXT or Markdown file.");
		text = bytes.toString("utf8");
	}
	if (text.trim().length < 15) throw new Error("The homework could not be read. Upload a clearer document or paste its text in a TXT file.");
	if (text.length > 80_000) throw new Error("Upload a smaller homework section (up to 80,000 text characters).");
	const material: StudyMaterial = { id, title: path.basename(file.name).slice(0, 200), kind: "assignment", text, due, updatedAt: new Date().toISOString() };
	updateStudy((state) => {
		const existing = state.materials.find((m) => m.id === id);
		state.materials = state.materials.filter((m) => m.id !== id);
		state.materials.push({ ...existing, ...material });
		return state;
	});
	return material;
}

export function startStudyLesson(id?: string) {
	const state = readStudy();
	const material = id ? state.materials.find((m) => m.id === id) : studyPriorities(state)[0];
	if (!material) return null;
	if (material.chatId && stores.chatStore.getChat(material.chatId)) return { chatId: material.chatId };
	const record = stores.settingsStore.readSettings();
	if (!slotsConfigured(record?.models)) throw new Error("Set up Strong, Cheap and Vision models before starting homework preparation.");
	const strong = effectiveSettings().models.strong!;
	if (!providerKeyPresent(strong.provider)) throw new Error("Connect your teaching model in Settings first.");
	const chat = stores.chatStore.createChat(`Prepare: ${material.title}`);
	stores.chatStore.saveSettings(chat.id, { model: { provider: strong.provider, id: strong.id }, thinkingLevel: strong.thinkingLevel });
	const references = state.materials.filter((m) => m.id !== material.id && m.courseId && m.courseId === material.courseId && m.kind !== "assignment").slice(0, 4);
	const context: LhMessage = { id: newMessageId(), role: "custom", customType: "study-context", display: false,
		content: studyContext(material, references), details: { materialId: material.id, opening: `Prepare me for ${material.title}. Diagnose the prerequisites I need, then teach my gaps efficiently before I attempt the homework.` }, timestamp: Date.now() };
	stores.chatStore.saveMessages(chat.id, [context]);
	updateStudy((fresh) => { const current = fresh.materials.find((m) => m.id === material.id); if (current) current.chatId = chat.id; return fresh; });
	return { chatId: chat.id };
}
