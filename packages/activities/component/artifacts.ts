import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";

import { currentLease } from "./leases";
import { protocolVersion } from "./validators";

const DEFAULT_SCOPE_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_SCOPE_TTL_MS = 30 * 24 * 60 * 60_000;
const UNREGISTERED_GRACE_MS = 24 * 60 * 60_000;
const CLEANUP_BATCH_SIZE = 100;

async function requireCurrentLease(
  ctx: MutationCtx,
  args: {
    attemptToken: string;
    slot: string;
  },
) {
  const activity = await currentLease(ctx, args.attemptToken);
  if (!activity || activity.cancelRequested) throw new Error("Activity lease is no longer current");
  if (!activity.artifactScopeId) {
    throw new Error("Activity was not scheduled with an artifact scope");
  }
  if (!(activity.artifactSlots ?? []).includes(args.slot)) {
    throw new Error(`Activity does not declare artifact slot ${args.slot}`);
  }
  const definition = activity.artifactDefinitions?.find(
    (candidate) => candidate.slot === args.slot,
  );
  if (!definition) {
    throw new Error(`Activity artifact slot ${args.slot} has no lifecycle definition`);
  }
  const scope = await ctx.db.get(activity.artifactScopeId);
  if (!scope || scope.state !== "open" || scope.expiresAt <= Date.now()) {
    throw new Error("Artifact scope is not open");
  }
  return { activity, scope, definition };
}

export const createScope = mutation({
  args: { ttlMs: v.optional(v.number()) },
  returns: v.id("artifactScopes"),
  handler: async (ctx, { ttlMs }) => {
    const requestedTtl = ttlMs ?? DEFAULT_SCOPE_TTL_MS;
    if (
      !Number.isSafeInteger(requestedTtl) ||
      requestedTtl <= 0 ||
      requestedTtl > MAX_SCOPE_TTL_MS
    ) {
      throw new Error(`ttlMs must be between 1 and ${MAX_SCOPE_TTL_MS}`);
    }
    const now = Date.now();
    const scopeId = await ctx.db.insert("artifactScopes", {
      state: "open",
      expiresAt: now + requestedTtl,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAt(now + requestedTtl, internal.artifacts.expireScope, {
      scopeId,
    });
    return scopeId;
  },
});

export const attachWorkflow = mutation({
  args: {
    scopeId: v.id("artifactScopes"),
    workflowId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { scopeId, workflowId }) => {
    const scope = await ctx.db.get(scopeId);
    if (!scope) throw new Error("Artifact scope not found");
    if (scope.state !== "open" || scope.expiresAt <= Date.now())
      throw new Error("Artifact scope is not open");
    if (scope.workflowId && scope.workflowId !== workflowId) {
      throw new Error("Artifact scope is already attached to another workflow");
    }
    const existing = await ctx.db
      .query("artifactScopes")
      .withIndex("by_workflow_id", (q) => q.eq("workflowId", workflowId))
      .unique();
    if (existing && existing._id !== scopeId) {
      throw new Error("Workflow is already attached to another artifact scope");
    }
    await ctx.db.patch(scopeId, { workflowId, updatedAt: Date.now() });
    return null;
  },
});

export const getScopeForWorkflow = query({
  args: { workflowId: v.string() },
  returns: v.union(v.id("artifactScopes"), v.null()),
  handler: async (ctx, { workflowId }) => {
    const scope = await ctx.db
      .query("artifactScopes")
      .withIndex("by_workflow_id", (q) => q.eq("workflowId", workflowId))
      .unique();
    return scope?._id ?? null;
  },
});

export const createUpload = mutation({
  args: {
    attemptToken: v.string(),
    slot: v.string(),
  },
  returns: v.object({ uploadUrl: v.string() }),
  handler: async (ctx, args) => {
    await requireCurrentLease(ctx, args);
    return { uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

export const registerUpload = mutation({
  args: {
    attemptToken: v.string(),
    slot: v.string(),
    storageId: v.id("_storage"),
  },
  returns: v.id("artifacts"),
  handler: async (ctx, args) => {
    const { activity, definition } = await requireCurrentLease(ctx, args);
    const existing = await ctx.db
      .query("artifacts")
      .withIndex("by_storage_id", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (existing) {
      if (
        existing.activityId !== activity._id ||
        existing.attempt !== activity.attempt ||
        existing.slot !== args.slot
      ) {
        throw new Error("Storage object is already registered to another artifact");
      }
      return existing._id;
    }
    const existingSlot = await ctx.db
      .query("artifacts")
      .withIndex("by_activity_attempt_and_slot", (q) =>
        q.eq("activityId", activity._id).eq("attempt", activity.attempt).eq("slot", args.slot),
      )
      .unique();
    if (existingSlot) {
      throw new Error(`Activity already registered artifact slot ${args.slot}`);
    }
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata) throw new Error("Uploaded storage object does not exist");
    const now = Date.now();
    return await ctx.db.insert("artifacts", {
      scopeId: activity.artifactScopeId!,
      activityId: activity._id,
      attempt: activity.attempt,
      slot: args.slot,
      disposition: definition.disposition,
      storageId: args.storageId,
      state: "staged",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getUrl = query({
  args: { artifactId: v.id("artifacts") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { artifactId }) => {
    const artifact = await ctx.db.get(artifactId);
    if (!artifact) return null;
    return await ctx.storage.getUrl(artifact.storageId);
  },
});

export const closeScope = mutation({
  args: { scopeId: v.id("artifactScopes") },
  returns: v.null(),
  handler: async (ctx, { scopeId }) => {
    const scope = await ctx.db.get(scopeId);
    if (!scope) return null;
    if (scope.state === "abandoned") return null;
    await ctx.runMutation(api.activities.cancelScope, { scopeId });
    await ctx.db.patch(scopeId, { state: "closed", updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.artifacts.cleanupScope, { scopeId });
    return null;
  },
});

export const abandonScope = mutation({
  args: { scopeId: v.id("artifactScopes") },
  returns: v.null(),
  handler: async (ctx, { scopeId }) => {
    const scope = await ctx.db.get(scopeId);
    if (!scope || scope.state === "closed") return null;
    await ctx.runMutation(api.activities.cancelScope, { scopeId });
    await ctx.db.patch(scopeId, { state: "abandoned", updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.artifacts.cleanupScope, { scopeId });
    return null;
  },
});

export const deleteArtifact = mutation({
  args: { artifactId: v.id("artifacts"), owner: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { artifactId, owner }) => {
    const artifact = await ctx.db.get(artifactId);
    if (!artifact) return false;
    if (artifact.state !== "adopted") return false;
    // TODO(deprecation): v1 retained artifacts have no owner; their caller
    // already checked the referenced asset before asking to delete them.
    if ("owner" in artifact && artifact.owner !== owner)
      throw new Error("Artifact is not owned by this resource");
    await ctx.storage.delete(artifact.storageId);
    await ctx.db.delete(artifactId);
    return true;
  },
});

export const expireScope = internalMutation({
  args: { scopeId: v.id("artifactScopes") },
  returns: v.null(),
  handler: async (ctx, { scopeId }) => {
    const scope = await ctx.db.get(scopeId);
    if (!scope || scope.state !== "open" || scope.expiresAt > Date.now()) return null;
    await ctx.runMutation(api.activities.cancelScope, { scopeId });
    await ctx.db.patch(scopeId, { state: "abandoned", updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.artifacts.cleanupScope, { scopeId });
    return null;
  },
});

export const cleanupScope = internalMutation({
  args: { scopeId: v.id("artifactScopes") },
  returns: v.null(),
  handler: async (ctx, { scopeId }) => {
    const scope = await ctx.db.get(scopeId);
    if (!scope || scope.state === "open") return null;
    const artifacts = await ctx.db
      .query("artifacts")
      .withIndex("by_scope_and_state", (q) => q.eq("scopeId", scopeId).eq("state", "staged"))
      .take(CLEANUP_BATCH_SIZE);
    for (const artifact of artifacts) {
      const activity = scope.state === "closed" ? await ctx.db.get(artifact.activityId) : null;
      if (
        artifact.disposition === "retained" &&
        activity &&
        activity.protocolVersion < protocolVersion &&
        activity.state === "completed" &&
        activity.attempt === artifact.attempt
      ) {
        // TODO(deprecation): Preserve a delayed v1 cleanup callback until the
        // old retained artifacts are adopted or retired in a later migration.
        await ctx.db.patch(artifact._id, { state: "adopted", updatedAt: Date.now() });
        continue;
      }
      await ctx.storage.delete(artifact.storageId);
      await ctx.db.delete(artifact._id);
    }
    if (artifacts.length === CLEANUP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.artifacts.cleanupScope, { scopeId });
    }
    return null;
  },
});

export const sweepUnregistered = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({
    cursor: v.optional(v.string()),
    isDone: v.boolean(),
    deleted: v.number(),
  }),
  handler: async (ctx, { cursor }) => {
    const cursorId = cursor ? ctx.db.system.normalizeId("_storage", cursor) : null;
    const page = await ctx.db.system
      .query("_storage")
      .withIndex("by_id", cursorId ? (q) => q.gt("_id", cursorId) : undefined)
      .take(CLEANUP_BATCH_SIZE);
    const cutoff = Date.now() - UNREGISTERED_GRACE_MS;
    let deleted = 0;
    for (const storage of page) {
      if (storage._creationTime >= cutoff) continue;
      const registered = await ctx.db
        .query("artifacts")
        .withIndex("by_storage_id", (q) => q.eq("storageId", storage._id))
        .unique();
      if (registered) continue;
      await ctx.storage.delete(storage._id);
      deleted += 1;
    }
    const isDone = page.length < CLEANUP_BATCH_SIZE;
    return {
      cursor: isDone ? undefined : page[page.length - 1]!._id,
      isDone,
      deleted,
    };
  },
});

export const runStorageSweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const state = await ctx.db
      .query("artifactGcState")
      .withIndex("by_name", (q) => q.eq("name", "storage"))
      .unique();
    const result = await ctx.runMutation(internal.artifacts.sweepUnregistered, {
      cursor: state?.cursor,
    });
    const cursor = result.isDone ? undefined : result.cursor;
    if (state) {
      await ctx.db.patch(state._id, { cursor, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("artifactGcState", {
        name: "storage",
        cursor,
        updatedAt: Date.now(),
      });
    }
    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.artifacts.runStorageSweep, {});
    }
    return null;
  },
});

// Called inside the same parent mutation that publishes the domain reference.
export const adopt = mutation({
  args: {
    workflowId: v.string(),
    owner: v.string(),
    artifacts: v.array(v.object({ artifactId: v.id("artifacts"), slot: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, { workflowId, owner, artifacts }) => {
    for (const { artifactId, slot } of artifacts) {
      const artifact = await ctx.db.get(artifactId);
      if (!artifact || artifact.disposition !== "retained" || artifact.slot !== slot)
        throw new Error("Invalid published artifact");
      const scope = await ctx.db.get(artifact.scopeId);
      if (!scope || scope.workflowId !== workflowId)
        throw new Error("Artifact belongs to another run");
      if (artifact.state === "adopted") {
        if (!("owner" in artifact)) throw new Error("Legacy artifact has no owner");
        if (artifact.owner !== owner) throw new Error("Artifact already has another owner");
        continue;
      }
      const activity = await ctx.db.get(artifact.activityId);
      if (
        scope.state !== "open" ||
        scope.expiresAt <= Date.now() ||
        activity?.state !== "completed" ||
        activity.attempt !== artifact.attempt
      )
        throw new Error("Artifact is not publishable");
      if (!(await ctx.db.system.get("_storage", artifact.storageId)))
        throw new Error("Artifact storage is missing");
      await ctx.db.patch(artifactId, { state: "adopted", owner, updatedAt: Date.now() });
    }
    return null;
  },
});

// Validate scratch references before a domain mutation stores them. They remain
// staged and are owned by the run until publication or scope cleanup.
export const validateProduced = query({
  args: { workflowId: v.string(), artifactId: v.id("artifacts"), slot: v.string() },
  returns: v.null(),
  handler: async (ctx, { workflowId, artifactId, slot }) => {
    const artifact = await ctx.db.get(artifactId);
    if (!artifact || artifact.slot !== slot || artifact.state !== "staged")
      throw new Error("Invalid produced artifact");
    const scope = await ctx.db.get(artifact.scopeId);
    const activity = await ctx.db.get(artifact.activityId);
    if (
      scope?.workflowId !== workflowId ||
      scope.state !== "open" ||
      scope.expiresAt <= Date.now() ||
      activity?.state !== "completed" ||
      activity.attempt !== artifact.attempt
    )
      throw new Error("Artifact belongs to an inactive attempt or another run");
    if (!(await ctx.db.system.get("_storage", artifact.storageId)))
      throw new Error("Artifact storage is missing");
    return null;
  },
});
