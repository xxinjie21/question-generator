import { App, Plugin, TFile, TFolder, Notice, ItemView, WorkspaceLeaf, requestUrl, Editor, Menu, MarkdownView, MarkdownFileInfo } from "obsidian";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, UnderlineType } from "docx";
import * as fs from "fs";
import * as path from "path";
import { remote } from "electron";

function getElectronRemote() { return remote; }

// ===================== 类型定义 =====================
interface OllamaResponse { response?: string; }
interface OpenAIResponse { choices?: { message?: { content?: string } }[]; }

type FmValue = string | boolean | number | string[];

interface HistoryEntry {
	id: string;
	timestamp: number;
	fileName: string;
	sourceSnippet: string;
	resultText: string;
	sourcePath: string;
}

interface WrongAnswerNote {
	filePath: string;
	baseName: string;
	date: string;
	sourceFile: string;
	sourcePath: string;
	tags: string[];
	mastered: boolean;
	resultText: string;
	note: string;
	nextReview: string;
	interval: number;
	easeFactor: number;
	reviewCount: number;
}

type QuestionType = "single" | "multi" | "judge" | "blank" | "essay";

interface ParsedQuestion {
	number: number;
	type: QuestionType;
	text: string;
	options: { label: string; text: string }[];
	answer: string;
	explanation: string;
}

interface PluginSettings {
	apiType: "ollama" | "openai";
	baseUrl: string;
	modelName: string;
	apiKey: string;
	temperature: number;
	countSingle: number;
	countMulti: number;
	countJudge: number;
	countBlank: number;
	countEssay: number;
	systemPrompt: string;
	questionFolder: string;
	wrongBookFolder: string;
	excludeFolders: string;
	autoSave: boolean;
	lastTags: string;
	lastEnabledTypes: string;
	weakPointThreshold: number;
	autoReviewReminder: boolean;
	sortWrongBy: "date" | "tag" | "review";
	extractedExamFolder: string;
}

const DEFAULT_SETTINGS: PluginSettings = {
	apiType: "ollama",
	baseUrl: "http://127.0.0.1:11434",
	modelName: "qwen2:7b",
	apiKey: "",
	temperature: 0.1,
	countSingle: 5,
	countMulti: 3,
	countJudge: 5,
	countBlank: 2,
	countEssay: 2,
	systemPrompt: "",
	questionFolder: "出题",
	wrongBookFolder: "错题本",
	excludeFolders: ".trash, 模板, templates",
	autoSave: true,
	lastTags: "",
	lastEnabledTypes: "single,multi,judge,blank,essay",
	weakPointThreshold: 2,
	autoReviewReminder: true,
	sortWrongBy: "date",
	extractedExamFolder: "出题/识别试卷",
};

const SYSTEM_TAGS = ["错题", "已掌握", "题目"];

// ===================== 常量定义 =====================
const MAX_EXAM_CONTENT_CHARS = 15000;
const MAX_EXTRACTED_TAGS = 8;
const MAX_WEAK_POINTS_DISPLAY = 8;
const MAX_UNTAGGED_DISPLAY = 10;
const MAX_MASTERED_DISPLAY = 10;
const MAX_REPORT_SNIPPET = 200;
const MAX_HISTORY_SNIPPET = 500;
const AI_REQUEST_TIMEOUT_MS = 180000;
const TOKEN_WARN_THRESHOLD = 6000;
const NOTICE_DURATION_MS = 8000;
const REVIEW_REMINDER_DELAY_MS = 2000;
const WRONG_NOTES_CACHE_TTL_MS = 2000;
const SEARCH_DEBOUNCE_MS = 250;
const PREVIEW_ITEMS_LIMIT = 3;
const RECENT_HISTORY_LIMIT = 10;
const RECENT_DAYS_LIMIT = 5;

// ===================== 工具函数 =====================
export function parseFM(content: string): { meta: Record<string, FmValue>; body: string } {
	if (!content.startsWith("---")) return { meta: {}, body: content };
	const end = content.indexOf("---", 3);
	if (end === -1) return { meta: {}, body: content };
	const yaml = content.slice(3, end).trim();
	const body = content.slice(end + 3).trim();
	const meta: Record<string, FmValue> = {};
	for (const line of yaml.split("\n")) {
		const i = line.indexOf(":");
		if (i === -1) continue;
		const key = line.slice(0, i).trim();
		let val = line.slice(i + 1).trim();
		if (val.startsWith("[") && val.endsWith("]")) {
			meta[key] = val.slice(1, -1).split(",").map(s => s.trim().replace(/^"|"$/g, ""));
		} else if (val === "true") meta[key] = true;
		else if (val === "false") meta[key] = false;
		else meta[key] = val.replace(/^"|"$/g, "");
	}
	return { meta, body };
}

export function buildFM(data: Record<string, FmValue>): string {
	let y = "---\n";
	for (const [k, v] of Object.entries(data)) {
		if (Array.isArray(v)) y += `${k}: [${v.join(", ")}]\n`;
		else if (typeof v === "boolean") y += `${k}: ${v}\n`;
		else if (typeof v === "number") y += `${k}: ${v}\n`;
		else y += `${k}: "${String(v).replace(/"/g, '\\"')}"\n`;
	}
	return y + "---\n\n";
}

export function knowledgeTags(tags: string[]): string[] {
	return tags.filter(t => !SYSTEM_TAGS.includes(t));
}

function buildKnowledgeLinks(tags: string[]): string {
	const kp = knowledgeTags(tags);
	if (kp.length === 0) return "";
	return "\n\n**知识点：** " + kp.map(t => "[[" + t + "]]").join(" ") + "\n";
}

const STOP_WORDS = new Set(["答案", "解析", "题目", "试题", "题干", "选项", "标准", "参考", "正确", "错误", "以上", "以下", "关于", "下列", "其中", "不正确", "正确的是", "错误的是", "单选题", "多选题", "判断题", "填空题", "简答题", "不属于", "以下哪", "下列哪", "对于", "能够", "使用", "以下哪个", "下列哪个", "不是", "属于", "属于以下", "正确答案", "错误答案", "以下说法", "下列说法", "功能", "描述", "实现", "包含", "具有", "通过", "进行", "一个", "多个", "所有", "每个", "可以", "应该", "需要", "已经", "没有", "不能", "将会", "以下关于", "下列关于", "关于以下", "说法正确", "说法错误", "正确的是", "错误的是"]);
const EN_STOP = new Set(["the", "this", "that", "with", "from", "will", "into", "each", "have", "has", "are", "was", "for", "not", "but", "can", "may", "its", "any", "all", "use", "used", "also", "via", "per", "our", "how", "when", "where", "what", "which", "does", "than", "then", "type", "true", "false", "null", "none", "other", "more", "most", "very", "such", "only", "just", "after", "before", "between", "under", "over"]);
const CN_STOP = new Set(["的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "他", "她", "它", "们", "那", "些", "什么", "为", "所", "以", "及", "或", "等", "之", "把", "被", "让", "给", "对", "从", "由", "但", "而", "且", "如果", "虽然", "因为", "所以", "这个", "那个", "这些", "那些", "如何", "怎样", "哪个", "哪些", "则", "后", "前", "内", "外", "中", "下", "间", "时", "年", "月", "日", "号", "个", "种", "次", "第", "该", "其", "此", "若", "当", "于", "作为", "已", "又", "只", "并", "即", "还", "仍", "却", "才", "非", "无", "未", "莫", "勿", "需", "可", "能", "会", "得", "做", "出", "来", "去", "过", "进", "开", "关", "用", "试", "问", "答", "记", "写", "读", "删", "增", "改", "查", "找", "看", "听", "说", "想", "知", "觉", "感", "受", "让", "叫", "请", "求", "许", "准", "禁", "止", "必", "须", "应", "该", "不", "没", "未", "曾", "已", "正", "在", "将", "要", "想", "愿", "肯", "敢", "能", "可", "许", "准", "予", "给", "与", "向", "往", "朝", "距", "离", "到", "至", "从", "自", "由", "经", "过", "通", "过", "凭", "借", "依", "靠", "按", "照", "据", "根", "据", "依", "照", "遵", "循", "顺", "沿", "随", "同", "跟", "和", "与", "及", "或", "还", "又", "也", "均", "都", "全", "总", "共", "计", "合", "共", "一", "共", "凡", "各", "每", "某", "有", "些", "任", "何", "所", "有", "全", "部", "整", "个", "一", "切", "凡", "是", "但", "凡", "只", "要", "一", "旦", "如", "若", "倘", "如", "假", "使", "既", "然", "虽", "然", "尽", "管", "无", "论", "不", "管", "哪", "怕", "即", "使", "哪", "怕", "再", "也", "不", "如", "果", "不", "然", "要", "不", "然", "否", "则", "或", "者", "还", "是", "不", "是", "有", "没", "有", "能", "不", "能", "可", "不", "可", "行", "不", "行", "对", "不", "对", "好", "不", "好", "是", "不", "是", "做", "不", "做", "用", "不", "用", "要", "不", "要"]);

function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
	let timer: number | null = null;
	return ((...args: Parameters<T>) => {
		if (timer !== null) window.clearTimeout(timer);
		timer = window.setTimeout(() => fn(...args), ms);
	}) as T;
}

function extractKnowledgeTags(sourceName: string, questionText: string): string[] {
	const tagCount = new Map<string, number>();

	const nameClean = sourceName.replace(/\[\[|\]\]/g, "").replace(/_错题_\d{4}-\d{2}-\d{2}.*$/, "").replace(/_试题_\d{4}-\d{2}-\d{2}.*$/, "").replace(/\.md$/, "");
	const segments = nameClean.split(/[_\-\s·/\\]+/).filter(s => s.length >= 2);
	const CH_NUM = /^(第[一二三四五六七八九十百千\d]+[章节篇讲部]|[一二三四五六七八九十]+[、.])$/;
	const GENERIC = /^(概述|简介|总结|复习|练习|测试|模拟|真题|期[中末]|考[试查]|作业|课[堂程]|笔记|大纲|目录|附录|参考文献|前言|绪论|引言|摘要|附[录表]|appendix|introduction|summary|overview|review|practice|test|exam|homework|quiz|final|midterm|lecture|course|note|outline|index|appendix|reference|abstract|preface|foreword|body|content|chapter|section|part|volume|book|text|read|material|resource|document|file|doc|txt|pdf|docx|ppt|pptx|xls|xlsx|csv|zip|rar|7z|tar|gz)$/i;
	for (const seg of segments) {
		const s = seg.replace(/[0-9]/g, "").trim();
		if (s.length < 2) continue;
		if (CH_NUM.test(seg) || CH_NUM.test(s)) continue;
		if (GENERIC.test(s)) continue;
		tagCount.set(s, (tagCount.get(s) || 0) + 5);
	}

	const fullText = sourceName + " " + questionText;

	const enPat = /\b[A-Za-z][A-Za-z0-9]{1,30}\b/g;
	let m;
	while ((m = enPat.exec(fullText)) !== null) {
		const term = m[0];
		const lower = term.toLowerCase();
		if (EN_STOP.has(lower)) continue;
		if (SYSTEM_TAGS.includes(lower)) continue;
		if (/^\d+$/.test(term)) continue;
		tagCount.set(term, (tagCount.get(term) || 0) + 1);
	}

	const cnPat = /[\u4e00-\u9fa5]{2,8}/g;
	while ((m = cnPat.exec(fullText)) !== null) {
		const term = m[0];
		if (term.length < 2) continue;
		if (CN_STOP.has(term)) continue;
		if (SYSTEM_TAGS.includes(term)) continue;
		if (STOP_WORDS.has(term)) continue;
		if (/^(答案|解析|题目|试题|题干|选项|标准|参考|正确|错误|以上|以下|关于|下列|其中|不正确|单选|多选|判断|填空|简答)$/.test(term)) continue;
		if (/^第[一二三四五六七八九十百千\d]+$/.test(term)) continue;
		if (/^(下列|以下|关于|对于|通过|使用|实现|包含|具有|功能|描述|进行|属于|能够|可以|需要|已经|没有|不能|将会|以下关于|下列关于|以下说法|下列说法|说法正确|说法错误|正确的是|错误的是|正确答案|不正确|不属于|以下哪|下列哪|以下哪个|下列哪个)$/.test(term)) continue;
		tagCount.set(term, (tagCount.get(term) || 0) + 1);
	}

	const sorted = [...tagCount.entries()].sort((a, b) => b[1] - a[1]);
	return sorted.slice(0, MAX_EXTRACTED_TAGS).map(e => e[0]);
}

function isAbs(p: string): boolean {
	return /^[A-Za-z]:[/\\]/.test(p) || p.startsWith("/");
}

function ensureFolderAbs(dir: string) {
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeFileStr(filePath: string, content: string) {
	fs.writeFileSync(filePath, content, "utf-8");
}

function readFileStr(filePath: string): string {
	return fs.readFileSync(filePath, "utf-8");
}

function listMdFiles(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir).filter((f: string) => f.endsWith(".md"));
}

function deleteFileAbs(filePath: string) {
	if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

async function ensureFolder(app: App, folderPath: string) {
	if (isAbs(folderPath)) {
		ensureFolderAbs(folderPath);
	} else {
		if (folderPath && !app.vault.getAbstractFileByPath(folderPath)) {
			await app.vault.createFolder(folderPath);
		}
	}
}

export function safeName(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\.md$/, "");
}

// ===================== 文本清洗 =====================
export function cleanSourceText(text: string): string {
	let clean = text;
	clean = clean.replace(/```[\s\S]*?```/g, "[代码块已省略]");
	clean = clean.replace(/`[^`\n]+`/g, "");
	clean = clean.replace(/%%[\s\S]*?%%/g, "");
	clean = clean.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
	clean = clean.replace(/\[\[([^\]]+)\]\]/g, "$1");
	clean = clean.replace(/!\[\[([^\]]+)\]\]/g, "");
	clean = clean.replace(/!\[([^\]]*)\]\([^)]+\)/g, "");
	clean = clean.replace(/^#{1,6}\s+/gm, "");
	clean = clean.replace(/\*\*([^*]+)\*\*/g, "$1");
	clean = clean.replace(/\*([^*]+)\*/g, "$1");
	clean = clean.replace(/~~([^~]+)~~/g, "$1");
	clean = clean.replace(/^[-*+]\s+/gm, "");
	clean = clean.replace(/^\d+\.\s+/gm, "");
	clean = clean.replace(/^>\s*/gm, "");
	clean = clean.replace(/---+/gm, "");
	clean = clean.replace(/\|[^|\n]+\|/g, "");
	clean = clean.replace(/\n{3,}/g, "\n\n");
	return clean.trim();
}

export function estimateTokens(text: string): number {
	let count = 0;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		count += (code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF) || (code >= 0x20000 && code <= 0x2A6DF) ? 1.5 : 1;
	}
	return Math.ceil(count);
}

export function stripAnswersForExport(text: string): string {
	const lines = text.split("\n");
	const result: string[] = [];
	let skip = false;
	for (const line of lines) {
		if (/^#{1,6}\s+(单选题|多选题|判断题|填空题|简答题)/.test(line.trim())) {
			skip = false;
			result.push(line);
			continue;
		}
		if (/^(答案[汇总：:]|解析[：:])/.test(line.trim())) {
			skip = true;
			continue;
		}
		if (/^\d+[.、）)]/.test(line.trim()) && skip) {
			skip = false;
		}
		if (!skip) result.push(line);
	}
	return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ===================== 间隔重复 (SM-2) =====================
export function sm2Update(easeFactor: number, interval: number, quality: number): { easeFactor: number; interval: number; nextReview: string } {
	// quality: 0=again, 1=hard, 2=good, 3=easy
	let newEF = easeFactor + (0.1 - (3 - quality) * (0.08 + (3 - quality) * 0.02));
	if (newEF < 1.3) newEF = 1.3;
	if (newEF > 3.0) newEF = 3.0;

	let newInterval: number;
	if (quality <= 1) {
		newInterval = 1; // Again/Hard → 1 day
	} else if (quality === 2) {
		if (interval <= 1) newInterval = 3;
		else if (interval <= 7) newInterval = 7;
		else newInterval = Math.round(interval * newEF);
	} else {
		// Easy
		if (interval <= 1) newInterval = 7;
		else if (interval <= 7) newInterval = 14;
		else newInterval = Math.round(interval * newEF * 1.3);
	}

	const nextDate = new Date();
	nextDate.setDate(nextDate.getDate() + newInterval);
	return {
		easeFactor: Math.round(newEF * 100) / 100,
		interval: newInterval,
		nextReview: nextDate.toISOString().slice(0, 10)
	};
}

export function todayStr(): string {
	return new Date().toISOString().slice(0, 10);
}

export function isDueForReview(note: WrongAnswerNote): boolean {
	if (note.mastered) return false;
	if (!note.nextReview) return false;
	return note.nextReview <= todayStr();
}

// ===================== 题目解析器 =====================
export function stripMd(text: string): string {
	return text
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/\*([^*]+)\*/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/~~([^~]+)~~/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/【/g, "(")
		.replace(/】/g, ")")
		.trim();
}

export function parseQuestions(text: string): ParsedQuestion[] {
	const cleaned = stripMd(text);
	const questions: ParsedQuestion[] = [];

	const answerBlock: Record<number, string> = {};
	const summaryPatterns = [
		/答案[汇总：:\s]*\n([\s\S]*?)$/i,
		/\n答案[汇总：:\s]*\n([\s\S]*?)$/i,
	];
	for (const pat of summaryPatterns) {
		const abMatch = cleaned.match(pat);
		if (abMatch && abMatch[1]) {
			for (const line of abMatch[1].split("\n")) {
				const m = line.trim().match(/^(\d+)[.、）)\s]+([A-D]+)/);
				if (m && m[1] && m[2]) answerBlock[parseInt(m[1])] = m[2].toUpperCase();
			}
			if (Object.keys(answerBlock).length > 0) break;
		}
	}

	let textToParse = cleaned;
	const summaryStart = cleaned.search(/\n\s*答案[汇总：:\s]*\n/);
	if (summaryStart !== -1) {
		textToParse = cleaned.slice(0, summaryStart);
	}

	const qBlocks = textToParse.split(/\n(?=\d+[.、）)\s])/);
	for (const block of qBlocks) {
		const lines = block.split("\n");
		const firstLine = lines[0]?.trim() || "";
		const numMatch = firstLine.match(/^(\d+)[.、）)\s]+\s*(.+)/);
		if (!numMatch || !numMatch[1] || !numMatch[2]) continue;

		const qNum = parseInt(numMatch[1]);
		let qText = numMatch[2].trim();
		qText = qText.replace(/^(?:题干|题目|问题|试题)[：:]\s*/i, "").trim();

		const opts: { label: string; text: string }[] = [];
		let answer = "";
		let explanation = "";

		for (let i = 1; i < lines.length; i++) {
			const line = lines[i]?.trim() || "";
			if (!line) continue;
			if (/^-{3,}$/.test(line)) continue;

			const optMatch = line.match(/^([A-D])[.、）)\s]+\s*(.+)/);
			if (optMatch && optMatch[1] && optMatch[2]) {
				opts.push({ label: optMatch[1], text: optMatch[2].trim() });
				continue;
			}

			const ansLetterMatch = line.match(/(?:标准)?(?:答案|正确答案|Answer)[：:\s]*([A-D]+)/i);
			if (ansLetterMatch && ansLetterMatch[1]) {
				answer = ansLetterMatch[1].toUpperCase();
				continue;
			}

			const noAns = line.match(/(?:标准)?(?:答案|正确答案|Answer)[：:\s]*(正确|错误|对|错|True|False)/i);
			if (noAns && noAns[1]) {
				answer = noAns[1];
				continue;
			}

			const textAns = line.match(/(?:标准)?(?:答案|参考答案)[：:]\s*(.+)/);
			if (textAns && textAns[1] && !answer) {
				answer = textAns[1].trim();
				continue;
			}

			const expMatch = line.match(/(?:解析|Explanation|解释)[：:]\s*(.+)/i);
			if (expMatch && expMatch[1]) {
				explanation = expMatch[1].trim();
				continue;
			}

			if (opts.length === 0 && !answer) qText += " " + line;
		}

		if (!answer && answerBlock[qNum]) answer = answerBlock[qNum];
		if (!answer && opts.length === 0) continue;
		if (opts.length === 0 && !explanation && /^[A-D]{1,4}$/.test(qText)) continue;

		let qType: QuestionType;
		if (opts.length >= 2) {
			const allTexts = opts.map(o => o.text.trim());
			if (opts.length === 2 && (
				(allTexts.includes("正确") && allTexts.includes("错误")) ||
				(allTexts.includes("对") && allTexts.includes("错")) ||
				(allTexts.includes("True") && allTexts.includes("False"))
			)) {
				qType = "judge";
			} else if (answer && answer.length > 1 && /^[A-D]+$/.test(answer)) {
				qType = "multi";
			} else {
				qType = "single";
			}
		} else if (/（[^）]*）/.test(qText) || /\(\s*\.\.\.\s*\)/.test(qText) || /_{2,}/.test(qText) || /\.{3,}/.test(qText)) {
			qType = "blank";
		} else {
			qType = "essay";
		}

		if (qType === "essay" || qType === "blank") {
			questions.push({ number: qNum, type: qType, text: qText, options: [], answer, explanation });
		} else if (opts.length >= 2) {
			questions.push({ number: qNum, type: qType, text: qText, options: opts, answer, explanation });
		}
	}
	return questions;
}

// ===================== 文件选择器（树形） =====================
interface TreeNode {
	name: string;
	path: string;
	isFolder: boolean;
	children: TreeNode[];
	file?: TFile;
}

function buildFileTree(files: TFile[]): TreeNode {
	const root: TreeNode = { name: "", path: "", isFolder: true, children: [] };
	for (const file of files) {
		const parts = file.path.split("/");
		let current = root;
		for (let i = 0; i < parts.length - 1; i++) {
			let child = current.children.find(c => c.isFolder && c.name === parts[i]);
			if (!child) {
				child = { name: parts[i] || "", path: parts.slice(0, i + 1).join("/"), isFolder: true, children: [] };
				current.children.push(child);
			}
			current = child;
		}
		const fileName = parts[parts.length - 1] || "";
		current.children.push({ name: fileName, path: file.path, isFolder: false, file, children: [] });
	}
	return root;
}

// ===================== 排版工具 =====================
export function stripAnswerSummarySection(text: string): string {
	return text.replace(/\n*#{0,3}\s*答案汇总\s*\n[\s\S]*$/, "").trim();
}

const FONT = "Microsoft YaHei";
const FSBody = 22;
const FSSmall = 20;
const AnswerColor = "2E7D32";
const ExplainColor = "1565C0";

const TECH_TERMS = /\b(GPT|API|REST|HTTP|HTTPS|JSON|XML|SQL|CSS|HTML|JavaScript|TypeScript|Python|Java|React|Vue|Angular|Node\.js|Docker|Kubernetes|Git|Linux|Windows|macOS|SDK|IDE|CLI|JWT|OAuth|TCP|UDP|IP|DNS|URL|URI|SSH|FTP|SMTP|WebSocket|GraphQL|gRPC|MQTT|NoSQL|ORM|CRUD|MVC|MVP|MVVM|CI\/CD|DevOps|SaaS|PaaS|IaaS|FaaS|AWS|Azure|GCP|LLM|NLP|AI|ML|DL|CNN|RNN|LSTM|BERT|Transformer|CUDA|GPU|CPU|RAM|ROM|SSD|HDD|LAN|WAN|VPN|CDN|CORS|XSS|CSRF|SQL注入|JWT|RBAC|ABAC|HAL|HATEOAS|WebSocket|Server-Sent Events|Event Loop|Callback|Promise|Async\/Await|Closure|Prototype|Decorator|Middleware|Plugin|Hook|State|Props|Virtual DOM|DOM|BOM|SPA|SSR|SSG|ISR|CSR|PWA|MVC|ORM|DI|IoC|AOP|TDD|BDD|DDD)\b/gi;

export function splitSemantic(text: string): string[] {
	const trimmed = text.trim();
	if (!trimmed) return [];
	if (trimmed.length <= 60) return [trimmed];
	const parts: string[] = [];
	const sentences = trimmed.split(/(?<=[。！？；])\s*/);
	for (const s of sentences) {
		const st = s.trim();
		if (!st) continue;
		if (st.length <= 60) {
			parts.push(st);
		} else {
			const subParts = st.split(/(?<=[，、])\s*/);
			let buf = "";
			for (const sp of subParts) {
				const spTrimmed = sp.trim();
				if (!spTrimmed) continue;
				if (buf.length + spTrimmed.length > 55 && buf) {
					parts.push(buf.trim());
					buf = "";
				}
				buf += spTrimmed;
			}
			if (buf.trim()) parts.push(buf.trim());
		}
	}
	if (parts.length <= 1 && trimmed.length > 60) {
		const numSplit = trimmed.split(/(?=\d+[.、）)]\s*)/);
		if (numSplit.length > 1) {
			return numSplit.map(s => s.trim()).filter(Boolean);
		}
	}
	return parts.length > 0 ? parts : [trimmed];
}

const STEP_TEXT_MAP: Record<string, number> = { "第一": 1, "第二": 2, "第三": 3, "第四": 4, "第五": 5, "第六": 6, "第七": 7, "第八": 8, "第九": 9, "第十": 10, "十一": 11, "十二": 12, "十三": 13, "十四": 14, "十五": 15, "十六": 16, "十七": 17, "十八": 18, "十九": 19, "二十": 20 };

export function normalizeAnswerSteps(text: string): string {
	return text.replace(/(第[一二三四五六七八九十]+)[步点个方面]([：:：]?)\s*/g, (_m, step: string, colon: string) => {
		const num = STEP_TEXT_MAP[step];
		if (!num) return _m;
		return num + ". ";
	});
}

function splitAnswerPoints(raw: string): string[] {
	const trimmed = raw.trim();
	if (!trimmed) return [];
	const parts = trimmed.split(/(?=\d+[.、）)])/);
	const result: string[] = [];
	for (const part of parts) {
		const p = part.trim();
		if (p) result.push(p);
	}
	return result.length > 0 ? result : [trimmed];
}

export function splitAnswerContent(raw: string): string[] {
	const trimmed = normalizeAnswerSteps(raw.trim());
	if (!trimmed) return [];
	if (/\d+[.、）)]/.test(trimmed)) {
		const points = splitAnswerPoints(trimmed);
		if (points.length > 1) return points;
	}
	const lines = trimmed.split("\n").map(l => l.trim()).filter(Boolean);
	if (lines.length > 1) {
		const result: string[] = [];
		for (const line of lines) {
			if (/\d+[.、）)]/.test(line) && line.length > 60) {
				result.push(...splitAnswerPoints(line));
			} else if (line.length <= 80) {
				result.push(line);
			} else {
				result.push(...splitSemantic(line));
			}
		}
		return result;
	}
	if (/\d+[.、）)]/.test(trimmed)) {
		return splitAnswerPoints(trimmed);
	}
	if (trimmed.length > 80) {
		return splitSemantic(trimmed);
	}
	return [trimmed];
}

function highlightTechTerms(text: string): TextRun[] {
	const runs: TextRun[] = [];
	let lastIndex = 0;
	TECH_TERMS.lastIndex = 0;
	let m;
	while ((m = TECH_TERMS.exec(text)) !== null) {
		if (m.index > lastIndex) {
			runs.push(new TextRun({ text: text.slice(lastIndex, m.index), font: FONT, size: FSBody }));
		}
		runs.push(new TextRun({ text: m[0], font: FONT, size: FSBody, underline: { type: UnderlineType.WAVE, color: "FF0000" } }));
		lastIndex = m.index + m[0].length;
	}
	if (lastIndex < text.length) {
		runs.push(new TextRun({ text: text.slice(lastIndex), font: FONT, size: FSBody }));
	}
	return runs.length > 0 ? runs : [new TextRun({ text, font: FONT, size: FSBody })];
}

function highlightTechHtml(text: string): string {
	return text.replace(TECH_TERMS, '<span style="text-decoration:underline wavy red;">$&</span>');
}

export function htmlEscape(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function normalizeExamContent(text: string): string {
	const lines = text.split("\n");
	const result: string[] = [];
	let lastType = "";
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const trimmed = line.trim();
		if (trimmed === "") { if (result.length > 0 && result[result.length - 1] !== "") result.push(""); continue; }
		if (/^#{1,6}\s+/.test(trimmed)) {
			if (result.length > 0 && result[result.length - 1] !== "") result.push("");
			result.push(trimmed);
			lastType = "heading";
			continue;
		}
		if (/^\d+[.、]/.test(trimmed)) {
			if (lastType === "answer" || lastType === "explanation" || lastType === "option" || lastType === "question") {
				if (result.length > 0 && result[result.length - 1] !== "") result.push("");
			}
			result.push(trimmed);
			lastType = "question";
			continue;
		}
		if (/^[A-D][.、]/.test(trimmed)) {
			result.push(trimmed);
			lastType = "option";
			continue;
		}
		if (/^(答案|标准答案|参考答案)[：:]/.test(trimmed)) {
			if (lastType !== "heading" && lastType !== "" && lastType !== "question") {
				if (result.length > 0 && result[result.length - 1] !== "") result.push("");
			}
			result.push(trimmed);
			const content = trimmed.replace(/^(答案|标准答案|参考答案)[：:]/, "").trim();
			if (/\d+[.、）)]/.test(content)) {
				const points = content.split(/(?=\d+[.、）)]\s*)/).map(s => s.trim()).filter(Boolean);
				if (points.length > 1) {
					result.pop();
					const label = trimmed.match(/^(答案|标准答案|参考答案)[：:]/)![0];
					result.push(label);
					for (const p of points) result.push(p);
				}
			}
			lastType = "answer";
			continue;
		}
		if (/^解析[：:]/.test(trimmed)) {
			if (lastType !== "heading") {
				if (result.length > 0 && result[result.length - 1] !== "") result.push("");
			}
			result.push(trimmed);
			lastType = "explanation";
			continue;
		}
		result.push(trimmed);
		lastType = "text";
	}
	while (result.length > 0 && result[result.length - 1] === "") result.pop();
	return result.join("\n");
}

function pushPara(children: Paragraph[], opts: { runs?: TextRun[]; spacing?: { before?: number; after?: number; line?: number }; indent?: { left?: number; right?: number }; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]; heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel] }) {
	if (opts.runs) {
		children.push(new Paragraph({ children: opts.runs, spacing: opts.spacing || { before: 0, after: 0 }, indent: opts.indent, alignment: opts.alignment, heading: opts.heading }));
	}
}

function addEmptyLine(children: Paragraph[], count: number = 1) {
	for (let j = 0; j < count; j++) {
		children.push(new Paragraph({ children: [], spacing: { before: 0, after: 0 } }));
	}
}

// ===================== Word排版 =====================
function buildWordParagraphs(text: string, title?: string, source?: string): Paragraph[] {
	const cleaned = stripAnswerSummarySection(text);
	const rawLines = cleaned.split("\n");
	const children: Paragraph[] = [];

	if (title) {
		children.push(new Paragraph({ text: title, heading: HeadingLevel.HEADING_1, spacing: { before: 0, after: 40 }, alignment: AlignmentType.CENTER }));
	}
	if (source) {
		pushPara(children, { runs: [new TextRun({ text: "来源：" + source, font: FONT, size: FSSmall, color: "888888", italics: true })], spacing: { before: 0, after: 80 }, alignment: AlignmentType.CENTER });
	}

	let lastType = "";

	for (let i = 0; i < rawLines.length; i++) {
		const trimmed = rawLines[i]!.trim();
		if (trimmed === "") continue;

		// ── 题型标题 (## 单选题)
		if (/^#{1,6}\s+/.test(trimmed)) {
			const level = trimmed.match(/^(#{1,6})/)?.[1]?.length || 1;
			const headingMap: Record<number, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
				1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3,
				4: HeadingLevel.HEADING_4, 5: HeadingLevel.HEADING_5, 6: HeadingLevel.HEADING_6,
			};
			children.push(new Paragraph({ text: trimmed.replace(/^#{1,6}\s+/, ""), heading: headingMap[level] || HeadingLevel.HEADING_2, spacing: { before: 160, after: 40 } }));
			lastType = "heading";
			continue;
		}

		// ── 题干 (1. xxx)
		if (/^\d+[.、]/.test(trimmed)) {
			if (lastType === "explanation" || lastType === "answer" || lastType === "option") {
				addEmptyLine(children);
			}
			const match = trimmed.match(/^(\d+[.、]\s*)(.*)/);
			if (match) {
				const stemRuns: TextRun[] = [
					new TextRun({ text: match[1]!, bold: true, font: FONT, size: FSBody }),
					...highlightTechTerms(match[2]!),
				];
				pushPara(children, {
					runs: stemRuns,
					spacing: { before: lastType === "heading" ? 20 : 60, after: 20 },
					indent: { left: 0 }
				});
			}
			lastType = "question";
			continue;
		}

		// ── 选项 (A. xxx)
		if (/^[A-D][.、]/.test(trimmed)) {
			pushPara(children, {
				runs: highlightTechTerms(trimmed),
				spacing: { before: 4, after: 4 },
				indent: { left: 360 }
			});
			lastType = "option";
			continue;
		}

		// ── 答案：独立板块标题（绿色加粗），内容按语义拆行
		if (/^(答案|标准答案|参考答案)[：:]/.test(trimmed)) {
			const match = trimmed.match(/^(答案|标准答案|参考答案)([：:])(.*)/);
			const label = match ? (match[1] || "答案") + (match[2] || "：") : "答案：";
			const inlineContent = match ? (match[3] || "").trim() : "";
			const steps = splitAnswerContent(inlineContent);

			if (lastType !== "heading" && lastType !== "") addEmptyLine(children);

			pushPara(children, {
				runs: [new TextRun({ text: label, bold: true, color: AnswerColor, font: FONT, size: FSBody })],
				spacing: { before: 0, after: 0 },
				indent: { left: 0 }
			});

			for (const step of steps) {
				pushPara(children, {
					runs: highlightTechTerms(step),
					spacing: { before: 2, after: 2 },
					indent: { left: 0 }
				});
			}
			lastType = "answer";
			continue;
		}

		// ── 解析：蓝色标签 + 内容按语义拆行
		if (/^解析[：:]/.test(trimmed)) {
			const match = trimmed.match(/^解析([：:])(.*)/);
			const label = match ? "解析" + (match[1] || "：") : "解析：";
			const content = match ? (match[2] || "").trim() : "";
			const contentLines = splitSemantic(content);

			pushPara(children, {
				runs: [new TextRun({ text: label, bold: true, color: ExplainColor, font: FONT, size: FSSmall })],
				spacing: { before: 4, after: 2 },
				indent: { left: 0 }
			});

			for (const line of contentLines) {
				pushPara(children, {
					runs: highlightTechTerms(line),
					spacing: { before: 0, after: 0 },
					indent: { left: 0 }
				});
			}

			let j = i + 1;
			while (j < rawLines.length) {
				const next = rawLines[j]!.trim();
				if (next === "") { j++; continue; }
				if (/^\d+[.、]/.test(next) || /^#{1,6}\s+/.test(next) || /^(答案|标准答案|参考答案)[：:]/.test(next)) break;
				const subLines = splitSemantic(next);
				for (const sl of subLines) {
					pushPara(children, {
						runs: highlightTechTerms(sl),
						spacing: { before: 0, after: 0 },
						indent: { left: 0 }
					});
				}
				j++;
			}
			i = j - 1;
			lastType = "explanation";
			continue;
		}

		// ── 其他文字
		pushPara(children, {
			runs: highlightTechTerms(trimmed),
			spacing: { before: 4, after: 4 },
			indent: { left: 0 }
		});
		lastType = "text";
	}

	return children;
}

function buildExportHtml(text: string, title?: string, source?: string): string {
	const cleaned = stripAnswerSummarySection(text);
	const rawLines = cleaned.split("\n");
	const dateStr = new Date().toISOString().slice(0, 10);
	const parts: string[] = [];

	if (title) parts.push('<h1 style="text-align:center;margin:0 0 2px;font-size:27px;">' + highlightTechHtml(htmlEscape(title)) + '</h1>');
	if (source) parts.push('<p style="text-align:center;color:#999;font-size:18px;margin:0 0 4px;">来源：' + htmlEscape(source) + '　|　日期：' + dateStr + '</p>');

	let lastType = "";
	for (let i = 0; i < rawLines.length; i++) {
		const trimmed = rawLines[i]!.trim();
		if (trimmed === "") continue;

		if (/^#{1,6}\s+/.test(trimmed)) {
			const level = trimmed.match(/^(#{1,6})/)?.[1]?.length || 1;
			const tag = level <= 2 ? "h2" : "h3";
			const style = level <= 2
				? 'font-size:21px;font-weight:600;color:#1a5276;margin:16px 0 6px;padding-bottom:3px;border-bottom:1.5px solid #3498db;'
				: 'font-size:20px;font-weight:600;color:#2c3e50;margin:12px 0 4px;';
			parts.push('<' + tag + ' style="' + style + '">' + highlightTechHtml(htmlEscape(trimmed.replace(/^#{1,6}\s+/, ''))) + '</' + tag + '>');
			lastType = "heading";
			continue;
		}

		if (/^\d+[.、]/.test(trimmed)) {
			if (lastType === "explanation" || lastType === "answer" || lastType === "option") {
				parts.push('<div style="height:8px;"></div>');
			}
			const match = trimmed.match(/^(\d+[.、]\s*)(.*)/);
			if (match) {
				parts.push('<p style="margin:' + (lastType === "heading" ? "2px" : "6px") + ' 0;font-size:20px;line-height:1.7;"><strong>' + htmlEscape(match[1]!) + '</strong>' + highlightTechHtml(htmlEscape(match[2]!)) + '</p>');
			}
			lastType = "question";
			continue;
		}

		if (/^[A-D][.、]/.test(trimmed)) {
			parts.push('<p style="margin:1px 0 1px 24px;font-size:19px;line-height:1.6;">' + highlightTechHtml(htmlEscape(trimmed)) + '</p>');
			lastType = "option";
			continue;
		}

		if (/^(答案|标准答案|参考答案)[：:]/.test(trimmed)) {
			const match = trimmed.match(/^(答案|标准答案|参考答案)([：:])(.*)/);
			const label = match ? (match[1] || "答案") + (match[2] || "：") : "答案：";
			const inlineContent = match ? (match[3] || "").trim() : "";
			const steps = splitAnswerContent(inlineContent);

			if (lastType !== "heading" && lastType !== "") parts.push('<div style="height:8px;"></div>');
			parts.push('<p style="margin:2px 0;font-size:20px;line-height:1.7;"><strong style="color:#2E7D32;">' + htmlEscape(label) + '</strong></p>');

			for (const step of steps) {
				parts.push('<p style="margin:1px 0;font-size:20px;line-height:1.7;">' + highlightTechHtml(htmlEscape(step)) + '</p>');
			}
			lastType = "answer";
			continue;
		}

		if (/^解析[：:]/.test(trimmed)) {
			const match = trimmed.match(/^解析([：:])(.*)/);
			const label = match ? "解析" + (match[1] || "：") : "解析：";
			const content = match ? (match[2] || "").trim() : "";
			const contentLines = splitSemantic(content);

			parts.push('<p style="margin:2px 0;font-size:19px;line-height:1.7;"><strong style="color:#1565C0;">' + htmlEscape(label) + '</strong></p>');
			for (const line of contentLines) {
				parts.push('<p style="margin:0;font-size:19px;line-height:1.7;">' + highlightTechHtml(htmlEscape(line)) + '</p>');
			}

			let j = i + 1;
			while (j < rawLines.length) {
				const next = rawLines[j]!.trim();
				if (next === "") { j++; continue; }
				if (/^\d+[.、]/.test(next) || /^#{1,6}\s+/.test(next) || /^(答案|标准答案|参考答案)[：:]/.test(next)) break;
				const subLines = splitSemantic(next);
				for (const sl of subLines) {
					parts.push('<p style="margin:0;font-size:19px;line-height:1.7;">' + highlightTechHtml(htmlEscape(sl)) + '</p>');
				}
				j++;
			}
			i = j - 1;
			lastType = "explanation";
			continue;
		}

		parts.push('<p style="margin:2px 0;font-size:20px;line-height:1.7;">' + highlightTechHtml(htmlEscape(trimmed)) + '</p>');
		lastType = "text";
	}

	const body = parts.join("\n");
	return '<html><head><meta charset="utf-8"><style>body{padding:40px 50px;max-width:900px;margin:0 auto;font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:20px;color:#333;}h1{font-size:27px;font-weight:700;text-align:center;color:#222;}p{margin:2px 0;}strong{font-weight:600;}</style></head><body>' + body + '</body></html>';
}

async function exportPdfDirect(filePath: string, text: string, title?: string, source?: string) {
	const fullHtml = buildExportHtml(text, title, source);
	
	const { BrowserWindow } = getElectronRemote();
	const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { offscreen: true } });
	await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(fullHtml));
	const pdfData = await win.webContents.printToPDF({ printBackground: true, pageSize: "A4", marginTop: 0.6, marginBottom: 0.6, marginLeft: 0.5, marginRight: 0.5 });
	fs.writeFileSync(filePath, pdfData);
	win.close();
}

// ===================== 主插件入口 =====================
const SIDEBAR_VIEW_TYPE = "question-generator-sidebar";

class MainSidebarView extends ItemView {
	plugin: QuestionGeneratorPlugin;
	activeSection: "home" | "wrong" | "analytics" | "settings" = "home";
	innerContentEl: HTMLDivElement | null = null;
	navButtons: Map<string, HTMLDivElement> = new Map();
	private _refreshHandler: (() => void) | null = null;

	// Home sub-views
	homeView: "default" | "filePicker" | "generate" | "answer" | "examBrowser" = "default";

	// File picker state
	fpSelected: Set<string> = new Set();
	fpAllFiles: TFile[] = [];

	// Generate state
	genSourceText = "";
	genFileName = "";
	genSourcePath = "";
	genResultText = "";
	genCurrentTags: string[] = [];
	genAITags: string[] = [];
	genAbortController: AbortController | null = null;
	genIsGenerating = false;

	// Exam browser state
	examFiles: TFile[] = [];
	examSelected: Set<string> = new Set();
	examProcessing = false;
	examStatusText = "";

	// Answer state
	answerQuestions: ParsedQuestion[] = [];
	answerAnswers: Map<number, string> = new Map();
	answerResultText = "";
	answerSourceName = "";
	answerSourcePath = "";
	answerCurrentTags: string[] = [];
	answerStartTime = 0;
	answerTimerInterval: ReturnType<typeof window.setInterval> | null = null;
	answerWrongChecked: Set<number> = new Set();

	// Wrong state
	wrongView: "list" | "detail" = "list";
	wrongNotes: WrongAnswerNote[] = [];
	wrongCurrentNote: WrongAnswerNote | null = null;
	wrongSelectedBatch: Set<string> = new Set();
	wrongSortMode: "tag" | "default" | "date" | "source" = "tag";
	questionFileSortMode: "tag" | "default" | "date" = "tag";

	getViewType() { return SIDEBAR_VIEW_TYPE; }
	getDisplayText() { return "智学助手"; }
	getIcon() { return "pencil"; }

	constructor(leaf: WorkspaceLeaf, plugin: QuestionGeneratorPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	async onOpen() {
		this._refreshHandler = () => void this.render();
		this.plugin.onDataChanged(this._refreshHandler);
		await this.render();
	}
	async onClose() {
		if (this._refreshHandler) { this.plugin.offDataChanged(this._refreshHandler); this._refreshHandler = null; }
		if (this.answerTimerInterval) { window.clearInterval(this.answerTimerInterval); this.answerTimerInterval = null; }
		if (this.genAbortController) { this.genAbortController.abort(); this.genAbortController = null; this.genIsGenerating = false; }
		this.innerContentEl = null;
	}

	async render() {
		if (this.answerTimerInterval) { window.clearInterval(this.answerTimerInterval); this.answerTimerInterval = null; }
		const container = this.containerEl.children[1] as HTMLElement;
		if (!container) return;
		container.empty();
		container.addClass("question-generator-sidebar");

		const header = container.createDiv({ attr: { style: "padding:12px 14px 8px;border-bottom:1px solid var(--background-modifier-border);" } });
		header.createDiv({ text: "智学助手", attr: { style: "font-size:21px;font-weight:bold;margin-bottom:8px;" } });

		const nav = container.createDiv({ attr: { style: "display:flex;gap:2px;padding:4px;background:var(--background-secondary);border-radius:6px;margin-bottom:10px;" } });
		const navItems: { key: "home" | "wrong" | "analytics" | "settings"; label: string; icon: string }[] = [
			{ key: "home", label: "首页", icon: "🏠" },
			{ key: "wrong", label: "错题本", icon: "❌" },
			{ key: "analytics", label: "分析", icon: "📊" },
			{ key: "settings", label: "设置", icon: "⚙️" },
		];
		this.navButtons.clear();
		for (const item of navItems) {
			const btn = nav.createDiv({ attr: { style: "flex:1;text-align:center;padding:6px 0;border-radius:4px;cursor:pointer;font-size:18px;transition:background 0.15s;" + (this.activeSection === item.key ? "background:var(--background-modifier-hover);font-weight:600;" : "") } });
			btn.setText(item.icon + " " + item.label);
			btn.addEventListener("click", () => {
				this.activeSection = item.key;
				if (item.key === "home") this.homeView = "default";
				if (item.key === "wrong") this.wrongView = "list";
				void this.render();
			});
			this.navButtons.set(item.key, btn);
		}

		this.innerContentEl = container.createDiv({ attr: { style: "flex:1;overflow-y:auto;padding:0 14px 14px;" } });

		switch (this.activeSection) {
			case "home": await this.renderHomeTab(); break;
			case "wrong": await this.renderWrongTab(); break;
			case "analytics": await this.renderAnalyticsTab(); break;
			case "settings": this.renderSettingsTab(); break;
		}
	}

	// ===================== HOME TAB =====================
	async renderHomeTab() {
		if (!this.innerContentEl) return;
		switch (this.homeView) {
			case "default": await this.renderHomeDefault(); break;
			case "filePicker": this.renderFilePicker(); break;
			case "generate": this.renderGenerateView(); break;
			case "answer": this.renderAnswerView(); break;
			case "examBrowser": await this.renderExamBrowser(); break;
		}
	}

	async renderHomeDefault() {
		if (!this.innerContentEl) return;
		const el = this.innerContentEl;
		el.empty();

		const stats = await this.getStats();

		const statsGrid = el.createDiv({ attr: { style: "display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:14px;" } });
		const miniCard = (label: string, value: string, color?: string) => {
			const c = statsGrid.createDiv({ attr: { style: "text-align:center;padding:10px 6px;border-radius:6px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);cursor:pointer;" } });
			c.createDiv({ text: value, attr: { style: "font-size:29px;font-weight:bold;" + (color ? "color:" + color + ";" : "") } });
			c.createDiv({ text: label, attr: { style: "color:var(--text-muted);font-size:17px;margin-top:2px;" } });
			return c;
		};
		const dueCard = miniCard("待复习", String(stats.dueCount), stats.dueCount > 0 ? "var(--interactive-accent)" : undefined);
		dueCard.addEventListener("click", () => { this.activeSection = "wrong"; this.wrongView = "list"; void this.render(); });
		miniCard("错题总数", String(stats.totalWrong));
		miniCard("已掌握", String(stats.mastered), stats.mastered > 0 ? "var(--color-green)" : undefined);
		miniCard("出题次数", String(stats.totalGenerated));

		const actSection = el.createDiv({ attr: { style: "margin-bottom:14px;" } });
		actSection.createDiv({ text: "快捷操作", attr: { style: "font-size:18px;font-weight:600;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;" } });

		const actions = [
			{ label: "📝 当前文档出题", desc: "基于当前打开的文档", action: () => this.openCurrentFileGenerate() },
			{ label: "📂 选择文件出题", desc: "从知识库选择文件", action: () => { this.homeView = "filePicker"; void this.renderHomeTab(); } },
			{ label: "🎯 薄弱点出题", desc: "针对薄弱知识点", badge: stats.weakCount > 0 ? String(stats.weakCount) : undefined, action: async () => { await this.generateFromWeakPoints(); } },
			{ label: "📋 AI识别试卷", desc: "从文档中AI提取题目并答题", action: () => { this.homeView = "examBrowser"; void this.renderHomeTab(); } },
		];
		for (const act of actions) {
			const row = el.createDiv({ cls: "qg-action-row" });
			row.createSpan({ text: act.label, cls: "qg-action-label" });
			if (act.badge) row.createSpan({ text: act.badge, cls: "qg-badge" });
			row.addEventListener("click", () => { void act.action(); });
		}

		if (stats.dueCount > 0) {
			const reviewSection = el.createDiv({ attr: { style: "padding:10px;border-radius:6px;border:2px solid var(--interactive-accent);background:color-mix(in srgb, var(--interactive-accent) 5%, transparent);margin-bottom:14px;" } });
			reviewSection.createDiv({ text: "今日待复习 " + stats.dueCount + " 题", attr: { style: "font-weight:600;font-size:19px;margin-bottom:6px;" } });
			const dueNotes = await this.getDueNotes();
			for (const note of dueNotes.slice(0, PREVIEW_ITEMS_LIMIT)) {
				const item = reviewSection.createDiv({ attr: { style: "display:flex;align-items:center;gap:6px;padding:4px 0;font-size:18px;border-bottom:1px solid var(--background-modifier-border);" } });
				item.createSpan({ text: note.sourceFile || note.baseName, attr: { style: "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" } });
				const btn = item.createSpan({ text: "复习", attr: { style: "padding:2px 8px;border-radius:4px;background:var(--interactive-accent);color:var(--text-on-accent);cursor:pointer;font-size:17px;" } });
				btn.addEventListener("click", () => { this.activeSection = "wrong"; this.wrongView = "detail"; this.wrongCurrentNote = note; void this.render(); });
			}
			if (stats.dueCount > 3) reviewSection.createDiv({ text: "还有" + (stats.dueCount - 3) + "题...", attr: { style: "font-size:17px;color:var(--text-muted);padding-top:4px;" } });
		}

		await this.renderQuestionFiles(el);
	}

	async renderQuestionFiles(el: HTMLElement) {
		const folder = this.plugin.settings.questionFolder;
		if (!folder) return;
		const files = await this.listQuestionFiles(folder);
		const section = el.createDiv({});
		const headerRow = section.createDiv({ attr: { style: "display:flex;align-items:center;gap:8px;margin-bottom:6px;" } });
		headerRow.createDiv({ text: "出题文件 (" + files.length + ")", attr: { style: "font-size:18px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;flex:1;" } });
		const modeBar = headerRow.createDiv({ attr: { style: "display:flex;gap:2px;" } });
		const sortModes: { key: "tag" | "default" | "date"; label: string }[] = [
			{ key: "tag", label: "按知识点" },
			{ key: "default", label: "默认" },
			{ key: "date", label: "按时间" },
		];
		for (const m of sortModes) {
			const mb = modeBar.createEl("button", { text: m.label, attr: { style: "padding:2px 6px;border-radius:3px;cursor:pointer;font-size:16px;border:1px solid var(--background-modifier-border);background:" + (this.questionFileSortMode === m.key ? "var(--interactive-accent);color:var(--text-on-accent);" : "var(--background-secondary);color:var(--text-muted);") } });
			mb.addEventListener("click", () => { this.questionFileSortMode = m.key; void this.renderHomeTab(); });
		}
		if (files.length === 0) {
			section.createDiv({ text: "暂无出题文件", attr: { style: "color:var(--text-faint);font-size:18px;text-align:center;padding:12px 0;" } });
			return;
		}
		const fileData: { file: TFile; tags: string[] }[] = [];
		for (const file of files) {
			try {
				let content = "";
				if (isAbs(folder)) { content = readFileStr(file.path); } else { content = await this.app.vault.read(file); }
				const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
				let tags: string[] = [];
				if (fmMatch) {
					const tagMatch = fmMatch[1]!.match(/tags:\s*\[([^\]]*)\]/);
					if (tagMatch) tags = tagMatch[1]!.split(",").map(s => s.trim()).filter(Boolean);
				}
				fileData.push({ file, tags });
			} catch { fileData.push({ file, tags: [] }); }
		}

		const tagGroups: Record<string, { file: TFile; tags: string[] }[]> = {};
		const untagged: { file: TFile; tags: string[] }[] = [];
		for (const fd of fileData) {
			const kp = knowledgeTags(fd.tags);
			if (kp.length === 0) { untagged.push(fd); continue; }
			for (const t of kp) {
				if (!tagGroups[t]) tagGroups[t] = [];
				tagGroups[t].push(fd);
			}
		}
		const sortedTags = Object.entries(tagGroups).sort((a, b) => b[1].length - a[1].length);

		const searchEl = section.createEl("input", { attr: { type: "text", placeholder: "搜索文件名...", style: "width:100%;padding:5px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);font-size:18px;margin-bottom:8px;" } });
		const listEl = section.createDiv({});

		const renderFileItem = (container: HTMLElement, fd: { file: TFile; tags: string[] }) => {
			const file = fd.file;
			const item = container.createDiv({ attr: { style: "display:flex;align-items:center;gap:4px;padding:6px 4px;border-bottom:1px solid var(--background-modifier-border);font-size:18px;" } });
			const nameEl = item.createSpan({ text: file.name, attr: { style: "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;cursor:pointer;" } });
			nameEl.addEventListener("click", () => { void this.app.workspace.openLinkText(file.path, "", false); });
			const kp = knowledgeTags(fd.tags);
			if (kp.length > 0) item.createSpan({ text: "#" + kp[0], cls: "qg-file-tag" });
			item.createSpan({ text: Math.round(file.stat.size / 1024) + "KB", cls: "qg-file-size" });
			const d = new Date(file.stat.mtime);
			item.createSpan({ text: (d.getMonth() + 1) + "/" + d.getDate(), cls: "qg-file-date" });
			const actRow = item.createDiv({ cls: "qg-file-actions" });
			const actBtn = (label: string, tip: string, cb: () => void) => {
				const b = actRow.createSpan({ text: label, attr: { title: tip }, cls: "qg-file-btn" });
				b.addEventListener("click", (e) => { e.stopPropagation(); cb(); });
			};
			actBtn("📖", "在Obsidian中打开", () => { void this.app.workspace.openLinkText(file.path, "", false).catch(() => {}); });
			actBtn("✏️", "答题", () => {
				void (async () => {
					const content = isAbs(folder) ? readFileStr(file.path) : await this.app.vault.read(file);
					const clean = content.replace(/^---[\s\S]*?---\s*/, "");
					this.startAnswer(clean, file.basename, file.path);
				})();
			});
			actBtn("📤", "导出", () => {
				void (async () => {
					const content = isAbs(folder) ? readFileStr(file.path) : await this.app.vault.read(file);
					const clean = content.replace(/^---[\s\S]*?---\s*/, "");
					const baseName = file.basename.replace(/_试题.*$/, "");
					
					const r = await getElectronRemote().dialog.showSaveDialog({ defaultPath: file.basename + ".docx", filters: [{ name: "Word", extensions: ["docx"] }, { name: "PDF", extensions: ["pdf"] }, { name: "Markdown", extensions: ["md"] }] });
					if (r.canceled || !r.filePath) return;
					const fp = r.filePath;
					if (fp.endsWith(".docx")) {
						const children = buildWordParagraphs(clean, baseName + " 配套试题", baseName);
						const doc = new Document({ sections: [{ properties: {}, children }] });
						const buffer = await Packer.toBuffer(doc);
						fs.writeFileSync(fp, Buffer.from(buffer));
						new Notice("Word已保存");
					} else if (fp.endsWith(".pdf")) {
						await exportPdfDirect(fp, clean, baseName + " 配套试题", baseName);
						new Notice("PDF已保存");
					} else {
						fs.writeFileSync(fp, clean, "utf-8");
						new Notice("Md已保存");
					}
				})();
			});
			actBtn("✏", "重命名", () => {
				void (async () => {
					const newName = prompt("输入新文件名（不含扩展号）：", file.basename);
					if (!newName || newName === file.basename) return;
					try {
						if (isAbs(folder)) {
							const ext = file.name.endsWith(".md") ? ".md" : "";
							fs.renameSync(file.path, folder + "\\" + newName + ext);
						} else {
							await this.app.fileManager.renameFile(file, folder + "/" + newName + ".md");
						}
						new Notice("已重命名");
						void this.render();
					} catch (err) { new Notice("重命名失败：" + (err as Error).message); }
				})();
			});
			actBtn("🗑", "删除", () => {
				void (async () => {
					if (!confirm("确定删除 " + file.name + "？")) return;
					try {
						if (isAbs(folder)) { deleteFileAbs(file.path); } else { await this.app.fileManager.trashFile(file); }
						new Notice("已删除");
						void this.render();
					} catch (err) { new Notice("删除失败：" + (err as Error).message); }
				})();
			});
			item.addEventListener("mouseenter", () => item.setCssProps({ background: "var(--background-modifier-hover)" }));
			item.addEventListener("mouseleave", () => item.setCssProps({ background: "" }));
		};

		const renderList = (query: string) => {
			listEl.empty();
			const filtered = query ? fileData.filter(fd => fd.file.name.toLowerCase().includes(query.toLowerCase())) : fileData;
			if (filtered.length === 0) { listEl.createDiv({ text: "无匹配文件", attr: { style: "color:var(--text-muted);text-align:center;padding:8px;font-size:18px;" } }); return; }
			if (query || this.questionFileSortMode === "default") {
				for (const fd of filtered) renderFileItem(listEl, fd);
			} else if (this.questionFileSortMode === "date") {
				const sorted = [...filtered].sort((a, b) => (b.file.stat.mtime || 0) - (a.file.stat.mtime || 0));
				for (const fd of sorted) renderFileItem(listEl, fd);
			} else {
				for (const [tag, tagFiles] of sortedTags) {
					const group = listEl.createDiv({ attr: { style: "margin-bottom:8px;border:1px solid var(--background-modifier-border);border-radius:6px;overflow:hidden;" } });
					const header = group.createDiv({ attr: { style: "display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:pointer;background:var(--background-secondary);" } });
					const arrow = header.createSpan({ text: "▸", attr: { style: "font-size:17px;color:var(--text-muted);min-width:14px;" } });
					header.createSpan({ text: "#" + tag, attr: { style: "font-weight:600;font-size:18px;color:var(--interactive-accent);flex:1;" } });
					header.createSpan({ text: tagFiles.length + "个", attr: { style: "font-size:17px;color:var(--text-muted);" } });
					const list = group.createDiv({ attr: { style: "display:none;padding:4px 8px;" } });
					for (const fd of tagFiles) renderFileItem(list, fd);
					let expanded = false;
					header.addEventListener("click", () => { expanded = !expanded; list.style.display = expanded ? "block" : "none"; arrow.setText(expanded ? "▾" : "▸"); });
				}
				if (untagged.length > 0) {
					listEl.createDiv({ text: "未分类", attr: { style: "font-size:18px;font-weight:600;color:var(--text-muted);margin:10px 0 6px;" } });
					for (const fd of untagged) renderFileItem(listEl, fd);
				}
			}
		};
		searchEl.addEventListener("input", debounce(() => renderList(searchEl.value), SEARCH_DEBOUNCE_MS));
		renderList("");
	}

	async listQuestionFiles(folder: string): Promise<TFile[]> {
		if (isAbs(folder)) {
			try {
				if (!fs.existsSync(folder)) return [];
				const files = fs.readdirSync(folder).filter((f: string) => f.endsWith(".md"));
				return files.map((f: string) => {
					const fp = path.join(folder, f);
					const stat = fs.statSync(fp);
					return { name: f, path: fp, basename: f.replace(/\.md$/, ""), stat: { mtime: stat.mtimeMs } } as unknown as TFile;
				}).sort((a: TFile, b: TFile) => (b.stat.mtime || 0) - (a.stat.mtime || 0));
			} catch { return []; }
		}
		try {
			const tfolder = this.app.vault.getAbstractFileByPath(folder);
			if (!tfolder || !(tfolder instanceof TFolder)) return [];
			return (tfolder.children as TFile[]).filter(f => f instanceof TFile && f.name.endsWith(".md")).sort((a, b) => (b.stat.mtime || 0) - (a.stat.mtime || 0));
		} catch { return []; }
	}

	// ===================== WRONG TAB =====================
	async renderWrongTab() {
		if (!this.innerContentEl) return;
		if (this.wrongView === "detail" && this.wrongCurrentNote) {
			this.renderWrongDetail();
		} else {
			await this.renderWrongList();
		}
	}

	async renderWrongList() {
		if (!this.innerContentEl) return;
		const el = this.innerContentEl;
		el.empty();

		const notes = await this.plugin.loadAllWrongNotes();
		this.wrongNotes = notes;
		const unmastered = notes.filter((n: WrongAnswerNote) => !n.mastered);
		const mastered = notes.filter((n: WrongAnswerNote) => n.mastered);
		const dueNotes = notes.filter((n: WrongAnswerNote) => isDueForReview(n));

		const statsRow = el.createDiv({ attr: { style: "display:flex;gap:6px;margin-bottom:10px;font-size:18px;" } });
		statsRow.createSpan({ text: "待复习 " + unmastered.length, attr: { style: "padding:3px 8px;border-radius:4px;background:color-mix(in srgb, var(--color-orange) 15%, transparent);color:var(--color-orange);font-weight:600;" } });
		statsRow.createSpan({ text: "已掌握 " + mastered.length, attr: { style: "padding:3px 8px;border-radius:4px;background:color-mix(in srgb, var(--color-green) 15%, transparent);color:var(--color-green);" } });

		const modeBar = el.createDiv({ attr: { style: "display:flex;gap:2px;margin-bottom:10px;" } });
		const sortModes: { key: "tag" | "source" | "date" | "default"; label: string }[] = [
			{ key: "tag", label: "按知识点" },
			{ key: "source", label: "按源文件" },
			{ key: "date", label: "按时间" },
			{ key: "default", label: "默认" },
		];
		for (const m of sortModes) {
			const mb = modeBar.createEl("button", { text: m.label, attr: { style: "padding:3px 8px;border-radius:3px;cursor:pointer;font-size:17px;border:1px solid var(--background-modifier-border);background:" + (this.wrongSortMode === m.key ? "var(--interactive-accent);color:var(--text-on-accent);" : "var(--background-secondary);color:var(--text-muted);") } });
			mb.addEventListener("click", () => { this.wrongSortMode = m.key; void this.renderWrongTab(); });
		}

		if (dueNotes.length > 0) {
			const dueBtn = el.createDiv({ attr: { style: "padding:10px;margin-bottom:10px;border-radius:6px;border:2px solid var(--interactive-accent);background:color-mix(in srgb, var(--interactive-accent) 5%, transparent);cursor:pointer;text-align:center;font-weight:600;font-size:19px;" } });
			dueBtn.setText("开始今日复习 (" + dueNotes.length + "题)");
			dueBtn.addEventListener("click", () => { this.wrongView = "detail"; this.wrongCurrentNote = dueNotes[0]!; void this.renderWrongTab(); });
		}

		const listEl = el.createDiv({});

		if (this.wrongSortMode === "default") {
			for (const note of unmastered) this.renderWrongNoteItem(listEl, note);
		} else if (this.wrongSortMode === "date") {
			const sorted = [...unmastered].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
			for (const note of sorted) this.renderWrongNoteItem(listEl, note);
		} else if (this.wrongSortMode === "source") {
			const sourceGroups: Record<string, WrongAnswerNote[]> = {};
			const noSource: WrongAnswerNote[] = [];
			for (const note of unmastered) {
				const src = (note.sourceFile || "").replace(/\[\[|\]\]/g, "").trim();
				if (!src) { noSource.push(note); continue; }
				if (!sourceGroups[src]) sourceGroups[src] = [];
				sourceGroups[src].push(note);
			}
			const sortedSources = Object.entries(sourceGroups).sort((a, b) => b[1].length - a[1].length);
			for (const [src, srcNotes] of sortedSources) {
				const group = listEl.createDiv({ attr: { style: "margin-bottom:8px;border:1px solid var(--background-modifier-border);border-radius:6px;overflow:hidden;" } });
				const header = group.createDiv({ attr: { style: "display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:pointer;background:var(--background-secondary);" } });
				const arrow = header.createSpan({ text: "▸", attr: { style: "font-size:17px;color:var(--text-muted);min-width:14px;" } });
				header.createSpan({ text: src, attr: { style: "font-weight:600;font-size:18px;color:var(--interactive-accent);flex:1;" } });
				header.createSpan({ text: srcNotes.length + "题", attr: { style: "font-size:17px;color:var(--text-muted);" } });
				const list = group.createDiv({ attr: { style: "display:none;padding:4px 8px;" } });
				for (const note of srcNotes) this.renderWrongNoteItem(list, note);
				let expanded = false;
				header.addEventListener("click", () => { expanded = !expanded; list.style.display = expanded ? "block" : "none"; arrow.setText(expanded ? "▾" : "▸"); });
			}
			if (noSource.length > 0) {
				listEl.createDiv({ text: "未分类", attr: { style: "font-size:18px;font-weight:600;color:var(--text-muted);margin:10px 0 6px;" } });
				for (const note of noSource) this.renderWrongNoteItem(listEl, note);
			}
		} else {
			const tagGroups: Record<string, WrongAnswerNote[]> = {};
			const untagged: WrongAnswerNote[] = [];
			for (const note of unmastered) {
				const kp = knowledgeTags(note.tags);
				if (kp.length === 0) { untagged.push(note); continue; }
				for (const t of kp) {
					if (!tagGroups[t]) tagGroups[t] = [];
					tagGroups[t].push(note);
				}
			}
			const sortedTags = Object.entries(tagGroups).sort((a, b) => b[1].length - a[1].length);
			for (const [tag, tagNotes] of sortedTags) {
				const group = listEl.createDiv({ attr: { style: "margin-bottom:8px;border:1px solid var(--background-modifier-border);border-radius:6px;overflow:hidden;" } });
				const header = group.createDiv({ attr: { style: "display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:pointer;background:var(--background-secondary);" } });
				const arrow = header.createSpan({ text: "▸", attr: { style: "font-size:17px;color:var(--text-muted);min-width:14px;" } });
				header.createSpan({ text: "#" + tag, attr: { style: "font-weight:600;font-size:18px;color:var(--interactive-accent);flex:1;" } });
				header.createSpan({ text: tagNotes.length + "题", attr: { style: "font-size:17px;color:var(--text-muted);" } });
				const list = group.createDiv({ attr: { style: "display:none;padding:4px 8px;" } });
				for (const note of tagNotes) this.renderWrongNoteItem(list, note);
				let expanded = false;
				header.addEventListener("click", () => { expanded = !expanded; list.style.display = expanded ? "block" : "none"; arrow.setText(expanded ? "▾" : "▸"); });
			}
			if (untagged.length > 0) {
				listEl.createDiv({ text: "未分类", attr: { style: "font-size:18px;font-weight:600;color:var(--text-muted);margin:10px 0 6px;" } });
				for (const note of untagged.slice(0, MAX_UNTAGGED_DISPLAY)) this.renderWrongNoteItem(listEl, note);
				if (untagged.length > 10) listEl.createDiv({ text: "还有" + (untagged.length - 10) + "题...", attr: { style: "font-size:17px;color:var(--text-muted);text-align:center;padding:6px;" } });
			}
		}

		if (mastered.length > 0) {
			const mh = el.createDiv({ attr: { style: "cursor:pointer;color:var(--text-muted);font-size:18px;padding:6px;margin-top:10px;" } });
			mh.createSpan({ text: "已掌握 (" + mastered.length + ") ▸" });
			let show = false;
			const mc = el.createDiv({ attr: { style: "display:none;" } });
			mh.addEventListener("click", () => { show = !show; mc.style.display = show ? "block" : "none"; mh.querySelector("span")!.textContent = "已掌握 (" + mastered.length + ") " + (show ? "▾" : "▸"); });
			for (const note of mastered.slice(0, MAX_MASTERED_DISPLAY)) this.renderWrongNoteItem(mc, note);
			el.appendChild(mc);
		}

		if (notes.length === 0) {
			el.createDiv({ text: "暂无错题记录", attr: { style: "color:var(--text-faint);text-align:center;padding:20px 0;font-size:19px;" } });
		}
	}

	renderWrongNoteItem(container: HTMLDivElement, note: WrongAnswerNote) {
		const item = container.createDiv({ attr: { style: "display:flex;align-items:center;gap:6px;padding:6px 8px;margin-bottom:4px;border-radius:4px;border:1px solid var(--background-modifier-border);font-size:18px;cursor:pointer;transition:background 0.15s;" } });
		const nameText = (note.sourceFile || note.baseName).replace(/\[\[|\]\]/g, "");
		const nameEl = item.createSpan({ text: nameText, attr: { style: "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:var(--interactive-accent);cursor:pointer;" } });
		nameEl.addEventListener("click", (e) => {
			e.stopPropagation();
			const noteFile = this.app.vault.getFiles().find(f => f.path === note.filePath || f.basename === note.baseName);
			if (noteFile) { this.app.workspace.openLinkText(noteFile.path, "", false).catch(() => {}); return; }
			const srcFile = this.app.vault.getFiles().find(f => f.basename === nameText || f.name === nameText);
			if (srcFile) this.app.workspace.openLinkText(srcFile.path, "", false).catch(() => {});
			else new Notice("找不到文件：" + nameText);
		});
		if (note.tags.length > 0) {
			const kTags = knowledgeTags(note.tags);
			if (kTags.length > 0) item.createSpan({ text: "#" + kTags[0], cls: "qg-note-tag" });
		}
		const delBtn = item.createSpan({ text: "×", cls: "qg-note-del" });
		delBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			void (async () => {
				if (!confirm("确定从错题本移除？")) return;
				await this.plugin.deleteWrongNote(note.filePath);
				void this.renderWrongTab();
			})();
		});
		item.classList.add("qg-hover-bg");
	}

	renderWrongDetail() {
		if (!this.innerContentEl || !this.wrongCurrentNote) return;
		const el = this.innerContentEl;
		el.empty();
		const note = this.wrongCurrentNote;

		const backBtn = el.createEl("button", { text: "← 返回列表", attr: { style: "padding:4px 10px;border-radius:4px;cursor:pointer;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);font-size:19px;margin-bottom:12px;" } });
		backBtn.addEventListener("click", () => { this.wrongView = "list"; this.wrongCurrentNote = null; void this.renderWrongTab(); });

		el.createDiv({ text: "加入时间：" + note.date, attr: { style: "color:var(--text-muted);font-size:18px;margin-bottom:6px;" } });
		if (note.tags.length > 0) {
			const tE = el.createDiv({ attr: { style: "margin-bottom:6px;" } });
			for (const t of note.tags) tE.createSpan({ text: "#" + t, attr: { style: "font-size:17px;color:var(--interactive-accent);margin-right:6px;" } });
		}
		if (note.note) el.createDiv({ text: "备注：" + note.note, attr: { style: "color:var(--text-faint);font-size:18px;font-style:italic;margin-bottom:8px;" } });
		el.createDiv({ text: note.resultText, attr: { style: "border:1px solid var(--background-modifier-border);border-radius:6px;padding:10px;max-height:400px;overflow-y:auto;white-space:pre-wrap;font-size:19px;line-height:1.6;" } });

		const btnRow = el.createDiv({ attr: { style: "margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;" } });
		const actBtn = (label: string, cls: string, cb: () => void) => {
			const b = btnRow.createEl("button", { text: label, attr: { class: cls, style: "padding:4px 10px;border-radius:4px;cursor:pointer;font-size:18px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);" } });
			b.addEventListener("click", cb);
		};
		actBtn("查看错题文件", "mod-cta", () => {
			const noteFile = this.app.vault.getFiles().find(f => f.path === note.filePath || f.basename === note.baseName);
			if (noteFile) { this.app.workspace.openLinkText(noteFile.path, "", false).catch(() => {}); }
			else new Notice("找不到错题文件");
		});
		actBtn("开始答题", "", () => {
			if (!note.resultText) { new Notice("无题目内容"); return; }
			this.startAnswer(note.resultText, note.sourceFile || note.baseName, note.sourcePath || "");
		});
		if (!note.mastered) actBtn("标记已掌握", "", () => { void this.wrongMarkMastered(note); });
		actBtn("基于原文重新出题", "", () => { void this.wrongRePracticeSingle(note); });
		actBtn("导出MD", "", () => { void this.wrongExportNote(note, "md"); });
		actBtn("导出Word", "", () => { void this.wrongExportNote(note, "word"); });
		actBtn("导出PDF", "", () => { void this.wrongExportNote(note, "pdf"); });
		actBtn("删除", "mod-warning", () => { void this.wrongDeleteNote(note); });

		if (!note.mastered) {
			const due = isDueForReview(note);
			const reviewSection = el.createDiv({ attr: { style: "margin-top:12px;padding:12px;border-radius:8px;border:1px solid " + (due ? "var(--interactive-accent)" : "var(--background-modifier-border)") + ";background:" + (due ? "color-mix(in srgb, var(--interactive-accent) 5%, transparent)" : "var(--background-secondary)") + ";" } });
			const dueInfo = due ? "已到复习时间" : "下次复习: " + (note.nextReview || "未设置");
			reviewSection.createDiv({ text: dueInfo + "　间隔: " + note.interval + "天　已复习" + note.reviewCount + "次", attr: { style: "font-size:18px;color:var(--text-muted);margin-bottom:8px;" } });
			reviewSection.createDiv({ text: "答题后评价掌握程度：", attr: { style: "font-size:19px;font-weight:600;margin-bottom:8px;" } });
			const qRow = reviewSection.createDiv({ attr: { style: "display:flex;gap:6px;flex-wrap:wrap;" } });
			const qualities = [
				{ label: "完全不会", quality: 0, color: "var(--color-red)" },
				{ label: "很困难", quality: 1, color: "var(--color-orange)" },
				{ label: "记住了", quality: 2, color: "var(--color-yellow)" },
				{ label: "很简单", quality: 3, color: "var(--color-green)" }
			];
			for (const q of qualities) {
				const btn = qRow.createEl("button", { text: q.label, attr: { style: "padding:4px 10px;border-radius:4px;cursor:pointer;font-size:18px;border:2px solid " + q.color + ";background:var(--background-secondary);color:var(--text-normal);" } });
				btn.addEventListener("click", () => { void (async () => { await this.wrongUpdateScheduling(note, q.quality); })(); });
			}
		}
	}

	async wrongMarkMastered(note: WrongAnswerNote, silent = false) {
		if (isAbs(this.plugin.settings.wrongBookFolder)) {
			const content = readFileStr(note.filePath);
			const { meta, body } = parseFM(content);
			meta.mastered = true;
			if (Array.isArray(meta.tags)) { meta.tags = meta.tags.filter((t: string) => t !== "错题"); if (!meta.tags.includes("已掌握")) meta.tags.push("已掌握"); }
			writeFileStr(note.filePath, buildFM(meta) + body);
		} else {
			const file = this.app.vault.getAbstractFileByPath(note.filePath);
			if (!(file instanceof TFile)) return;
			const content = await this.app.vault.read(file);
			const { meta, body } = parseFM(content);
			meta.mastered = true;
			if (Array.isArray(meta.tags)) { meta.tags = meta.tags.filter((t: string) => t !== "错题"); if (!meta.tags.includes("已掌握")) meta.tags.push("已掌握"); }
			await this.app.vault.modify(file, buildFM(meta) + body);
		}
		if (!silent) new Notice("已标记为掌握");
		this.plugin.emitDataChanged();
		this.wrongView = "list";
		this.wrongCurrentNote = null;
		await this.renderWrongTab();
	}

	async wrongDeleteNote(note: WrongAnswerNote) {
		if (isAbs(this.plugin.settings.wrongBookFolder)) deleteFileAbs(note.filePath);
		else { const file = this.app.vault.getAbstractFileByPath(note.filePath); if (file instanceof TFile) await this.app.fileManager.trashFile(file); }
		new Notice("已删除");
		this.plugin.emitDataChanged();
		this.wrongView = "list";
		this.wrongCurrentNote = null;
		await this.renderWrongTab();
	}

	async wrongRePracticeSingle(note: WrongAnswerNote) {
		const srcName = note.sourceFile.replace(/\[\[|\]\]/g, "");
		let sourceText = "";
		let found = false;
		let srcPath = "";
		const src = this.app.vault.getFiles().find(f => f.basename === srcName || f.name === srcName);
		if (src) { sourceText = await this.app.vault.read(src); found = true; srcPath = src.path; }
		else if (isAbs(this.plugin.settings.questionFolder)) {
			const qDir = this.plugin.settings.questionFolder;
			if (fs.existsSync(qDir)) {
				for (const f of fs.readdirSync(qDir)) {
					if (f.includes(srcName) && f.endsWith(".md")) { sourceText = readFileStr(qDir + "\\" + f); found = true; srcPath = qDir + "\\" + f; break; }
				}
			}
		}
		if (found) { this.startGenerate(sourceText, srcName, srcPath); }
		else new Notice("源文件不存在");
	}

	async wrongRePracticeDue() {
		const dueNotes = this.wrongNotes.filter(n => !n.mastered && isDueForReview(n));
		const sources: string[] = [];
		const paths: string[] = [];
		for (const note of dueNotes) {
			const srcName = note.sourceFile.replace(/\[\[|\]\]/g, "");
			const src = this.app.vault.getFiles().find(f => f.basename === srcName || f.name === srcName);
			if (src) { sources.push(await this.app.vault.read(src)); paths.push(src.path); }
			else if (isAbs(this.plugin.settings.questionFolder)) {
				const qDir = this.plugin.settings.questionFolder;
				if (fs.existsSync(qDir)) { for (const f of fs.readdirSync(qDir)) { if (f.includes(srcName) && f.endsWith(".md")) { sources.push(readFileStr(qDir + "\\" + f)); paths.push(qDir + "\\" + f); break; } } }
			}
		}
		if (sources.length === 0) { new Notice("没有可用的源文件"); return; }
		this.startGenerate(sources.join("\n\n---\n\n"), "今日待复习出题", paths.join(","));
	}

	async wrongExportNote(note: WrongAnswerNote, format: "md" | "word" | "pdf") {
		try {
			
			const dateStr = note.date || new Date().toISOString().slice(0, 10);
			const srcName = note.sourceFile?.replace(/\[\[|\]\]/g, "") || "";
			if (format === "md") {
				const r = await getElectronRemote().dialog.showSaveDialog({ defaultPath: note.baseName + ".md", filters: [{ name: "Markdown", extensions: ["md"] }] });
				if (r.canceled || !r.filePath) return;
				const mdContent = "# " + note.baseName + "\n\n> 来源：" + (srcName || "未知") + "　|　日期：" + dateStr + "\n\n" + stripAnswerSummarySection(note.resultText);
				fs.writeFileSync(r.filePath, mdContent, "utf-8");
				new Notice("Md文件已保存");
			} else if (format === "word") {
				const r = await getElectronRemote().dialog.showSaveDialog({ defaultPath: note.baseName + ".docx", filters: [{ name: "Word", extensions: ["docx"] }] });
				if (r.canceled || !r.filePath) return;
				const children = buildWordParagraphs(note.resultText, note.baseName, srcName + " " + dateStr);
				const doc = new Document({ sections: [{ properties: {}, children }] });
				const buffer = await Packer.toBuffer(doc);
				fs.writeFileSync(r.filePath, Buffer.from(buffer));
				new Notice("Word文件已保存");
			} else if (format === "pdf") {
				const r = await getElectronRemote().dialog.showSaveDialog({ defaultPath: note.baseName + ".pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
				if (r.canceled || !r.filePath) return;
				await exportPdfDirect(r.filePath, note.resultText, note.baseName, srcName + " " + dateStr);
				new Notice("PDF文件已保存");
			}
		} catch (err) { new Notice("导出失败：" + (err as Error).message); }
	}

	async wrongUpdateScheduling(note: WrongAnswerNote, quality: number) {
		const result = sm2Update(note.easeFactor || 2.5, note.interval || 1, quality);
		if (isAbs(this.plugin.settings.wrongBookFolder)) {
			const content = readFileStr(note.filePath);
			const { meta, body } = parseFM(content);
			meta.interval = result.interval;
			meta.easeFactor = result.easeFactor;
			meta.nextReview = result.nextReview;
			meta.reviewCount = (typeof meta.reviewCount === "number" ? meta.reviewCount : 0) + 1;
			if (quality >= 2 && result.interval >= 14) {
				meta.mastered = true;
				if (Array.isArray(meta.tags)) { meta.tags = meta.tags.filter((t: string) => t !== "错题"); if (!meta.tags.includes("已掌握")) meta.tags.push("已掌握"); }
			}
			writeFileStr(note.filePath, buildFM(meta) + body);
		} else {
			const file = this.app.vault.getAbstractFileByPath(note.filePath);
			if (!(file instanceof TFile)) return;
			const content = await this.app.vault.read(file);
			const { meta, body } = parseFM(content);
			meta.interval = result.interval;
			meta.easeFactor = result.easeFactor;
			meta.nextReview = result.nextReview;
			meta.reviewCount = (typeof meta.reviewCount === "number" ? meta.reviewCount : 0) + 1;
			if (quality >= 2 && result.interval >= 14) {
				meta.mastered = true;
				if (Array.isArray(meta.tags)) { meta.tags = meta.tags.filter((t: string) => t !== "错题"); if (!meta.tags.includes("已掌握")) meta.tags.push("已掌握"); }
			}
			await this.app.vault.modify(file, buildFM(meta) + body);
		}
		const labels = ["完全不会", "很困难", "记住了", "很简单"];
		new Notice("已记录：" + labels[quality] + "，下次复习 " + result.nextReview + "（间隔" + result.interval + "天）");
		if (quality >= 2 && result.interval >= 14) new Notice("已自动标记为掌握！");
		this.plugin.emitDataChanged();
		this.wrongView = "list";
		this.wrongCurrentNote = null;
		await this.renderWrongTab();
	}

	// ===================== ANALYTICS TAB =====================
	async renderAnalyticsTab() {
		if (!this.innerContentEl) return;
		const el = this.innerContentEl;
		el.empty();

		const history = this.plugin.history;
		const wrongNotes = await this.plugin.loadAllWrongNotes();
		const mastered = wrongNotes.filter(n => n.mastered);
		const total = wrongNotes.length;
		const masteryRate = total > 0 ? Math.round((mastered.length / total) * 100) : 0;
		const dueCount = wrongNotes.filter(n => isDueForReview(n)).length;

		const statsGrid = el.createDiv({ attr: { style: "display:grid;grid-template-columns:repeat(auto-fit, minmax(100px, 1fr));gap:6px;margin-bottom:14px;" } });
		const miniStat = (label: string, value: string, color?: string) => {
			const c = statsGrid.createDiv({ attr: { style: "text-align:center;padding:8px 4px;border-radius:6px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);" } });
			c.createDiv({ text: value, attr: { style: "font-size:25px;font-weight:bold;" + (color ? "color:" + color + ";" : "") } });
			c.createDiv({ text: label, attr: { style: "color:var(--text-muted);font-size:16px;margin-top:2px;" } });
		};
		miniStat("出题", String(history.length));
		miniStat("错题", String(total));
		miniStat("掌握率", masteryRate + "%", masteryRate >= 80 ? "var(--color-green)" : masteryRate >= 50 ? "var(--color-yellow)" : "var(--color-red)");
		miniStat("待复习", String(dueCount), dueCount > 0 ? "var(--interactive-accent)" : undefined);

		const weakPoints = await this.plugin.getWeakPoints();
		if (weakPoints.length > 0) {
			el.createDiv({ text: "薄弱知识点", attr: { style: "font-size:18px;font-weight:600;color:var(--text-muted);margin-bottom:6px;" } });
			const maxT = weakPoints[0]!.count;
			for (const wp of weakPoints.slice(0, MAX_WEAK_POINTS_DISPLAY)) {
				const row = el.createDiv({ attr: { style: "margin-bottom:6px;" } });
				const header = row.createDiv({ attr: { style: "display:flex;align-items:center;gap:6px;font-size:18px;cursor:pointer;" } });
				header.createSpan({ text: "#" + wp.tag, attr: { style: "min-width:60px;font-weight:500;color:var(--interactive-accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" } });
				const bar = header.createDiv({ attr: { style: "flex:1;height:8px;background:var(--background-modifier-border);border-radius:4px;overflow:hidden;" } });
				bar.createDiv({ attr: { style: "height:100%;width:" + Math.round((wp.count / maxT) * 100) + "%;background:var(--color-red);border-radius:4px;opacity:0.7;" } });
				header.createSpan({ text: String(wp.count), attr: { style: "min-width:16px;text-align:right;color:var(--text-muted);" } });

				const detailEl = row.createDiv({ attr: { style: "display:none;margin-top:4px;padding-left:66px;" } });
				for (const q of wp.questions.slice(0, PREVIEW_ITEMS_LIMIT)) {
					const qItem = detailEl.createDiv({ attr: { style: "font-size:17px;color:var(--text-faint);padding:2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;" } });
					const snippet = q.resultText.split("\n")[0]?.slice(0, 50) || q.baseName;
					qItem.setText(snippet);
					qItem.addEventListener("click", () => { this.wrongView = "detail"; this.wrongCurrentNote = q; this.activeSection = "wrong"; void this.render(); });
				}
				if (wp.questions.length > PREVIEW_ITEMS_LIMIT) detailEl.createDiv({ text: "还有" + (wp.questions.length - PREVIEW_ITEMS_LIMIT) + "题...", attr: { style: "font-size:16px;color:var(--text-faint);padding-top:2px;" } });

				let expanded = false;
				header.addEventListener("click", () => { expanded = !expanded; detailEl.style.display = expanded ? "block" : "none"; });
			}
		}

		if (history.length > 0) {
			el.createDiv({ text: "近期出题", attr: { style: "font-size:18px;font-weight:600;color:var(--text-muted);margin:12px 0 6px;" } });
			const dayCounts: Record<string, number> = {};
			for (const h of history) { const d = new Date(h.timestamp).toISOString().slice(0, 10); dayCounts[d] = (dayCounts[d] || 0) + 1; }
			const days = Object.entries(dayCounts).sort((a, b) => b[0].localeCompare(a[0])).slice(0, RECENT_DAYS_LIMIT);
			if (days.length > 0) {
				const maxDay = Math.max(...days.map(d => d[1]));
				for (const [day, count] of days) {
					const row = el.createDiv({ attr: { style: "display:flex;align-items:center;gap:6px;font-size:18px;margin-bottom:3px;" } });
					row.createSpan({ text: day.slice(5), attr: { style: "min-width:40px;color:var(--text-muted);" } });
					const bar = row.createDiv({ attr: { style: "flex:1;height:8px;background:var(--background-modifier-border);border-radius:4px;overflow:hidden;" } });
					bar.createDiv({ attr: { style: "height:100%;width:" + Math.round((count / maxDay) * 100) + "%;background:var(--interactive-accent);border-radius:4px;" } });
					row.createSpan({ text: count + "次", attr: { style: "min-width:24px;" } });
				}
			}
		}

		if (wrongNotes.length > 0 || history.length > 0) {
			const exportBtn = el.createDiv({ attr: { style: "margin-top:12px;text-align:center;" } });
			const b = exportBtn.createEl("button", { text: "导出学习报告", attr: { style: "padding:6px 16px;border-radius:4px;cursor:pointer;font-size:18px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);" } });
			b.addEventListener("click", () => { void (async () => { await this.analyticsExportReport(wrongNotes, history); })(); });
		}

		if (wrongNotes.length === 0 && history.length === 0) {
			el.createDiv({ text: "暂无学习数据，开始答题积累数据吧！", attr: { style: "color:var(--text-muted);text-align:center;padding:30px 0;font-size:20px;" } });
		}
	}

	async analyticsExportReport(wrongNotes: WrongAnswerNote[], history: HistoryEntry[]) {
		const unmastered = wrongNotes.filter(n => !n.mastered);
		const mastered = wrongNotes.filter(n => n.mastered);
		const total = wrongNotes.length;
		const masteryRate = total > 0 ? Math.round((mastered.length / total) * 100) : 0;
		const dueCount = wrongNotes.filter(n => isDueForReview(n)).length;

		let report = "# 学习分析报告\n\n";
		report += "生成时间：" + new Date().toLocaleString() + "\n\n";
		report += "## 概览\n\n";
		report += "- 出题次数：" + history.length + "\n";
		report += "- 错题总数：" + total + "\n";
		report += "- 已掌握：" + mastered.length + "\n";
		report += "- 未掌握：" + unmastered.length + "\n";
		report += "- 掌握率：" + masteryRate + "%\n";
		report += "- 今日待复习：" + dueCount + "\n\n";

		const tagCounts: Record<string, { total: number; mastered: number }> = {};
		for (const n of wrongNotes) {
			for (const t of knowledgeTags(n.tags)) {
				if (!tagCounts[t]) tagCounts[t] = { total: 0, mastered: 0 };
				tagCounts[t].total++;
				if (n.mastered) tagCounts[t].mastered++;
			}
		}
		const tagList = Object.entries(tagCounts).sort((a, b) => (b[1].total - b[1].mastered) - (a[1].total - a[1].mastered));
		if (tagList.length > 0) {
			report += "## 知识点掌握情况\n\n";
			report += "| 知识点 | 总错题 | 已掌握 | 未掌握 | 掌握率 |\n";
			report += "|--------|--------|--------|--------|--------|\n";
			for (const [tag, data] of tagList) {
				const rate = data.total > 0 ? Math.round((data.mastered / data.total) * 100) : 0;
				report += "| " + tag + " | " + data.total + " | " + data.mastered + " | " + (data.total - data.mastered) + " | " + rate + "% |\n";
			}
			report += "\n";
		}

		if (unmastered.length > 0) {
			report += "## 未掌握错题列表\n\n";
			for (const n of unmastered) {
				report += "### " + (n.sourceFile || n.baseName).replace(/\[\[|\]\]/g, "") + "\n";
				report += "- 加入时间：" + n.date + "\n";
				if (n.tags.length > 0) report += "- 标签：" + knowledgeTags(n.tags).map(t => "#" + t).join(" ") + "\n";
				if (n.nextReview) report += "- 下次复习：" + n.nextReview + "（间隔" + n.interval + "天）\n";
			const snippet = n.resultText.slice(0, MAX_REPORT_SNIPPET).replace(/\n/g, " ");
			report += "- 内容摘要：" + snippet + (n.resultText.length > MAX_REPORT_SNIPPET ? "..." : "") + "\n\n";
			}
		}

		if (history.length > 0) {
			report += "## 近期出题记录\n\n";
			const recent = history.slice(-RECENT_HISTORY_LIMIT).reverse();
			for (const h of recent) {
				const d = new Date(h.timestamp);
				report += "- " + d.toLocaleDateString() + " " + d.toLocaleTimeString() + " — " + h.fileName + "\n";
			}
		}

		await this.plugin.exportToFile(report, "学习报告", "md", "学习分析报告");
	}

	// ===================== SETTINGS TAB =====================
	renderSettingsTab() {
		if (!this.innerContentEl) return;
		const el = this.innerContentEl;
		el.empty();
		const s = this.plugin.settings;

		const section = (title: string) => {
			el.createDiv({ text: title, attr: { style: "font-size:19px;font-weight:600;color:var(--text-muted);margin:14px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--background-modifier-border);" } });
		};

		section("API 配置");
		const apiTypeRow = el.createDiv({ attr: { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:18px;" } });
		apiTypeRow.createSpan({ text: "接口类型", attr: { style: "min-width:70px;color:var(--text-muted);" } });
		const apiTypeSel = apiTypeRow.createEl("select", { attr: { style: "flex:1;padding:5px;border-radius:4px;border:1px solid var(--background-modifier-border);" } });
		apiTypeSel.createEl("option", { value: "ollama", text: "Ollama" });
		apiTypeSel.createEl("option", { value: "openai", text: "OpenAI兼容" });
		apiTypeSel.value = s.apiType;
		apiTypeSel.addEventListener("change", () => { s.apiType = apiTypeSel.value as "ollama" | "openai"; void this.plugin.saveSettings(); });

		const urlRow = el.createDiv({ attr: { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:18px;" } });
		urlRow.createSpan({ text: "接口地址", attr: { style: "min-width:70px;color:var(--text-muted);" } });
		const urlInput = urlRow.createEl("input", { attr: { type: "text", value: s.baseUrl, style: "flex:1;padding:5px;border-radius:4px;border:1px solid var(--background-modifier-border);" } });
		urlInput.addEventListener("change", () => { s.baseUrl = urlInput.value; void this.plugin.saveSettings(); });

		const modelRow = el.createDiv({ attr: { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:18px;" } });
		modelRow.createSpan({ text: "模型名称", attr: { style: "min-width:70px;color:var(--text-muted);" } });
		const modelInput = modelRow.createEl("input", { attr: { type: "text", value: s.modelName, style: "flex:1;padding:5px;border-radius:4px;border:1px solid var(--background-modifier-border);" } });
		modelInput.addEventListener("change", () => { s.modelName = modelInput.value; void this.plugin.saveSettings(); });

		const keyRow = el.createDiv({ attr: { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:18px;" } });
		keyRow.createSpan({ text: "API Key", attr: { style: "min-width:70px;color:var(--text-muted);" } });
		const keyInput = keyRow.createEl("input", { attr: { type: "password", value: s.apiKey || "", style: "flex:1;padding:5px;border-radius:4px;border:1px solid var(--background-modifier-border);" } });
		keyInput.addEventListener("change", () => { s.apiKey = keyInput.value; void this.plugin.saveSettings(); });

		const tempRow = el.createDiv({ attr: { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:18px;" } });
		tempRow.createSpan({ text: "Temperature", attr: { style: "min-width:70px;color:var(--text-muted);" } });
		const tempInput = tempRow.createEl("input", { attr: { type: "number", min: "0", max: "2", step: "0.1", value: String(s.temperature), style: "width:60px;padding:5px;border-radius:4px;border:1px solid var(--background-modifier-border);text-align:center;" } });
		tempInput.addEventListener("change", () => { s.temperature = parseFloat(tempInput.value) || 0.1; void this.plugin.saveSettings(); });
		tempRow.createSpan({ text: String(s.temperature), attr: { id: "pg-temp-val", style: "color:var(--text-muted);min-width:30px;" } });
		tempInput.addEventListener("input", () => { const v = tempRow.querySelector("#pg-temp-val"); if (v) v.textContent = tempInput.value; });

		section("文件夹");
		const qfRow = el.createDiv({ attr: { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:18px;" } });
		qfRow.createSpan({ text: "出题文件夹", attr: { style: "min-width:70px;color:var(--text-muted);" } });
		const qfInput = qfRow.createEl("input", { attr: { type: "text", value: s.questionFolder, style: "flex:1;padding:5px;border-radius:4px;border:1px solid var(--background-modifier-border);" } });
		qfInput.addEventListener("change", () => { s.questionFolder = qfInput.value; void this.plugin.saveSettings(); });

		const wbRow = el.createDiv({ attr: { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:18px;" } });
		wbRow.createSpan({ text: "错题本文件夹", attr: { style: "min-width:70px;color:var(--text-muted);" } });
		const wbInput = wbRow.createEl("input", { attr: { type: "text", value: s.wrongBookFolder, style: "flex:1;padding:5px;border-radius:4px;border:1px solid var(--background-modifier-border);" } });
		wbInput.addEventListener("change", () => { s.wrongBookFolder = wbInput.value; void this.plugin.saveSettings(); });

		const exRow = el.createDiv({ attr: { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:18px;" } });
		exRow.createSpan({ text: "排除文件夹", attr: { style: "min-width:70px;color:var(--text-muted);" } });
		const exInput = exRow.createEl("input", { attr: { type: "text", value: s.excludeFolders, style: "flex:1;padding:5px;border-radius:4px;border:1px solid var(--background-modifier-border);" } });
		exInput.addEventListener("change", () => { s.excludeFolders = exInput.value; void this.plugin.saveSettings(); });

		const efRow = el.createDiv({ attr: { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:18px;" } });
		efRow.createSpan({ text: "AI识别文件夹", attr: { style: "min-width:70px;color:var(--text-muted);" } });
		const efInput = efRow.createEl("input", { attr: { type: "text", value: s.extractedExamFolder, style: "flex:1;padding:5px;border-radius:4px;border:1px solid var(--background-modifier-border);" } });
		efInput.addEventListener("change", () => { s.extractedExamFolder = efInput.value; void this.plugin.saveSettings(); });

		const asRow = el.createDiv({ attr: { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:18px;" } });
		const asCb = asRow.createEl("input", { attr: { type: "checkbox" } });
		asCb.checked = s.autoSave;
		asCb.addEventListener("change", () => { s.autoSave = asCb.checked; void this.plugin.saveSettings(); });
		asRow.createSpan({ text: "生成后自动保存到题库" });

		section("学习设置");
		const wpRow = el.createDiv({ attr: { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:18px;" } });
		wpRow.createSpan({ text: "薄弱点阈值", attr: { style: "min-width:70px;color:var(--text-muted);" } });
		const wpInput = wpRow.createEl("input", { attr: { type: "number", min: "1", max: "20", value: String(s.weakPointThreshold), style: "width:60px;padding:5px;border-radius:4px;border:1px solid var(--background-modifier-border);text-align:center;" } });
		wpInput.addEventListener("change", () => { s.weakPointThreshold = parseInt(wpInput.value) || 2; void this.plugin.saveSettings(); });
		wpRow.createSpan({ text: "次以上错题标记为薄弱", attr: { style: "color:var(--text-muted);" } });

		const rrRow = el.createDiv({ attr: { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:18px;" } });
		const rrCb = rrRow.createEl("input", { attr: { type: "checkbox" } });
		rrCb.checked = s.autoReviewReminder;
		rrCb.addEventListener("change", () => { s.autoReviewReminder = rrCb.checked; void this.plugin.saveSettings(); });
		rrRow.createSpan({ text: "启动时提醒复习" });

		const sortRow = el.createDiv({ attr: { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:18px;" } });
		sortRow.createSpan({ text: "错题排序", attr: { style: "min-width:70px;color:var(--text-muted);" } });
		const sortSel = sortRow.createEl("select", { attr: { style: "flex:1;padding:5px;border-radius:4px;border:1px solid var(--background-modifier-border);" } });
		for (const [val, label] of [["date", "按日期"], ["tag", "按知识点"], ["review", "按复习时间"]]) {
			const opt = sortSel.createEl("option", { value: val, text: label });
			if (s.sortWrongBy === val) opt.selected = true;
		}
		sortSel.addEventListener("change", () => { s.sortWrongBy = sortSel.value as "date" | "tag" | "review"; void this.plugin.saveSettings(); });

		section("默认出题数量");
		const counts = [
			{ label: "单选题", key: "countSingle" as const },
			{ label: "多选题", key: "countMulti" as const },
			{ label: "判断题", key: "countJudge" as const },
			{ label: "填空题", key: "countBlank" as const },
			{ label: "简答题", key: "countEssay" as const },
		];
		const countGrid = el.createDiv({ attr: { style: "display:grid;grid-template-columns:1fr 1fr;gap:6px;" } });
		for (const c of counts) {
			const row = countGrid.createDiv({ attr: { style: "display:flex;align-items:center;gap:6px;font-size:18px;" } });
			row.createSpan({ text: c.label, attr: { style: "min-width:50px;color:var(--text-muted);" } });
			const inp = row.createEl("input", { attr: { type: "number", min: "0", max: "50", value: String(s[c.key]), style: "width:50px;padding:4px;border-radius:4px;border:1px solid var(--background-modifier-border);text-align:center;" } });
			inp.addEventListener("change", () => { s[c.key] = parseInt(inp.value) || 0; void this.plugin.saveSettings(); });
			row.createSpan({ text: "题", attr: { style: "color:var(--text-muted);" } });
		}

		section("自定义提示词");
		const promptTA = el.createEl("textarea", { attr: { value: s.systemPrompt, style: "width:100%;min-height:80px;padding:8px;border-radius:4px;border:1px solid var(--background-modifier-border);font-size:18px;resize:vertical;", placeholder: "留空使用默认提示词..." } });
		promptTA.addEventListener("change", () => { s.systemPrompt = promptTA.value; void this.plugin.saveSettings(); });

		section("数据管理");
		const dataBtnRow = el.createDiv({ attr: { style: "display:flex;gap:8px;flex-wrap:wrap;" } });
		const dataBtn = (label: string, cb: () => void) => {
			const b = dataBtnRow.createEl("button", { text: label, attr: { style: "padding:5px 12px;border-radius:4px;cursor:pointer;font-size:18px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);" } });
			b.addEventListener("click", cb);
		};
		dataBtn("重建知识点索引", () => { void (async () => { await this.plugin.migrateKnowledgeLinks(); new Notice("知识点索引已重建"); })(); });
		dataBtn("清除缓存", () => { this.plugin.invalidateCache(); new Notice("缓存已清除"); });
		dataBtn("在Obsidian设置中打开", () => { (this.app as unknown as { setting?: { open(): void; scrollTop?(): void } }).setting?.open(); (this.app as unknown as { setting?: { open(): void; scrollTop?(): void } }).setting?.scrollTop?.(); });
	}

	// ===================== FILE PICKER (inline) =====================
	renderFilePicker() {
		if (!this.innerContentEl) return;
		const el = this.innerContentEl;
		el.empty();

		const backBtn = el.createEl("button", { text: "← 返回", attr: { style: "padding:4px 10px;border-radius:4px;cursor:pointer;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);font-size:19px;margin-bottom:12px;" } });
		backBtn.addEventListener("click", () => { this.homeView = "default"; void this.renderHomeTab(); });
		el.createDiv({ text: "选择出题文档", attr: { style: "font-size:21px;font-weight:bold;margin-bottom:8px;" } });

		const excludeList = this.buildExcludeList();
		this.fpAllFiles = this.app.vault.getFiles().filter(f => {
			if (f.extension !== "md") return false;
			const lowerPath = f.path.toLowerCase();
			for (const ex of excludeList) {
				if (lowerPath.includes(ex.toLowerCase() + "/") || lowerPath.startsWith(ex.toLowerCase())) return false;
			}
			return true;
		});

		const infoEl = el.createDiv({ attr: { style: "color:var(--text-muted);font-size:18px;margin-bottom:8px;" } });
		infoEl.setText("共 " + this.fpAllFiles.length + " 个文档，已选 " + this.fpSelected.size + " 个" + (excludeList.length > 0 ? "（已排除: " + excludeList.join(", ") + "）" : ""));

		const searchDiv = el.createDiv({ attr: { style: "margin-bottom:8px;" } });
		const searchInput = searchDiv.createEl("input", { attr: { type: "text", placeholder: "搜索文件名...", style: "width:100%;padding:6px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);" } });

		const toolBar = el.createDiv({ attr: { style: "margin-bottom:8px;display:flex;gap:6px;" } });
		const toolBtn = (label: string, cb: () => void) => {
			const b = toolBar.createEl("button", { text: label, attr: { style: "padding:4px 10px;border-radius:4px;cursor:pointer;font-size:18px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);" } });
			b.addEventListener("click", cb);
		};
		toolBtn("全选", () => { this.fpAllFiles.forEach(f => this.fpSelected.add(f.path)); this.fpRenderTree(listEl, searchInput, infoEl); });
		toolBtn("取消全选", () => { this.fpSelected.clear(); this.fpRenderTree(listEl, searchInput, infoEl); });

		const listEl = el.createDiv({ attr: { style: "max-height:450px;overflow-y:auto;" } });
		searchInput.addEventListener("input", debounce(() => this.fpRenderTree(listEl, searchInput, infoEl), SEARCH_DEBOUNCE_MS));
		this.fpRenderTree(listEl, searchInput, infoEl);

		const btnRow = el.createDiv({ attr: { style: "margin-top:12px;display:flex;gap:8px;" } });
		const confirmBtn = btnRow.createEl("button", { text: "确认选择 (" + this.fpSelected.size + "个)", attr: { class: "mod-cta", style: "padding:6px 16px;border-radius:4px;cursor:pointer;font-size:19px;" } });
		confirmBtn.addEventListener("click", () => {
			void (async () => {
				const chosen = this.fpAllFiles.filter(f => this.fpSelected.has(f.path));
				if (chosen.length === 0) { new Notice("请至少选择一个文件"); return; }
				let combined = "";
				const paths: string[] = [];
				for (const f of chosen) { combined += "\n\n---\n\n" + await this.app.vault.read(f); paths.push(f.path); }
				this.startGenerate(combined.trim(), chosen.length + "个文档", paths.join(","));
			})();
		});
	}

	fpRenderTree(listEl: HTMLDivElement, searchInput: HTMLInputElement, infoEl: HTMLElement) {
		listEl.empty();
		const query = searchInput.value.toLowerCase();
		const filtered = query ? this.fpAllFiles.filter(f => f.path.toLowerCase().includes(query) || f.basename.toLowerCase().includes(query)) : this.fpAllFiles;
		const tree = buildFileTree(filtered);
		this.fpRenderNode(listEl, tree, 0, infoEl);
	}

	fpRenderNode(container: HTMLDivElement, node: TreeNode, depth: number, infoEl: HTMLElement) {
		const sorted = [...node.children].sort((a, b) => {
			if (a.isFolder && !b.isFolder) return -1;
			if (!a.isFolder && b.isFolder) return 1;
			return a.name.localeCompare(b.name);
		});
		for (const child of sorted) {
			if (child.isFolder) {
				const folderEl = container.createDiv({ attr: { style: "margin-left:" + (depth * 16) + "px;" } });
				const folderRow = folderEl.createDiv({ attr: { style: "display:flex;align-items:center;gap:4px;padding:3px 4px;cursor:pointer;border-radius:4px;font-weight:bold;font-size:19px;" } });
				const arrow = folderRow.createSpan({ text: "▸", attr: { style: "font-size:17px;min-width:14px;color:var(--text-muted);" } });
				const folderFiles = this.fpGetFolderFiles(child);
				const folderCb = folderRow.createEl("input", { attr: { type: "checkbox" } });
				folderCb.checked = folderFiles.length > 0 && folderFiles.every(f => this.fpSelected.has(f.path));
				folderCb.indeterminate = folderFiles.some(f => this.fpSelected.has(f.path)) && !folderCb.checked;
				folderCb.addEventListener("change", () => {
					if (folderCb.checked) folderFiles.forEach(f => this.fpSelected.add(f.path));
					else folderFiles.forEach(f => this.fpSelected.delete(f.path));
					this.fpRenderTree(container.parentElement as HTMLDivElement, container.parentElement!.previousElementSibling!.querySelector("input") as HTMLInputElement, infoEl);
				});
				folderRow.createSpan({ text: child.name + " (" + child.children.length + ")" });
				const childContainer = folderEl.createDiv({ attr: { style: "display:none;" } });
				let expanded = false;
				folderRow.addEventListener("click", (e) => {
					if ((e.target as HTMLElement).tagName === "INPUT") return;
					expanded = !expanded;
					childContainer.style.display = expanded ? "block" : "none";
					arrow.setText(expanded ? "▾" : "▸");
				});
				this.fpRenderNode(childContainer, child, depth + 1, infoEl);
			} else {
				const row = container.createDiv({ attr: { style: "margin-left:" + (depth * 16) + "px;padding:3px 4px;display:flex;align-items:center;gap:6px;cursor:pointer;border-radius:4px;font-size:19px;" } });
				const cb = row.createEl("input", { attr: { type: "checkbox" } });
				cb.checked = this.fpSelected.has(child.path);
				cb.addEventListener("change", () => { cb.checked ? this.fpSelected.add(child.path) : this.fpSelected.delete(child.path); infoEl.setText("共 " + this.fpAllFiles.length + " 个文档，已选 " + this.fpSelected.size + " 个"); });
				row.createSpan({ text: child.name, attr: { style: "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" } });
				if (child.file) {
					row.createSpan({ text: Math.round(child.file.stat.size / 1024) + "KB", attr: { style: "color:var(--text-muted);font-size:16px;flex-shrink:0;" } });
				}
				row.addEventListener("click", (e) => {
					if ((e.target as HTMLElement).tagName === "INPUT") return;
					cb.checked = !cb.checked;
					cb.checked ? this.fpSelected.add(child.path) : this.fpSelected.delete(child.path);
					infoEl.setText("共 " + this.fpAllFiles.length + " 个文档，已选 " + this.fpSelected.size + " 个");
				});
			}
		}
	}

	fpGetFolderFiles(node: TreeNode): TFile[] {
		const files: TFile[] = [];
		for (const c of node.children) {
			if (c.isFolder) files.push(...this.fpGetFolderFiles(c));
			else if (c.file) files.push(c.file);
		}
		return files;
	}

	// ===================== EXAM BROWSER (inline) =====================
	async renderExamBrowser() {
		if (!this.innerContentEl) return;
		const el = this.innerContentEl;
		el.empty();

		const backBtn = el.createEl("button", { text: "← 返回", attr: { style: "padding:4px 10px;border-radius:4px;cursor:pointer;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);font-size:19px;margin-bottom:12px;" } });
		backBtn.addEventListener("click", () => { this.examSelected.clear(); this.examStatusText = ""; this.homeView = "default"; void this.renderHomeTab(); });

		el.createDiv({ text: "AI 识别试卷", attr: { style: "font-size:21px;font-weight:bold;margin-bottom:4px;" } });
		el.createDiv({ text: "选择vault中的文档，AI自动识别并提取其中的题目，保存后进入答题模式", attr: { style: "color:var(--text-muted);font-size:18px;margin-bottom:12px;" } });

		if (this.examProcessing) {
			const statusEl = el.createDiv({ attr: { style: "text-align:center;padding:24px 0;" } });
			statusEl.createDiv({ text: "⏳", attr: { style: "font-size:28px;margin-bottom:8px;" } });
			statusEl.createDiv({ text: this.examStatusText || "AI 正在识别题目...", attr: { style: "color:var(--text-muted);font-size:19px;" } });
			return;
		}

		if (this.examFiles.length === 0) this.loadExamFiles();

		const infoEl = el.createDiv({ attr: { style: "color:var(--text-muted);font-size:18px;margin-bottom:6px;" } });
		infoEl.setText("共 " + this.examFiles.length + " 个文档，已选 " + this.examSelected.size + " 个");

		const searchInput = el.createEl("input", { attr: { type: "text", placeholder: "搜索文件名...", style: "width:100%;padding:5px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);font-size:18px;margin-bottom:8px;" } });
		const listEl = el.createDiv({ attr: { style: "max-height:420px;overflow-y:auto;" } });

		const renderTree = () => {
			listEl.empty();
			const query = searchInput.value.toLowerCase();
			const filtered = query ? this.examFiles.filter(f => f.path.toLowerCase().includes(query) || f.basename.toLowerCase().includes(query)) : this.examFiles;
			const tree = buildFileTree(filtered);
			this.examRenderNode(listEl, tree, 0, infoEl);
		};
		searchInput.addEventListener("input", debounce(renderTree, SEARCH_DEBOUNCE_MS));
		renderTree();

		if (this.examStatusText) {
			el.createDiv({ text: this.examStatusText, attr: { style: "color:var(--color-orange);font-size:18px;margin-top:8px;" } });
		}

		const btnRow = el.createDiv({ attr: { style: "margin-top:12px;display:flex;gap:8px;" } });
		const extractBtn = btnRow.createEl("button", { text: "🔍 AI 识别题目 (" + this.examSelected.size + "个)", attr: { class: "mod-cta", style: "flex:1;padding:8px 16px;border-radius:4px;font-size:19px;cursor:pointer;" } });
		extractBtn.addEventListener("click", () => {
			if (this.examSelected.size === 0) { new Notice("请至少选择一个文件"); return; }
			void this.extractFromExamSelected();
		});
		const clearBtn = btnRow.createEl("button", { text: "清空选择", attr: { style: "padding:8px 16px;border-radius:4px;font-size:19px;cursor:pointer;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);" } });
		clearBtn.addEventListener("click", () => { this.examSelected.clear(); renderTree(); infoEl.setText("共 " + this.examFiles.length + " 个文档，已选 0 个"); });
	}

	examRenderNode(container: HTMLDivElement, node: TreeNode, depth: number, infoEl: HTMLElement) {
		const sorted = [...node.children].sort((a, b) => {
			if (a.isFolder && !b.isFolder) return -1;
			if (!a.isFolder && b.isFolder) return 1;
			return a.name.localeCompare(b.name);
		});
		for (const child of sorted) {
			if (child.isFolder) {
				const folderEl = container.createDiv({ attr: { style: "margin-left:" + (depth * 16) + "px;" } });
				const folderRow = folderEl.createDiv({ attr: { style: "display:flex;align-items:center;gap:4px;padding:3px 4px;cursor:pointer;border-radius:4px;font-weight:bold;font-size:19px;" } });
				const arrow = folderRow.createSpan({ text: "▸", attr: { style: "font-size:17px;min-width:14px;color:var(--text-muted);" } });
				const folderFiles = this.examGetFolderFiles(child);
				const folderCb = folderRow.createEl("input", { attr: { type: "checkbox" } });
				folderCb.checked = folderFiles.length > 0 && folderFiles.every(f => this.examSelected.has(f.path));
				folderCb.indeterminate = folderFiles.some(f => this.examSelected.has(f.path)) && !folderCb.checked;
				folderCb.addEventListener("change", () => {
					if (folderCb.checked) folderFiles.forEach(f => this.examSelected.add(f.path));
					else folderFiles.forEach(f => this.examSelected.delete(f.path));
					void this.renderExamBrowser();
				});
				folderRow.createSpan({ text: child.name + " (" + child.children.length + ")" });
				const childContainer = folderEl.createDiv({ attr: { style: "display:none;" } });
				let expanded = false;
				folderRow.addEventListener("click", (e) => {
					if ((e.target as HTMLElement).tagName === "INPUT") return;
					expanded = !expanded;
					childContainer.style.display = expanded ? "block" : "none";
					arrow.setText(expanded ? "▾" : "▸");
				});
				this.examRenderNode(childContainer, child, depth + 1, infoEl);
			} else {
				const row = container.createDiv({ attr: { style: "margin-left:" + (depth * 16) + "px;padding:3px 4px;display:flex;align-items:center;gap:6px;cursor:pointer;border-radius:4px;font-size:19px;" } });
				const cb = row.createEl("input", { attr: { type: "checkbox" } });
				cb.checked = this.examSelected.has(child.path);
				cb.addEventListener("change", () => {
					cb.checked ? this.examSelected.add(child.path) : this.examSelected.delete(child.path);
					infoEl.setText("共 " + this.examFiles.length + " 个文档，已选 " + this.examSelected.size + " 个");
				});
				row.createSpan({ text: child.name, attr: { style: "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" } });
				if (child.file) {
					row.createSpan({ text: Math.round(child.file.stat.size / 1024) + "KB", attr: { style: "color:var(--text-muted);font-size:16px;flex-shrink:0;" } });
					const d = new Date(child.file.stat.mtime);
					row.createSpan({ text: (d.getMonth() + 1) + "/" + d.getDate(), attr: { style: "color:var(--text-muted);font-size:17px;flex-shrink:0;" } });
				}
				row.addEventListener("click", (e) => {
					if ((e.target as HTMLElement).tagName === "INPUT") return;
					cb.checked = !cb.checked;
					cb.checked ? this.examSelected.add(child.path) : this.examSelected.delete(child.path);
					infoEl.setText("共 " + this.examFiles.length + " 个文档，已选 " + this.examSelected.size + " 个");
				});
			}
		}
	}

	examGetFolderFiles(node: TreeNode): TFile[] {
		const files: TFile[] = [];
		for (const c of node.children) {
			if (c.isFolder) files.push(...this.examGetFolderFiles(c));
			else if (c.file) files.push(c.file);
		}
		return files;
	}

	buildExcludeList(): string[] {
		const list = this.plugin.settings.excludeFolders.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
		const configDir = this.app.vault.configDir;
		if (configDir && !list.includes(configDir.toLowerCase())) list.push(configDir.toLowerCase());
		return list;
	}

	loadExamFiles() {
		const excludeList = this.buildExcludeList();
		this.examFiles = this.app.vault.getFiles().filter(f => {
			if (f.extension !== "md") return false;
			const lowerPath = f.path.toLowerCase();
			for (const ex of excludeList) {
				if (lowerPath.includes(ex + "/") || lowerPath.startsWith(ex)) return false;
			}
			return true;
		}).sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	async extractFromExamSelected() {
		const files = this.examFiles.filter(f => this.examSelected.has(f.path));
		if (files.length === 0) return;

		this.examProcessing = true;
		this.examStatusText = "准备识别 " + files.length + " 个文件...";
		void this.renderExamBrowser();

		const cfg = this.plugin.settings;
		const saveFolder = cfg.extractedExamFolder || "出题/识别试卷";
		await ensureFolder(this.app, saveFolder);
		const savedPaths: string[] = [];
		let totalQuestions = 0;

		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			if (!file) continue;
			this.examStatusText = "正在识别 (" + (i + 1) + "/" + files.length + ") " + file.name + "...";
			void this.renderExamBrowser();

			try {
				const content = await this.app.vault.read(file);
				if (!content || content.trim().length === 0) continue;

			if (content.length > MAX_EXAM_CONTENT_CHARS) {
				this.examStatusText = "正在识别 (" + (i + 1) + "/" + files.length + ") " + file.name + "（内容较长，仅识别前" + MAX_EXAM_CONTENT_CHARS + "字符）...";
					void this.renderExamBrowser();
				}

				const prompt = this.buildExamExtractPrompt(content);
				const full = await this.callAIWithPrompt(prompt);
				if (!full) continue;

				const questions = parseQuestions(full);
				if (questions.length === 0) continue;
				totalQuestions += questions.length;

				const { tags: aiTags, cleanText } = this.parseAITagsFromResult(full);
				const saveContent = this.buildExamFrontmatter(file.basename, aiTags) + normalizeExamContent(cleanText);
				const safeName = file.basename.replace(/[<>:"/\\|?*]/g, "_");
				const savePath = saveFolder + "/" + safeName + " - AI识别.md";
				try { await this.app.vault.create(savePath, saveContent); }
				catch { await this.app.vault.create(saveFolder + "/" + safeName + " - AI识别_" + Date.now() + ".md", saveContent); }
				savedPaths.push(savePath);
			} catch (err) {
				if ((err as Error).name === "AbortError") {
					this.examProcessing = false;
					this.examStatusText = "识别超时（3分钟）";
					void this.renderExamBrowser();
					return;
				}
			}
		}

		this.examProcessing = false;
		this.examStatusText = "";
		this.examSelected.clear();

		if (savedPaths.length === 0) {
			this.examStatusText = "所有文件均未能识别出题目";
			void this.renderExamBrowser();
			return;
		}

		if (savedPaths.length === 1 && savedPaths[0]) {
			const savedFile = this.app.vault.getAbstractFileByPath(savedPaths[0]);
			if (savedFile && savedFile instanceof TFile) {
				const content2 = await this.app.vault.read(savedFile);
				const clean2 = content2.replace(/^---[\s\S]*?---\s*/, "");
				new Notice("识别完成，共 " + totalQuestions + " 题，已保存至 " + savedPaths[0]);
				this.startAnswer(clean2, savedFile.basename, savedFile.path);
				return;
			}
		}

		let combined = "";
		const paths: string[] = [];
		for (const p of savedPaths) {
			const f = this.app.vault.getAbstractFileByPath(p);
			if (f && f instanceof TFile) {
				const c = await this.app.vault.read(f);
				combined += "\n\n---\n\n" + c.replace(/^---[\s\S]*?---\s*/, "");
				paths.push(p);
			}
		}
		new Notice("识别完成，共 " + totalQuestions + " 题，已保存 " + savedPaths.length + " 个文件");
		this.startGenerate(normalizeExamContent(combined.trim()), savedPaths.length + "个识别试卷", paths.join(","));
	}

	buildExamExtractPrompt(content: string): string {
		return `你是专业的试卷识别助手。请仔细阅读以下文档内容，精准识别并提取其中所有的考试题目。

【核心原则 - 必须遵守】
1. 尊重原文：试卷上是什么题型，识别出来就是什么题型，不要改变题型
2. 答案优先级：试卷上给了答案的，必须按试卷原样保留；试卷上没给答案的，由你根据题目内容生成规范的参考答案
3. 题目完整性：完整保留题干、选项、分值等信息，不要删减
4. 如果文档中有分值标注（如"每题2分"），保留该信息

【输出格式要求 - 必须严格遵守】
必须按以下格式输出，否则系统无法解析：

## 题型名称（如：单选题/多选题/判断题/填空题/简答题/论述题/计算题/名词解释/案例分析 等）
1. 题干文本
A. 选项A文本
B. 选项B文本
C. 选项C文本
D. 选项D文本
答案：答案内容
解析：解析文本

【各类题型输出规则】
- 选择题：必须列出所有选项（A. B. C. D.），答案用字母表示
- 多选题：答案为多个字母，如 答案：ABD
- 判断题：选项为 A. 正确 B. 错误，答案为 A 或 B
- 填空题：题干中用（）标记空缺位置，答案填写具体内容
- 简答题/论述题：答案必须用数字序号（1. 2. 3.）列出要点
- 计算题：保留完整计算过程
- 案例分析：完整保留案例材料和问题
- 如果原文有解析/解释，一并保留；如果没有，由你补充简要解析

【铁律 - 绝对禁止】
1. 绝对不要使用任何Markdown格式（不要用#号、星号、反引号等标记符号）
2. 题号格式固定为：数字. 题干文本
3. 选项格式固定为：A. 选项文本
4. 答案行格式固定为：答案：xxx
5. 解析行格式固定为：解析：xxx
6. 每道题之间必须空一行
7. 不要在文末输出答案汇总
8. 简答题答案必须用数字序号（1. 2. 3.）列出踩分点，每个序号单独一行
9. 答案中多个要点（1. xxx 2. xxx 3. xxx）必须每个要点单独一行
10. 在所有题目输出完毕后，最后一行必须输出：知识点：tag1, tag2, tag3（根据内容精准提取3-8个核心知识点，用逗号分隔）

【重要提示】
- 如果文档中包含多套试卷，全部提取出来
- 如果文档不是试卷格式（如笔记、教材等），请从中提炼可能的考点并出题
- 保持题目的完整性和准确性
- 题型分类标题必须准确反映原文题型（如原文是"论述题"就写"论述题"，不要统一改成"简答题"）

### 文档内容：
${content.slice(0, MAX_EXAM_CONTENT_CHARS)}`;
	}

	async callAIWithPrompt(prompt: string): Promise<string> {
		const cfg = this.plugin.settings;
		const controller = new AbortController();
		this.genAbortController = controller;
		const timeoutId = window.setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

		try {
			let full = "";
			if (cfg.apiType === "ollama") {
				const url = cfg.baseUrl + "/api/generate";
				const res = await requestUrl({
					url,
					method: "POST",
					contentType: "application/json",
					body: JSON.stringify({ model: cfg.modelName, prompt, stream: false, temperature: cfg.temperature }),
				});
				const data = res.json as OllamaResponse;
				full = data.response || "";
			} else {
				const url = cfg.baseUrl + "/v1/chat/completions";
				const res = await requestUrl({
					url,
					method: "POST",
					contentType: "application/json",
					headers: { "Authorization": "Bearer " + cfg.apiKey },
					body: JSON.stringify({
						model: cfg.modelName,
						temperature: cfg.temperature,
						stream: false,
						messages: [
							{ role: "system", content: "你是专业的试卷识别助手，严格按照指定格式输出题目。" },
							{ role: "user", content: prompt }
						]
					}),
				});
				const data = res.json as OpenAIResponse;
				full = data.choices?.[0]?.message?.content || "";
			}
			window.clearTimeout(timeoutId);
			return full;
		} catch (err) {
			window.clearTimeout(timeoutId);
			throw err;
		} finally {
			this.genAbortController = null;
		}
	}

	buildExamFrontmatter(sourceName: string, tags: string[]): string {
		const now = new Date();
		const dateStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
		const timeStr = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
		return "---\ntitle: \"" + sourceName + " - AI识别试卷\"\ndate: " + dateStr + "T" + timeStr + "\ntags:\n  - 试卷\n  - AI识别" + (tags.length > 0 ? "\n" + tags.map(t => "  - " + t).join("\n") : "") + "\nsourceType: ai-extracted\nsource: \"" + sourceName + "\"\n---\n\n";
	}

	// ===================== GENERATE (inline) =====================
	startGenerate(sourceText: string, name: string, sourcePath: string = "") {
		this.genSourceText = sourceText;
		this.genFileName = name.replace(".md", "");
		this.genSourcePath = sourcePath;
		this.genResultText = "";
		this.genCurrentTags = [];
		this.genAITags = [];
		this.homeView = "generate";
		void this.renderHomeTab();
	}

	renderGenerateView() {
		if (!this.innerContentEl) return;
		const el = this.innerContentEl;
		el.empty();

		const backBtn = el.createEl("button", { text: "← 返回", attr: { style: "padding:4px 10px;border-radius:4px;cursor:pointer;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);font-size:19px;margin-bottom:12px;" } });
		backBtn.addEventListener("click", () => { if (this.genAbortController) { this.genAbortController.abort(); this.genAbortController = null; this.genIsGenerating = false; } this.homeView = "default"; void this.renderHomeTab(); });

		if (this.genResultText) {
			this.genRenderResult();
			return;
		}

		el.createDiv({ text: "出题设置", attr: { style: "font-size:21px;font-weight:bold;margin-bottom:10px;" } });

		const cleanedText = cleanSourceText(this.genSourceText);
		const tokenEst = estimateTokens(cleanedText);
		const charCount = cleanedText.length;

		const infoEl = el.createDiv({ attr: { style: "padding:10px 14px;margin-bottom:14px;border-radius:8px;background:var(--background-secondary);font-size:18px;line-height:1.8;" } });
		infoEl.createDiv({ text: "当前文档：" + this.genFileName, attr: { style: "font-weight:600;" } });
		infoEl.createDiv({ text: "清洗后字符数：" + charCount.toLocaleString() + "　预估Token：" + tokenEst.toLocaleString(), attr: { style: "color:var(--text-muted);" } });
		if (tokenEst > TOKEN_WARN_THRESHOLD) infoEl.createDiv({ text: "⚠️ 内容较长，建议分段出题", attr: { style: "color:var(--color-orange);margin-top:4px;" } });

		const cfg = this.plugin.settings;
		const savedEnabled = cfg.lastEnabledTypes.split(",").filter(Boolean);
		const types: { label: string; key: keyof PluginSettings; count: number; enabled: boolean }[] = [
			{ label: "单选题", key: "countSingle", count: cfg.countSingle, enabled: savedEnabled.length === 0 || savedEnabled.includes("single") },
			{ label: "多选题", key: "countMulti", count: cfg.countMulti, enabled: savedEnabled.length === 0 || savedEnabled.includes("multi") },
			{ label: "判断题", key: "countJudge", count: cfg.countJudge, enabled: savedEnabled.length === 0 || savedEnabled.includes("judge") },
			{ label: "填空题", key: "countBlank", count: cfg.countBlank, enabled: savedEnabled.length === 0 || savedEnabled.includes("blank") },
			{ label: "简答题", key: "countEssay", count: cfg.countEssay, enabled: savedEnabled.length === 0 || savedEnabled.includes("essay") },
		];

		const toggleArea = el.createDiv({ attr: { style: "display:flex;flex-direction:column;gap:6px;margin-bottom:14px;" } });
		for (const t of types) {
			const row = toggleArea.createDiv({ attr: { style: "display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;border:1px solid var(--background-modifier-border);" } });
			const cb = row.createEl("input", { attr: { type: "checkbox" } });
			cb.checked = t.enabled;
			row.createSpan({ text: t.label, attr: { style: "min-width:60px;font-size:18px;" } });
			const countInput = row.createEl("input", { attr: { type: "number", min: "0", max: "50", value: String(t.count), style: "width:50px;padding:4px 6px;border-radius:4px;border:1px solid var(--background-modifier-border);text-align:center;font-size:18px;" } });
			countInput.addEventListener("change", () => { t.count = parseInt(countInput.value) || 0; (cfg[t.key] as number) = t.count; });
			row.createSpan({ text: "题", attr: { style: "font-size:17px;color:var(--text-muted);" } });
			cb.addEventListener("change", () => { t.enabled = cb.checked; });
		}

		el.createDiv({ text: "知识点标签（逗号分隔）：", attr: { style: "margin-bottom:4px;font-size:18px;" } });
		const tagsInput = el.createEl("input", { attr: { type: "text", placeholder: "例如：微积分, 导数", value: cfg.lastTags, style: "width:100%;padding:6px;margin-bottom:14px;border-radius:4px;border:1px solid var(--background-modifier-border);font-size:18px;" } });

		const autoSaveRow = el.createDiv({ attr: { style: "display:flex;align-items:center;gap:8px;margin-bottom:14px;" } });
		const autoSaveCb = autoSaveRow.createEl("input", { attr: { type: "checkbox" } });
		autoSaveCb.checked = cfg.autoSave;
		autoSaveCb.addEventListener("change", () => { cfg.autoSave = autoSaveCb.checked; });
		autoSaveRow.createSpan({ text: "生成后自动保存到题库", attr: { style: "font-size:18px;" } });

		const startBtn = el.createDiv({ attr: { style: "text-align:center;" } });
		const sb = startBtn.createEl("button", { text: "开始生成", attr: { class: "mod-cta", style: "padding:8px 24px;border-radius:4px;cursor:pointer;font-size:20px;" } });
		sb.addEventListener("click", () => {
			const enabledTypes = types.filter(t => t.enabled && t.count > 0);
			if (enabledTypes.length === 0) { new Notice("请至少选择一种题型且数量大于0"); return; }
			this.genCurrentTags = tagsInput.value.split(",").map(s => s.trim()).filter(Boolean);
			cfg.lastTags = tagsInput.value;
			cfg.lastEnabledTypes = types.filter(t => t.enabled).map(t => t.key.replace("count", "").toLowerCase()).join(",");
			void this.plugin.saveSettings();
			const counts: string[] = [];
			for (const t of enabledTypes) { if (t.count > 0) counts.push(t.label + t.count); }
			this.genStartGenerate(counts.join("、"));
		});
	}

	genStartGenerate(typeStr: string) {
		const el = this.innerContentEl;
		if (!el) return;
		el.empty();

		const backBtn = el.createEl("button", { text: "← 返回设置", attr: { style: "padding:4px 10px;border-radius:4px;cursor:pointer;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);font-size:19px;margin-bottom:12px;" } });
		backBtn.addEventListener("click", () => { if (this.genAbortController) { this.genAbortController.abort(); this.genAbortController = null; this.genIsGenerating = false; } this.genResultText = ""; this.renderGenerateView(); });

		const progressEl = el.createDiv({ attr: { style: "text-align:center;padding:14px;margin-bottom:10px;border-radius:8px;background:var(--background-secondary);" } });
		const spinner = progressEl.createDiv({ text: "⏳ 正在生成试题...", attr: { style: "font-size:20px;font-weight:600;line-height:1.6;" } });
		const subText = progressEl.createDiv({ text: "预计需要 10-60 秒", attr: { style: "font-size:17px;color:var(--text-muted);margin-top:4px;" } });

		const textArea = el.createEl("textarea", { attr: { style: "width:100%;height:300px;font-family:monospace;font-size:18px;line-height:1.5;" } });
		const update = (txt: string) => { this.genResultText = txt; textArea.value = txt; textArea.scrollTop = textArea.scrollHeight; };

		const btnRow = el.createDiv({ attr: { style: "margin-top:8px;display:flex;gap:6px;" } });
		const cancelBtn = btnRow.createEl("button", { text: "⏹ 中止", attr: { style: "padding:5px 12px;border-radius:4px;cursor:pointer;font-size:18px;border:1px solid var(--color-red);background:var(--background-secondary);color:var(--color-red);" } });
		cancelBtn.addEventListener("click", () => { if (this.genAbortController) { this.genAbortController.abort(); this.genAbortController = null; this.genIsGenerating = false; spinner.setText("已中止"); subText.setText("已获取的内容已保留"); } });

		void this.genRunGenerate(update, typeStr, spinner, subText);
	}

	genBuildPrompt(typeStr: string): string {
		const cfg = this.plugin.settings;
		const cleanSource = cleanSourceText(this.genSourceText);
		const noMdRules = "\n\n【铁律 - 绝对禁止】\n1. 绝对不要使用任何Markdown格式\n2. 题号格式固定为：数字. 题干文本\n3. 选项格式固定为：A. 选项文本\n4. 答案行格式固定为：答案：A 或 答案：AB 或 答案：填写内容\n5. 解析行格式固定为：解析：解释文本\n6. 每道题之间必须空一行\n7. 不要在文末输出答案汇总\n8. 简答题答案必须用数字序号（1. 2. 3.）列出踩分点，每个序号单独一行\n9. 答案中多个要点（1. xxx 2. xxx 3. xxx）必须每个要点单独一行\n10. 在所有题目输出完毕后，最后一行必须输出：知识点：tag1, tag2, tag3（根据原文内容精准提取3-8个核心知识点，用逗号分隔）\n";
		if (cfg.systemPrompt && cfg.systemPrompt.trim()) {
			return cfg.systemPrompt + noMdRules + "\n### 参考原文：\n" + cleanSource + "\n出题数量：" + typeStr + "\n规则：无对应知识点直接跳过，不要虚构内容。";
		}
		return `你是专业出题教师，严格依据原文内容出题，禁止编造不存在知识点。

【输出格式要求 - 必须严格遵守】
必须按以下格式输出，否则系统无法解析：

## 单选题
1. 题干文本
A. 选项A文本
B. 选项B文本
C. 选项C文本
D. 选项D文本
答案：A
解析：解释文本

## 多选题
2. 题干文本
A. 选项A文本
B. 选项B文本
C. 选项C文本
D. 选项D文本
答案：AB
解析：解释文本

## 判断题
3. 题干文本
A. 正确
B. 错误
答案：A
解析：解释文本

## 填空题
4. 题干文本，其中空缺部分用（）表示
答案：填写的内容
解析：解释文本

## 简答题
5. 题干文本
答案：1. 第一个踩分点内容 2. 第二个踩分点内容 3. 第三个踩分点内容
解析：解释文本
${noMdRules}
### 参考原文：
${cleanSource}

出题数量：${typeStr}
规则：无对应知识点直接跳过，不要虚构内容。
【简答题答案格式要求】
简答题答案必须使用数字序号（1. 2. 3.）列出踩分点，禁止使用"第一步""第二步"等文字描述。
【知识点提取】
在所有题目输出完毕后，最后一行必须输出：
知识点：根据原文内容提取的核心知识点（3-8个，逗号分隔）`;
	}

	parseAITagsFromResult(text: string): { tags: string[]; cleanText: string } {
		const lines = text.split("\n");
		const lastLines = lines.slice(-5);
		for (let i = lastLines.length - 1; i >= 0; i--) {
			const line = lastLines[i]!.trim();
			const match = line.match(/^知识点[：:]\s*(.+)/);
			if (match) {
				const tags = match[1]!.split(/[,，]/).map(s => s.trim()).filter(Boolean);
				const cleanLines = lines.slice(0, lines.length - lastLines.length + i);
				return { tags, cleanText: cleanLines.join("\n").trim() };
			}
		}
		return { tags: [], cleanText: text };
	}

	async genRunGenerate(onChunk: (s: string) => void, typeStr: string, spinner: HTMLElement, subText: HTMLElement) {
		if (this.genIsGenerating) { new Notice("正在生成中，请等待完成"); return; }
		const cfg = this.plugin.settings;
		const prompt = this.genBuildPrompt(typeStr);
		let full = "";
		this.genIsGenerating = true;

		try {
			const timeoutId = window.setTimeout(() => { if (this.genAbortController) this.genAbortController.abort(); }, AI_REQUEST_TIMEOUT_MS);

			if (cfg.apiType === "ollama") {
				const url = cfg.baseUrl + "/api/generate";
				const res = await requestUrl({
					url,
					method: "POST",
					contentType: "application/json",
					body: JSON.stringify({ model: cfg.modelName, prompt, stream: false, temperature: cfg.temperature }),
				});
				const data = res.json as OllamaResponse;
				full = data.response || "";
			} else {
				const url = cfg.baseUrl + "/v1/chat/completions";
				const res = await requestUrl({
					url,
					method: "POST",
					contentType: "application/json",
					headers: { "Authorization": "Bearer " + cfg.apiKey },
					body: JSON.stringify({
						model: cfg.modelName,
						temperature: cfg.temperature,
						stream: false,
						messages: [
							{ role: "system", content: "你是一个出题助手，严格按照指定格式输出题目。" },
							{ role: "user", content: prompt }
						]
					}),
				});
				const data = res.json as OpenAIResponse;
				full = data.choices?.[0]?.message?.content || "";
			}
			window.clearTimeout(timeoutId);

			if (!full) { onChunk("接口返回内容为空，请检查模型名称和接口地址配置是否正确。"); return; }

			const { tags: aiTags, cleanText } = this.parseAITagsFromResult(full);
			this.genAITags = aiTags;
			full = cleanText;
			onChunk(full);

			const questions = parseQuestions(full);
			const gradableCount = questions.filter(q => q.type !== "essay" && q.type !== "blank").length;
			spinner.setText("✅ 生成完成");
			const tagInfo = aiTags.length > 0 ? " | 知识点：" + aiTags.join(", ") : "";
			subText.setText("共解析出 " + questions.length + " 题（客观题 " + gradableCount + " 题）" + tagInfo + (questions.length === 0 ? " ⚠️ 请检查AI输出格式" : ""));

			const entry: HistoryEntry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), timestamp: Date.now(), fileName: this.genFileName, sourceSnippet: this.genSourceText.slice(0, MAX_HISTORY_SNIPPET), resultText: full, sourcePath: this.genSourcePath };
			await this.plugin.addHistory(entry);
			if (cfg.autoSave && full) await this.genSaveToVault();
		} catch (err) {
			if ((err as Error).name === "AbortError") {
				spinner.setText("⚠️ 已中止");
				subText.setText("未获取到完整内容");
				return;
			}
			spinner.setText("❌ 生成失败");
			onChunk("接口调用失败：" + (err as Error).message + "\n\n请检查：\n1. 接口地址\n2. API服务是否运行\n3. 模型名称");
		} finally {
			this.genIsGenerating = false;
		}
	}

	genRenderResult() {
		if (!this.innerContentEl) return;
		const el = this.innerContentEl;
		el.empty();

		const backBtn = el.createEl("button", { text: "← 返回设置", attr: { style: "padding:4px 10px;border-radius:4px;cursor:pointer;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);font-size:19px;margin-bottom:10px;" } });
		backBtn.addEventListener("click", () => { this.genResultText = ""; this.renderGenerateView(); });

		el.createDiv({ text: "生成结果", attr: { style: "font-size:20px;font-weight:bold;margin-bottom:8px;" } });
		const textArea = el.createEl("textarea", { attr: { style: "width:100%;height:300px;font-family:monospace;font-size:18px;line-height:1.5;" } });
		textArea.value = this.genResultText;
		textArea.addEventListener("input", () => { this.genResultText = textArea.value; });

		const btnRow = el.createDiv({ attr: { style: "margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;" } });
		const actBtn = (label: string, cb: () => void) => {
			const b = btnRow.createEl("button", { text: label, attr: { style: "padding:4px 10px;border-radius:4px;cursor:pointer;font-size:17px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);" } });
			b.addEventListener("click", cb);
		};
		actBtn("导出MD", () => { void this.genExportMd(); });
		actBtn("导出Word", () => { void this.genExportWord(); });
		actBtn("导出PDF", () => { void this.genExportPdf(); });
		actBtn("无答案版", () => { void this.genExportNoAnswer(); });

		const btnRow2 = el.createDiv({ attr: { style: "margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;" } });
		const ctaBtn = (label: string, cb: () => void) => {
			const b = btnRow2.createEl("button", { text: label, attr: { class: "mod-cta", style: "padding:5px 14px;border-radius:4px;cursor:pointer;font-size:18px;" } });
			b.addEventListener("click", cb);
		};
		ctaBtn("保存到知识库", () => { void (async () => { await this.genSaveToVault(); })(); });
		actBtn("开始答题", () => { if (!this.genResultText) { new Notice("请先生成试题"); return; } this.startAnswer(this.genResultText, this.genFileName, this.genSourcePath); });
	}

	async genSaveToVault() {
		if (!this.genResultText) { new Notice("还没有生成试题内容"); return; }
		try {
			await ensureFolder(this.app, this.plugin.settings.questionFolder);
			const dateStr = new Date().toISOString().slice(0, 10);
			const autoTags = this.genAITags.length > 0 ? this.genAITags : extractKnowledgeTags(this.genFileName, this.genResultText);
			const allTags = ["题目", ...this.genCurrentTags, ...autoTags.filter(t => !this.genCurrentTags.includes(t))];
			const sourceLink = this.genFileName ? "[[" + this.genFileName + "]]" : "";
			const fm = buildFM({ source: sourceLink, sourcePath: this.genSourcePath, date: dateStr, tags: allTags });
			const content = fm + normalizeExamContent(this.genResultText);
			const fileName = safeName(this.genFileName) + "_试题_" + dateStr + ".md";
			if (isAbs(this.plugin.settings.questionFolder)) {
				const filePath = this.plugin.settings.questionFolder + "\\" + fileName;
				try { writeFileStr(filePath, content); }
				catch { writeFileStr(this.plugin.settings.questionFolder + "\\" + safeName(this.genFileName) + "_试题_" + Date.now() + ".md", content); }
			} else {
				const filePath = this.plugin.settings.questionFolder + "/" + fileName;
				try { await this.app.vault.create(filePath, content); }
				catch { await this.app.vault.create(this.plugin.settings.questionFolder + "/" + safeName(this.genFileName) + "_试题_" + Date.now() + ".md", content); }
			}
			new Notice("已保存到 " + this.plugin.settings.questionFolder);
			this.plugin.emitDataChanged();
		} catch (err) { new Notice("保存失败：" + (err as Error).message); }
	}

	async genExportMd() {
		try {
			if (!this.genResultText) { new Notice("还没有生成试题内容"); return; }
			
			const r = await getElectronRemote().dialog.showSaveDialog({ defaultPath: this.genFileName + "_试题.md", filters: [{ name: "Markdown", extensions: ["md"] }] });
			if (r.canceled || !r.filePath) return;
			const dateStr = new Date().toISOString().slice(0, 10);
			fs.writeFileSync(r.filePath, "# " + this.genFileName + " 配套试题\n\n> 来源：" + this.genFileName + "　|　日期：" + dateStr + "\n\n" + stripAnswerSummarySection(this.genResultText), "utf-8");
			new Notice("Md已保存");
		} catch (err) { new Notice("导出失败：" + (err as Error).message); }
	}

	async genExportWord() {
		try {
			if (!this.genResultText) { new Notice("还没有生成试题内容"); return; }
			
			const r = await getElectronRemote().dialog.showSaveDialog({ defaultPath: this.genFileName + "_试题.docx", filters: [{ name: "Word", extensions: ["docx"] }] });
			if (r.canceled || !r.filePath) return;
			const dateStr = new Date().toISOString().slice(0, 10);
			const children = buildWordParagraphs(this.genResultText, this.genFileName + " 配套试题", this.genFileName + " " + dateStr);
			const doc = new Document({ sections: [{ properties: {}, children }] });
			const buffer = await Packer.toBuffer(doc);
			fs.writeFileSync(r.filePath, Buffer.from(buffer));
			new Notice("Word已保存");
		} catch (err) { new Notice("导出失败：" + (err as Error).message); }
	}

	async genExportPdf() {
		try {
			if (!this.genResultText) { new Notice("还没有生成试题内容"); return; }
			
			const r = await getElectronRemote().dialog.showSaveDialog({ defaultPath: this.genFileName + "_试题.pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
			if (r.canceled || !r.filePath) return;
			await exportPdfDirect(r.filePath, this.genResultText, this.genFileName + " 配套试题", this.genFileName);
			new Notice("PDF已保存");
		} catch (err) { new Notice("导出失败：" + (err as Error).message); }
	}

	async genExportNoAnswer() {
		try {
			if (!this.genResultText) { new Notice("还没有生成试题内容"); return; }
			const noAnswerText = stripAnswersForExport(this.genResultText);
			
			const r = await getElectronRemote().dialog.showSaveDialog({ defaultPath: this.genFileName + "_试题_无答案.md", filters: [{ name: "Markdown", extensions: ["md"] }] });
			if (r.canceled || !r.filePath) return;
			const dateStr = new Date().toISOString().slice(0, 10);
			fs.writeFileSync(r.filePath, "# " + this.genFileName + " 配套试题（无答案版）\n\n> 来源：" + this.genFileName + "　|　日期：" + dateStr + "\n\n" + noAnswerText, "utf-8");
			new Notice("无答案版已保存");
		} catch (err) { new Notice("导出失败：" + (err as Error).message); }
	}

	async generateFromWeakPoints() {
		const wp = await this.plugin.getWeakPoints();
		if (wp.length === 0) { new Notice("暂无薄弱知识点数据"); return; }
		const notes = await this.plugin.loadAllWrongNotes();
		const unmastered = notes.filter(n => !n.mastered);
		const sources: string[] = [];
		const paths: string[] = [];
		for (const note of unmastered) {
			const srcName = note.sourceFile.replace(/\[\[|\]\]/g, "");
			const src = this.app.vault.getFiles().find(f => f.basename === srcName || f.name === srcName);
			if (src) { sources.push(await this.app.vault.read(src)); paths.push(src.path); }
			else if (isAbs(this.plugin.settings.questionFolder)) {
				const qDir = this.plugin.settings.questionFolder;
				if (fs.existsSync(qDir)) { for (const f of fs.readdirSync(qDir)) { if (f.includes(srcName) && f.endsWith(".md")) { sources.push(readFileStr(qDir + "\\" + f)); paths.push(qDir + "\\" + f); break; } } }
			}
		}
		if (sources.length === 0) { new Notice("没有可用的源文件"); return; }
		const weakPrompt = "【出题要求 - 请重点关注以下薄弱知识点】\n" + wp.map(w => "- " + w.tag + "（错题" + w.count + "次）").join("\n") + "\n\n对于上述薄弱知识点，每类至少出2-3题。\n\n";
		this.startGenerate(weakPrompt + sources.join("\n\n---\n\n"), "薄弱点定向出题", paths.join(","));
	}

	// ===================== ANSWER (inline) =====================
	startAnswer(resultText: string, sourceName: string, sourcePath: string = "") {
		this.answerResultText = resultText;
		this.answerSourceName = sourceName;
		this.answerSourcePath = sourcePath;
		this.answerQuestions = parseQuestions(resultText);
		this.answerAnswers = new Map();
		this.answerWrongChecked = new Set();
		this.answerStartTime = Date.now();
		this.homeView = "answer";
		void this.renderHomeTab();
	}

	renderAnswerView() {
		if (!this.innerContentEl) return;
		const el = this.innerContentEl;
		el.empty();

		const backBtn = el.createEl("button", { text: "← 返回", attr: { style: "padding:4px 10px;border-radius:4px;cursor:pointer;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);font-size:19px;margin-bottom:10px;" } });
		backBtn.addEventListener("click", () => { if (this.answerTimerInterval) { window.clearInterval(this.answerTimerInterval); this.answerTimerInterval = null; } this.homeView = "default"; void this.renderHomeTab(); });

		if (this.answerQuestions.length === 0) {
			el.createEl("p", { text: "未能解析出可答题的题目。", attr: { style: "color:var(--text-muted);padding:20px 0;" } });
			return;
		}

		const typeLabels: Record<QuestionType, string> = { single: "单选", multi: "多选", judge: "判断", blank: "填空", essay: "简答" };
		const counts: Record<string, number> = {};
		for (const q of this.answerQuestions) { const k = typeLabels[q.type]; counts[k] = (counts[k] || 0) + 1; }
		const summary = Object.entries(counts).map(([k, v]) => k + " " + v).join(" / ");
		el.createDiv({ text: "共 " + this.answerQuestions.length + " 题：" + summary, cls: "qg-summary" });

		for (const q of this.answerQuestions) {
			const isGradable = q.type === "single" || q.type === "multi" || q.type === "judge";
			const qEl = el.createDiv({ attr: { style: "border:1px solid var(--background-modifier-border);border-radius:8px;padding:12px 14px;margin-bottom:10px;" } });

			const headerRow = qEl.createDiv({ attr: { style: "display:flex;align-items:center;gap:6px;margin-bottom:8px;" } });
			headerRow.createSpan({ text: typeLabels[q.type], attr: { style: "font-size:16px;padding:2px 6px;border-radius:4px;background:var(--interactive-accent);color:var(--text-on-accent);font-weight:500;" } });
			headerRow.createSpan({ text: "第 " + q.number + " 题", attr: { style: "font-size:17px;color:var(--text-muted);" } });
			if (!isGradable) headerRow.createSpan({ text: "(仅参考)", attr: { style: "font-size:16px;color:var(--text-faint);" } });

			qEl.createDiv({ text: q.text, attr: { style: "font-weight:600;line-height:1.7;font-size:19px;margin-bottom:8px;" } });

			if (q.type === "single" || q.type === "judge") {
				const optsEl = qEl.createDiv({ cls: "qg-opts-col" });
				for (const opt of q.options) {
					const optRow = optsEl.createDiv({ cls: "qg-option-row" });
					const radio = optRow.createEl("input", { attr: { type: "radio", name: "q" + q.number, value: opt.label } });
					optRow.createSpan({ text: opt.label + ". " + opt.text, cls: "qg-option-text" });
					radio.addEventListener("change", () => { this.answerAnswers.set(q.number, opt.label); });
					optRow.addEventListener("click", () => { radio.checked = true; this.answerAnswers.set(q.number, opt.label); });
				}
			} else if (q.type === "multi") {
				const optsEl = qEl.createDiv({ cls: "qg-opts-col" });
				const selected = new Set<string>();
				for (const opt of q.options) {
					const optRow = optsEl.createDiv({ cls: "qg-option-row" });
					const cb = optRow.createEl("input", { attr: { type: "checkbox", value: opt.label } });
					optRow.createSpan({ text: opt.label + ". " + opt.text, cls: "qg-option-text" });
					const updateMulti = () => { this.answerAnswers.set(q.number, [...selected].sort().join("")); };
					cb.addEventListener("change", () => { cb.checked ? selected.add(opt.label) : selected.delete(opt.label); updateMulti(); });
					optRow.addEventListener("click", (e) => { if ((e.target as HTMLElement).tagName !== "INPUT") { cb.checked = !cb.checked; cb.checked ? selected.add(opt.label) : selected.delete(opt.label); updateMulti(); } });
				}
			} else if (q.type === "blank") {
				const input = qEl.createEl("input", { cls: "qg-input-wide", attr: { type: "text", placeholder: "填写答案..." } });
				input.addEventListener("input", () => { this.answerAnswers.set(q.number, input.value.trim()); });
			} else if (q.type === "essay") {
				const ta = qEl.createEl("textarea", { attr: { style: "width:100%;min-height:80px;padding:8px;border-radius:4px;border:1px solid var(--background-modifier-border);resize:vertical;font-size:19px;line-height:1.7;box-sizing:border-box;", placeholder: "输入你的答案..." } });
				ta.addEventListener("input", () => { this.answerAnswers.set(q.number, ta.value.trim()); });
			}
		}

		const submitBtn = el.createDiv({ attr: { style: "margin-top:10px;text-align:center;" } });
		const sb = submitBtn.createEl("button", { text: "提交答卷", attr: { class: "mod-cta", style: "padding:8px 24px;border-radius:4px;cursor:pointer;font-size:20px;" } });
		sb.addEventListener("click", () => this.answerSubmit());
	}

	answerSubmit() {
		if (this.answerTimerInterval) { window.clearInterval(this.answerTimerInterval); this.answerTimerInterval = null; }
		if (!this.innerContentEl) return;
		const el = this.innerContentEl;
		el.empty();

		const backBtn = el.createEl("button", { text: "← 重新答题", attr: { style: "padding:4px 10px;border-radius:4px;cursor:pointer;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);font-size:19px;margin-bottom:10px;" } });
		backBtn.addEventListener("click", () => { this.answerAnswers = new Map(); this.answerWrongChecked = new Set(); this.answerStartTime = Date.now(); this.renderAnswerView(); });

		const gradable = this.answerQuestions.filter(q => q.type === "single" || q.type === "multi" || q.type === "judge");
		const nonGradable = this.answerQuestions.filter(q => q.type === "blank" || q.type === "essay");

		let correct = 0;
		const wrongList: ParsedQuestion[] = [];
		for (const q of gradable) {
			const userAnswer = this.answerAnswers.get(q.number) || "";
			let isCorrect = false;
			if (q.type === "single" || q.type === "judge") isCorrect = userAnswer.toUpperCase() === q.answer.toUpperCase();
			else if (q.type === "multi") isCorrect = userAnswer.split("").sort().join("").toUpperCase() === q.answer.toUpperCase();
			if (isCorrect) correct++;
			else wrongList.push(q);
		}

		const totalGradable = gradable.length;
		const score = totalGradable > 0 ? Math.round((correct / totalGradable) * 100) : -1;

		const scoreCard = el.createDiv({ attr: { style: "text-align:center;padding:16px;margin-bottom:14px;border-radius:8px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);" } });
		if (score >= 0) {
			const scoreColor = score >= 80 ? "var(--color-green)" : score >= 60 ? "var(--color-yellow)" : "var(--color-red)";
			scoreCard.createDiv({ text: score + " 分", attr: { style: "font-size:36px;font-weight:bold;color:" + scoreColor + ";line-height:1.2;" } });
			scoreCard.createDiv({ text: "客观题 " + totalGradable + " 题：正确 " + correct + " / 错误 " + wrongList.length, attr: { style: "color:var(--text-muted);margin-top:6px;font-size:19px;" } });
		}
		if (nonGradable.length > 0) scoreCard.createDiv({ text: "主观题 " + nonGradable.length + " 题：请对照参考答案自查", attr: { style: "color:var(--text-faint);margin-top:4px;font-size:18px;" } });

		const typeLabels: Record<QuestionType, string> = { single: "单选", multi: "多选", judge: "判断", blank: "填空", essay: "简答" };

		if (gradable.length > 0) {
			el.createDiv({ text: "客观题详情", attr: { style: "font-size:19px;font-weight:600;margin:12px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--background-modifier-border);" } });
			for (const q of gradable) {
				const userAnswer = this.answerAnswers.get(q.number) || "";
				let isCorrect = false;
				if (q.type === "single" || q.type === "judge") isCorrect = userAnswer.toUpperCase() === q.answer.toUpperCase();
				else if (q.type === "multi") isCorrect = userAnswer.split("").sort().join("").toUpperCase() === q.answer.toUpperCase();

				const borderColor = isCorrect ? "var(--color-green)" : "var(--color-red)";
				const qEl = el.createDiv({ attr: { style: "border:1px solid " + borderColor + ";border-radius:8px;padding:10px 12px;margin-bottom:8px;" } });

				const qHeader = qEl.createDiv({ attr: { style: "display:flex;align-items:center;gap:6px;margin-bottom:6px;" } });
				const wCb = qHeader.createEl("input", { attr: { type: "checkbox" } });
				wCb.checked = this.answerWrongChecked.has(q.number);
				wCb.addEventListener("change", () => { wCb.checked ? this.answerWrongChecked.add(q.number) : this.answerWrongChecked.delete(q.number); });
				qHeader.createSpan({ text: isCorrect ? "✓ 正确" : "✗ 错误", attr: { style: "font-size:17px;padding:2px 6px;border-radius:4px;font-weight:600;" + (isCorrect ? "background:color-mix(in srgb, var(--color-green) 15%, transparent);color:var(--color-green);" : "background:color-mix(in srgb, var(--color-red) 15%, transparent);color:var(--color-red);") } });
				qHeader.createSpan({ text: typeLabels[q.type], attr: { style: "font-size:16px;color:var(--text-muted);" } });

				qEl.createDiv({ text: q.number + ". " + q.text, attr: { style: "font-weight:600;line-height:1.7;font-size:19px;margin-bottom:6px;" } });

				for (const opt of q.options) {
					const isUserChoice = q.type === "multi" ? userAnswer.includes(opt.label) : opt.label === userAnswer;
					const isCorrectOpt = q.type === "multi" ? q.answer.includes(opt.label) : opt.label === q.answer;
					let optStyle = "padding:2px 0;font-size:19px;line-height:1.5;";
					if (isCorrectOpt) optStyle += "color:var(--color-green);font-weight:600;";
					else if (isUserChoice && !isCorrect) optStyle += "color:var(--color-red);text-decoration:line-through;";
					qEl.createDiv({ text: opt.label + ". " + opt.text, attr: { style: optStyle } });
				}

				if (q.answer) {
					const refLabel = qEl.createDiv({ attr: { style: "margin-top:4px;" } });
					refLabel.createDiv({ text: "参考答案", attr: { style: "font-size:18px;font-weight:700;color:#2E7D32;margin-bottom:2px;" } });
					const steps = splitAnswerContent(q.answer);
					for (const step of steps) qEl.createDiv({ text: step, attr: { style: "font-size:18px;line-height:1.6;" } });
				}
				if (q.explanation) {
					const expLabel = qEl.createDiv({ attr: { style: "margin-top:4px;" } });
					expLabel.createDiv({ text: "考点解析", attr: { style: "font-size:18px;font-weight:700;color:#1565C0;margin-bottom:2px;" } });
					const expLines = splitSemantic(q.explanation);
					for (const line of expLines) qEl.createDiv({ text: line, attr: { style: "font-size:17px;line-height:1.6;color:var(--text-muted);" } });
				}
			}
		}

		if (nonGradable.length > 0) {
			el.createDiv({ text: "主观题参考答案", attr: { style: "font-size:19px;font-weight:600;margin:12px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--background-modifier-border);" } });
			for (const q of nonGradable) {
				const userAnswer = this.answerAnswers.get(q.number) || "";
				const qEl = el.createDiv({ attr: { style: "border:1px solid var(--interactive-accent);border-radius:8px;padding:10px 12px;margin-bottom:8px;" } });
				const qHeader = qEl.createDiv({ attr: { style: "display:flex;align-items:center;gap:6px;margin-bottom:6px;" } });
				const wCb = qHeader.createEl("input", { attr: { type: "checkbox" } });
				wCb.checked = this.answerWrongChecked.has(q.number);
				wCb.addEventListener("change", () => { wCb.checked ? this.answerWrongChecked.add(q.number) : this.answerWrongChecked.delete(q.number); });
				qHeader.createSpan({ text: typeLabels[q.type], attr: { style: "font-size:16px;padding:2px 6px;border-radius:4px;background:var(--interactive-accent);color:var(--text-on-accent);" } });

				qEl.createDiv({ text: q.number + ". " + q.text, attr: { style: "font-weight:600;line-height:1.7;font-size:19px;margin-bottom:6px;" } });
				if (userAnswer) {
					qEl.createDiv({ text: "你的答案：", attr: { style: "font-size:17px;color:var(--text-muted);margin-bottom:2px;" } });
					qEl.createDiv({ text: userAnswer, attr: { style: "padding:6px 10px;border-radius:4px;background:var(--background-secondary);font-size:19px;line-height:1.7;white-space:pre-wrap;" } });
				}
				if (q.answer) {
					const refAns = qEl.createDiv({ attr: { style: "margin-top:6px;" } });
					refAns.createDiv({ text: "参考答案", attr: { style: "font-size:17px;color:#2E7D32;font-weight:700;margin-bottom:2px;" } });
					const steps = splitAnswerContent(q.answer);
					for (const step of steps) refAns.createDiv({ text: step, attr: { style: "padding:3px 10px;border-radius:4px;background:color-mix(in srgb, var(--color-green) 8%, transparent);font-size:19px;line-height:1.7;" } });
				}
				if (q.explanation) {
					const expEl = qEl.createDiv({ cls: "qg-exp-top" });
					expEl.createDiv({ text: "考点解析", cls: "qg-exp-title" });
					const expLines = splitSemantic(q.explanation);
					for (const line of expLines) expEl.createDiv({ text: line, cls: "qg-exp-line" });
				}
			}
		}

		if (this.answerQuestions.length > 0) {
			const wrongBtnRow = el.createDiv({ cls: "qg-mt10" });
			const wrongBtn = wrongBtnRow.createEl("button", { text: "加入错题本", attr: { class: "mod-cta" }, cls: "qg-wrong-btn" });
			const wrongArea = el.createDiv({ cls: "qg-wrong-area qg-hidden" });
			const autoTags = extractKnowledgeTags(this.answerSourceName, this.answerQuestions.map(q => q.text).join("\n"));
			wrongArea.createDiv({ text: "知识点标签（可编辑）：", cls: "qg-label-text" });
			const tagsInput = wrongArea.createEl("input", { attr: { type: "text", value: autoTags.join(", "), placeholder: "微积分, 导数", style: "width:100%;padding:6px;border-radius:4px;border:1px solid var(--background-modifier-border);margin-bottom:6px;font-size:18px;" } });
			wrongArea.createDiv({ text: "备注：", attr: { style: "font-size:18px;margin-bottom:4px;" } });
			const noteArea = wrongArea.createEl("textarea", { attr: { style: "width:100%;height:40px;border-radius:4px;border:1px solid var(--background-modifier-border);font-size:18px;", placeholder: "例如：第3、7题做错了" } });
			const confirmWrongBtn = wrongArea.createEl("button", { text: "确认加入", attr: { class: "mod-cta", style: "padding:5px 14px;border-radius:4px;cursor:pointer;font-size:18px;margin-top:4px;" } });
			confirmWrongBtn.addEventListener("click", () => {
				void (async () => {
					this.answerCurrentTags = tagsInput.value.split(",").map(s => s.trim()).filter(Boolean);
					const checked = this.answerWrongChecked.size > 0 ? this.answerQuestions.filter(q => this.answerWrongChecked.has(q.number)) : wrongList;
					if (checked.length === 0) { new Notice("请先勾选要加入错题本的题目"); return; }
					await this.answerSaveWrongToBook(checked, noteArea.value);
					wrongArea.classList.add("qg-hidden");
				})();
			});
			wrongBtn.addEventListener("click", () => { wrongArea.classList.toggle("qg-hidden"); });
		}

		const homeBtn = el.createDiv({ cls: "qg-home-btn" });
		const hb = homeBtn.createEl("button", { text: "返回首页", cls: "qg-btn-home" });
		hb.addEventListener("click", () => { this.homeView = "default"; void this.renderHomeTab(); });
	}

	async answerSaveWrongToBook(wrongList: ParsedQuestion[], noteText: string) {
		const typeLabels: Record<QuestionType, string> = { single: "单选", multi: "多选", judge: "判断", blank: "填空", essay: "简答" };
		let wrongText = "";
		for (const q of wrongList) {
			wrongText += q.number + ". [" + typeLabels[q.type] + "] " + q.text + "\n";
			for (const opt of q.options) wrongText += opt.label + ". " + opt.text + "\n";
			wrongText += "答案：" + q.answer + "\n";
			if (q.explanation) wrongText += "解析：" + q.explanation + "\n";
			wrongText += "\n";
		}
		const tags = ["错题", ...this.answerCurrentTags];
		const knowledgeLinks = buildKnowledgeLinks(tags);
		try {
			await ensureFolder(this.app, this.plugin.settings.wrongBookFolder);
			const dateStr = new Date().toISOString().slice(0, 10);
			const sourceLink = this.answerSourceName ? "[[" + this.answerSourceName + "]]" : "";
			const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
			const fm = buildFM({ source: sourceLink, sourcePath: this.answerSourcePath, date: dateStr, tags, mastered: false, note: noteText || "答题模式加入（" + wrongList.length + "题错误）", nextReview: tomorrow.toISOString().slice(0, 10), interval: 1, easeFactor: 2.5, reviewCount: 0 });
			const content = fm + wrongText + knowledgeLinks;
			const fileName = safeName(this.answerSourceName) + "_错题_" + dateStr + ".md";
			if (isAbs(this.plugin.settings.wrongBookFolder)) {
				const dir = this.plugin.settings.wrongBookFolder;
				try { writeFileStr(dir + "\\" + fileName, content); }
				catch { writeFileStr(dir + "\\" + safeName(this.answerSourceName) + "_错题_" + Date.now() + ".md", content); }
			} else {
				try { await this.app.vault.create(this.plugin.settings.wrongBookFolder + "/" + fileName, content); }
				catch { await this.app.vault.create(this.plugin.settings.wrongBookFolder + "/" + safeName(this.answerSourceName) + "_错题_" + Date.now() + ".md", content); }
			}
			await this.plugin.updateKnowledgePointMOC(tags, fileName);
			new Notice("已自动将 " + wrongList.length + " 道错题加入错题本");
			this.plugin.emitDataChanged();
		} catch (err) { new Notice("加入错题本失败：" + (err as Error).message); console.error("[question-generator] 加入错题本失败:", err); }
	}

	// ===================== HELPERS =====================
	async openCurrentFileGenerate() {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") { new Notice("请先打开一个Markdown文档"); return; }
		const text = await this.app.vault.read(file);
		this.startGenerate(text, file.name, file.path);
	}

	async getStats() {
		const notes = await this.plugin.loadAllWrongNotes();
		const dueCount = notes.filter(n => isDueForReview(n)).length;
		const mastered = notes.filter(n => n.mastered).length;
		const weakPoints = await this.plugin.getWeakPoints();
		return {
			dueCount,
			totalWrong: notes.length,
			mastered,
			totalGenerated: this.plugin.history.length,
			weakCount: weakPoints.length
		};
	}

	async getDueNotes(): Promise<WrongAnswerNote[]> {
		const notes = await this.plugin.loadAllWrongNotes();
		return notes.filter(n => isDueForReview(n));
	}
}

// ===================== 主插件入口 =====================
export default class QuestionGeneratorPlugin extends Plugin {
	settings!: PluginSettings;
	history: HistoryEntry[] = [];

	async loadSettings() {
		const data = await this.loadData() as { history?: HistoryEntry[]; wrongAnswers?: { timestamp?: number; fileName?: string; note?: string; resultText?: string }[] } | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		if (data?.history) this.history = data.history;
	}
	async saveSettings() {
		await this.saveData({ ...this.settings, history: this.history });
	}
	async saveHistory() {
		await this.saveData({ ...this.settings, history: this.history });
	}
	async addHistory(entry: HistoryEntry) {
		this.history.push(entry);
		await this.saveHistory();
	}

	async migrateOldWrongAnswers() {
		const data = await this.loadData() as { wrongAnswers?: { timestamp?: number; fileName?: string; note?: string; resultText?: string }[] } | null;
		if (data?.wrongAnswers && data.wrongAnswers.length > 0) {
			const folder = this.settings.wrongBookFolder;
			await ensureFolder(this.app, folder);
			let migrated = 0;
			for (const old of data.wrongAnswers) {
				const dateStr = old.timestamp ? new Date(old.timestamp).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
				const tags = ["错题"];
				const fm = buildFM({ source: old.fileName || "未知", date: dateStr, tags, mastered: false, note: old.note || "" });
				const content = fm + (old.resultText || "");
				const fileName = safeName(old.fileName || "未知") + "_错题_" + dateStr + "_" + migrated + ".md";
				try {
					if (isAbs(folder)) writeFileStr(folder + "\\" + fileName, content);
					else await this.app.vault.create(folder + "/" + fileName, content);
					migrated++;
				} catch { /* empty */ }
			}
			if (migrated > 0) new Notice("已迁移 " + migrated + " 条旧错题到 " + folder);
			data.wrongAnswers = [];
			await this.saveData({ ...this.settings, history: this.history, wrongAnswers: [] });
		}
	}

	// ===================== 集中数据管理 =====================
	private _wrongNotesCache: WrongAnswerNote[] | null = null;
	private _cacheTime = 0;
	private _refreshCallbacks: (() => void)[] = [];

	invalidateCache() { this._wrongNotesCache = null; this._cacheTime = 0; }

	onDataChanged(callback: () => void) { this._refreshCallbacks.push(callback); }

	offDataChanged(callback: () => void) { this._refreshCallbacks = this._refreshCallbacks.filter(cb => cb !== callback); }

	emitDataChanged() { this.invalidateCache(); for (const cb of this._refreshCallbacks) { try { cb(); } catch { /* empty */ } } }

	async updateKnowledgePointMOC(tags: string[], noteFileName: string) {
		const kp = knowledgeTags(tags);
		if (kp.length === 0) return;
		const mocFolder = this.settings.wrongBookFolder + "/知识点";
		await ensureFolder(this.app, mocFolder);
		for (const tag of kp) {
			const mocPath = mocFolder + "/" + safeName(tag) + ".md";
			const link = "[[" + noteFileName.replace(/\.md$/, "") + "]]";
			let existing = "";
			let existingLinks: string[] = [];
			try {
				if (isAbs(mocFolder)) {
					existing = readFileStr(mocPath);
				} else {
					const f = this.app.vault.getAbstractFileByPath(mocPath);
					if (f instanceof TFile) existing = await this.app.vault.read(f);
				}
				const { meta, body } = parseFM(existing);
				existingLinks = Array.isArray(meta.relatedLinks) ? meta.relatedLinks : [];
				const linkPattern = /\[\[([^\]]+)\]\]/g;
				let m;
				while ((m = linkPattern.exec(body)) !== null) { if (!existingLinks.includes(m[1]!)) existingLinks.push(m[1]!); }
			} catch { /* empty */ }
			if (!existingLinks.includes(link.replace(/\[\[|\]\]/g, ""))) existingLinks.push(link.replace(/\[\[|\]\]/g, ""));
			const relatedLinksYaml = existingLinks.map(l => "[[" + l.replace(/\[\[|\]\]/g, "") + "]]").join(", ");
			const fm = buildFM({ tags: ["知识点", tag], relatedLinks: relatedLinksYaml, date: todayStr() });
			let body = "# " + tag + "\n\n";
			body += "> 知识点索引（MOC），由智学助手自动维护\n\n";
			body += "## 相关错题\n\n";
			for (const l of existingLinks) {
				body += "- [[" + l.replace(/\[\[|\]\]/g, "") + "]]\n";
			}
			try {
				if (isAbs(mocFolder)) {
					writeFileStr(mocPath, fm + body);
				} else {
					const existingFile = this.app.vault.getAbstractFileByPath(mocPath);
					if (existingFile instanceof TFile) await this.app.vault.modify(existingFile, fm + body);
					else await this.app.vault.create(mocPath, fm + body);
				}
			} catch { /* empty */ }
		}
	}

	async loadAllWrongNotes(forceRefresh = false): Promise<WrongAnswerNote[]> {
		const now = Date.now();
		if (!forceRefresh && this._wrongNotesCache && (now - this._cacheTime < WRONG_NOTES_CACHE_TTL_MS)) {
			return this._wrongNotesCache;
		}
		const notes: WrongAnswerNote[] = [];
		const folder = this.settings.wrongBookFolder;
		if (isAbs(folder)) {
			ensureFolderAbs(folder);
			for (const f of listMdFiles(folder)) {
				const { meta, body } = parseFM(readFileStr(folder + "/" + f));
				notes.push({ filePath: folder + "/" + f, baseName: f.replace(/\.md$/, ""), date: (meta.date as string) || "", sourceFile: (meta.source as string) || "", sourcePath: (meta.sourcePath as string) || "", tags: Array.isArray(meta.tags) ? meta.tags : [], mastered: meta.mastered === true, resultText: body, note: (meta.note as string) || "", nextReview: (meta.nextReview as string) || "", interval: typeof meta.interval === "number" ? meta.interval : 1, easeFactor: typeof meta.easeFactor === "number" ? meta.easeFactor : 2.5, reviewCount: typeof meta.reviewCount === "number" ? meta.reviewCount : 0 });
			}
		} else {
			const folderFile = this.app.vault.getAbstractFileByPath(folder);
			if (folderFile instanceof TFolder) {
				for (const child of folderFile.children) {
					if (child instanceof TFile && child.extension === "md") {
						const { meta, body } = parseFM(await this.app.vault.read(child));
						notes.push({ filePath: child.path, baseName: child.basename, date: (meta.date as string) || "", sourceFile: (meta.source as string) || "", sourcePath: (meta.sourcePath as string) || "", tags: Array.isArray(meta.tags) ? meta.tags : [], mastered: meta.mastered === true, resultText: body, note: (meta.note as string) || "", nextReview: (meta.nextReview as string) || "", interval: typeof meta.interval === "number" ? meta.interval : 1, easeFactor: typeof meta.easeFactor === "number" ? meta.easeFactor : 2.5, reviewCount: typeof meta.reviewCount === "number" ? meta.reviewCount : 0 });
					}
				}
			}
		}
		this._wrongNotesCache = notes;
		this._cacheTime = now;
		return notes;
	}

	async deleteWrongNote(filePath: string) {
		if (isAbs(filePath)) {
			if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
		} else {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file instanceof TFile) await this.app.fileManager.trashFile(file);
		}
		this.invalidateCache();
	}

	async getWeakPoints(): Promise<{ tag: string; count: number; questions: WrongAnswerNote[] }[]> {
		const notes = await this.loadAllWrongNotes();
		const unmastered = notes.filter(n => !n.mastered);
		const threshold = this.settings.weakPointThreshold || 2;
		const tagMap: Record<string, WrongAnswerNote[]> = {};
		for (const n of unmastered) {
			for (const t of knowledgeTags(n.tags)) {
				if (!tagMap[t]) tagMap[t] = [];
				tagMap[t].push(n);
			}
		}
		return Object.entries(tagMap)
			.filter(([_, list]) => list.length >= threshold)
			.map(([tag, list]) => ({ tag, count: list.length, questions: list }))
			.sort((a, b) => b.count - a.count);
	}

	async migrateKnowledgeLinks() {
		const notes = await this.loadAllWrongNotes(true);
		const mocFolder = this.settings.wrongBookFolder + "/知识点";
		await ensureFolder(this.app, mocFolder);
		const allTagLinks: Record<string, string[]> = {};
		let updated = 0;

		for (const note of notes) {
			const kp = knowledgeTags(note.tags);
			if (kp.length === 0) continue;
			const hasLinks = note.resultText.includes("**知识点：**");
			if (hasLinks) {
				for (const tag of kp) {
					const noteBaseName = note.baseName;
					if (!allTagLinks[tag]) allTagLinks[tag] = [];
					if (!allTagLinks[tag].includes(noteBaseName)) allTagLinks[tag].push(noteBaseName);
				}
				continue;
			}
			const knowledgeLinkText = "\n\n**知识点：** " + kp.map(t => "[[" + t + "]]").join(" ") + "\n";
			if (isAbs(this.settings.wrongBookFolder)) {
				const content = readFileStr(note.filePath);
				writeFileStr(note.filePath, content + knowledgeLinkText);
			} else {
				const file = this.app.vault.getAbstractFileByPath(note.filePath);
				if (file instanceof TFile) {
					const content = await this.app.vault.read(file);
					await this.app.vault.modify(file, content + knowledgeLinkText);
				}
			}
			for (const tag of kp) {
				const noteBaseName = note.baseName;
				if (!allTagLinks[tag]) allTagLinks[tag] = [];
				if (!allTagLinks[tag].includes(noteBaseName)) allTagLinks[tag].push(noteBaseName);
			}
			updated++;
		}

		for (const [tag, linkNames] of Object.entries(allTagLinks)) {
			const mocPath = mocFolder + "/" + safeName(tag) + ".md";
			const fm = buildFM({ tags: ["知识点", tag], date: todayStr() });
			let body = "# " + tag + "\n\n";
			body += "> 知识点索引（MOC），由智学助手自动维护\n\n";
			body += "## 相关错题\n\n";
			for (const name of linkNames) {
				body += "- [[" + name + "]]\n";
			}
			try {
				if (isAbs(mocFolder)) {
					writeFileStr(mocPath, fm + body);
				} else {
					const existingFile = this.app.vault.getAbstractFileByPath(mocPath);
					if (existingFile instanceof TFile) await this.app.vault.modify(existingFile, fm + body);
					else await this.app.vault.create(mocPath, fm + body);
				}
			} catch { /* empty */ }
		}

		if (updated > 0) new Notice("已为 " + updated + " 条错题补充知识点链接");
		this.invalidateCache();
	}

	async exportToFile(text: string, defaultName: string, format: "md" | "word" | "pdf", title?: string, source?: string) {
		try {
			
			if (format === "md") {
				const r = await getElectronRemote().dialog.showSaveDialog({ defaultPath: defaultName + ".md", filters: [{ name: "Markdown", extensions: ["md"] }] });
				if (r.canceled || !r.filePath) return;
				const dateStr = new Date().toISOString().slice(0, 10);
				const mdHeader = title ? "# " + title + "\n\n> 来源：" + (source || title) + "　|　日期：" + dateStr + "\n\n" : "";
				fs.writeFileSync(r.filePath, mdHeader + stripAnswerSummarySection(text), "utf-8");
				new Notice("Md文件已保存");
			} else if (format === "word") {
				const r = await getElectronRemote().dialog.showSaveDialog({ defaultPath: defaultName + ".docx", filters: [{ name: "Word", extensions: ["docx"] }] });
				if (r.canceled || !r.filePath) return;
				const children = buildWordParagraphs(text, title, source);
				const doc = new Document({ sections: [{ properties: {}, children }] });
				const buffer = await Packer.toBuffer(doc);
				fs.writeFileSync(r.filePath, Buffer.from(buffer));
				new Notice("Word文件已保存");
			} else if (format === "pdf") {
				const r = await getElectronRemote().dialog.showSaveDialog({ defaultPath: defaultName + ".pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
				if (r.canceled || !r.filePath) return;
				await exportPdfDirect(r.filePath, text, title, source);
				new Notice("PDF文件已保存");
			}
		} catch (err) { new Notice("导出失败：" + (err as Error).message); }
	}

	async activateSidebar(): Promise<MainSidebarView | null> {
		const leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
		if (leaves.length > 0) {
			await this.app.workspace.revealLeaf(leaves[0]!);
			return leaves[0]!.view as MainSidebarView;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: true });
			return leaf.view as MainSidebarView;
		}
		return null;
	}

	async onload() {
		await this.loadSettings();

		try {
			await ensureFolder(this.app, this.settings.questionFolder);
			await ensureFolder(this.app, this.settings.wrongBookFolder);
			await this.migrateOldWrongAnswers();
			await this.migrateKnowledgeLinks();
		} catch (err) {
			console.error("[question-generator] 启动初始化错误:", err);
		}

		this.registerView(SIDEBAR_VIEW_TYPE, (leaf) => new MainSidebarView(leaf, this));

		this.addRibbonIcon("pencil", "智学助手", async () => {
			const leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
			if (leaves.length > 0) {
				await this.app.workspace.revealLeaf(leaves[0]!);
			} else {
				const leaf = this.app.workspace.getRightLeaf(false);
				if (leaf) {
					await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: true });
				}
			}
		});

		this.app.workspace.onLayoutReady(async () => {
			const leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
			if (leaves.length === 0) {
				const leaf = this.app.workspace.getRightLeaf(false);
				if (leaf) {
					await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: true });
				}
			}
			if (this.settings.autoReviewReminder) {
				try {
					const notes = await this.loadAllWrongNotes();
					const dueCount = notes.filter(n => isDueForReview(n)).length;
					if (dueCount > 0) {
						this.registerInterval(window.setTimeout(() => {
							const notice = new Notice("你有 " + dueCount + " 道错题待复习，点击开始", NOTICE_DURATION_MS);
							notice.messageEl.addEventListener("click", () => {
								void (async () => {
									const view = await this.activateSidebar();
									if (view) { view.activeSection = "wrong"; view.wrongView = "list"; await view.render(); }
								})();
							});
						}, REVIEW_REMINDER_DELAY_MS));
					}
				} catch { /* empty */ }
			}
		});

		this.addCommand({ id: "open-sidebar", name: "打开智学助手侧边栏", callback: async () => {
			await this.activateSidebar();
		}});
		this.addCommand({ id: "view-history", name: "查看出题历史记录", callback: async () => {
			const view = await this.activateSidebar();
			if (view) { view.activeSection = "wrong"; view.wrongView = "list"; await view.render(); }
		}});
		this.addCommand({ id: "view-wrong-answers", name: "查看错题本", callback: async () => {
			const view = await this.activateSidebar();
			if (view) { view.activeSection = "wrong"; view.wrongView = "list"; await view.render(); }
		}});
		this.addCommand({ id: "rebuild-knowledge-index", name: "重建知识点索引", callback: async () => { await this.migrateKnowledgeLinks(); new Notice("知识点索引已重建"); } });
		this.addCommand({
			id: "generate-from-current",
			name: "基于当前文档生成试题",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") { new Notice("请先打开一个Markdown文档"); return; }
				const text = await this.app.vault.read(file);
				const view = await this.activateSidebar();
				if (view) { view.activeSection = "home"; view.homeView = "generate"; view.genSourceText = text; view.genFileName = file.name; view.genSourcePath = file.path; await view.render(); }
			}
		});

		this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
			try {
				if (file instanceof TFolder) {
					menu.addItem(item => item.setTitle("选择文件出题").onClick(async () => {
						const view = await this.activateSidebar();
						if (view) { view.activeSection = "home"; view.homeView = "filePicker"; await view.render(); }
					}));
				}
				if (file instanceof TFile && file.extension === "md") {
					menu.addItem(item => item.setTitle("基于本文档生成试题").onClick(async () => {
						const text = await this.app.vault.read(file);
						const view = await this.activateSidebar();
						if (view) { view.activeSection = "home"; view.homeView = "generate"; view.genSourceText = text; view.genFileName = file.name; view.genSourcePath = file.path; await view.render(); }
					}));
				}
			} catch (e) {
				console.error("[question-generator] file-menu error:", e);
			}
		}));

		this.registerEvent(this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
			try {
				const selectText = editor.getSelection();
				if (selectText && selectText.trim().length > 0) {
					const fileName = ("file" in info ? info.file?.name : undefined) || "片段";
					const filePath = ("file" in info ? info.file?.path : undefined) || "";
					menu.addItem(item => item.setTitle("基于选中内容生成试题").onClick(async () => {
						let fullText = selectText;
						if (fileName && fileName !== "片段") {
							try {
								const file = this.app.vault.getAbstractFileByPath(filePath);
								if (file instanceof TFile) {
									const fileTitle = file.basename;
									fullText = "文档标题：" + fileTitle + "\n\n" + selectText;
								}
							} catch { /* empty */ }
						}
						const sidebarView = await this.activateSidebar();
						if (sidebarView) { sidebarView.activeSection = "home"; sidebarView.homeView = "generate"; sidebarView.genSourceText = fullText; sidebarView.genFileName = fileName; sidebarView.genSourcePath = filePath; await sidebarView.render(); }
					}));
				}
			} catch (e) {
				console.error("[question-generator] editor-menu error:", e);
			}
		}));

		this.registerDomEvent(document, "keydown", (evt: KeyboardEvent) => {
			try {
				if (evt.ctrlKey && evt.key === "q") {
					evt.preventDefault();
					const file = this.app.workspace.getActiveFile();
					if (file && file.extension === "md") {
						this.app.vault.read(file).then(async text => {
							const view = await this.activateSidebar();
							if (view) { view.activeSection = "home"; view.homeView = "generate"; view.genSourceText = text; view.genFileName = file.name; view.genSourcePath = file.path; await view.render(); }
						}).catch(e => console.error("[question-generator]", e));
					} else {
						new Notice("请先打开一个Markdown文档再使用 Ctrl+Q");
					}
				}
				if (evt.ctrlKey && evt.key === "w") {
					evt.preventDefault();
					this.activateSidebar().then(async view => {
						if (view) { view.activeSection = "wrong"; view.wrongView = "list"; await view.render(); }
					}).catch(e => console.error("[question-generator]", e));
				}
			} catch (e) {
				console.error("[question-generator] keydown error:", e);
			}
		});
	}
	onunload() {
		const leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
		for (const leaf of leaves) { leaf.detach(); }
	}
}
