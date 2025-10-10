import express from "express";
import { listAllFiles, readFileText, writeFileText } from "./storage.js";
import { isSafePath, log, BUCKET } from "./utils.js";
import { scaffoldFunction, scaffoldRun } from "./scaffold.js";
import { deploy } from "./deploy.js";
import { getBuildLogs } from "./logs.js";
import { getDocument, setDocument, deleteDocument } from "./firestore.js";
// --- NEW: Import the sandbox executor ---
import { executeInSandbox } from "./sandbox.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
app.use(express.json());

// --- Existing Endpoints (Unchanged) ---
app.get(["/", "/healthz"], (_, res) => res.send("🚀 Primordia Bridge OK"));
app.get("/files", asyncHandler(async (_, res) => res.json({ files: await listAllFiles() })));
app.post("/scaffold/function", asyncHandler(async (req, res) => res.json(await scaffoldFunction(req.body))));
app.post("/scaffold/run", asyncHandler(async (req, res) => res.json(await scaffoldRun(req.body))));
app.post("/deploy", asyncHandler(async (req, res) => res.json(await deploy(req.body))));
app.get("/logs", asyncHandler(async (req, res) => res.json({ buildId: req.query.buildId, logs: await getBuildLogs(req.query) })));
app.get("/firestore/document", asyncHandler(async (req, res) => res.json(await getDocument(req.query.path))));
app.post("/firestore/document", asyncHandler(async (req, res) => res.json(await setDocument(req.body.path, req.body.data))));
app.delete("/firestore/document", asyncHandler(async (req, res) => res.json(await deleteDocument(req.query.path))));


// --- NEW: Dynamic Script Runner Endpoint ---
app.post("/run/:scriptName", asyncHandler(async (req, res) => {
  const { scriptName } = req.params;
  const params = req.body || {};
  let scriptCode = null;

  log(`[Runner] Attempting to run script '${scriptName}'...`);

  // 1. Try to fetch the script from Google Cloud Storage first.
  try {
    const gcsPath = `scripts/${scriptName}.js`;
    scriptCode = await readFileText(gcsPath);
    log(`[Runner] Script '${scriptName}' loaded from GCS.`);
  } catch (gcsError) {
    log(`[Runner] Script not found in GCS. Checking Firestore fallback...`);
    // 2. If GCS fails and Firestore fallback is enabled, try Firestore.
    if (process.env.USE_FIRESTORE === 'true') {
      try {
        const doc = await getDocument(`scripts/${scriptName}`);
        if (doc && doc.code) {
          scriptCode = doc.code;
          log(`[Runner] Script '${scriptName}' loaded from Firestore.`);
        }
      } catch (firestoreError) {
        // Firestore also failed, proceed to 404
      }
    }
  }

  if (!scriptCode) {
    log(`[Runner] Script '${scriptName}' not found in any source.`);
    return res.status(404).json({ error: `Script '${scriptName}' not found.` });
  }

  // 3. Execute the script in the sandbox and return its result.
  const result = await executeInSandbox(scriptCode, params);
  res.json(result);
}));

// --- NEW: Admin Endpoint to Upload/Sync Scripts ---
app.post("/admin/uploadScript", asyncHandler(async (req, res) => {
  const { name, code } = req.body;
  if (!name || !code) {
    return res.status(400).json({ error: "Request body must include 'name' and 'code'." });
  }

  log(`[Admin] Uploading script '${name}'...`);
  const gcsPath = `scripts/${name}.js`;
  const firestorePath = `scripts/${name}`;

  // Use Promise.all to write to both GCS and Firestore simultaneously.
  await Promise.all([
    writeFileText(gcsPath, code),
    setDocument(firestorePath, { code, updatedAt: new Date().toISOString() })
  ]);

  log(`[Admin] Script '${name}' successfully uploaded to GCS and Firestore.`);
  res.json({ success: true, message: `Script '${name}' synced.` });
}));


// --- Centralized Error Handler (Unchanged) ---
app.use(async (err, req, res, next) => {
  log("ERROR:", err.message);
  res.status(500).json({ error: err.message || "An unexpected error occurred." });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => log(`🚀 Primordia Bridge running on port ${PORT}`));

export default app;