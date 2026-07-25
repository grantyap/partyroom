import type {
  ActivityDefinition,
  ActivityInput,
  ActivityOutput,
  ArtifactId,
} from "@partyroom/activities";
import { protocolVersion } from "@partyroom/activities";
import { parse } from "convex-helpers/validators";
import type { Value } from "convex/values";
import {
  claimResponseSchema,
  artifactRegisterResponseSchema,
  artifactUploadResponseSchema,
  failureResponseSchema,
  renewalResponseSchema,
  terminalResponseSchema,
  type ClaimedActivity,
} from "./protocol";

export class ApplicationError extends Error {
  constructor(
    message: string,
    readonly type = "ApplicationError",
    readonly nonRetryable = false,
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

export type ActivityInfo = Pick<
  ClaimedActivity,
  | "activityId"
  | "activityType"
  | "activityVersion"
  | "taskQueue"
  | "attempt"
  | "attemptDeadline"
  | "scheduleDeadline"
>;

export type ActivityContext = {
  readonly info: ActivityInfo;
  readonly signal: AbortSignal;
  heartbeat(details?: Value): Promise<void>;
  reportProgress(progress: number, message?: string): Promise<void>;
  uploadArtifact(slot: string, body: BodyInit, contentType: string): Promise<ArtifactId>;
  runProcess(command: string[], options?: ManagedProcessOptions): Promise<ManagedProcessResult>;
};

export type ManagedProcessOptions = {
  signal?: AbortSignal;
  cwd?: string;
  env?: Record<string, string | undefined>;
  check?: boolean;
  maxOutputBytes?: number;
  terminateTimeoutMs?: number;
  onStdoutLine?: (line: string) => void | Promise<void>;
  onStderrLine?: (line: string) => void | Promise<void>;
};

export type ManagedProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type ProcessHandle = {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  exitCode: number | null;
  kill(signal?: string): void;
};

type ProcessRuntime = {
  spawn(
    command: string[],
    options: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      stdout: "pipe";
      stderr: "pipe";
    },
  ): ProcessHandle;
};

async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void | Promise<void>,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  while (true) {
    const { done, value } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";
    for (const line of lines) await onLine(line);
    if (done) break;
  }
  if (buffered) await onLine(buffered);
}

export async function runManagedProcess(
  command: string[],
  options: ManagedProcessOptions = {},
): Promise<ManagedProcessResult> {
  if (command.length === 0) throw new Error("At least one command argument is required");
  if (options.signal?.aborted) throw options.signal.reason;
  const runtime = (globalThis as typeof globalThis & { Bun?: ProcessRuntime }).Bun;
  if (!runtime) throw new Error("Managed processes require the Bun runtime");
  const child = runtime.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  const abort = () => {
    child.kill("SIGTERM");
    forceKillTimer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, options.terminateTimeoutMs ?? 5_000);
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  let stdout = "";
  let stderr = "";
  const maxOutputBytes = options.maxOutputBytes ?? 1_048_576;
  const append = (current: string, line: string) => `${current}${line}\n`.slice(-maxOutputBytes);
  try {
    const stdoutTask = readLines(child.stdout, async (line) => {
      stdout = append(stdout, line);
      await options.onStdoutLine?.(line);
    });
    const stderrTask = readLines(child.stderr, async (line) => {
      stderr = append(stderr, line);
      await options.onStderrLine?.(line);
    });
    const exitCode = await child.exited;
    await Promise.all([stdoutTask, stderrTask]);
    if (options.signal?.aborted) throw options.signal.reason;
    if ((options.check ?? true) && exitCode !== 0) {
      throw new ApplicationError(
        `${command[0]} exited with ${exitCode}` +
          (stderr.trim() ? `: ${stderr.trim().slice(-2_000)}` : ""),
      );
    }
    return { exitCode, stdout, stderr };
  } finally {
    options.signal?.removeEventListener("abort", abort);
    if (options.signal?.aborted && child.exitCode === null) {
      if (!forceKillTimer) abort();
      await child.exited;
    }
    if (forceKillTimer) clearTimeout(forceKillTimer);
  }
}

export type ActivityHandler<Definition extends ActivityDefinition = ActivityDefinition> = {
  definition: Definition;
  execute(
    context: ActivityContext,
    input: ActivityInput<Definition>,
  ): Promise<ActivityOutput<Definition>>;
};

export function defineHandler<Definition extends ActivityDefinition>(
  definition: Definition,
  execute: ActivityHandler<Definition>["execute"],
): ActivityHandler<Definition> {
  return { definition, execute };
}

type Fetch = typeof globalThis.fetch;

export type ActivityWorkerOptions = {
  apiUrl: string;
  token: string;
  workerId: string;
  taskQueue: string;
  activities: ActivityHandler[];
  maxConcurrentActivities?: number;
  idlePollIntervalMs?: number;
  requestTimeoutMs?: number;
  fetch?: Fetch;
};

export class ActivityWorker {
  private readonly handlers = new Map<string, ActivityHandler>();
  private readonly fetch: Fetch;
  private readonly maxConcurrentActivities: number;
  private readonly idlePollIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly instanceId = crypto.randomUUID();
  private stopController: AbortController | null = null;
  private loops: Promise<void>[] = [];
  private running = 0;
  private lastPollAt: number | null = null;
  private lastRenewalAt: number | null = null;
  private eventLoopLagMs = 0;
  private maxEventLoopLagMs = 0;

  constructor(private readonly options: ActivityWorkerOptions) {
    if (!options.workerId.trim()) throw new Error("workerId must not be empty");
    if (!options.taskQueue.trim()) throw new Error("taskQueue must not be empty");
    this.fetch = options.fetch ?? globalThis.fetch;
    this.maxConcurrentActivities = Math.max(1, options.maxConcurrentActivities ?? 1);
    this.idlePollIntervalMs = Math.max(100, options.idlePollIntervalMs ?? 1_000);
    this.requestTimeoutMs = Math.max(1_000, options.requestTimeoutMs ?? 10_000);
    for (const handler of options.activities) {
      if (handler.definition.queue.name !== options.taskQueue) {
        throw new Error(
          `Activity ${handler.definition.name} belongs to ${handler.definition.queue.name}, not ${options.taskQueue}`,
        );
      }
      const key = activityKey(handler.definition.name, handler.definition.version);
      if (this.handlers.has(key)) throw new Error(`Duplicate activity handler ${key}`);
      this.handlers.set(key, handler);
    }
    if (this.handlers.size === 0) throw new Error("At least one activity handler is required");
  }

  start() {
    if (this.stopController) return;
    this.stopController = new AbortController();
    this.loops = Array.from({ length: this.maxConcurrentActivities }, (_, slot) =>
      this.poll(slot, this.stopController!.signal),
    );
    this.loops.push(this.monitorEventLoop(this.stopController.signal));
  }

  async stop() {
    const controller = this.stopController;
    if (!controller) return;
    controller.abort("Worker is stopping");
    await Promise.allSettled(this.loops);
    this.stopController = null;
    this.loops = [];
  }

  health() {
    return {
      ok: true,
      started: this.stopController !== null,
      running: this.running,
      concurrency: this.maxConcurrentActivities,
      taskQueue: this.options.taskQueue,
      activities: [...this.handlers.keys()],
      lastPollAt: this.lastPollAt,
      lastRenewalAt: this.lastRenewalAt,
      eventLoopLagMs: Math.round(this.eventLoopLagMs * 10) / 10,
      maxEventLoopLagMs: Math.round(this.maxEventLoopLagMs * 10) / 10,
    };
  }

  private async monitorEventLoop(signal: AbortSignal) {
    let expected = performance.now() + 1_000;
    while (!signal.aborted) {
      await delay(Math.max(0, expected - performance.now()), signal);
      const now = performance.now();
      this.eventLoopLagMs = Math.max(0, now - expected);
      this.maxEventLoopLagMs = Math.max(this.maxEventLoopLagMs, this.eventLoopLagMs);
      expected = now + 1_000;
    }
  }

  private async poll(slot: number, stopSignal: AbortSignal) {
    while (!stopSignal.aborted) {
      try {
        this.lastPollAt = Date.now();
        const activity = await this.request(
          "claim",
          {
            protocolVersion,
            taskQueue: this.options.taskQueue,
            workerId: `${this.options.workerId}:${this.instanceId}:${slot}`,
            supportedActivities: [...this.handlers.values()].map(({ definition }) => ({
              name: definition.name,
              version: definition.version,
            })),
          },
          claimResponseSchema,
          stopSignal,
        );
        if (!activity) {
          await delay(this.idlePollIntervalMs, stopSignal);
          continue;
        }
        this.running += 1;
        try {
          await this.execute(activity, stopSignal);
        } finally {
          this.running -= 1;
        }
      } catch (error) {
        if (stopSignal.aborted) return;
        console.error("Activity claim failed", error);
        await delay(this.idlePollIntervalMs, stopSignal).catch(() => undefined);
      }
    }
  }

  private async execute(activity: ClaimedActivity, stopSignal: AbortSignal) {
    const handler = this.handlers.get(activityKey(activity.activityType, activity.activityVersion));
    if (!handler) return;

    const execution = new AbortController();
    const stop = () => execution.abort(stopSignal.reason);
    stopSignal.addEventListener("abort", stop, { once: true });
    let leaseExpiresAt = activity.leaseExpiresAt;
    let cancelRequested = false;
    let finished = false;
    let progress: { value?: number; message?: string; details?: Value } = {};

    const renew = async () => {
      const response = await this.request(
        "renew",
        {
          activityId: activity.activityId,
          attempt: activity.attempt,
          leaseToken: activity.leaseToken,
          progress: progress.value,
          progressMessage: progress.message,
          heartbeatDetails: progress.details,
        },
        renewalResponseSchema,
        execution.signal,
      );
      progress = {};
      if (!response.accepted) {
        execution.abort("Activity lease is no longer current");
        return;
      }
      this.lastRenewalAt = Date.now();
      if (response.leaseExpiresAt !== undefined) leaseExpiresAt = response.leaseExpiresAt;
      if (response.cancelRequested) {
        cancelRequested = true;
        execution.abort("Activity cancellation requested");
      }
    };

    const renewLoop = (async () => {
      while (!finished && !execution.signal.aborted) {
        const wait = Math.max(250, Math.min(5_000, (leaseExpiresAt - Date.now()) / 3));
        await delay(wait, execution.signal);
        try {
          await renew();
        } catch (error) {
          if (execution.signal.aborted) return;
          if (Date.now() >= leaseExpiresAt) {
            execution.abort("Activity lease renewal deadline passed");
            return;
          }
          console.error(`Unable to renew activity ${activity.activityId}`, error);
        }
      }
    })().catch(() => undefined);

    const context: ActivityContext = {
      info: {
        activityId: activity.activityId,
        activityType: activity.activityType,
        activityVersion: activity.activityVersion,
        taskQueue: activity.taskQueue,
        attempt: activity.attempt,
        attemptDeadline: activity.attemptDeadline,
        scheduleDeadline: activity.scheduleDeadline,
      },
      signal: execution.signal,
      heartbeat: async (details) => {
        progress.details = details;
        await renew();
      },
      reportProgress: async (value, message) => {
        progress.value = Math.min(1, Math.max(0, value));
        progress.message = message;
        await renew();
      },
      runProcess: async (command, options = {}) =>
        await runManagedProcess(command, {
          ...options,
          signal: options.signal
            ? AbortSignal.any([execution.signal, options.signal])
            : execution.signal,
        }),
      uploadArtifact: async (slot, body, contentType) => {
        if (!activity.artifactSlots.includes(slot)) {
          throw new Error(`Activity does not declare artifact slot ${slot}`);
        }
        const identity = {
          activityId: activity.activityId,
          attempt: activity.attempt,
          leaseToken: activity.leaseToken,
          slot,
        };
        const { uploadUrl } = await this.request(
          "artifact-upload-url",
          identity,
          artifactUploadResponseSchema,
          execution.signal,
        );
        const response = await this.fetch(uploadUrl, {
          method: "POST",
          headers: { "content-type": contentType },
          body,
          signal: execution.signal,
        });
        if (!response.ok) {
          throw new Error(
            `Artifact upload returned HTTP ${response.status}: ${await response.text()}`,
          );
        }
        const uploaded = (await response.json()) as { storageId?: string };
        if (!uploaded.storageId) throw new Error("Artifact upload did not return a storageId");
        const registered = await this.request(
          "artifact-register",
          { ...identity, storageId: uploaded.storageId },
          artifactRegisterResponseSchema,
          execution.signal,
        );
        return registered.artifactId as ArtifactId;
      },
    };

    try {
      const input = parse(handler.definition.input, activity.input);
      const value = await handler.execute(context, input);
      if (cancelRequested) {
        await this.sendTerminal("cancel", activity, {});
      } else if (!execution.signal.aborted) {
        const output = parse(handler.definition.output, value) as Value;
        await this.sendTerminal("complete", activity, { value: output });
      }
    } catch (error) {
      if (cancelRequested) {
        await this.sendTerminal("cancel", activity, {});
      } else if (!stopSignal.aborted) {
        const applicationError =
          error instanceof ApplicationError
            ? error
            : new ApplicationError(error instanceof Error ? error.message : String(error));
        await this.sendTerminal(
          "fail",
          activity,
          {
            errorType: applicationError.type,
            errorMessage: applicationError.message.slice(0, 2_000),
            nonRetryable: applicationError.nonRetryable,
          },
          failureResponseSchema,
        );
      }
    } finally {
      finished = true;
      execution.abort("Activity execution finished");
      await renewLoop;
      stopSignal.removeEventListener("abort", stop);
    }
  }

  private async sendTerminal(
    path: "complete" | "fail" | "cancel",
    activity: ClaimedActivity,
    body: Record<string, unknown>,
    schema = terminalResponseSchema,
  ) {
    const requestId = crypto.randomUUID();
    let delayMs = 250;
    while (Date.now() < activity.scheduleDeadline) {
      try {
        return await this.request(
          path,
          {
            activityId: activity.activityId,
            attempt: activity.attempt,
            leaseToken: activity.leaseToken,
            requestId,
            ...body,
          },
          schema,
        );
      } catch (error) {
        console.error(`Unable to report terminal activity state ${activity.activityId}`, error);
        await delay(delayMs);
        delayMs = Math.min(5_000, delayMs * 2);
      }
    }
  }

  private async request<Output>(
    path: string,
    body: unknown,
    schema: { parse(value: unknown): Output },
    parentSignal?: AbortSignal,
  ): Promise<Output> {
    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    const signal = parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout;
    const response = await this.fetch(new URL(path, this.options.apiUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      throw new Error(
        `Activity API ${path} returned HTTP ${response.status}: ${await response.text()}`,
      );
    }
    return schema.parse(await response.json());
  }
}

function activityKey(name: string, version: number) {
  return `${name}:${version}`;
}

function delay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
