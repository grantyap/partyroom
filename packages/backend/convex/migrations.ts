import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import { mediaEnrichmentPatch, mediaJobPatch } from "./migration/workflowStateRedesignModel";

export const migrations = new Migrations(components.migrations);

export const workflowStateRedesignV1MediaJobs = migrations.define({
  table: "mediaJobs",
  batchSize: 50,
  migrateOne: async (ctx, job) => {
    const patch = mediaJobPatch(job);
    if (!patch) return;
    const replacement = Object.fromEntries(
      Object.entries({ ...job, ...patch }).filter(
        ([key, value]) => key !== "_id" && key !== "_creationTime" && value !== undefined,
      ),
    );
    await ctx.db.replace(job._id, replacement as never);
  },
});

export const workflowStateRedesignV1MediaEnrichments = migrations.define({
  table: "mediaEnrichments",
  batchSize: 50,
  migrateOne: async (ctx, enrichment) => {
    const patch = mediaEnrichmentPatch(enrichment);
    if (!patch) return;
    const replacement = Object.fromEntries(
      Object.entries({ ...enrichment, ...patch }).filter(
        ([key, value]) => key !== "_id" && key !== "_creationTime" && value !== undefined,
      ),
    );
    await ctx.db.replace(enrichment._id, replacement as never);
  },
});

export const runWorkflowStateRedesignV1 = migrations.runner([
  internal.migrations.workflowStateRedesignV1MediaJobs,
  internal.migrations.workflowStateRedesignV1MediaEnrichments,
]);
