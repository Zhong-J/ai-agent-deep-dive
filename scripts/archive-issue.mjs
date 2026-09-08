import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { generateArchive, validateIssue } from "./generate.mjs";

async function commitStagedFiles(files) {
  const committed = [];
  try {
    for (const { staged, target } of files) {
      await mkdir(dirname(target), { recursive: true });
      const backup = `${target}.${process.pid}.archive-backup`;
      let hadTarget = false;
      try {
        await rename(target, backup);
        hadTarget = true;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      try {
        await rename(staged, target);
      } catch (error) {
        if (hadTarget) await rename(backup, target);
        throw error;
      }
      committed.push({ target, backup, hadTarget });
    }
  } catch (error) {
    for (const entry of committed.reverse()) {
      await rm(entry.target, { force: true });
      if (entry.hadTarget) await rename(entry.backup, entry.target);
    }
    throw error;
  }
  await Promise.all(committed.filter((entry) => entry.hadTarget).map((entry) => rm(entry.backup, { force: true })));
}

export async function archiveIssue({ projectDirectory, payloadPath }) {
  const issue = validateIssue(JSON.parse(await readFile(payloadPath, "utf8")));
  const issuesDirectory = join(projectDirectory, "content", "issues");
  const manifestPath = join(issuesDirectory, "manifest.json");
  await mkdir(issuesDirectory, { recursive: true });

  let manifest = { issues: [] };
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!Array.isArray(manifest.issues)) throw new Error("manifest.issues must be an array");

  const fileName = `${issue.date}.json`;
  const files = [...new Set(manifest.issues.filter((candidate) => candidate !== fileName).concat(fileName))]
    .sort((a, b) => b.localeCompare(a));
  // Read and validate the complete future archive before touching source state.
  const issues = await Promise.all(files.map(async (file) => file === fileName
    ? issue
    : JSON.parse(await readFile(join(issuesDirectory, file), "utf8"))));

  const stageDirectory = await mkdtemp(join(projectDirectory, ".archive-stage-"));
  try {
    const stageIssuesDirectory = join(stageDirectory, "content", "issues");
    await mkdir(stageIssuesDirectory, { recursive: true });
    await writeFile(join(stageIssuesDirectory, fileName), `${JSON.stringify(issue, null, 2)}\n`, "utf8");
    await writeFile(join(stageIssuesDirectory, "manifest.json"), `${JSON.stringify({ issues: files }, null, 2)}\n`, "utf8");
    const result = await generateArchive({ outputDirectory: stageDirectory, issues });
    const generated = [
      "index.html", "search-index.json", "curriculum-state.json",
      join("assets", "styles.css"), join("assets", "app.js"),
      ...issues.map((candidate) => join("entries", `${candidate.date}.html`)),
    ];
    await commitStagedFiles([
      { staged: join(stageIssuesDirectory, fileName), target: join(issuesDirectory, fileName) },
      { staged: join(stageIssuesDirectory, "manifest.json"), target: manifestPath },
      ...generated.map((relative) => ({ staged: join(stageDirectory, relative), target: join(projectDirectory, relative) })),
    ]);
    return { ...result, archivedDate: issue.date };
  } finally {
    await rm(stageDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const payloadPath = process.argv[2];
  const projectDirectory = resolve(process.argv[3] || new URL("..", import.meta.url).pathname);
  if (!payloadPath) throw new Error("usage: node archive-issue.mjs <payload.json> [project-directory]");
  const result = await archiveIssue({ projectDirectory, payloadPath: resolve(payloadPath) });
  console.log(`Archived ${result.archivedDate}; ${result.issueCount} issue(s) total`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
