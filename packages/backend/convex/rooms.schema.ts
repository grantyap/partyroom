import { v } from "convex/values";

export const roomRoleSchema = v.union(v.literal("admin"), v.literal("member"));
