import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ConvexHttpClient } from "../../packages/backend/node_modules/convex/browser";
import { makeFunctionReference } from "../../packages/backend/node_modules/convex/server";

const root = resolve(import.meta.dir, "../..");
const directory = mkdtempSync(join(tmpdir(), "partyroom-restart-"));
const backend = join(directory, "packages/backend");
const container = `partyroom-restart-${process.pid}`;
const cloud = "http://127.0.0.1:33210";
const apiUrl = "http://127.0.0.1:33211/activities/workers";
const token = crypto.randomUUID();
const checks: string[] = [];
const workers: ReturnType<typeof Bun.spawn>[] = [];
const log = (message: string) => console.log(`[${new Date().toISOString()}] ${message}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function command(cmd: string[], env = process.env, cwd = root) {
  const process = Bun.spawn(cmd, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, status] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (status !== 0) throw new Error(`${cmd.slice(0, 3).join(" ")} failed: ${stderr}\n${stdout}`);
  return stdout.trim();
}
async function until<T>(
  description: string,
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeout = 120000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      last = value;
      if (accept(value)) return value;
    } catch (error) {
      last = String(error);
    }
    await sleep(250);
  }
  throw new Error(`Timed out: ${description}\n${JSON.stringify(last)}`);
}
async function online() {
  await until(
    "backend online",
    async () => (await fetch(`${cloud}/version`)).status,
    (code) => code < 500,
    60000,
  );
}
async function restartBackend() {
  await command(["docker", "kill", "--signal", "KILL", container]);
  await command(["docker", "start", container]);
  await online();
}
async function artifactRecord(name: string, attempt = 1): Promise<any> {
  const path = join(directory, `${name}-${attempt}.json`);
  return await until(
    `${name} attempt ${attempt} uploaded`,
    async () => await Bun.file(path).json(),
    (value) => !!value,
  );
}
async function allow(name: string) {
  await Bun.write(join(directory, `allow-${name}`), "go");
}
function startWorker(python = false) {
  const cmd = python
    ? [
        join(root, "packages/activity-worker-python/.venv/bin/python"),
        join(import.meta.dir, "worker.py"),
      ]
    : [process.execPath, join(import.meta.dir, "worker.ts")];
  const child = Bun.spawn(cmd, {
    cwd: root,
    env: {
      ...process.env,
      RESTART_TEST_DIRECTORY: directory,
      RESTART_TEST_API: apiUrl,
      RESTART_TEST_TOKEN: token,
    },
    stdout: openSync(join(directory, python ? "python-worker.log" : "ts-worker.log"), "a"),
    stderr: openSync(join(directory, python ? "python-worker.log" : "ts-worker.log"), "a"),
  });
  workers.push(child);
  return child;
}
async function killWorker(worker: ReturnType<typeof Bun.spawn>) {
  worker.kill("SIGKILL");
  await worker.exited;
}
async function http(path: string, body: unknown) {
  const response = await fetch(`${apiUrl}/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (() => {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    })(),
  };
}
function passed(message: string) {
  checks.push(message);
  log(`PASS ${message}`);
}

log(`Isolated restart test: ${directory}`);
try {
  mkdirSync(join(directory, "packages"), { recursive: true });
  cpSync(join(root, "packages/backend"), backend, {
    recursive: true,
    filter: (path) =>
      !path.split("/").includes("node_modules") &&
      !path.split("/").some((part) => part.startsWith(".env") || part === ".turbo"),
  });
  symlinkSync(join(root, "packages/backend/node_modules"), join(backend, "node_modules"));
  for (const name of ["activities", "activity-worker", "media-activities"])
    symlinkSync(join(root, "packages", name), join(directory, "packages", name));
  cpSync(join(import.meta.dir, "probe.ts.fixture"), join(backend, "convex/restartProbe.ts"));
  const lrclib = join(backend, "convex/media/lrclib.ts");
  const original = readFileSync(lrclib, "utf8");
  assert(original.includes("const result = await fetchLyrics(args);"));
  writeFileSync(
    lrclib,
    original.replace(
      "const result = await fetchLyrics(args);",
      'const result = {state: "ready" as const, timing: "line" as const, observations: [{time: 0, duration: 1, value: "test"}]} as Awaited<ReturnType<typeof fetchLyrics>>;',
    ),
  );
  await command([
    "docker",
    "run",
    "-d",
    "--name",
    container,
    "-p",
    "127.0.0.1:33210:3210",
    "-p",
    "127.0.0.1:33211:3211",
    "-e",
    `CONVEX_CLOUD_ORIGIN=${cloud}`,
    "-e",
    "CONVEX_SITE_ORIGIN=http://127.0.0.1:33211",
    "ghcr.io/get-convex/convex-backend:latest",
  ]);
  await online();
  const adminKey = await command(["docker", "exec", container, "./generate_admin_key.sh"]);
  const env: Record<string, string | undefined> = {
    ...process.env,
    CONVEX_SELF_HOSTED_URL: cloud,
    CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
  };
  delete env.CONVEX_DEPLOY_KEY;
  delete env.CONVEX_DEPLOYMENT;
  for (const [key, value] of Object.entries({
    SITE_URL: "http://localhost:3000",
    ACTIVITY_WORKER_TOKEN: token,
    WORKER_CONVEX_CLOUD_ORIGIN: cloud,
    WORKER_SIGNING_SECRET: "restart-test-only",
  }))
    await command([process.execPath, "x", "convex", "env", "set", key, value], env, backend);
  log("Deploying isolated copy with deterministic LRCLIB fixture");
  await command(
    [process.execPath, "x", "convex", "dev", "--once", "--typecheck", "enable"],
    env,
    backend,
  );
  const client = new ConvexHttpClient(cloud);
  (client as any).setAdminAuth(adminKey);
  const query = async (name: string, args: any) =>
    (await client.query(makeFunctionReference<"query">(`restartProbe:${name}`), args)) as any;
  const jobId = await client.mutation(makeFunctionReference<"mutation">("restartProbe:start"), {});
  const snapshot = () => query("snapshot", { jobId });
  let ts = startWorker();
  let python = startWorker(true);

  const resolving = await artifactRecord("resolve");
  log("Killing backend while a TypeScript handler holds a live lease");
  await restartBackend();
  const beforeResolve = await snapshot();
  assert.equal(beforeResolve.steps.find((s: any) => s.key === "resolve").attempt, 1);
  await allow("resolve");
  const oldDownload = await artifactRecord("download");
  passed("backend SIGKILL preserves the workflow journal and live attempt");

  log("Killing TypeScript worker after upload; keeping backend down past the lease deadline");
  await killWorker(ts);
  await command(["docker", "kill", "--signal", "KILL", container]);
  await sleep(33000);
  await command(["docker", "start", container]);
  await online();
  ts = startWorker();
  const newDownload = await artifactRecord("download", 2);
  assert.equal(newDownload.activityId, oldDownload.activityId);
  assert.notEqual(newDownload.attemptToken, oldDownload.attemptToken);
  assert.equal(
    (await http("renew", { attemptToken: oldDownload.attemptToken })).body.accepted,
    false,
  );
  assert.equal(
    (await http("complete", { attemptToken: oldDownload.attemptToken, value: oldDownload.output }))
      .body.accepted,
    false,
  );
  assert.notEqual(
    (
      await http("artifact-upload-url", {
        attemptToken: oldDownload.attemptToken,
        slot: "artifactId",
      })
    ).status,
    200,
  );
  await allow("download");
  await allow("extractAudio");
  await allow("separate");
  passed("expired leases recover after backend restart; stale worker writes are fenced");

  const oldTranscription = await artifactRecord("transcribe");
  log("Killing Python worker after uploading lyrics, then restarting it");
  await killWorker(python);
  await allow("alignLyrics");
  python = startWorker(true);
  const newTranscription = await artifactRecord("transcribe", 2);
  assert.equal(newTranscription.activityId, oldTranscription.activityId);
  assert.notEqual(
    newTranscription.output.timedLyricsArtifactId,
    oldTranscription.output.timedLyricsArtifactId,
  );
  await allow("transcribe");
  await allow("alignLyrics");
  await artifactRecord("analyzeMelody");
  passed("Python worker SIGKILL retries the same activity with new artifact provenance");

  await artifactRecord("mux");
  await allow("mux");
  const lost = await until(
    "committed completion with dropped response",
    () => Bun.file(join(directory, "lost-response.json")).json(),
    (value) => !!value,
  );
  await until("core published", snapshot, (value) => value.job.state === "ready");
  await killWorker(ts);
  log("Restarting backend after a committed completion whose response was lost");
  await restartBackend();
  const duplicate = await http("complete", lost);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  const conflict = await http("complete", { ...lost, value: { ...lost.value, duration: 999 } });
  assert.notEqual(conflict.status, 200);
  passed(
    "completion receipts survive restart: identical retry accepted, conflicting result rejected",
  );

  const published = await snapshot();
  assert.equal(published.lyrics.find((track: any) => track.source === "generated").state, "ready");
  assert.equal(published.asset.state, "ready");
  const publishedIds = [
    published.asset.finalArtifactId,
    ...published.lyrics.flatMap((track: any) =>
      [track.textArtifactId, track.timedArtifactId].filter(Boolean),
    ),
  ];
  for (const url of await query("artifactUrls", { ids: publishedIds })) {
    assert(url);
    assert((await fetch(url)).ok);
  }
  passed("published video and lyrics remain readable while enrichment recovers");
  // The killed TS process also owned melody analysis. Its replacement must retry.
  ts = startWorker();
  await allow("analyzeMelody");
  await allow("assembleAnnotations");
  const finished = await until(
    "both workflows complete",
    snapshot,
    (value) =>
      value.statuses.length === 2 && value.statuses.every((s: any) => s.type === "completed"),
  );
  assert.equal(finished.job.state, "ready");
  assert.equal(finished.enrichment.state, "ready");
  assert.equal(finished.asset.annotationsState, "ready");
  assert.deepEqual(finished.counts, { jobs: 1, assets: 1, enrichments: 1 });
  assert.equal(finished.steps.length, 10);
  assert(finished.steps.every((s: any) => s.state === "completed"));
  assert.equal(
    new Set(finished.steps.filter((s: any) => s.activityId).map((s: any) => s.activityId)).size,
    9,
  );
  const retained = [
    finished.asset.finalArtifactId,
    finished.asset.instrumentalArtifactId,
    finished.asset.vocalsArtifactId,
    finished.asset.annotationsArtifactId,
    finished.asset.midiArtifactId,
    finished.asset.musicXmlArtifactId,
    ...finished.lyrics.flatMap((track: any) =>
      [track.textArtifactId, track.timedArtifactId].filter(Boolean),
    ),
  ];
  assert.equal(retained.length, 9);
  for (const url of await query("artifactUrls", { ids: retained })) {
    assert(url);
    assert((await fetch(url)).ok);
  }
  const produced: string[] = [];
  for (const file of new Bun.Glob("*.json").scanSync(directory)) {
    const record = await Bun.file(join(directory, file)).json();
    for (const [key, value] of Object.entries(record.output ?? {})) {
      if (key === "artifactId" || key.endsWith("ArtifactId")) produced.push(value as string);
    }
  }
  const discarded = produced.filter((id) => !retained.includes(id));
  assert.equal(new Set(produced).size, produced.length);
  assert(produced.length >= 16);
  assert(discarded.length >= 7);
  await until(
    "staging cleanup",
    () => query("artifactUrls", { ids: discarded }),
    (urls) => urls.every((url: any) => url === null),
  );
  passed(
    "full pipeline completes once; retained outputs survive and abandoned/scratch artifacts are cleaned",
  );
  await restartBackend();
  const durable = await snapshot();
  assert.deepEqual(durable.counts, finished.counts);
  assert.equal(durable.job.state, "ready");
  assert.equal(durable.enrichment.state, "ready");
  for (const url of await query("artifactUrls", { ids: retained })) {
    assert(url);
    assert((await fetch(url)).ok);
  }
  passed("completed state and all nine published artifacts survive another hard restart");
  const result = {
    date: new Date().toISOString(),
    commit: await command(["git", "rev-parse", "HEAD"]),
    backendImage: await command(["docker", "inspect", "--format", "{{.Image}}", container]),
    retainedArtifacts: retained.length,
    cleanedArtifacts: discarded.length,
    checks,
    steps: finished.steps.map(({ key, state, attempt }: any) => ({ key, state, attempt })),
  };
  await Bun.write(join(directory, "results.json"), JSON.stringify(result, null, 2));
  log(`ALL PASS. Report: ${join(directory, "results.json")}`);
} catch (error) {
  await command(["docker", "logs", "--tail", "150", container])
    .then((text) => writeFileSync(join(directory, "backend.log"), text))
    .catch(() => {});
  console.error(`FAILED. Logs retained in ${directory}`, error);
  process.exitCode = 1;
} finally {
  for (const worker of workers) if (worker.exitCode === null) await killWorker(worker);
  await command(["docker", "rm", "-f", "-v", container]).catch(() => {});
}
