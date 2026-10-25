import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const worktree = fileURLToPath(new URL("..", import.meta.url));
const projectRoot = process.env.T3CODE_PROJECT_ROOT;
if (!projectRoot)
  throw new Error("T3CODE_PROJECT_ROOT is required; run the T3 Setup Worktree action.");
if (!statSync(projectRoot).isDirectory())
  throw new Error("T3CODE_PROJECT_ROOT must be a directory.");

for (const file of [".env", "apps/web/.env", "packages/backend/.env.local"]) {
  const destination = resolve(worktree, file);
  if (lstatSync(destination, { throwIfNoEntry: false })) continue;
  const source = resolve(projectRoot, file);
  let contents: Buffer;
  try {
    contents = readFileSync(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    console.warn(
      `Missing ${file} in the project checkout; copy its .env.example before running services.`,
    );
    continue;
  }
  try {
    writeFileSync(destination, contents, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

const install = spawnSync("bun", ["install", "--frozen-lockfile"], {
  cwd: worktree,
  stdio: ["ignore", "inherit", "inherit"],
});
if (install.error) throw install.error;
if (install.status !== 0) process.exit(install.status ?? 1);
