import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";

const DEFAULT_SCOPE_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_SCOPE_TTL_MS = 30 * 24 * 60 * 60_000;
const UNREGISTERED_GRACE_MS = 24 * 60 * 60_000;
const CLEANUP_BATCH_SIZE = 100;

async function requireCurrentLease(
  ctx: MutationCtx,
  args: {
    activityId: Id<"activities">;
    attempt: number;
    leaseToken: string;
    slot: string;
  },
) {
  const activity = await ctx.db.get(args.activityId);
  if (!activity) throw new Error("Activity not found");
  if (
    activity.state !== "running" ||
    activity.attempt !== args.attempt ||
    activity.leaseToken !== args.leaseToken
  ) {
    throw new Error("Activity lease is no longer current");
  }
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
  if (!scope || scope.state !== "open") {
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

export const createUpload = mutation({
  args: {
    activityId: v.id("activities"),
    attempt: v.number(),
    leaseToken: v.string(),
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
    activityId: v.id("activities"),
    attempt: v.number(),
    leaseToken: v.string(),
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
        existing.attempt !== args.attempt ||
        existing.slot !== args.slot
      ) {
        throw new Error("Storage object is already registered to another artifact");
      }
      return existing._id;
    }
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata) throw new Error("Uploaded storage object does not exist");
    const now = Date.now();
    return await ctx.db.insert("artifacts", {
      scopeId: activity.artifactScopeId!,
      activityId: activity._id,
      attempt: args.attempt,
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
  args: {
    scopeId: v.id("artifactScopes"),
    keep: v.array(v.id("artifacts")),
  },
  returns: v.null(),
  handler: async (ctx, { scopeId, keep }) => {
    if (keep.length > 100) throw new Error("At most 100 artifacts may be adopted at once");
    const scope = await ctx.db.get(scopeId);
    if (!scope) return null;
    if (scope.state === "abandoned") throw new Error("Artifact scope was abandoned");
    const now = Date.now();
    for (const artifactId of new Set(keep)) {
      const artifact = await ctx.db.get(artifactId);
      if (!artifact || artifact.scopeId !== scopeId) {
        throw new Error("Cannot adopt an artifact from another scope");
      }
      if (artifact.disposition !== "retained") {
        throw new Error(`Intermediate artifact ${artifact.slot} cannot be adopted`);
      }
      if (artifact.state !== "adopted") {
        await ctx.db.patch(artifactId, { state: "adopted", updatedAt: now });
      }
    }
    await ctx.db.patch(scopeId, { state: "closed", updatedAt: now });
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
    await ctx.db.patch(scopeId, { state: "abandoned", updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.artifacts.cleanupScope, { scopeId });
    return null;
  },
});

export const deleteArtifact = mutation({
  args: { artifactId: v.id("artifacts") },
  returns: v.boolean(),
  handler: async (ctx, { artifactId }) => {
    const artifact = await ctx.db.get(artifactId);
    if (!artifact) return false;
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
    const artifacts =
      scope.state === "abandoned"
        ? await ctx.db
            .query("artifacts")
            .withIndex("by_scope_and_state", (q) => q.eq("scopeId", scopeId))
            .take(CLEANUP_BATCH_SIZE)
        : await ctx.db
            .query("artifacts")
            .withIndex("by_scope_and_state", (q) => q.eq("scopeId", scopeId).eq("state", "staged"))
            .take(CLEANUP_BATCH_SIZE);
    for (const artifact of artifacts) {
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
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    continueCursor: v.string(),
    isDone: v.boolean(),
    deleted: v.number(),
  }),
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db.system.query("_storage").order("asc").paginate(paginationOpts);
    const cutoff = Date.now() - UNREGISTERED_GRACE_MS;
    let deleted = 0;
    for (const storage of page.page) {
      if (storage._creationTime >= cutoff) continue;
      const registered = await ctx.db
        .query("artifacts")
        .withIndex("by_storage_id", (q) => q.eq("storageId", storage._id))
        .unique();
      if (registered) continue;
      await ctx.storage.delete(storage._id);
      deleted += 1;
    }
    return {
      continueCursor: page.continueCursor,
      isDone: page.isDone,
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
      paginationOpts: {
        cursor: state?.cursor ?? null,
        numItems: CLEANUP_BATCH_SIZE,
      },
    });
    const cursor = result.isDone ? undefined : result.continueCursor;
    if (state) {
      await ctx.db.patch(state._id, { cursor, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("artifactGcState", {
        name: "storage",
        cursor,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});
