import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import type { StudyState } from "../core/study.ts";

export const STUDY_DIR = path.join(PATHS.data, "study");
const file = path.join(STUDY_DIR, "study.json");
export function readStudy(): StudyState {
	try {
		const state = JSON.parse(fs.readFileSync(file, "utf8")) as StudyState;
		if (!Array.isArray(state.courses) || !Array.isArray(state.selected) || !Array.isArray(state.materials)) throw new Error("Invalid study record");
		return state;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { courses: [], selected: [], materials: [], autoTeach: true };
		throw error;
	}
}

/** Synchronous updates never hold a stale snapshot across a model or network wait. */
export function updateStudy(change: (state: StudyState) => StudyState): StudyState {
	const state = change(readStudy());
	fs.mkdirSync(STUDY_DIR, { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
	fs.renameSync(temp, file);
	return state;
}
