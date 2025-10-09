import express from "express";
import { listAllFiles, readFileText, writeFileText } from "./storage.js";
import { isSafePath, log, fetchFn, REGION, PROJECT_ID } from "./utils.js";
import { logTask, updateTask, getTask } from "./tasks.js";
import { cache } from "./cache.js";
import { scaffoldFunction, scaffoldRun } from "./scaffold.js";
import { deploy } from "./deploy.js";
import { getBuildLogs } from "./logs.js";
import { getDocument, listCollection, setDocument, deleteDocument } from "./firestore.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
app.use(express.json());

app.get(["/", "/healthz"], (_, res) => res.send("🚀 Primordia Bridge OK"));

// --- FILE MANAGEMENT ---
app.get("/files", asyncHandler(async (_, res) => res.json({ files: await listAllFiles() })));
app.get("/file", asyncHandler(async (req, res) => {
  if (!isSafePath(req.query.path)) return res.status(400).send("Invalid path");
  res.type("text/plain").send(await readFileText(req.query.path));
}));
app.post("/file", asyncHandler(async (req, res) => {
  const { path: p, content } = req.body;
  if (!isSafePath(p) || typeof content !== 'string') return res.status(400).json({ error: "Invalid path or missing content" });
  await writeFileText(p, content);
  res.json({ success: true, message: `Wrote ${content.length} bytes to ${p}` });
}));

// --- SCAFFOLDING ---
app.post("/scaffold/function", asyncHandler(async (req, res) => res.json(await scaffoldFunction(req.body))));
app.post("/scaffold/run", asyncHandler(async (req, res) => res.json(await scaffoldRun(req.body))));

// --- DEPLOYMENT & LOGS ---
app.post("/deploy", asyncHandler(async (req, res) => res.json(await deploy(req.body))));
app.get("/logs", asyncHandler(async (req, res) => {
  if (!req.query.buildId) return res.status(400).json({ error: "Missing buildId query parameter" });
  res.json({ buildId: req.query.buildId, logs: await getBuildLogs(req.query) });
}));

// --- SANDBOXED FIRESTORE MANAGEMENT ---
app.get("/firestore/document", asyncHandler(async (req, res) => {
  res.json(await getDocument(req.query.path));
}));
app.get("/firestore/collection", asyncHandler(async (req, res) => {
  res.json(await listCollection(req.query.path));
}));
app.post("/firestore/document", asyncHandler(async (req, res) => {
  // DEBUGGING: Log the exact body received by the endpoint.
  log("Received POST to /firestore/document with body:", JSON.stringify(req.body, null, 2));
  
  const { path, data } = req.body;
  if (!path || !data) {
    return res.status(400).json({ error: "Request body must include 'path' and 'data' keys." });
  }
  res.json(await setDocument(path, data));
}));
app.delete("/firestore/document", asyncHandler(async (req, res) => {
  res.json(await deleteDocument(req.query.path));
}));

// --- Centralized Error Handler ---
app.use(async (err, req, res, next) => {
  log("ERROR:", err.message);
  res.status(500).json({ error: err.message || "An unexpected error occurred." });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => log(`🚀 Primordia Bridge running on port ${PORT}`));

export default app;
