import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Only standalone closing lines count; references in fenced examples do not.
export function closingIssues(body) {
  const issues = new Set();
  let fence = null;
  for (const line of (body ?? "").split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^\s*$/.test(line.slice(marker[0].length))) fence = null;
      continue;
    }
    if (fence || /^(?: {4}| {0,3}	)/.test(line)) continue;
    const match = line.match(/^\s*(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+((?:#\d+)(?:\s*,\s*#\d+)*)\s*\.?\s*$/i);
    if (match) for (const number of match[1].matchAll(/#(\d+)/g)) issues.add(Number(number[1]));
  }
  return [...issues];
}

async function main() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
  for (const number of closingIssues(event.pull_request.body)) {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${number}`;
    const headers = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Could not read #${number}: ${response.status}`);
    const issue = await response.json();
    if (issue.pull_request || issue.state !== "open") continue;
    const update = await fetch(url, { method: "PATCH", headers, body: JSON.stringify({ state: "closed", state_reason: "completed" }) });
    if (!update.ok) throw new Error(`Could not close #${number}: ${update.status}`);
    console.log(`Closed #${number} after merge of #${event.pull_request.number}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
