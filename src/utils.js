// ----------------------------------------------------------------------
// utils.js — helpers, constants, and fetch wrapper
// ----------------------------------------------------------------------
export const PROJECT_ID = process.env.PROJECT_ID;
export const REGION = process.env.REGION || "us-central1";
export const BUCKET = process.env.WORKSPACE_BUCKET;
export const CACHE_COLLECTION = process.env.CACHE_COLLECTION || "primordia_cache";
export const TASKS_COLLECTION = process.env.TASKS_COLLECTION || "primordia_tasks";

if (!PROJECT_ID) {
  throw new Error("[Primordia FATAL] PROJECT_ID environment variable is not set.");
}
if (!BUCKET) {
  throw new Error("[Primordia FATAL] WORKSPACE_BUCKET environment variable is not set.");
}

export const fetchFn = global.fetch || (await import("node-fetch")).default;

export function isSafePath(p) {
  return typeof p === "string" && p.length > 0 && !p.includes("..");
}

export function log(...args) {
  console.log("[Primordia]", ...args);
}
