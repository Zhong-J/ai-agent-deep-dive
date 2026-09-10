import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateArchive, validateIssue } from "../scripts/generate.mjs";

const sections = [
  "proposition",
  "connection",
  "mechanism",
  "mathematics",
  "implications",
  "tradeoffs",
  "takeaways",
  "sources",
  "continuity",
];

function paragraph(language, section) {
  const body = language === "中文" ? "机制".repeat(180) : "mechanism ".repeat(240);
  return `<p>${language} ${section} ${body}</p>`;
}

function fixture(overrides = {}) {
  const issue = {
    date: "2026-09-08",
    slug: "next-token-prediction-to-agent-action",
    readingMinutes: 18,
    topicId: "llm-next-token-agent-action",
    series: { id: "llm-foundations", title: { zh: "LLM 基础", en: "LLM Foundations" }, part: 1, total: 3, complete: false },
    title: { zh: "下一个 token 如何驱动 Agent", en: "How the Next Token Drives an Agent" },
    dek: { zh: "从概率分布到行动循环。", en: "From probability distributions to action loops." },
    tags: ["LLM", "Agent Runtime"],
    sections: sections.map((id) => ({
      id,
      title: { zh: `中文 ${id}`, en: `English ${id}` },
      html: { zh: paragraph("中文", id), en: paragraph("English", id) },
    })),
    continuation: {
      status: "continues",
      established: { zh: ["已建立"], en: ["Established"] },
      next: { zh: "下一篇继续", en: "Continues tomorrow" },
    },
    ...overrides,
  };
  return issue;
}

test("validateIssue accepts a complete bilingual continuation", () => {
  assert.doesNotThrow(() => validateIssue(fixture()));
});

test("validateIssue rejects a missing English section", () => {
  const issue = fixture();
  issue.sections[2].html.en = "";
  assert.throws(() => validateIssue(issue), /mechanism.*English/i);
});

test("validateIssue rejects inconsistent series continuation", () => {
  const issue = fixture({ continuation: { status: "complete" } });
  assert.throws(() => validateIssue(issue), /series.*complete/i);
});

test("validateIssue rejects executable HTML in generated content", () => {
  const issue = fixture();
  issue.sections[0].html.en = '<a href="java&#x73;cript:alert(1)">Unsafe</a>';
  assert.throws(() => validateIssue(issue), /executable HTML/i);
});

test("validateIssue rejects content too short for a deep dive", () => {
  const issue = fixture();
  issue.sections.forEach((section) => { section.html.zh = "<p>太短</p>"; });
  assert.throws(() => validateIssue(issue), /Chinese content.*short/i);
});

test("generateArchive creates index, dated page, search data, and curriculum state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-dive-test-"));
  try {
    await generateArchive({ outputDirectory: directory, issues: [fixture()] });
    const [index, page, search, state] = await Promise.all([
      readFile(join(directory, "index.html"), "utf8"),
      readFile(join(directory, "entries", "2026-09-08.html"), "utf8"),
      readFile(join(directory, "search-index.json"), "utf8"),
      readFile(join(directory, "curriculum-state.json"), "utf8"),
    ]);

    assert.match(index, /AI Agent Deep Dive/);
    assert.match(index, /entries\/2026-09-08\.html/);
    assert.match(page, /data-language="zh"/);
    assert.match(page, /data-language="en"/);
    assert.match(page, /aria-pressed/);
    assert.match(page, /localStorage/);
    assert.match(page, /Part 1 of 3/);
    assert.match(page, /data-section-id="mechanism"/);
    assert.match(page, /scrollIntoView/);
    assert.match(await readFile(join(directory, "assets", "styles.css"), "utf8"), /scroll-margin-top:\s*100px/);
    assert.match(index, /data-searchable="[^"]*llm foundations/i);
    assert.equal(JSON.parse(search).length, 1);
    assert.equal(JSON.parse(state).pendingSeries.id, "llm-foundations");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("generated styles keep hidden archive search results out of layout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-dive-hidden-results-"));
  try {
    await generateArchive({ outputDirectory: directory, issues: [fixture()] });
    const styles = await readFile(join(directory, "assets", "styles.css"), "utf8");
    assert.match(styles, /\[hidden\]\s*\{\s*display:\s*none\s*!important\s*\}/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("generateArchive does not resurrect a series completed by its latest part", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-dive-complete-"));
  const completed = fixture({
    date: "2026-09-09",
    topicId: "llm-foundations-part-2",
    series: { id: "llm-foundations", title: { zh: "LLM 基础", en: "LLM Foundations" }, part: 2, total: 2, complete: true },
    continuation: { status: "complete" },
  });
  try {
    await generateArchive({ outputDirectory: directory, issues: [fixture(), completed] });
    const state = JSON.parse(await readFile(join(directory, "curriculum-state.json"), "utf8"));
    assert.equal(state.pendingSeries, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("generateArchive is idempotent for one date", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-dive-idempotent-"));
  try {
    await generateArchive({ outputDirectory: directory, issues: [fixture()] });
    const first = await readFile(join(directory, "index.html"), "utf8");
    await generateArchive({ outputDirectory: directory, issues: [fixture()] });
    assert.equal(await readFile(join(directory, "index.html"), "utf8"), first);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
