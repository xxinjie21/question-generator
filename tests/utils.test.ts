import { describe, it, expect } from "vitest";
import {
	parseFM,
	buildFM,
	safeName,
	cleanSourceText,
	estimateTokens,
	stripAnswersForExport,
	reviewUpdate,
	todayStr,
	isDueForReview,
	stripMd,
	parseQuestions,
	stripAnswerSummarySection,
	splitSemantic,
	normalizeAnswerSteps,
	splitAnswerContent,
	htmlEscape,
} from "../src/main";

describe("parseFM", () => {
	it("parses frontmatter with inline array", () => {
		const { meta, body } = parseFM("---\ntitle: Test\ntags: [tag1, tag2]\n---\n\nBody content");
		expect(meta.title).toBe("Test");
		expect(meta.tags).toEqual(["tag1", "tag2"]);
		expect(body).toBe("Body content");
	});

	it("parses frontmatter with scalar values", () => {
		const { meta, body } = parseFM("---\nkey: value\ncount: 5\nflag: true\n---\n\nContent");
		expect(meta.key).toBe("value");
		expect(meta.count).toBe("5");
		expect(meta.flag).toBe(true);
		expect(body).toBe("Content");
	});

	it("returns empty meta for no frontmatter", () => {
		const { meta, body } = parseFM("Just content");
		expect(meta).toEqual({});
		expect(body).toBe("Just content");
	});
});

describe("buildFM", () => {
	it("builds frontmatter string", () => {
		const result = buildFM({ title: "Test", tags: ["a", "b"], count: 5 });
		expect(result).toContain('title: "Test"');
		expect(result).toContain("tags: [a, b]");
  expect(result).toContain("count: 5");
		expect(result.startsWith("---\n")).toBe(true);
		expect(result.endsWith("\n---\n\n")).toBe(true);
	});
});

describe("safeName", () => {
	it("sanitizes filenames", () => {
		expect(safeName("hello/world:test")).toBe("hello_world_test");
		expect(safeName("normal")).toBe("normal");
		expect(safeName("a<b>c\"d|e?f*g")).toBe("a_b_c_d_e_f_g");
	});
});

describe("cleanSourceText", () => {
	it("removes frontmatter markers but keeps content", () => {
		expect(cleanSourceText("---\ntitle: x\n---\n\nContent")).toBe("title: x\n\nContent");
	});

	it("returns text without frontmatter as-is", () => {
		expect(cleanSourceText("Hello World")).toBe("Hello World");
	});
});

describe("estimateTokens", () => {
	it("estimates token count", () => {
		const count = estimateTokens("Hello world");
		expect(count).toBeGreaterThan(0);
	});
});

describe("stripAnswersForExport", () => {
	it("removes answer lines", () => {
		const result = stripAnswersForExport("Q1\n答案：A\n解析：text\n\nQ2");
		expect(result).not.toContain("答案：");
		expect(result).toContain("Q1");
	});
});

describe("reviewUpdate", () => {
	it("increases interval on correct answer", () => {
		const result = reviewUpdate(0, true);
		expect(result.correctCount).toBe(1);
		expect(result.interval).toBeGreaterThan(0);
	});

	it("resets to 0 on wrong answer", () => {
		const result = reviewUpdate(3, false);
		expect(result.correctCount).toBe(0);
		expect(result.interval).toBe(1);
	});
});

describe("todayStr", () => {
	it("returns date in YYYY-MM-DD format", () => {
		expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe("isDueForReview", () => {
	it("returns true for past dates", () => {
		const note = {
			nextReview: "2020-01-01",
			interval: 1,
			correctCount: 0,
			wrongCount: 1,
		} as any;
		expect(isDueForReview(note)).toBe(true);
	});

	it("returns false for future dates", () => {
		const note = {
			nextReview: "2099-12-31",
			interval: 1,
			correctCount: 0,
			wrongCount: 1,
		} as any;
		expect(isDueForReview(note)).toBe(false);
	});
});

describe("stripMd", () => {
	it("removes bold and italic", () => {
		expect(stripMd("**bold** and *italic*")).toBe("bold and italic");
	});
});

describe("parseQuestions", () => {
	it("parses single choice question", () => {
		const result = parseQuestions("## 单选题\n1. Test question\nA. Opt1\nB. Opt2\n答案：A\n解析：Explanation");
		expect(result.length).toBe(1);
		expect(result[0]!.type).toBe("single");
		expect(result[0]!.number).toBe(1);
		expect(result[0]!.text).toContain("Test question");
		expect(result[0]!.answer).toBe("A");
		expect(result[0]!.options.length).toBe(2);
	});

	it("parses multiple choice question", () => {
		const result = parseQuestions("## 多选题\n1. Multi?\nA. Opt1\nB. Opt2\n答案：AB");
		expect(result.length).toBe(1);
		expect(result[0]!.type).toBe("multi");
		expect(result[0]!.answer).toBe("AB");
	});

	it("parses true/false question", () => {
		const result = parseQuestions("## 判断题\n1. True?\nA. 正确\nB. 错误\n答案：A");
		expect(result.length).toBe(1);
		expect(result[0]!.type).toBe("judge");
	});

	it("parses fill-in-the-blank question", () => {
		const result = parseQuestions("## 填空题\n1. Fill ___\n答案：answer");
		expect(result.length).toBe(1);
		expect(result[0]!.type).toBe("blank");
	});

	it("returns empty for no questions", () => {
		const result = parseQuestions("Just some text");
		expect(result.length).toBe(0);
	});
});

describe("stripAnswerSummarySection", () => {
	it("removes answer summary section", () => {
		const result = stripAnswerSummarySection("Content\n\n---\n\n答案汇总\n1. A\n2. B");
		expect(result).not.toContain("答案汇总");
	});
});

describe("splitAnswerContent", () => {
	it("splits numbered answers", () => {
		const result = splitAnswerContent("1. First\n2. Second");
		expect(result.length).toBe(2);
	});

	it("returns single answer as array", () => {
		const result = splitAnswerContent("Simple answer");
		expect(result.length).toBe(1);
	});
});

describe("htmlEscape", () => {
	it("escapes HTML special chars", () => {
		expect(htmlEscape("<div>\"test\"&</div>")).toBe("&lt;div&gt;&quot;test&quot;&amp;&lt;/div&gt;");
	});
});
