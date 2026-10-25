import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const directories: string[] = [];
const envFiles = [".env", "apps/web/.env", "packages/backend/.env.local"];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "partyroom-worktree-"));
  directories.push(directory);
  const source = join(directory, "project");
  const worktree = join(directory, "worktree");
  const bin = join(directory, "bin");
  mkdirSync(bin);
  mkdirSync(join(worktree, "scripts"), { recursive: true });
  copyFileSync(
    join(import.meta.dir, "setup-worktree.ts"),
    join(worktree, "scripts/setup-worktree.ts"),
  );
  for (const file of envFiles) {
    mkdirSync(dirname(join(source, file)), { recursive: true });
    mkdirSync(dirname(join(worktree, file)), { recursive: true });
    writeFileSync(join(source, file), `SECRET=fixture-${file}\n`);
    chmodSync(join(source, file), 0o644);
  }
  writeFileSync(
    join(bin, "bun"),
    '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@" >> "$INSTALL_LOG"\nexit "${INSTALL_STATUS:-0}"\n',
  );
  chmodSync(join(bin, "bun"), 0o755);
  const log = join(directory, "install.log");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    T3CODE_PROJECT_ROOT: source,
    INSTALL_LOG: log,
  };
  const run = (overrides: Record<string, string | undefined> = {}) =>
    spawnSync(process.execPath, [join(worktree, "scripts/setup-worktree.ts")], {
      cwd: directory,
      env: { ...env, ...overrides },
      encoding: "utf8",
    });
  return { source, worktree, log, run };
}

test("setup copies private env files and installs locked dependencies in the worktree", () => {
  const { source, worktree, log, run } = fixture();
  const result = run();
  expect(result.status).toBe(0);
  for (const file of envFiles) {
    expect(readFileSync(join(worktree, file))).toEqual(readFileSync(join(source, file)));
    expect(statSync(join(worktree, file)).mode & 0o777).toBe(0o600);
  }
  expect(readFileSync(log, "utf8")).toBe(`${realpathSync(worktree)}\ninstall\n--frozen-lockfile\n`);
  expect(result.stdout + result.stderr).not.toContain("SECRET=");
});

test("reruns preserve existing files, symlinks, and the original checkout", () => {
  const { source, worktree, run } = fixture();
  expect(run().status).toBe(0);
  writeFileSync(join(worktree, ".env"), "LOCAL=keep\n");
  rmSync(join(worktree, "apps/web/.env"));
  symlinkSync(join(source, "apps/web/.env"), join(worktree, "apps/web/.env"));
  rmSync(join(worktree, "packages/backend/.env.local"));
  symlinkSync("missing-target", join(worktree, "packages/backend/.env.local"));
  expect(run().status).toBe(0);
  expect(readFileSync(join(worktree, ".env"), "utf8")).toBe("LOCAL=keep\n");
  expect(lstatSync(join(worktree, "apps/web/.env")).isSymbolicLink()).toBe(true);
  expect(readlinkSync(join(worktree, "packages/backend/.env.local"))).toBe("missing-target");
  expect(readFileSync(join(source, ".env"), "utf8")).toBe("SECRET=fixture-.env\n");
});

test("missing source env files warn without preventing dependency installation", () => {
  const { source, worktree, log, run } = fixture();
  rmSync(join(source, "apps/web/.env"));
  const result = run();
  expect(result.status).toBe(0);
  expect(result.stderr).toContain("Missing apps/web/.env");
  expect(lstatSync(join(worktree, "apps/web/.env"), { throwIfNoEntry: false })).toBeUndefined();
  expect(statSync(log).isFile()).toBe(true);
});

test("missing or invalid project roots fail before copying or installing", () => {
  const { source, worktree, log, run } = fixture();
  for (const root of [undefined, join(source, "missing"), join(source, ".env")]) {
    expect(run({ T3CODE_PROJECT_ROOT: root }).status).not.toBe(0);
    expect(lstatSync(join(worktree, ".env"), { throwIfNoEntry: false })).toBeUndefined();
    expect(lstatSync(log, { throwIfNoEntry: false })).toBeUndefined();
  }
});

test("dependency installation failures propagate", () => {
  const { run } = fixture();
  expect(run({ INSTALL_STATUS: "23" }).status).toBe(23);
  expect(run({ PATH: "/nonexistent" }).status).not.toBe(0);
});

test("T3 defaults to worktrees and waits for automatic setup", () => {
  const config = JSON.parse(readFileSync(join(import.meta.dir, "../t3.json"), "utf8"));
  expect(config.defaultThreadEnvMode).toBe("worktree");
  expect(config.scripts).toContainEqual({
    name: "Setup Worktree",
    command: "bun scripts/setup-worktree.ts",
    icon: "configure",
    runOnWorktreeCreate: true,
    async: false,
  });
});
