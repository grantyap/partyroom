import { resolve } from "node:path";

const command = process.argv[2];
const target = process.argv.includes("--production") ? "production" : "restored-copy";
if (!command || !["prepare-v2", "complete-v2", "release-v2"].includes(command))
  throw new Error("usage: workflow-drain <prepare-v2|complete-v2|release-v2> (--production|--restored-copy)");
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
  const active: string[] = [];
  do {
    const page = run(name, { ...base, cursor, limit: 50 }, component);
    scanned += page.scanned;
    active.push(...page.active);
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor);
  return { scanned, active };
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

function authorized() {
  try {
    return cli(["env", "get", "MEDIA_WORKFLOW_CUTOVER_AUTHORIZED"]) === "1";
  } catch {
    return false;
  }
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
  if (!empty && report.drainValue !== "1") throw new Error("the v1 drain is not enabled");
  if (!empty && !authorized()) {
    const readyAt = Date.parse(cli(["env", "get", "MEDIA_WORKFLOW_DRAIN_READY_AT"]));
    if (!Number.isFinite(readyAt) || readyAt > Date.now())
      throw new Error("the preparatory release has not certified a clean ten-minute drain");
  }
  cli(["env", "set", "MEDIA_WORKFLOW_CUTOVER_AUTHORIZED", "1"]);
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

let released = 0;
while (run("media/jobs:releaseQueuedV2", {})) released += 1;
console.log(JSON.stringify({ released }));
