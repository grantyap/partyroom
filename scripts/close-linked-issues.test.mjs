import { strict as assert } from "node:assert";
import { test } from "node:test";
import { closingIssues } from "./close-linked-issues.mjs";

test("recognizes explicit closing lines, deduplicating local issues", () => {
  assert.deepEqual(closingIssues("Closes #17.\nFixes #2, #3\nresolved #17\nRelated: #4"), [17, 2, 3]);
});

test("ignores examples, partial prose, and cross-repository references", () => {
  assert.deepEqual(closingIssues("```md\nCloses #1\n```\nThis fixes #2 for now.\nCloses other/repo#3\nFixes #4 and #5\n    Closes #6\n\tFixes #7\n \tCloses #8\n```md\n```example\nCloses #9\n```"), []);
});
