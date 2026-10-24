import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { resolveChromeExecutablePath } from "../agent/subagents/headless.ts";
import { readStudyPdf } from "../agent/study-document.ts";
import { piEngineForSpec } from "../agent/models.ts";
import { STUDY_DIR, readStudy, updateStudy } from "../store/study.ts";
import type { StudyCourse, StudyMaterial } from "../core/study.ts";
import { effectiveSettings } from "./stores.ts";
import { providerKeyPresent } from "./keys.ts";

const ORIGIN = "https://lamaku.hawaii.edu";
interface Link { url: string; title: string; context: string; date?: string }
interface Snapshot { text: string; links: Link[] }
const global = globalThis as typeof globalThis & { __lhLamaku?: { browser: Browser; visible: boolean }; __lhLamakuLaunch?: Promise<Browser>; __lhLamakuSync?: Promise<void> };

/** Only course URLs observed on authenticated pages are followed. */
export function lamakuUrl(value: string): string | null {
	try { const url = new URL(value, ORIGIN); return url.origin === ORIGIN && url.protocol === "https:" ? url.href : null; } catch { return null; }
}

async function browser(visible: boolean): Promise<Browser> {
	if (global.__lhLamakuLaunch) return global.__lhLamakuLaunch;
	const existing = global.__lhLamaku;
	if (existing?.browser.connected && (!visible || existing.visible)) return existing.browser;
	global.__lhLamakuLaunch = (async () => {
		if (existing?.browser.connected) await existing.browser.close();
		const executablePath = resolveChromeExecutablePath();
		if (!executablePath) throw new Error("Install Chrome, or set CHROME_PATH, to connect Lamakū.");
		fs.mkdirSync(STUDY_DIR, { recursive: true, mode: 0o700 });
		const opened = await puppeteer.launch({ executablePath, headless: !visible, userDataDir: path.join(STUDY_DIR, "browser"), defaultViewport: null, args: ["--no-first-run", "--no-default-browser-check"] });
		global.__lhLamaku = { browser: opened, visible };
		opened.on("disconnected", () => { if (global.__lhLamaku?.browser === opened) global.__lhLamaku = undefined; });
		return opened;
	})();
	try { return await global.__lhLamakuLaunch; } finally { global.__lhLamakuLaunch = undefined; }
}

export async function connectLamaku() {
	const chrome = await browser(true);
	const pages = await chrome.pages();
	const page = pages[0] ?? await chrome.newPage();
	await page.goto(ORIGIN, { waitUntil: "domcontentloaded", timeout: 45_000 });
	await page.bringToFront();
}

async function snapshot(page: Page): Promise<Snapshot> {
	return page.evaluate(() => {
		const links: Link[] = [];
		const parts: string[] = [];
		const visit = (root: Document | ShadowRoot) => {
			for (const element of root.querySelectorAll("*")) {
				if (element.shadowRoot) visit(element.shadowRoot);
				if (element.matches("script,style,noscript,svg") || !element.getClientRects().length) continue;
				for (const child of element.childNodes) if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) parts.push(child.textContent.trim());
				const href = element.getAttribute("href") ?? (element.tagName === "IFRAME" ? element.getAttribute("src") : element.tagName === "OBJECT" ? element.getAttribute("data") : null);
				if (!href) continue;
				const row = element.closest("tr,[role=row],li,.d2l-datalist-item") ?? element.parentElement;
				const title = (element.textContent?.trim() || element.getAttribute("aria-label") || element.getAttribute("title") || element.querySelector("img")?.getAttribute("alt") || (/IFRAME|OBJECT/.test(element.tagName) ? "Course document" : "")).replace(/\s+/g, " ");
				links.push({ url: new URL(href, location.href).href, title, context: (row?.textContent ?? title).replace(/\s+/g, " ").slice(0, 2000), date: row?.querySelector("time[datetime]")?.getAttribute("datetime") ?? undefined });
			}
		};
		visit(document);
		return { text: parts.join("\n").slice(0, 80_000), links };
	});
}

export function coursesFromLinks(links: Link[]): StudyCourse[] {
	const courses = new Map<string, StudyCourse>();
	for (const link of links) {
		const url = lamakuUrl(link.url);
		const match = url && new URL(url).pathname.match(/^\/d2l\/home\/(\d+)\/?$/);
		if (match && link.title) courses.set(match[1]!, { id: match[1]!, title: link.title.slice(0, 200), url: url! });
	}
	return [...courses.values()];
}

/** Prefer machine dates; parse explicit Brightspace due-date text as Hawaiʻi time. */
export function dueFromLink(link: Link): string | undefined {
	if (link.date && /(?:Z|[+-]\d\d:\d\d)$/.test(link.date) && Number.isFinite(Date.parse(link.date))) return new Date(link.date).toISOString();
	const date = link.context.match(/Due(?:\s+(?:on|date:?))?\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i);
	if (!date) return undefined;
	const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
	const month = months.indexOf(date[1]!.slice(0, 3).toLowerCase()) + 1;
	if (!month) return undefined;
	const hour = date[4] ? Number(date[4]) % 12 + (/pm/i.test(date[6] ?? "") ? 12 : 0) : 23;
	const value = `${date[3]}-${String(month).padStart(2, "0")}-${date[2]!.padStart(2, "0")}T${String(hour).padStart(2, "0")}:${date[5] ?? "59"}:00-10:00`;
	return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

async function readPage(page: Page, link: Link): Promise<Snapshot> {
	const url = lamakuUrl(link.url);
	if (!url) throw new Error("Course links must remain on lamaku.hawaii.edu.");
	if (/\.pdf(?:\?|$)/i.test(url)) {
		const encoded = await page.evaluate(async (target) => {
			if (new URL(target).origin !== location.origin) throw new Error("Course download must stay on Lamakū");
			const response = await fetch(target, { credentials: "same-origin", redirect: "error" });
			if (!response.ok || Number(response.headers.get("content-length")) > 20 * 1024 * 1024) throw new Error("Course PDF is unavailable or exceeds 20 MB");
			const reader = response.body!.getReader(); const parts: Uint8Array[] = []; let total = 0;
			for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > 20 * 1024 * 1024) { await reader.cancel(); throw new Error("Course PDF exceeds 20 MB"); } parts.push(value); }
			let binary = ""; for (const bytes of parts) for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
			return btoa(binary);
		}, url);
		const bytes = Buffer.from(encoded, "base64");
		if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("Course PDF returned a login page or an unreadable file. Reconnect Lamakū.");
		const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-syllabus-"));
		try {
			const file = path.join(temp, "course.pdf"); fs.writeFileSync(file, bytes, { mode: 0o600 });
			const text = await readStudyPdf(file, () => {
				const spec = effectiveSettings().models.vision;
				if (!spec || !providerKeyPresent(spec.provider)) throw new Error("Set up your Vision model to read scanned course PDFs.");
				return piEngineForSpec(spec);
			});
			return { text, links: [] };
		} finally { fs.rmSync(temp, { recursive: true, force: true }); }
	}
	const response = await page.goto(url, { waitUntil: "networkidle2", timeout: 45_000 });
	if (!response?.ok() || !lamakuUrl(page.url()) || /\/login|\/samlLogin/i.test(page.url())) throw new Error("Sign into Lamakū, including Duo, in the dedicated Chrome window, then sync again.");
	const result = await snapshot(page);
	if (/not authorized|not currently available|access denied/i.test(result.text) && result.text.length < 1500) throw new Error("This course page is unavailable to your student account.");
	return result;
}

async function sync() {
	const chrome = await browser(false);
	const page = await chrome.newPage();
	try {
		const home = await readPage(page, { url: ORIGIN, title: "Lamakū", context: "" });
		const courses = coursesFromLinks(home.links);
		if (!courses.length) throw new Error("No course links were found. Sign into the dedicated Chrome window and make your courses visible on the Lamakū dashboard, then retry.");
		updateStudy((state) => ({ ...state, courses }));
		const selected = readStudy().selected;
		if (selected.some((id) => !courses.some((course) => course.id === id))) throw new Error("A selected course is missing from the Lamakū dashboard. Make it visible there and retry; cached materials have been kept.");
		const materials: StudyMaterial[] = [];
		for (const course of courses.filter((c) => selected.includes(c.id))) {
			const visited = new Set<string>();
			const queue: Array<Link & { depth: number }> = [{ url: course.url, title: course.title, context: "", depth: 0 }];
			while (queue.length && visited.size < 80) {
				const link = queue.shift()!;
				if (visited.has(link.url)) continue;
				visited.add(link.url);
				const data = await readPage(page, link);
				const kind = /syllabus|syllabi/i.test(link.title) ? "syllabus" : !/^(?:assignments?|calendar|content)$/i.test(link.title) && (/homework|assignment|problem\s*set|worksheet/i.test(link.title) || new URL(link.url).searchParams.has("db")) ? "assignment" : "content";
				if (link.depth > 0) materials.push({ id: `lamaku_${createHash("sha256").update(link.url).digest("hex").slice(0, 24)}`, courseId: course.id, title: link.title, url: link.url, kind,
					text: data.text, due: dueFromLink(link), submitted: /not submitted|unsubmitted|no submissions/i.test(link.context) ? false : /\bsubmitted\b/i.test(link.context) ? true : undefined, updatedAt: new Date().toISOString() });
				if (link.depth >= 3) continue;
				for (const child of data.links) {
					const url = lamakuUrl(child.url);
					if (!url || visited.has(url) || !child.title || /logout|delete|submit|attempt|email|help/i.test(child.title)) continue;
					const target = new URL(url);
					if (target.searchParams.has("ou") && target.searchParams.get("ou") !== course.id) continue;
					if (target.pathname.startsWith("/d2l/home/")) continue;
					const relevant = /content|calendar|syllab|assignment|homework|problem\s*set|worksheet|module|lesson|week\s*\d/i.test(child.title) || /\/content\/|\/dropbox\/|\/calendar\//i.test(target.pathname);
					if (relevant) queue.push({ ...child, title: child.title === "Course document" ? link.title : child.title, url, depth: link.depth + 1 });
				}
			}
			if (queue.length) throw new Error(`${course.title} has more than 80 study pages. Sync stopped before replacing the previous snapshot; narrow the visible course content and retry.`);
		}
		updateStudy((state) => {
			const old = new Map(state.materials.map((m) => [m.id, m]));
			return { ...state, syncError: undefined, lastSync: new Date().toISOString(), materials: [
				...state.materials.filter((m) => !m.courseId || !selected.includes(m.courseId)),
				...materials.map((m) => { const previous = old.get(m.id); return { ...m, chatId: previous?.text === m.text ? previous.chatId : undefined, prepared: previous?.text === m.text && previous.prepared }; }),
			] };
		});
	} finally { await page.close(); }
}

export async function syncLamaku() {
	if (!global.__lhLamakuSync) global.__lhLamakuSync = sync().finally(() => { global.__lhLamakuSync = undefined; });
	await global.__lhLamakuSync;
}
