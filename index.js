import express from "express";
import { listAllFiles, readFileText, writeFileText } from "./storage.js";
import { isSafePath, log, fetchFn, REGION, PROJECT_ID } from "./utils.js";
import { logTask, updateTask, getTask } from "./tasks.js";
import { cache } from "./cache.js";
import { scaffoldFunction, scaffoldRun } from "./scaffold.js";
import { deploy } from "./deploy.js";

// A simple async wrapper to catch errors and pass them to our error handler
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
app.use(express.json());

// Init cache and health check
app.get(["/", "/healthz"], (_, res) => res.send("🚀 Primordia Bridge OK"));
(async () => {
  try {
    await cache.set("init", { time: new Date().toISOString(), ok: true });
  } catch (err) {
    log("ERROR: Cache initialization failed.", err.message);
  }
})();


// --- API ROUTES ---

// File Management
app.get("/files", asyncHandler(async (_, res) => {
  const files = await listAllFiles();
  res.json({ files });
}));

app.get("/file", asyncHandler(async (req, res) => {
  const p = req.query.path;
  if (!isSafePath(p)) return res.status(400).send("Invalid path");
  const txt = await readFileText(p);
  res.type("text/plain").send(txt);
}));

app.post("/file", asyncHandler(async (req, res) => {
  const { path: p, content } = req.body;
  if (!isSafePath(p) || typeof content !== 'string') {
    return res.status(400).json({ error: "Invalid path or missing content" });
  }
  await writeFileText(p, content);
  res.json({ success: true, message: `Wrote ${content.length} bytes to ${p}` });
}));

// Scaffolding
app.post("/scaffold/function", asyncHandler(async (req, res) => {
  const result = await scaffoldFunction(req.body);
  res.json(result);
}));

app.post("/scaffold/run", asyncHandler(async (req, res) => {
  const result = await scaffoldRun(req.body);
  res.json(result);
}));

// Deployment
app.post("/deploy", asyncHandler(async (req, res) => {
  const result = await deploy(req.body);
  res.json(result);
}));

// Invocation (Functions only)
app.post("/invoke", asyncHandler(async (req, res) => {
  const { function: fnName, payload } = req.body;
  if (!fnName) throw new Error("Missing function name");
  const url = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${fnName}`;
  const response = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const result = await response.json();
  res.json(result);
}));

// Task Lookup
app.get("/task", asyncHandler(async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing id" });
  const doc = await getTask(id);
  if (!doc) return res.status(404).json({ error: "Task not found" });
  res.json(doc);
}));

// --- Centralized Error Handler ---
// This middleware will run if any of the asyncHandler functions throw an error.
app.use(async (err, req, res, next) => {
  const errorMsg = err.message || "An unexpected error occurred.";
  log("ERROR:", errorMsg);
  // We can still try to log the task failure to Firestore
  try {
    // This assumes we can get a taskId from somewhere, for now, we just log the error.
    // In a more advanced setup, we'd create the task log at the start of each request.
  } catch (logErr) {
    log("FATAL: Could not log error to Firestore.", logErr.message);
  }
  res.status(500).json({ error: errorMsg });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => log(`🚀 Primordia Bridge running on port ${PORT}`));

export default app;