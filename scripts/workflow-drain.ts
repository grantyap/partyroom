import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const command = process.argv[2];
const target = process.argv.includes("--production") ? "production" : "restored-copy";
if (!command || !["start", "status", "resume-v1"].includes(command))
  throw new Error("usage: workflow-drain <start|status|resume-v1> (--production|--restored-copy)");
if (process.argv.includes("--production") === process.argv.includes("--restored-copy"))
  throw new Error("choose exactly one target");
if (process.env.MIGRATION_TARGET !== target)
  throw new Error(`MIGRATION_TARGET must be ${target}`);
if (!process.env.CONVEX_SELF_HOSTED_URL || !process.env.CONVEX_SELF_HOSTED_ADMIN_KEY)
  throw new Error("self-hosted Convex URL and admin key are required");

const cwd = resolve(import.meta.dir, "../packages/backend");
function cli(args: string[]) {
  const result = Bun.spawnSync(["bunx", "convex", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) throw new Error(`convex ${args[0]} failed`);
  return result.stdout.toString().trim();
}
function run(name: string, args: unknown, component?: string) {
  const command = ["run"];
  if (component) command.push("--component", component);
  return JSON.parse(cli([...command, name, JSON.stringify(args)]));
}
function scan(name: string, base: Record<string, unknown>, component?: string) {
  let cursor: string | null = null;
  let scanned = 0;
  let queued = 0;
  const active: string[] = [];
  do {
    const page = run(name, { ...base, cursor, limit: 50 }, component);
    scanned += page.scanned;
    queued += page.queued ?? 0;
    active.push(...page.active);
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor);
  return { scanned, queued, active };
}

if (command === "start") cli(["env", "set", "MEDIA_WORKFLOW_DRAIN", "1"]);
if (command === "resume-v1") {
  cli(["env", "remove", "MEDIA_WORKFLOW_DRAIN"]);
  let resumed = 0;
  while (run("media/jobs:resumeQueuedV1", {})) resumed += 1;
  console.log(JSON.stringify({ resumed }));
}

const report = {
  target,
  createdAt: new Date().toISOString(),
  drainValue: command === "resume-v1" ? "" : cli(["env", "get", "MEDIA_WORKFLOW_DRAIN"]),
  jobs: scan("migration/drain:statusPage", { table: "mediaJobs" }),
  enrichments: scan("migration/drain:statusPage", { table: "mediaEnrichments" }),
  activities: scan("drain:statusPage", {}, "activities"),
};
mkdirSync(resolve(import.meta.dir, "../migration-reports"), { recursive: true });
const path = resolve(
  import.meta.dir,
  `../migration-reports/workflow-drain-${new Date().toISOString().replaceAll(":", "-")}.json`,
);
writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
console.log(path);
console.log(JSON.stringify(report, null, 2));
if (command !== "resume-v1" && report.drainValue !== "1") process.exitCode = 2;
