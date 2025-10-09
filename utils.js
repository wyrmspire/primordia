// ----------------------------------------------------------------------
// utils.js — helpers, constants, and fetch wrapper
// ----------------------------------------------------------------------
export const PROJECT_ID = process.env.PROJECT_ID || "ticktalk-472521";
export const REGION = process.env.REGION || "us-central1";
export const BUCKET = process.env.WORKSPACE_BUCKET;
export const CACHE_DIR = process.env.CACHE_DIR || "./cache";
export const CACHE_COLLECTION = process.env.CACHE_COLLECTION || "primordia_cache";
export const TASKS_COLLECTION = process.env.TASKS_COLLECTION || "primordia_tasks";

// THIS IS THE CRITICAL CHANGE: We now WARN instead of crashing.
if (!BUCKET) {
  console.warn("[Primordia WARNING] WORKSPACE_BUCKET environment variable is not set. Storage operations will fail.");
}

export const fetchFn = global.fetch || (await import("node-fetch")).default;

export function isSafePath(p) {
  return typeof p === "string" && p.length > 0 && !p.includes("..");
}

export function log(...args) {
  console.log("[Primordia]", ...args);
}