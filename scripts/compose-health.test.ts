import { expect, test } from "bun:test";

const compose = Bun.YAML.parse(
  await Bun.file(new URL("../docker-compose.yaml", import.meta.url)).text(),
) as {
  services: Record<string, { restart?: string; healthcheck?: { test: string[] } }>;
};

test("completed deployment jobs are excluded from Coolify's overall health", () => {
  for (const name of ["backend-deploy", "queue-release"]) {
    expect(compose.services[name]!.restart).toBe("no");
    expect(compose.services[name]!.healthcheck).toBeUndefined();
  }
});

for (const [name, service] of Object.entries(compose.services)) {
  if (["backend-deploy", "queue-release"].includes(name)) continue;

  test(`${name} probe accepts readiness and rejects failures`, async () => {
    expect(service.healthcheck).toBeDefined();
    let response = Response.json({ ok: true, started: true });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => response.clone(),
    });
    const command = service
      .healthcheck!.test.slice(1)
      .map((arg) => arg.replace(/http:\/\/127\.0\.0\.1:\d+/g, `http://127.0.0.1:${server.port}`));
    const probe = async () => {
      const process = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
      return await process.exited;
    };
    try {
      expect(await probe()).toBe(0);
      response = new Response("unavailable", { status: 503 });
      expect(await probe()).not.toBe(0);
      if (name.endsWith("-worker")) {
        for (const body of [{ ok: false, started: true }, { ok: true, started: false }, {}]) {
          response = Response.json(body);
          expect(await probe()).not.toBe(0);
        }
        response = new Response("invalid JSON");
        expect(await probe()).not.toBe(0);
      }
      server.stop(true);
      expect(await probe()).not.toBe(0);
    } finally {
      server.stop(true);
    }
  });
}

test("metadata worker uses explicit CPU/CUDA modes and native Metal in Mac mode", async () => {
  const base = Bun.YAML.parse(
    await Bun.file(new URL("../docker-compose.yaml", import.meta.url)).text(),
  );
  const mac = Bun.YAML.parse(
    await Bun.file(new URL("../docker-compose.mac.yaml", import.meta.url)).text(),
  );
  const nvidia = Bun.YAML.parse(
    await Bun.file(new URL("../docker-compose.nvidia.yaml", import.meta.url)).text(),
  );
  expect(base.services["metadata-worker"].environment.METADATA_DEVICE).toBe("cpu");
  expect(base.services["metadata-worker"].ports).toBeUndefined();
  expect(base.services["metadata-worker"].environment.ACTIVITY_WORKER_API_URL).toContain(
    "/activities/workers/",
  );
  expect(base.services["backend-deploy"].environment.METADATA_WORKER_URL).toBeUndefined();
  expect(nvidia.services["metadata-worker"].environment.METADATA_DEVICE).toBe("cuda");
  expect(
    nvidia.services["metadata-worker"].deploy.resources.reservations.devices[0].capabilities,
  ).toContain("gpu");
  expect(mac.services["metadata-worker"].profiles).toEqual(["docker-metadata-worker"]);
  expect(nvidia.services["metadata-worker"].environment.ACTIVITY_PROCESS_LOCK_PATH).toBe(
    "/resource-lock/model.lock",
  );
  expect(nvidia.services["metadata-worker"].volumes).toContain("ml_runtime:/resource-lock");
  const worker = await Bun.file(
    new URL("../apps/metadata-worker/package.json", import.meta.url),
  ).json();
  for (const name of ["dev:mac", "dev:mac:build", "dev:mac:host", "dev:mac:host:build"]) {
    expect(worker.scripts[name]).toBeDefined();
  }
  expect(worker.scripts["dev:mac"]).toContain("METADATA_DEVICE=metal");
});
