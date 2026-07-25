import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "reconcile unregistered activity artifacts",
  { hours: 1 },
  internal.artifacts.runStorageSweep,
  {},
);

export default crons;
