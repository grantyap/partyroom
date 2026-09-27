import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const command = process.argv[2];
const target = process.argv.includes("--production") ? "production" : "restored-copy";
if (!command || !["start", "status", "resume-v1", "monitor"].includes(command))
  throw new Error("usage: workflow-drain <start|status|resume-v1|monitor> (--production|--restored-copy)");
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

const reportDir = resolve(import.meta.dir, "../migration-reports");
const readinessPath = resolve(reportDir, "workflow-drain-readiness.json");
const instanceFingerprint = createHash("sha256")
  .update(process.env.CONVEX_SELF_HOSTED_ADMIN_KEY!)
  .digest("hex");

function readStatus(drainValue = cli(["env", "get", "MEDIA_WORKFLOW_DRAIN"])) {
  return {
    target,
    instanceFingerprint,
    createdAt: new Date().toISOString(),
    drainValue,
    jobs: scan("migration/drain:statusPage", { table: "mediaJobs" }),
    enrichments: scan("migration/drain:statusPage", { table: "mediaEnrichments" }),
    activities: scan("drain:statusPage", {}, "activities"),
  };
}

if (command === "monitor") {
  mkdirSync(reportDir, { recursive: true });
  let firstCleanAt: string | null = null;
  try {
    const previous = JSON.parse(readFileSync(readinessPath, "utf8"));
    if (
      previous.instanceFingerprint === instanceFingerprint &&
      previous.target === target &&
      Date.now() - Date.parse(previous.checkedAt) < 180_000 &&
      previous.clean
    )
      firstCleanAt = previous.firstCleanAt;
  } catch {
    // A new or invalid report starts a fresh observation window.
  }
  for (;;) {
    let clean = false;
    let queued = 0;
    try {
      const report = readStatus();
      queued = report.jobs.queued + report.enrichments.queued;
      clean =
        report.drainValue === "1" &&
        report.jobs.active.length === 0 &&
        report.enrichments.active.length === 0 &&
        report.activities.active.length === 0;
      if (!clean) firstCleanAt = null;
      else firstCleanAt ??= report.createdAt;
      const checkedAt = report.createdAt;
      const ready = clean && Date.parse(checkedAt) - Date.parse(firstCleanAt!) >= 600_000;
      const summary = {
        target,
        instanceFingerprint,
        checkedAt,
        firstCleanAt,
        clean,
        ready,
        queued,
        activeJobs: report.jobs.active.length,
        activeEnrichments: report.enrichments.active.length,
        activeActivities: report.activities.active.length,
      };
      writeFileSync(`${readinessPath}.tmp`, `${JSON.stringify(summary)}\n`);
      renameSync(`${readinessPath}.tmp`, readinessPath);
      console.log(JSON.stringify({ workflowMigration: summary }));
    } catch (error) {
      firstCleanAt = null;
      writeFileSync(
        `${readinessPath}.tmp`,
        `${JSON.stringify({ target, instanceFingerprint, checkedAt: new Date().toISOString(), clean: false, ready: false })}\n`,
      );
      renameSync(`${readinessPath}.tmp`, readinessPath);
      console.error("workflow migration drain scan failed", error);
    }
    await Bun.sleep(60_000);
  }
}

if (command === "start") cli(["env", "set", "MEDIA_WORKFLOW_DRAIN", "1"]);
if (command === "resume-v1") {
  cli(["env", "remove", "MEDIA_WORKFLOW_DRAIN"]);
  let resumed = 0;
  while (run("media/jobs:resumeQueuedV1", {})) resumed += 1;
  console.log(JSON.stringify({ resumed }));
}

const report = command === "resume-v1" ? readStatus("") : readStatus();
mkdirSync(reportDir, { recursive: true });
const path = resolve(
  import.meta.dir,
  `../migration-reports/workflow-drain-${new Date().toISOString().replaceAll(":", "-")}.json`,
);
writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
console.log(path);
console.log(JSON.stringify(report, null, 2));
if (command !== "resume-v1" && report.drainValue !== "1") process.exitCode = 2;
