import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// Usage: bun scripts/check-web-runtime.ts <production-web-image>
const image = process.argv[2];
assert(image, "Provide a production web Docker image to test");
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const container = docker("run", "-d", "-p", "127.0.0.1::3000", image);

try {
  const bindings = JSON.parse(
    docker("inspect", "--format", '{{json (index .NetworkSettings.Ports "3000/tcp")}}', container),
  );
  const url = `http://127.0.0.1:${bindings[0].HostPort}/login`;
  let response: Response | undefined;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: "manual" });
      break;
    } catch {
      await Bun.sleep(500);
    }
  }
  assert(response, "Production server did not become reachable");
  assert.equal(response.status, 200, "Production login route failed");
  const html = await response.text();
  assert(html.includes('type="password"'), "Production login form did not render");
  console.log("PASS: production web image starts and renders the login route");
} catch (error) {
  console.error(docker("logs", container));
  throw error;
} finally {
  docker("rm", "-f", container);
}
