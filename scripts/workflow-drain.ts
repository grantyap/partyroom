import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const command = process.argv[2];
const target = process.argv.includes("--production") ? "production" : "restored-copy";
if (!command || !["status", "route-v2", "release-v2", "open-v2", "pause-v2", "prepare-v2", "complete-v2"].includes(command))
  throw new Error(
    "usage: workflow-drain <status|route-v2|release-v2|open-v2|pause-v2> (--production|--restored-copy)",
  );
if (process.argv.includes("--production") === process.argv.includes("--restored-copy"))
  throw new Error("choose exactly one target");
if (process.env.MIGRATION_TARGET !== target) throw new Error(`MIGRATION_TARGET must be ${target}`);
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
const instanceFingerprint = createHash("sha256")
  .update(process.env.CONVEX_SELF_HOSTED_ADMIN_KEY!)
  .digest("hex");
const readinessPath = resolve(reportDir, "workflow-drain-readiness.json");
const authorizationPath = resolve(reportDir, "workflow-cutover-authorized.json");

function authorized() {
  try {
    const marker = JSON.parse(readFileSync(authorizationPath, "utf8"));
    return marker.target === target && marker.instanceFingerprint === instanceFingerprint;
  } catch {
    return false;
  }
}

function routingVersionOrNull(): 1 | 2 | null {
  const result = Bun.spawnSync(
    ["bunx", "convex", "run", "migration/workflowStateRedesign:getRoutingVersion", "{}"],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  return result.exitCode === 0 ? JSON.parse(result.stdout.toString()) : null;
}

function liveDrain() {
  return {
    drainValue: cli(["env", "get", "MEDIA_WORKFLOW_DRAIN"]),
    jobs: scan("migration/drain:statusPage", { table: "mediaJobs" }),
    enrichments: scan("migration/drain:statusPage", { table: "mediaEnrichments" }),
    activities: scan("drain:statusPage", {}, "activities"),
  };
}

function noActive(report: ReturnType<typeof liveDrain>) {
  return !(
    report.jobs.active.length ||
    report.enrichments.active.length ||
    report.activities.active.length
  );
}

if (command === "prepare-v2") {
  if (routingVersionOrNull() === 2) {
    console.log("Workflow routing is already v2; continuing normal deployment");
    process.exit(0);
  }
  const report = liveDrain();
  if (!noActive(report)) throw new Error("v1 work is active; keep the preparatory release deployed");
  const empty =
    report.jobs.scanned === 0 &&
    report.enrichments.scanned === 0 &&
    report.activities.scanned === 0;
  if (empty && report.drainValue !== "1") cli(["env", "set", "MEDIA_WORKFLOW_DRAIN", "1"]);
  if (!empty && !authorized()) {
    if (report.drainValue !== "1") throw new Error("the v1 drain is not enabled");
    const readiness = JSON.parse(readFileSync(readinessPath, "utf8"));
    if (
      readiness.target !== target ||
      readiness.instanceFingerprint !== instanceFingerprint ||
      readiness.ready !== true ||
      Date.now() - Date.parse(readiness.checkedAt) > 180_000 ||
      Date.parse(readiness.checkedAt) - Date.parse(readiness.firstCleanAt) < 600_000
    )
      throw new Error("the preparatory release has not certified a clean ten-minute drain");
  }
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(
    authorizationPath,
    `${JSON.stringify({ target, instanceFingerprint, authorizedAt: new Date().toISOString() })}\n`,
  );
  console.log(empty ? "Empty deployment may start v2" : "Certified v1 drain; may deploy v2");
  process.exit(0);
}

if (command === "complete-v2") {
  if (routingVersionOrNull() !== 2) {
    if (!authorized()) throw new Error("cutover authorization is missing");
    const report = liveDrain();
    if (report.drainValue !== "1" || !noActive(report))
      throw new Error("v1 work appeared during deployment; routing remains v1");
    run("migration/workflowStateRedesign:setRoutingVersion", { version: 2 });
  }
  cli(["env", "set", "MEDIA_WORKFLOW_DRAIN", "0"]);
  console.log("Workflow routing is v2; new submissions are open");
  process.exit(0);
}

if (command === "pause-v2") cli(["env", "set", "MEDIA_WORKFLOW_DRAIN", "1"]);

const report = {
  target,
  createdAt: new Date().toISOString(),
  drainValue: (() => {
    try {
      return cli(["env", "get", "MEDIA_WORKFLOW_DRAIN"]);
    } catch {
      return "";
    }
  })(),
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
if (command === "route-v2") {
  const reports = ["--report-a=", "--report-b="].map((prefix) => {
    const name = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
    if (!name) throw new Error(`route-v2 requires ${prefix}<path>`);
    return JSON.parse(readFileSync(resolve(name), "utf8"));
  });
  const scans = [...reports, report];
  if (scans.some((scan) => scan.target !== target || scan.drainValue !== "1"))
    throw new Error("all drain reports must target this deployment with the drain enabled");
  if (
    scans.some(
      (scan) =>
        scan.jobs.active.length || scan.enrichments.active.length || scan.activities.active.length,
    )
  )
    throw new Error("v1 work is still active");
  const times = reports.map((scan) => Date.parse(scan.createdAt));
  if (!times.every(Number.isFinite) || times[1] - times[0] < 10 * 60_000)
    throw new Error("clean drain scans must be at least 10 minutes apart");
  run("migration/workflowStateRedesign:setRoutingVersion", { version: 2 });
}
if (command === "open-v2") {
  if (run("migration/workflowStateRedesign:getRoutingVersion", {}) !== 2)
    throw new Error("route v2 before opening submissions");
  cli(["env", "remove", "MEDIA_WORKFLOW_DRAIN"]);
}
if (command === "release-v2" || command === "open-v2") {
  let released = 0;
  while (run("media/jobs:releaseQueuedV2", {})) released += 1;
  console.log(JSON.stringify({ released }));
}
if (command === "route-v2" && report.drainValue !== "1") process.exitCode = 2;
