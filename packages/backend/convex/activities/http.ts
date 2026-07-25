import {
  artifactRegisterRequestSchema,
  artifactUploadRequestSchema,
  cancelRequestSchema,
  claimRequestSchema,
  completeRequestSchema,
  failRequestSchema,
  renewRequestSchema,
} from "@partyroom/activity-worker";
import type { Id } from "../_generated/dataModel";
import { components, internal } from "../_generated/api";
import { env, httpAction, type ActionCtx } from "../_generated/server";
import { decryptSourceUrl } from "../media/crypto";
import { replaceUrlOrigin } from "../media/urls";

const encoder = new TextEncoder();

export async function tokensEqual(left: string, right: string) {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < Math.max(leftBytes.length, rightBytes.length); index++) {
    difference |= leftBytes[index % leftBytes.length] ^ rightBytes[index % rightBytes.length];
  }
  return difference === 0;
}

export async function authenticate(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || !env.ACTIVITY_WORKER_TOKEN) return false;
  return await tokensEqual(authorization.slice(7), env.ACTIVITY_WORKER_TOKEN);
}

async function body(request: Request) {
  return await request.json().catch(() => null);
}

function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

function invalid(error: unknown) {
  return Response.json(
    { error: "Invalid activity request", details: String(error) },
    { status: 400 },
  );
}

function workerEndpoint<Input, Output>(options: {
  parse(value: unknown): Input;
  execute(ctx: ActionCtx, input: Input): Promise<Output>;
}) {
  return httpAction(async (ctx, request) => {
    if (!(await authenticate(request))) return unauthorized();
    let input: Input;
    try {
      input = options.parse(await body(request));
    } catch (error) {
      return invalid(error);
    }
    return Response.json(await options.execute(ctx, input));
  });
}

export const claim = workerEndpoint({
  parse: (value) => claimRequestSchema.parse(value),
  execute: async (ctx, input) =>
    await ctx.runMutation(components.activities.activities.claim, input),
});

export const renew = workerEndpoint({
  parse: (value) => renewRequestSchema.parse(value),
  execute: async (ctx, input) =>
    await ctx.runMutation(components.activities.activities.renew, input),
});

export const complete = workerEndpoint({
  parse: (value) => completeRequestSchema.parse(value),
  execute: async (ctx, input) =>
    await ctx.runMutation(components.activities.activities.complete, input),
});

export const fail = workerEndpoint({
  parse: (value) => failRequestSchema.parse(value),
  execute: async (ctx, input) =>
    await ctx.runMutation(components.activities.activities.fail, input),
});

export const cancel = workerEndpoint({
  parse: (value) => cancelRequestSchema.parse(value),
  execute: async (ctx, input) =>
    await ctx.runMutation(components.activities.activities.acknowledgeCancellation, input),
});

export const artifactUploadUrl = workerEndpoint({
  parse: (value) => artifactUploadRequestSchema.parse(value),
  execute: async (ctx, input) => {
    const prepared = await ctx.runMutation(
      components.activities.artifacts.createUpload,
      input as any,
    );
    return {
      uploadUrl: replaceUrlOrigin(prepared.uploadUrl, env.WORKER_CONVEX_CLOUD_ORIGIN),
    };
  },
});

export const artifactRegister = workerEndpoint({
  parse: (value) => artifactRegisterRequestSchema.parse(value),
  execute: async (ctx, input) => ({
    artifactId: await ctx.runMutation(components.activities.artifacts.registerUpload, input as any),
  }),
});

export const mediaSource = httpAction(async (ctx, request) => {
  if (!(await authenticate(request))) return unauthorized();
  const value = await body(request);
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as { jobId?: unknown }).jobId !== "string"
  ) {
    return invalid("jobId is required");
  }
  const source = await ctx.runQuery(internal.media.jobs.getEncryptedSource, {
    jobId: (value as { jobId: string }).jobId as Id<"mediaJobs">,
  });
  return Response.json({
    sourceUrl: await decryptSourceUrl(source.encryptedSource, source.sourceIv),
  });
});
