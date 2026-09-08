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
