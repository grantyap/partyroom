import { spawnSync } from "node:child_process";

const requestedMode = process.argv[2];

if (requestedMode !== "docker" && requestedMode !== "mac" && requestedMode !== "nvidia") {
  console.error("Expected development mode to be `docker`, `mac`, or `nvidia`.");
  process.exit(1);
}

function docker(args: string[]) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.error) {
    console.error(`Unable to inspect Docker: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

const projectContainers = docker([
  "ps",
  "--all",
  "--quiet",
  "--filter",
  "label=com.docker.compose.project=partyroom",
]);

if (!projectContainers) {
  process.exit(0);
}

const backendContainerId = docker([
  "ps",
  "--all",
  "--quiet",
  "--filter",
  "label=com.docker.compose.project=partyroom",
  "--filter",
  "label=com.docker.compose.service=backend",
])
  .split("\n")
  .at(0);

if (!backendContainerId) {
  console.error(
    "An incomplete Partyroom development stack already exists. Run `bun run dev:down` before starting it again.",
  );
  process.exit(1);
}

const runningMode = docker([
  "inspect",
  "--format",
  '{{ index .Config.Labels "partyroom.dev.mode" }}',
  backendContainerId,
]);

if (runningMode !== requestedMode) {
  const modeDescriptions: Record<string, string> = {
    docker: "`dev` mode",
    mac: "`dev:mac` mode",
    nvidia: "`dev:nvidia` mode",
  };
  const runningDescription = modeDescriptions[runningMode] ?? "an older, untagged mode";
  const requestedDescription = modeDescriptions[requestedMode].replace(" mode", "");
  console.error(
    `The existing stack uses ${runningDescription}. Run \`bun run dev:down\` before switching to ${requestedDescription}.`,
  );
  process.exit(1);
}
