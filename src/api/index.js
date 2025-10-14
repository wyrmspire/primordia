import express from "express";
import { randomUUID } from "crypto";
import { Firestore } from "@google-cloud/firestore";

import { publishMessage } from "../shared/pubsub.js";
import { listAllFiles, readFileText, writeFileText } from "../shared/storage.js";
import { isSafePath, log } from "../shared/utils.js";
import { scaffoldFunction, scaffoldRun } from "../shared/scaffold.js";
import { deploy } from "../shared/deploy.js";
import { getBuildLogs } from "../shared/logs.js";
import { getDocument, setDocument, deleteDocument } from "../shared/firestore.js";
import { taskRegistry } from "../shared/tasks.js";
import { executeInSandbox } from "../shared/sandbox.js";
import { proxyHandler } from "./proxy.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
app.use(express.json());

const TOPIC_ID = process.env.PUBSUB_TOPIC || "primordia-builds";
const db = new Firestore({ projectId: process.env.PROJECT_ID || process.env.GCLOUD_PROJECT });
const JOBS_COLLECTION = process.env.TASKS_COLLECTION || "primordia_jobs";

/** Health/Root */
app.get(["/", "/healthz"], asyncHandler(async (_req, res) => {
  const job = { type: "HEALTH_CHECK", timestamp: new Date().toISOString() };
  await publishMessage(TOPIC_ID, job);
  res.send(`🚀 Primordia Bridge OK - Test job published to ${process.env.PUBSUB_TOPIC || TOPIC_ID}!`);
}));

/** Simple file helpers (via shared/storage.js) */
app.get("/files", asyncHandler(async (req, res) => {
  const prefix = req.query.prefix || "";
  res.json({ files: await listAllFiles(prefix) });
}));

app.get("/file", asyncHandler(async (req, res) => {
  const p = req.query.path;
  if (!isSafePath(p)) return res.status(400).send("Invalid path");
  res.type("text/plain").send(await readFileText(p));
}));

app.post("/file", asyncHandler(async (req, res) => {
  const { path: p, content } = req.body || {};
  if (!isSafePath(p) || typeof content !== "string") {
    return res.status(400).json({ error: "Invalid path or missing content" });
  }
  await writeFileText(p, content);
  res.json({ success: true, message: `Wrote ${content.length} bytes to ${p}` });
}));

/**
 * Lightweight emulator-powered listing that does not depend on utils,
 * useful for sanity checks.
 * GET /files3?prefix=runs/alpha
 */
app.get("/files3", asyncHandler(async (req, res) => {
  const { Storage } = await import("@google-cloud/storage");
  const s = new Storage({
    projectId: process.env.GCLOUD_PROJECT || process.env.PROJECT_ID || "ticktalk-472521",
    apiEndpoint: process.env.STORAGE_EMULATOR_HOST || "http://gcs:4443",
  });
  const bucket = process.env.WORKSPACE_BUCKET || "primordia-bucket";
  const prefix = req.query.prefix || "";
  const [files] = await s.bucket(bucket).getFiles({ prefix });
  res.json({ files: files.map(f => f.name) });
}));

/** Scaffold / Deploy / Logs */
app.post("/scaffold/function", asyncHandler(async (req, res) => res.json(await scaffoldFunction(req.body))));
app.post("/scaffold/run", asyncHandler(async (req, res) => res.json(await scaffoldRun(req.body))));
app.post("/deploy", asyncHandler(async (req, res) => res.json(await deploy(req.body))));
app.get("/logs", asyncHandler(async (req, res) => res.json({ buildId: req.query.buildId, logs: await getBuildLogs(req.query) })));

/** Task runner */
app.post("/task/:taskName", asyncHandler(async (req, res) => {
  const { taskName } = req.params;
  const taskFunction = taskRegistry[taskName];
  if (!taskFunction) return res.status(404).json({ error: `Task '${taskName}' is not a valid task.` });

  let config = {};
  try {
    const gcsPath = `configs/${taskName}.json`;
    config = JSON.parse(await readFileText(gcsPath));
    log(`[TaskRunner] Loaded config for '${taskName}' from GCS.`);
  } catch {
    log(`[TaskRunner] No external config found for '${taskName}'.`);
  }
  const result = await taskFunction(config);
  res.json({ success: true, ...result });
}));

/** Script runner (GCS -> Firestore fallback) */
app.post("/run/:scriptName", asyncHandler(async (req, res) => {
  const { scriptName } = req.params;
  const params = req.body || {};
  let scriptCode = null;
  try {
    scriptCode = await readFileText(`scripts/${scriptName}.js`);
    log(`[ScriptRunner] Script '${scriptName}' loaded from GCS.`);
  } catch {
    if (process.env.USE_FIRESTORE === "true") {
      const doc = await getDocument(`scripts/${scriptName}`);
      if (doc && doc.code) {
        scriptCode = doc.code;
        log(`[ScriptRunner] Script '${scriptName}' loaded from Firestore.`);
      }
    }
  }
  if (!scriptCode) return res.status(404).json({ error: `Script '${scriptName}' not found.` });
  const result = await executeInSandbox(scriptCode, params);
  res.json(result);
}));

/** Admin helpers */
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
    setDocument(firestorePath, { code }),
  ]);
  res.json({ success: true, message: `Script '${name}' synced to GCS and Firestore.` });
}));

/** Firestore helpers */
app.get("/firestore/document", asyncHandler(async (req, res) => res.json(await getDocument(req.query.path))));
app.post("/firestore/document", asyncHandler(async (req, res) => res.json(await setDocument(req.body.path, req.body.data))));
app.delete("/firestore/document", asyncHandler(async (req, res) => res.json(await deleteDocument(req.query.path))));

/** Proxy passthrough */
app.post("/workspace/proxy", asyncHandler(proxyHandler));

/** Workspace job endpoints */
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
  await publishMessage(TOPIC_ID, { jobId });

  log(`[API] Created and dispatched job: ${jobId}`);
  res.status(202).json({ jobId, message: "Job accepted and is being processed." });
}));

app.get("/workspace/status/:jobId", asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const jobRef = db.collection(JOBS_COLLECTION).doc(jobId);
  const doc = await jobRef.get();
  if (!doc.exists) return res.status(404).json({ error: "Job not found." });
  res.json(doc.data());
}));

/** Global error handler */
app.use(async (err, _req, res, _next) => {
  log("ERROR:", err.message);
  res.status(500).json({ error: err.message || "An unexpected error occurred." });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => log(`🚀 Primordia Bridge running on port ${PORT}`));

export default app;
