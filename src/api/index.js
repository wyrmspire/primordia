import { proxyHandler } from "./proxy.js";

// --- This command will completely overwrite the api/index.js file with the correct code ---
import { publishMessage } from "../shared/pubsub.js";
import express from "express";
import { listAllFiles, readFileText, writeFileText } from "../shared/storage.js";
import { isSafePath, log } from "../shared/utils.js";
import { scaffoldFunction, scaffoldRun } from "../shared/scaffold.js";
import { deploy } from "../shared/deploy.js";
import { getBuildLogs } from "../shared/logs.js";
import { getDocument, setDocument, deleteDocument } from "../shared/firestore.js";
import { taskRegistry } from "../shared/tasks.js";
import { executeInSandbox } from "../shared/sandbox.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
app.use(express.json());

// --- Corrected Healthz Route ---
app.get(["/", "/healthz"], asyncHandler(async (_, res) => {
  const job = { type: "HEALTH_CHECK", timestamp: new Date().toISOString() };
  await publishMessage("primordia-jobs", job);
  res.send("🚀 Primordia Bridge OK - Test job published to primordia-jobs!");
}));

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

app.post("/scaffold/function", asyncHandler(async (req, res) => res.json(await scaffoldFunction(req.body))));
app.post("/scaffold/run", asyncHandler(async (req, res) => res.json(await scaffoldRun(req.body))));
app.post("/deploy", asyncHandler(async (req, res) => res.json(await deploy(req.body))));
app.get("/logs", asyncHandler(async (req, res) => res.json({ buildId: req.query.buildId, logs: await getBuildLogs(req.query) })));

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

app.get("/firestore/document", asyncHandler(async (req, res) => res.json(await getDocument(req.query.path))));
app.post("/firestore/document", asyncHandler(async (req, res) => res.json(await setDocument(req.body.path, req.body.data))));
app.delete("/firestore/document", asyncHandler(async (req, res) => res.json(await deleteDocument(req.query.path))));

import { Firestore } from "@google-cloud/firestore";
import { randomUUID } from "crypto";

const db = new Firestore({ projectId: process.env.PROJECT_ID });
const JOBS_COLLECTION = process.env.TASKS_COLLECTION || "primordia_jobs";

// --- Workspace Endpoints ---

app.post("/workspace", asyncHandler(async (req, res) => {
  const blueprint = req.body;
  if (!blueprint || !blueprint.type) {
    return res.status(400).json({ error: "Request body must be a valid blueprint with a 'type'." });
  }

  const jobId = randomUUID();
  const jobRef = db.collection(JOBS_COLLECTION).doc(jobId);

  const jobData = {
    jobId,
    status: "PENDING",
    receivedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    blueprint,
    logs: [`[${new Date().toISOString()}] Job created.`],
    outputs: {},
  };

  await jobRef.set(jobData);
  await publishMessage("primordia-jobs", { jobId });

  log(`[API] Created and dispatched job: ${jobId}`);
  res.status(202).json({ jobId, message: "Job accepted and is being processed." });
}));

app.get("/workspace/status/:jobId", asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const jobRef = db.collection(JOBS_COLLECTION).doc(jobId);
    const doc = await jobRef.get();

    if (!doc.exists) {
        return res.status(404).json({ error: "Job not found." });
    }
    res.json(doc.data());
}));



app.post("/workspace/proxy", asyncHandler(proxyHandler));

app.use(async (err, req, res, next) => {
  log("ERROR:", err.message);
  res.status(500).json({ error: err.message || "An unexpected error occurred." });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => log(`🚀 Primordia Bridge running on port ${PORT}`));

export default app;
