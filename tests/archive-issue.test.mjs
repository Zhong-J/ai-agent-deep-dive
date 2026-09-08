import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { archiveIssue } from "../scripts/archive-issue.mjs";

const payloadPath = new URL("../content/issues/2026-09-08.json", import.meta.url);

test("archiveIssue writes and idempotently replaces a dated issue", async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "deep-dive-archive-"));
  try {
    await archiveIssue({ projectDirectory, payloadPath });
    await archiveIssue({ projectDirectory, payloadPath });
    const manifest = JSON.parse(await readFile(join(projectDirectory, "content", "issues", "manifest.json"), "utf8"));
    assert.deepEqual(manifest.issues, ["2026-09-08.json"]);
    assert.match(await readFile(join(projectDirectory, "entries", "2026-09-08.html"), "utf8"), /data-language="en"/);
    assert.match(await readFile(join(projectDirectory, "index.html"), "utf8"), /2026-09-08/);
  } finally {
    await rm(projectDirectory, { recursive: true, force: true });
  }
});

test("archiveIssue leaves source state untouched when staging fails", async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "deep-dive-rollback-"));
  const issuesDirectory = join(projectDirectory, "content", "issues");
  const manifestPath = join(issuesDirectory, "manifest.json");
  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(issuesDirectory, { recursive: true }));
    const original = '{"issues":["2026-09-07.json"]}\n';
    await writeFile(manifestPath, original, "utf8");
    await assert.rejects(archiveIssue({ projectDirectory, payloadPath }), /2026-09-07/);
    assert.equal(await readFile(manifestPath, "utf8"), original);
    await assert.rejects(access(join(issuesDirectory, "2026-09-08.json")));
  } finally {
    await rm(projectDirectory, { recursive: true, force: true });
  }
});
