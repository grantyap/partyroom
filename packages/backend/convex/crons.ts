import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("Clean up old emails", { hours: 24 }, internal.email.cleanup, {});
export default crons;
