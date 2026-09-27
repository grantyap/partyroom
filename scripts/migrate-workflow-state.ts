import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const migrationId = "workflow-state-redesign-v1";
const command = process.argv[2];
const production = process.argv.includes("--production");
const restoredCopy = process.argv.includes("--restored-copy");
const reportArg = process.argv.find((arg) => arg.startsWith("--report="))?.slice(9);
const backend = resolve(import.meta.dir, "../packages/backend");
const tables = [
  "mediaJobs",
  "mediaAssets",
  "mediaLyricTracks",
  "mediaEnrichments",
  "roomMedia",
  "roomPlayback",
] as const;

if (!command || !["status", "preflight", "apply", "verify"].includes(command))
  throw new Error(
    "usage: bun migrate:workflow-state <status|preflight|apply|verify> (--production|--restored-copy) [--report=path]",
  );
if (production === restoredCopy)
  throw new Error("choose exactly one target: --production or --restored-copy");
const target = production ? "production" : "restored-copy";
if (process.env.MIGRATION_TARGET !== target)
  throw new Error(`MIGRATION_TARGET must be ${target} for this command`);
if (!process.env.CONVEX_SELF_HOSTED_URL || !process.env.CONVEX_SELF_HOSTED_ADMIN_KEY)
  throw new Error("a self-hosted Convex URL and admin key are required");

function run(name: string, args: unknown = {}, component?: string) {
  const cli = ["bunx", "convex", "run"];
  if (component) cli.push("--component", component);
  cli.push(name, JSON.stringify(args));
  const result = Bun.spawnSync(cli, { cwd: backend, stdout: "pipe", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`${name} failed`);
  const output = result.stdout.toString().trim();
  return output ? JSON.parse(output) : null;
}

function chunks<T>(values: T[], size = 50) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

function save(kind: string, report: unknown) {
  const path = resolve(
    reportArg ??
      `migration-reports/${migrationId}-${kind}-${new Date().toISOString().replaceAll(":", "-")}.json`,
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(path);
  return path;
}

function pages(name: string, base: Record<string, unknown>, component?: string) {
  const results: any[] = [];
  let cursor: string | null = null;
  do {
    const result = run(name, { ...base, cursor, limit: 50 }, component);
    results.push(result);
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor);
  return results;
}

function buildReport() {
  const application = Object.fromEntries(
    tables.map((table) => [
      table,
      pages("migration/workflowStateRedesign:preflightPage", { table }),
    ]),
  );
  const activityPages = pages("maintenance:preflightActivities", {}, "activities");
  const stepPages = pages("maintenance:migrateWorkflowSteps", { dryRun: true }, "activities");
  const appPages = Object.values(application).flat() as any[];
  const references = appPages.flatMap((page) => page.artifactReferences);
  const workflowIds = [
    ...new Set([
      ...appPages.flatMap((page) => page.workflowIds),
      ...activityPages.flatMap((page) => page.workflowIds),
    ]),
  ];
  const artifacts = chunks(references.map((reference) => reference.artifactId)).flatMap((ids) =>
    run("maintenance:inspectArtifacts", { artifactIds: ids }, "activities"),
  );
  const artifactById = new Map(artifacts.map((artifact: any) => [artifact.artifactId, artifact]));
  const artifactBlockers = references.flatMap((reference: any) => {
    const artifact: any = artifactById.get(reference.artifactId);
    if (!artifact?.found)
      return [
        { table: "artifacts", id: reference.artifactId, reason: "referenced artifact is missing" },
      ];
    if (!artifact.storageExists)
      return [
        {
          table: "artifacts",
          id: reference.artifactId,
          reason: "referenced artifact storage is missing",
        },
      ];
    if (artifact.slot !== reference.slot)
      return [
        {
          table: "artifacts",
          id: reference.artifactId,
          reason: `expected slot ${reference.slot}, got ${artifact.slot}`,
        },
      ];
    if (artifact.state === "adopted" && artifact.owner && artifact.owner !== reference.owner)
      return [
        { table: "artifacts", id: reference.artifactId, reason: "artifact has another owner" },
      ];
    return [];
  });
  const pendingAdoptions = references.filter((reference: any) => {
    const artifact: any = artifactById.get(reference.artifactId);
    return artifact?.state !== "adopted" || artifact?.owner !== reference.owner;
  });
  const workflowStatuses = chunks(workflowIds).flatMap((ids) =>
    run("migration/workflowStateRedesign:workflowStatuses", { workflowIds: ids }),
  );
  const versions = new Map(
    appPages.flatMap((page) => page.workflows).map((item: any) => [item.workflowId, item.version]),
  );
  const activeV1Workflows = workflowStatuses.filter(
    (item: any) => item.status === "inProgress" && (versions.get(item.workflowId) ?? 1) === 1,
  );
  const activeV1ActivityIds = activityPages.flatMap((page) => page.activeV1);
  const legacy = [
    ...appPages.map((page) => page.legacy),
    ...activityPages.map((page) => page.legacy),
  ].reduce((sum, count) => sum + count, 0);
  const dataWatermark = JSON.stringify({
    scanned:
      appPages.reduce((sum, page) => sum + page.scanned, 0) +
      activityPages.reduce((sum, page) => sum + page.scanned, 0),
    workflows: workflowIds.sort(),
    activeV1Workflows: activeV1Workflows.map((item: any) => item.workflowId).sort(),
    activeV1ActivityIds: [...activeV1ActivityIds].sort(),
  });
  return {
    migrationId,
    target: production ? "production" : "restored-copy",
    createdAt: new Date().toISOString(),
    application,
    activities: activityPages,
    workflowSteps: stepPages,
    artifactReferences: references,
    artifacts,
    pendingAdoptions,
    workflowIds,
    workflowStatuses,
    activeV1Workflows,
    activeV1ActivityIds,
    legacy,
    dataWatermark,
    cleanupArtifactIds: appPages.flatMap((page) => page.cleanupArtifactIds),
    blockingErrors: [
      ...appPages.flatMap((page) => page.blockers),
      ...activityPages.flatMap((page) => page.issues),
      ...artifactBlockers,
    ],
    activeActivityIds: activityPages.flatMap((page) => page.active),
  };
}

async function waitForApplicationMigrations() {
  const names = [
    "migrations:workflowStateRedesignV1MediaJobs",
    "migrations:workflowStateRedesignV1MediaEnrichments",
  ];
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const statuses = run("lib:getStatus", { names }, "migrations");
    const failed = statuses.find((status: any) =>
      ["failed", "canceled", "unknown"].includes(status.state),
    );
    if (failed) throw new Error(`${failed.name}: ${failed.error ?? failed.state}`);
    if (statuses.every((status: any) => status.isDone)) return;
    await Bun.sleep(1_000);
  }
  throw new Error("application migrations did not finish within five minutes");
}

if (command === "status") {
  const report = buildReport();
  console.log(
    JSON.stringify(
      {
        state: run("migration/workflowStateRedesign:getState"),
        application: run("lib:getStatus", { limit: 20 }, "migrations"),
        counts: {
          blockers: report.blockingErrors.length,
          legacy: report.legacy,
          activeV1Workflows: report.activeV1Workflows.length,
          activeV1Activities: report.activeV1ActivityIds.length,
          pendingDeliveries: report.activities.flatMap((page: any) => page.pendingDeliveries)
            .length,
          pendingAdoptions: report.pendingAdoptions.length,
        },
      },
      null,
      2,
    ),
  );
} else if (command === "preflight" || command === "verify") {
  const report = buildReport();
  const generation = command === "verify" ? crypto.randomUUID() : undefined;
  const saved = { ...report, generation };
  save(command, saved);
  if (generation)
    run("migration/workflowStateRedesign:persistVerification", {
      generation,
      counts: {
        blockers: report.blockingErrors.length,
        legacy: report.legacy,
        activeV1Workflows: report.activeV1Workflows.length,
        activeV1Activities: report.activeV1ActivityIds.length,
        pendingAdoptions: report.pendingAdoptions.length,
      },
      dataWatermark: report.dataWatermark,
    });
  if (
    report.blockingErrors.length ||
    (command === "verify" &&
      (report.legacy ||
        report.pendingAdoptions.length ||
        report.activeV1ActivityIds.length ||
        report.activeV1Workflows.length))
  )
    process.exitCode = 2;
} else if (command === "apply") {
  const report = buildReport();
  save(command, report);
  if (report.blockingErrors.length) throw new Error("preflight has blocking errors");
  for (const refs of chunks(report.artifactReferences)) {
    const result = run(
      "maintenance:adoptArtifacts",
      { dryRun: false, references: refs },
      "activities",
    );
    if (result.issues.length) throw new Error(JSON.stringify(result.issues));
  }
  run("migrations:runWorkflowStateRedesignV1", { reset: true });
  await waitForApplicationMigrations();
  let state = run("migration/workflowStateRedesign:getState") ?? {};
  let cursor = state.activityCursor ?? null;
  do {
    const result = run(
      "maintenance:migrateActivities",
      { cursor, limit: 50, dryRun: false },
      "activities",
    );
    if (result.issues.length) throw new Error(JSON.stringify(result.issues));
    cursor = result.isDone ? null : result.continueCursor;
    state = { ...state, activityCursor: cursor ?? undefined };
    run("migration/workflowStateRedesign:setState", {
      phase: "apply",
      activityCursor: state.activityCursor,
      workflowStepCursor: state.workflowStepCursor,
    });
  } while (cursor);
}
