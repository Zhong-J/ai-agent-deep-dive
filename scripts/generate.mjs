import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REQUIRED_SECTIONS = [
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

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
}

function validateLocalized(value, label) {
  if (!value || typeof value !== "object") throw new Error(`${label} must be bilingual`);
  requiredString(value.zh, `${label} Chinese`);
  requiredString(value.en, `${label} English`);
}

function validateLocalizedList(value, label) {
  if (!value || typeof value !== "object") throw new Error(`${label} must be bilingual`);
  for (const language of ["zh", "en"]) {
    if (!Array.isArray(value[language]) || value[language].length < 1
      || value[language].some((item) => typeof item !== "string" || !item.trim())) {
      throw new Error(`${label} ${language === "zh" ? "Chinese" : "English"} must be a non-empty list`);
    }
  }
}

function rejectExecutableHtml(html, label) {
  const decoded = html.replace(/&#(?:x([0-9a-f]+)|(\d+));?/gi, (_, hex, decimal) =>
    String.fromCodePoint(Number.parseInt(hex || decimal, hex ? 16 : 10)))
    .replace(/&(colon|tab|newline);/gi, (_, name) => ({ colon: ":", tab: "\t", newline: "\n" })[name.toLowerCase()]);
  const unsafe = /<\s*(script|iframe|object|embed|style|link|meta)\b|\son[a-z]+\s*=|(?:java|vb)script\s*:|data\s*:\s*text\/html/i;
  if (unsafe.test(decoded)) throw new Error(`${label} contains executable HTML`);
}

function plainText(html) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|ensp|emsp);/gi, " ")
    .replace(/&#(?:x([0-9a-f]+)|(\d+));?/gi, (_, hex, decimal) => String.fromCodePoint(Number.parseInt(hex || decimal, hex ? 16 : 10)))
    .replace(/&[a-z][a-z0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateIssue(issue) {
  if (!issue || typeof issue !== "object") throw new Error("issue must be an object");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issue.date || "")) throw new Error("issue.date must use YYYY-MM-DD");
  requiredString(issue.slug, "issue.slug");
  requiredString(issue.topicId, "issue.topicId");
  if (!Number.isInteger(issue.readingMinutes) || issue.readingMinutes < 10 || issue.readingMinutes > 25) {
    throw new Error("readingMinutes must be an integer from 10 to 25");
  }
  validateLocalized(issue.title, "title");
  validateLocalized(issue.dek, "dek");
  if (!Array.isArray(issue.tags) || issue.tags.length < 1) throw new Error("tags are required");
  if (!issue.series || typeof issue.series !== "object") throw new Error("series is required");
  requiredString(issue.series.id, "series.id");
  validateLocalized(issue.series.title, "series.title");
  if (!Number.isInteger(issue.series.part) || issue.series.part < 1) throw new Error("series.part must be positive");
  if (issue.series.total !== null && (!Number.isInteger(issue.series.total) || issue.series.total < issue.series.part)) {
    throw new Error("series.total must be null or at least the current part");
  }
  if (typeof issue.series.complete !== "boolean") throw new Error("series.complete must be boolean");
  if (!Array.isArray(issue.sections)) throw new Error("sections must be an array");
  for (const id of REQUIRED_SECTIONS) {
    const section = issue.sections.find((candidate) => candidate?.id === id);
    if (!section) throw new Error(`${id} section is required`);
    validateLocalized(section.title, `${id} title`);
    validateLocalized(section.html, `${id} HTML`);
    rejectExecutableHtml(section.html.zh, `${id} Chinese HTML`);
    rejectExecutableHtml(section.html.en, `${id} English HTML`);
  }
  const chineseLength = issue.sections.reduce((total, section) => total + plainText(section.html.zh).replace(/\s/g, "").length, 0);
  const englishWords = issue.sections.reduce((total, section) => total + (plainText(section.html.en).match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length || 0), 0);
  if (chineseLength < 2400) throw new Error(`Chinese content is too short for a deep dive (${chineseLength}/2400 characters)`);
  if (englishWords < 1800) throw new Error(`English content is too short for a deep dive (${englishWords}/1800 words)`);
  if (!issue.continuation || typeof issue.continuation !== "object") throw new Error("continuation is required");
  if (issue.series.complete && issue.continuation.status !== "complete") {
    throw new Error("series marked complete requires complete continuation status");
  }
  if (!issue.series.complete && issue.continuation.status !== "continues") {
    throw new Error("series not complete requires continues continuation status");
  }
  if (!issue.series.complete) {
    validateLocalizedList(issue.continuation.established, "continuation.established");
    validateLocalized(issue.continuation.next, "continuation.next");
  }
  return issue;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function listText(value) {
  return Array.isArray(value) ? value.join(" · ") : value;
}

function renderSections(issue, language) {
  return issue.sections.map((section, index) => `
      <section class="lesson-section" id="${escapeHtml(section.id)}-${language}" data-section-id="${escapeHtml(section.id)}">
        <header class="section-label"><span>${String(index + 1).padStart(2, "0")}</span><h2>${escapeHtml(section.title[language])}</h2></header>
        <div class="section-copy">${section.html[language]}</div>
      </section>`).join("");
}

function seriesLabel(issue, language) {
  const total = issue.series.total || "?";
  return language === "zh"
    ? `${issue.series.title.zh} · 第 ${issue.series.part}/${total} 篇`
    : `${issue.series.title.en} · Part ${issue.series.part} of ${total}`;
}

function renderIssuePage(issue, issues) {
  const previous = issues.find((candidate) => candidate.date < issue.date);
  const next = [...issues].reverse().find((candidate) => candidate.date > issue.date);
  const nav = (candidate, labels) => candidate
    ? `<a href="${candidate.date}.html"><span data-nav-language="zh">${labels.zh}</span><span data-nav-language="en" hidden>${labels.en}</span><strong data-nav-language="zh">${escapeHtml(candidate.title.zh)}</strong><strong data-nav-language="en" hidden>${escapeHtml(candidate.title.en)}</strong></a>`
    : `<span></span>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <link rel="icon" href="data:,">
  <title>${escapeHtml(issue.title.zh)} · AI Agent Deep Dive</title>
  <link rel="stylesheet" href="../assets/styles.css">
</head>
<body class="issue-page">
  <header class="topbar">
    <a class="wordmark" href="../index.html"><i></i><span>AI Agent<br><b>Deep Dive</b></span></a>
    <div class="language-switch" role="group" aria-label="Language">
      <button type="button" data-set-language="zh" aria-pressed="true">中文</button>
      <button type="button" data-set-language="en" aria-pressed="false">English</button>
    </div>
  </header>
  <main>
    <article class="lesson" data-language="zh">
      <p class="kicker">${escapeHtml(seriesLabel(issue, "zh"))}</p>
      <h1>${escapeHtml(issue.title.zh)}</h1>
      <p class="dek">${escapeHtml(issue.dek.zh)}</p>
      <div class="issue-meta"><span>${issue.date}</span><span>约 ${issue.readingMinutes} 分钟</span><span>${issue.tags.map(escapeHtml).join(" / ")}</span></div>
      ${renderSections(issue, "zh")}
    </article>
    <article class="lesson" data-language="en" hidden>
      <p class="kicker">${escapeHtml(seriesLabel(issue, "en"))}</p>
      <h1>${escapeHtml(issue.title.en)}</h1>
      <p class="dek">${escapeHtml(issue.dek.en)}</p>
      <div class="issue-meta"><span>${issue.date}</span><span>${issue.readingMinutes} min read</span><span>${issue.tags.map(escapeHtml).join(" / ")}</span></div>
      ${renderSections(issue, "en")}
    </article>
    <nav class="issue-nav" aria-label="Issue navigation">${nav(previous, { zh: "← 上一篇", en: "← Previous" })}${nav(next, { zh: "下一篇 →", en: "Next →" })}</nav>
  </main>
  <script>${APP}</script>
</body>
</html>`;
}

function renderIndex(issues, searchData) {
  const latest = issues[0];
  const cards = issues.map((issue) => `<a class="archive-card" href="entries/${issue.date}.html" data-searchable="${escapeHtml(searchableText(issue))}">
          <time>${issue.date}</time><span class="card-series">${escapeHtml(seriesLabel(issue, "en"))}</span>
          <h3>${escapeHtml(issue.title.zh)}</h3><p>${escapeHtml(issue.title.en)}</p>
        </a>`).join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <link rel="icon" href="data:,">
  <title>AI Agent Deep Dive · Daily Learning Archive</title>
  <link rel="stylesheet" href="assets/styles.css">
</head>
<body class="archive-page">
  <aside class="archive-rail">
    <a class="wordmark wordmark--rail" href="index.html"><i></i><span>AI Agent<br><b>Deep Dive</b></span></a>
    <p class="rail-intro">One mechanism a day.<br>Read deeply. Build reliably.</p>
    <nav aria-label="Issue dates">${issues.map((issue, index) => `<a href="entries/${issue.date}.html"${index === 0 ? ' aria-current="date"' : ""}><strong>${issue.date.slice(8)}</strong><span>${issue.date.slice(0, 7)}</span></a>`).join("")}</nav>
    <footer>08:00 Asia / Shanghai<br>Primary sources first</footer>
  </aside>
  <main class="archive-main">
    <section class="archive-hero">
      <p class="kicker">Daily technical curriculum</p>
      <h1>Understand the<br><em>machinery.</em></h1>
      <p>面向 AI Agent 从业者的双语技术深读。机制、必要数学、工程影响与失败模式，每天一篇。</p>
    </section>
    <section class="latest-issue">
      <div><span>Latest issue · ${latest.date}</span><span>${escapeHtml(seriesLabel(latest, "en"))}</span></div>
      <h2>${escapeHtml(latest.title.zh)}</h2><p>${escapeHtml(latest.title.en)}</p>
      <a class="read-link" href="entries/${latest.date}.html">开始阅读 <span>↗</span></a>
    </section>
    <section class="archive-list">
      <div class="archive-heading"><h2>Archive</h2><label><span class="sr-only">Search archive</span><input id="archive-search" type="search" placeholder="搜索 topic / series…"></label></div>
      <div id="archive-cards">${cards}</div>
      <p class="empty-state" hidden>没有找到匹配主题。</p>
    </section>
  </main>
  <script id="search-data" type="application/json">${JSON.stringify(searchData).replace(/<\/script/gi, "<\\/script")}</script>
  <script src="assets/app.js"></script>
</body>
</html>`;
}

const STYLES = `
[hidden]{display:none!important}
:root{--ink:#19201d;--muted:#69716c;--paper:#f4f0e7;--paper2:#e9e2d5;--rail:#18221e;--line:rgba(25,32,29,.16);--accent:#d04a33;--serif:Iowan Old Style,Baskerville,"Palatino Linotype",Georgia,"Noto Serif CJK SC",serif;--sans:Avenir Next,Avenir,"Microsoft YaHei","PingFang SC",sans-serif}*{box-sizing:border-box}html{scroll-behavior:smooth;background:var(--paper)}body{margin:0;color:var(--ink);background:radial-gradient(circle at 86% 6%,rgba(208,74,51,.1),transparent 29rem),repeating-linear-gradient(0deg,rgba(25,32,29,.018) 0,rgba(25,32,29,.018) 1px,transparent 1px,transparent 4px),var(--paper);font-family:var(--sans);line-height:1.75}a{color:inherit}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.wordmark{display:flex;align-items:center;gap:12px;color:inherit;text-decoration:none;font-size:13px;line-height:1.08;letter-spacing:.14em;text-transform:uppercase}.wordmark i{width:11px;height:11px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 7px rgba(208,74,51,.16)}.wordmark b{font-weight:500;color:var(--muted)}.wordmark--rail b{color:#9eaaa4}.archive-rail{position:fixed;inset:0 auto 0 0;width:292px;padding:38px 28px;color:#f7f3e9;background:linear-gradient(145deg,rgba(255,255,255,.035),transparent 44%),var(--rail);overflow:auto}.rail-intro{margin:44px 0 30px;color:#9eaaa4;font:500 14px/1.6 var(--serif)}.archive-rail nav{display:grid;gap:4px}.archive-rail nav a{display:grid;grid-template-columns:36px 1fr;align-items:baseline;gap:12px;padding:9px 12px;border-radius:3px;color:#c7d0cb;text-decoration:none}.archive-rail nav a:hover,.archive-rail nav a[aria-current]{color:#fff;background:rgba(255,255,255,.07)}.archive-rail nav strong{font:500 22px/1 var(--serif)}.archive-rail nav span{font-size:11px;letter-spacing:.08em}.archive-rail footer{margin-top:45px;padding-top:18px;border-top:1px solid rgba(255,255,255,.1);color:#9eaaa4;font-size:10px;letter-spacing:.08em;text-transform:uppercase}.archive-main{margin-left:292px;padding:70px clamp(32px,7vw,112px) 100px}.archive-main>*{width:min(940px,100%);margin-inline:auto}.kicker{margin:0 0 18px;color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.17em;text-transform:uppercase}.archive-hero{padding:30px 0 72px}.archive-hero h1{margin:0;font:500 clamp(58px,8vw,106px)/.88 var(--serif);letter-spacing:-.065em}.archive-hero h1 em{color:var(--accent);font-weight:400}.archive-hero>p:last-child{max-width:610px;margin:34px 0 0;color:#4e5752;font-size:17px}.latest-issue{padding:42px clamp(26px,5vw,58px);color:#f7f3e9;background:var(--rail);box-shadow:0 22px 70px rgba(25,32,29,.16)}.latest-issue>div{display:flex;justify-content:space-between;gap:16px;color:#9eaaa4;font-size:10px;letter-spacing:.1em;text-transform:uppercase}.latest-issue h2{max-width:710px;margin:34px 0 8px;font:500 clamp(34px,5vw,58px)/1.03 var(--serif);letter-spacing:-.04em}.latest-issue p{margin:0;color:#bec8c2;font:400 20px/1.4 var(--serif)}.read-link{display:inline-flex;gap:42px;margin-top:34px;padding-bottom:5px;border-bottom:1px solid var(--accent);color:#fff;text-decoration:none;font-size:13px}.read-link span{color:var(--accent)}.archive-list{padding-top:72px}.archive-heading{display:flex;align-items:end;justify-content:space-between;gap:24px;padding-bottom:20px;border-bottom:3px double var(--line)}.archive-heading h2{margin:0;font:500 36px/1 var(--serif)}#archive-search{width:min(300px,45vw);padding:11px 14px;border:1px solid var(--line);background:rgba(255,255,255,.35);font:500 13px var(--sans)}.archive-card{display:grid;grid-template-columns:110px 170px minmax(0,1fr);gap:24px;padding:28px 0;border-bottom:1px solid var(--line);text-decoration:none}.archive-card time,.card-series{color:var(--muted);font-size:11px;letter-spacing:.05em}.archive-card h3{margin:0;font:600 22px/1.25 var(--serif)}.archive-card p{grid-column:3;margin:-14px 0 0;color:var(--muted);font:400 15px/1.4 var(--serif)}.empty-state{padding:30px 0;color:var(--muted)}.topbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;padding:20px clamp(20px,4vw,54px);background:rgba(244,240,231,.92);border-bottom:1px solid var(--line);backdrop-filter:blur(16px)}.language-switch{display:flex;padding:3px;background:var(--paper2);border:1px solid var(--line)}.language-switch button{padding:7px 12px;border:0;color:var(--muted);background:transparent;font:700 11px var(--sans);cursor:pointer}.language-switch button[aria-pressed=true]{color:#fff;background:var(--rail)}.issue-page main{width:min(1050px,calc(100% - 40px));margin:0 auto;padding:74px 0 100px}.lesson>h1{max-width:940px;margin:0;font:500 clamp(48px,8vw,90px)/.94 var(--serif);letter-spacing:-.055em}.dek{max-width:720px;margin:26px 0 32px;color:#4e5752;font:400 clamp(19px,2.2vw,25px)/1.45 var(--serif)}.issue-meta{display:flex;flex-wrap:wrap;gap:10px 28px;padding:16px 0 48px;border-top:1px solid var(--line);color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase}.lesson-section{display:grid;grid-template-columns:minmax(180px,235px) minmax(0,1fr);gap:clamp(30px,6vw,78px);padding:43px 0 50px;border-top:1px solid var(--line)}.section-label{position:sticky;top:100px;align-self:start}.section-label span{color:var(--accent);font:700 11px var(--sans);letter-spacing:.12em}.section-label h2{margin:7px 0 0;font:500 25px/1.15 var(--serif);letter-spacing:-.02em}.section-copy{min-width:0}.section-copy> :first-child{margin-top:0}.section-copy h3{margin:32px 0 10px;font:600 22px/1.3 var(--serif)}.section-copy p{margin:0 0 16px}.section-copy strong{color:#111713}.section-copy code{padding:2px 5px;background:var(--paper2);font-size:.9em}.section-copy pre{overflow:auto;padding:20px;color:#dce6df;background:var(--rail);border-left:3px solid var(--accent);line-height:1.55}.section-copy blockquote{margin:24px 0;padding:4px 0 4px 20px;border-left:3px solid var(--accent);color:#4e5752}.section-copy ul,.section-copy ol{padding-left:22px}.section-copy li+li{margin-top:8px}.section-copy a{color:#963725;text-underline-offset:3px}.equation{margin:24px 0;padding:20px;background:rgba(255,255,255,.38);border:1px solid var(--line);font:500 18px/1.5 var(--serif);text-align:center}.diagram{margin:28px 0;padding:24px;background:#f8f5ed;border:1px solid var(--line)}.diagram svg{display:block;width:100%;height:auto}.diagram figcaption{margin-top:14px;color:var(--muted);font-size:11px}.callout{margin:24px 0;padding:18px 20px;background:rgba(208,74,51,.08);border-left:3px solid var(--accent)}.source-list li+li{margin-top:13px}.issue-nav{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:60px;padding-top:26px;border-top:3px double var(--line)}.issue-nav a{display:grid;gap:5px;color:var(--muted);font-size:10px;text-decoration:none}.issue-nav a:last-child{text-align:right}.issue-nav strong{color:var(--ink);font:500 16px/1.3 var(--serif)}@media(max-width:760px){.archive-rail{position:relative;width:auto;padding:22px 18px}.rail-intro,.archive-rail footer{display:none}.archive-rail nav{display:flex;margin-top:18px;overflow:auto}.archive-rail nav a{min-width:110px}.archive-main{margin:0;padding:38px 20px 70px}.archive-hero{padding:10px 0 46px}.archive-card{grid-template-columns:92px 1fr}.archive-card .card-series{display:none}.archive-card h3{font-size:19px}.archive-card p{grid-column:2;margin:-14px 0 0}.latest-issue>div{display:grid}.issue-page main{width:min(100% - 36px,1050px);padding-top:45px}.lesson-section{grid-template-columns:1fr;gap:16px;padding:32px 0 38px}.section-label{position:static}.section-label h2{font-size:22px}.topbar{padding:15px 18px}.issue-nav{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
.lesson-section{scroll-margin-top:100px}
`;

const APP = `
(() => {
  const switches = [...document.querySelectorAll("[data-set-language]")];
  const lessons = [...document.querySelectorAll(".lesson[data-language]")];
  function nearestSectionId() {
    const visibleLesson = lessons.find((lesson) => !lesson.hidden);
    if (!visibleLesson) return null;
    const sections = [...visibleLesson.querySelectorAll("[data-section-id]")];
    return sections.sort((a, b) => Math.abs(a.getBoundingClientRect().top - 100) - Math.abs(b.getBoundingClientRect().top - 100))[0]?.dataset.sectionId || null;
  }
  function setLanguage(language, preserveSection = false) {
    if (!lessons.length) return;
    const sectionId = preserveSection ? nearestSectionId() : null;
    lessons.forEach((lesson) => { lesson.hidden = lesson.dataset.language !== language; });
    document.querySelectorAll("[data-nav-language]").forEach((node) => { node.hidden = node.dataset.navLanguage !== language; });
    switches.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.setLanguage === language)));
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    try { localStorage.setItem("ai-agent-deep-dive-language", language); } catch {}
    if (sectionId) lessons.find((lesson) => lesson.dataset.language === language)?.querySelector('[data-section-id="' + sectionId + '"]')?.scrollIntoView({ block: "start" });
  }
  if (lessons.length) {
    let stored = "zh";
    try { stored = localStorage.getItem("ai-agent-deep-dive-language") || "zh"; } catch {}
    setLanguage(stored === "en" ? "en" : "zh");
    switches.forEach((button) => button.addEventListener("click", () => setLanguage(button.dataset.setLanguage, true)));
  }
  const search = document.querySelector("#archive-search");
  if (search) search.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    const cards = [...document.querySelectorAll("[data-searchable]")];
    let visible = 0;
    cards.forEach((card) => { card.hidden = Boolean(query) && !card.dataset.searchable.includes(query); if (!card.hidden) visible += 1; });
    const empty = document.querySelector(".empty-state");
    if (empty) empty.hidden = visible !== 0;
  });
})();
`;

async function atomicWrite(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  const backup = `${path}.${process.pid}.bak`;
  await writeFile(temporary, contents, "utf8");
  let hadTarget = false;
  try {
    await rename(path, backup);
    hadTarget = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await rename(temporary, path);
    if (hadTarget) await rm(backup, { force: true });
  } catch (error) {
    if (hadTarget) await rename(backup, path);
    await rm(temporary, { force: true });
    throw error;
  }
}

function searchableText(issue) {
  return [issue.title.zh, issue.title.en, issue.series.title.zh, issue.series.title.en, ...issue.tags,
    ...issue.sections.flatMap((section) => [section.title.zh, section.title.en, plainText(section.html.zh), plainText(section.html.en)])]
    .join(" ").toLowerCase();
}

export async function generateArchive({ outputDirectory, issues }) {
  if (!Array.isArray(issues) || issues.length < 1) throw new Error("at least one issue is required");
  const validated = issues.map(validateIssue);
  const dates = validated.map((issue) => issue.date);
  if (new Set(dates).size !== dates.length) throw new Error("issue dates must be unique");
  const sorted = [...validated].sort((a, b) => b.date.localeCompare(a.date));
  const searchData = sorted.map((issue) => ({
    date: issue.date,
    title: issue.title,
    series: issue.series.title,
    tags: issue.tags,
    text: searchableText(issue),
    href: `entries/${issue.date}.html`,
  }));
  const latestBySeries = new Map();
  for (const issue of sorted) if (!latestBySeries.has(issue.series.id)) latestBySeries.set(issue.series.id, issue);
  const pending = [...latestBySeries.values()].find((issue) => !issue.series.complete);
  const state = {
    generatedAt: sorted[0].date,
    latestIssueDate: sorted[0].date,
    completedTopics: sorted.filter((issue) => issue.series.complete).map((issue) => issue.topicId),
    completedSeries: [...latestBySeries.values()].filter((issue) => issue.series.complete).map((issue) => issue.series.id),
    history: sorted.map((issue) => ({ date: issue.date, topicId: issue.topicId, seriesId: issue.series.id, part: issue.series.part, complete: issue.series.complete })),
    pendingSeries: pending ? {
      id: pending.series.id,
      nextPart: pending.series.part + 1,
      established: pending.continuation.established,
      next: pending.continuation.next,
    } : null,
  };

  await mkdir(join(outputDirectory, "entries"), { recursive: true });
  await mkdir(join(outputDirectory, "assets"), { recursive: true });
  await Promise.all(sorted.map((issue) => atomicWrite(
    join(outputDirectory, "entries", `${issue.date}.html`),
    renderIssuePage(issue, sorted),
  )));
  await Promise.all([
    atomicWrite(join(outputDirectory, "index.html"), renderIndex(sorted, searchData)),
    atomicWrite(join(outputDirectory, "search-index.json"), `${JSON.stringify(searchData, null, 2)}\n`),
    atomicWrite(join(outputDirectory, "curriculum-state.json"), `${JSON.stringify(state, null, 2)}\n`),
    atomicWrite(join(outputDirectory, "assets", "styles.css"), STYLES.trimStart()),
    atomicWrite(join(outputDirectory, "assets", "app.js"), APP.trimStart()),
  ]);
  return { issueCount: sorted.length, latestDate: sorted[0].date };
}

async function main() {
  const contentDirectory = resolve(process.argv[2] || fileURLToPath(new URL("../content/issues", import.meta.url)));
  const outputDirectory = resolve(process.argv[3] || fileURLToPath(new URL("..", import.meta.url)));
  const manifest = JSON.parse(await readFile(join(contentDirectory, "manifest.json"), "utf8"));
  const issues = await Promise.all(manifest.issues.map(async (file) => JSON.parse(await readFile(join(contentDirectory, file), "utf8"))));
  const result = await generateArchive({ outputDirectory, issues });
  console.log(`Generated ${result.issueCount} issue(s); latest ${result.latestDate}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
