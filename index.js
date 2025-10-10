import express from "express";
import { readFileText, writeFileText } from "./storage.js";
import { log } from "./utils.js";
import { scaffoldFunction, scaffoldRun } from "./scaffold.js";
import { deploy } from "./deploy.js";
import { getBuildLogs } from "./logs.js";
import { getDocument, setDocument, deleteDocument } from "./firestore.js";
// --- HYBRID IMPORTS ---
import { taskRegistry } from "./tasks.js";      // For hard-coded tasks
import { executeInSandbox } from "./sandbox.js"; // For dynamic scripts

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
app.use(express.json());

// --- Core Endpoints ---
app.get(["/", "/healthz"], (_, res) => res.send("🚀 Primordia Bridge OK"));
app.post("/scaffold/function", asyncHandler(async (req, res) => res.json(await scaffoldFunction(req.body))));
app.post("/scaffold/run", asyncHandler(async (req, res) => res.json(await scaffoldRun(req.body))));
app.post("/deploy", asyncHandler(async (req, res) => res.json(await deploy(req.body))));
app.get("/logs", asyncHandler(async (req, res) => res.json({ buildId: req.query.buildId, logs: await getBuildLogs(req.query) })));
app.get("/firestore/document", asyncHandler(async (req, res) => res.json(await getDocument(req.query.path))));
app.post("/firestore/document", asyncHandler(async (req, res) => res.json(await setDocument(req.body.path, req.body.data))));
app.delete("/firestore/document", asyncHandler(async (req, res) => res.json(await deleteDocument(req.query.path))));


// --- HARD-CODED TASK RUNNER ---
app.post("/task/:taskName", asyncHandler(async (req, res) => {
  const { taskName } = req.params;
  const taskFunction = taskRegistry[taskName];
  if (!taskFunction) {
    return res.status(404).json({ error: `Task '${taskName}' is not a valid task.` });
  }
  let config = {};
  try {
    const gcsPath = `configs/${taskName}.json`;
    config = JSON.parse(await readFileText(gcsPath));
    log(`[TaskRunner] Loaded config for '${taskName}' from GCS.`);
  } catch (err) {
    log(`[TaskRunner] No external config found for '${taskName}'.`);
  }
  const result = await taskFunction(config);
  res.json({ success: true, ...result });
}));

// --- DYNAMIC SCRIPT RUNNER ---
app.post("/run/:scriptName", asyncHandler(async (req, res) => {
  const { scriptName } = req.params;
  const params = req.body || {};
  let scriptCode = null;
  try {
    scriptCode = await readFileText(`scripts/${scriptName}.js`);
    log(`[ScriptRunner] Script '${scriptName}' loaded from GCS.`);
  } catch (gcsError) {
    if (process.env.USE_FIRESTORE === 'true') {
      const doc = await getDocument(`scripts/${scriptName}`);
      if (doc && doc.code) {
        scriptCode = doc.code;
        log(`[ScriptRunner] Script '${scriptName}' loaded from Firestore.`);
      }
    }
  }
  if (!scriptCode) {
    return res.status(404).json({ error: `Script '${scriptName}' not found.` });
  }
  const result = await executeInSandbox(scriptCode, params);
  res.json(result);
}));

// --- ADMIN ENDPOINTS FOR BOTH ---
app.post("/admin/uploadConfig", asyncHandler(async (req, res) => {
  const { name, config } = req.body;
  await writeFileText(`configs/${name}.json`, JSON.stringify(config, null, 2));
  res.json({ success: true, message: `Config for '${name}' saved to GCS.` });
}));

app.post("/admin/uploadScript", asyncHandler(async (req, res) => {
  const { name, code } = req.body;
  const gcsPath = `scripts/${name}.js`;
  const firestorePath = `scripts/${name}`;
  await Promise.all([
    writeFileText(gcsPath, code),
    setDocument(firestorePath, { code })
  ]);
  res.json({ success: true, message: `Script '${name}' synced to GCS and Firestore.` });
}));

// --- Error Handler ---
app.use(async (err, req, res, next) => {
  log("ERROR:", err.message);
  res.status(500).json({ error: err.message || "An unexpected error occurred." });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => log(`🚀 Primordia Bridge running on port ${PORT}`));

export default app;
