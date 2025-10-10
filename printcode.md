# Primordia Project Source Code Snapshot


---

## File: `package.json`

```json
{
  "name": "primordia",
  "version": "1.0.0",
  "description": "API-driven development studio for Google Cloud",
  "main": "index.js",
  "type": "module",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "@google-cloud/cloudbuild": "^4.1.0",
    "@google-cloud/firestore": "^7.3.0",
    "@google-cloud/logging": "^11.0.0",
    "@google-cloud/storage": "^7.7.0",
    "archiver": "^7.0.0",
    "express": "^4.19.2",
    "vm2": "^3.9.19"
  }
}

```

---

## File: `Dockerfile`

```dockerfile
# -----------------------------------------------------------
# Primordia Bridge — Production Dockerfile
# -----------------------------------------------------------
# ✅ Base: Secure, minimal Node.js 20 image
FROM node:20-slim AS base

# Ensure system certificates for HTTPS (required for GCP SDKs)
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy dependency files first for caching
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose the service port for Cloud Run
EXPOSE 8080

# Add health check for Cloud Run container monitoring
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl --fail http://localhost:${PORT}/healthz || exit 1

# Drop root privileges for security
RUN useradd -m primordia
USER primordia

# Start the service
CMD ["node", "index.js"]

```

---

## File: `.gcloudignore`

```plaintext
# This file tells gcloud what to exclude from deployments.

# Dependencies are installed by Cloud Build, do not upload them.
node_modules/

# Environment file with secrets.
.env

# Version control
.git/
.gitignore

# Local cache directory (should not be deployed)
cache/

# IDE and OS-specific files
.vscode/
.idea/
.DS_Store

# Log files
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Deployment artifacts
primordia-source.zip

```

---

## File: `cloudbuild.yaml`

```yaml
steps:
  - name: "gcr.io/cloud-builders/gsutil"
    entrypoint: "bash"
    args: ["-c", "gsutil cp gs://${_PROJECT_ID}-build-cache/node_modules.tar.gz node_modules.tar.gz && tar -xzf node_modules.tar.gz || echo 'Cache not found'"]
  - name: "gcr.io/cloud-builders/npm"
    args: ["install", "--only=production"]
  - name: "gcr.io/cloud-builders/npm"
    entrypoint: "bash"
    args: ["-c", "tar -czf node_modules.tar.gz node_modules"]
  - name: "gcr.io/cloud-builders/gsutil"
    args: ["cp", "node_modules.tar.gz", "gs://${_PROJECT_ID}-build-cache/node_modules.tar.gz"]
  - name: "gcr.io/cloud-builders/docker"
    args: ["build", "-t", "gcr.io/$PROJECT_ID/primordia:$BUILD_ID", "."]
  - name: "gcr.io/cloud-builders/docker"
    args: ["push", "gcr.io/$PROJECT_ID/primordia:$BUILD_ID"]
  - name: "gcr.io/google.com/cloudsdktool/cloud-sdk"
    entrypoint: gcloud
    args:
      - "run"
      - "deploy"
      - "primordia"
      - "--image=gcr.io/$PROJECT_ID/primordia:$BUILD_ID"
      - "--region=${_REGION}"
      - "--platform=managed"
      - "--allow-unauthenticated"
      - "--service-account=primordia-sa@${_PROJECT_ID}.iam.gserviceaccount.com"
      - "--set-env-vars=PROJECT_ID=${_PROJECT_ID},REGION=${_REGION},WORKSPACE_BUCKET=${_WORKSPACE_BUCKET},CACHE_COLLECTION=${_CACHE_COLLECTION},TASKS_COLLECTION=${_TASKS_COLLECTION},USE_FIRESTORE=${_USE_FIRESTORE}"
images:
  - "gcr.io/$PROJECT_ID/primordia:$BUILD_ID"
substitutions:
  _PROJECT_ID: ""
  _REGION: ""
  _WORKSPACE_BUCKET: ""
  _CACHE_COLLECTION: ""
  _TASKS_COLLECTION: ""
  _USE_FIRESTORE: "true"

```

---

## File: `deploy.sh`

```bash
#!/bin/bash
set -e
if [[ -n $(git status --porcelain) ]]; then
  echo "❌ Uncommitted changes found. Please commit before deploying."
  git status
  exit 1
fi
echo "✅ Git status is clean."
echo "✅ Reading configuration from .env file..."
export $(grep -v '^#' .env | xargs)
echo "🚀 Starting the Cloud Build deployment..."
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions=_PROJECT_ID=$PROJECT_ID,_REGION=$REGION,_WORKSPACE_BUCKET=$WORKSPACE_BUCKET,_CACHE_COLLECTION=$CACHE_COLLECTION,_TASKS_COLLECTION=$TASKS_COLLECTION,_USE_FIRESTORE=true \
  .
echo "🎉 Verifying the live service..."
SERVICE_URL=$(gcloud run services describe primordia --region ${REGION} --format='value(status.url)')
echo "Service is live at: ${SERVICE_URL}"
echo "Pinging /healthz endpoint (retrying up to 50s)..."
for i in {1..10}; do
  if curl -sSf -o /dev/null "${SERVICE_URL}/healthz"; then
    echo ""
    echo "✅ Health check passed. Deployment complete and verified."
    exit 0
  fi
  echo "Attempt ${i} failed. Retrying in 5 seconds..."
  sleep 5
done
echo "❌ Health check failed after 10 attempts."
exit 1

```

---

## File: `cache.js`

```javascript
import fs from "fs";
import path from "path";
import os from "os"; // Import the 'os' module
import { Firestore } from "@google-cloud/firestore";
import { CACHE_COLLECTION, PROJECT_ID } from "./utils.js";

const db = new Firestore({ projectId: PROJECT_ID });

// Use the OS-provided temporary directory, which is writable in Cloud Run
const CACHE_DIR = path.join(os.tmpdir(), "primordia-cache");

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

export const cache = {
  async set(key, data, persist = false) {
    const file = path.join(CACHE_DIR, `${key}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    if (persist) {
      await db.collection(CACHE_COLLECTION).doc(key).set({
        data,
        updatedAt: new Date().toISOString(),
      });
    }
  },
  get(key) {
    const file = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  },
  async getPersistent(key) {
    const local = this.get(key);
    if (local) return local;
    const doc = await db.collection(CACHE_COLLECTION).doc(key).get();
    if (!doc.exists) return null;
    const data = doc.data()?.data;
    await this.set(key, data, false);
    return data;
  },
};

```

---

## File: `deploy.js`

```javascript
import { CloudBuildClient } from "@google-cloud/cloudbuild";
import { PROJECT_ID, REGION } from "./utils.js";
import { cache } from "./cache.js";
import { downloadPrefixToTmp, zipDirectoryToGcs } from "./storage.js";
import { log } from "./utils.js";

const cloudBuild = new CloudBuildClient();

export async function deploy({ name, confirm, target = "cloudfunctions", version = "latest" }) {
  if (!confirm) throw new Error("Confirmation required");
  if (!name) throw new Error("Missing name");

  const isRun = target === "cloudrun";
  const prefix = isRun ? `runs/${name}/` : `functions/${name}/`;

  const cacheKey = `zip_${target}_${name}`;
  let zipRecord = await cache.getPersistent(cacheKey);
  let zipUri;

  if (zipRecord?.uri && zipRecord?.version === version) {
    zipUri = zipRecord.uri;
    log(`[Deploy] Using cached source version '${version}' for ${name}: ${zipUri}`);
  } else {
    log(`[Deploy] Packaging new source version '${version}' for ${name}...`);
    const localDir = await downloadPrefixToTmp(prefix);
    const dest = isRun ? `runs/${name}/source-v${version}.zip` : `functions/${name}/source-v${version}.zip`;
    zipUri = await zipDirectoryToGcs(localDir, dest);
    await cache.set(cacheKey, { uri: zipUri, updatedAt: new Date().toISOString(), version: version }, true);
    log(`[Deploy] Packaged source uploaded to: ${zipUri}`);
  }

  log(`[Deploy] Triggering Cloud Build for ${name}...`);
  const [operation] = await cloudBuild.createBuild({
    projectId: PROJECT_ID,
    build: {
      steps: [{
        name: "gcr.io/google.com/cloudsdktool/cloud-sdk",
        entrypoint: "bash",
        args: ["-lc", `
          set -euo pipefail
          echo ">>> Installing unzip..."
          apt-get update -qq && apt-get install -y -qq unzip > /dev/null
          echo ">>> Deploying ${name} to ${target}..."
          gsutil cp ${zipUri} /workspace/source.zip
          unzip /workspace/source.zip -d /workspace/source
          ${
            isRun
            ? `gcloud run deploy ${name} --source=/workspace/source --region=${REGION} --allow-unauthenticated --platform=managed --timeout=300`
            : `gcloud functions deploy ${name} --gen2 --region=${REGION} --runtime=nodejs20 --trigger-http --allow-unauthenticated --entry-point=main --memory=256MB --timeout=60s --source=/workspace/source`
          }
        `]
      }],
      timeout: { seconds: 1200 },
      options: {
        logging: "CLOUD_LOGGING_ONLY",
        machineType: "E2_HIGHCPU_8",
      },
    },
  });

  await cache.set(`deploy_${target}_${name}`, { operation: operation.name, startedAt: new Date().toISOString() }, true);

  return { success: true, status: "build_started", operation: operation.name, type: isRun ? "cloudrun" : "cloudfunctions" };
}

```

---

## File: `file.js`

```javascript

```

---

## File: `firestore.js`

```javascript
import { Firestore } from "@google-cloud/firestore";
import { PROJECT_ID } from "./utils.js";
import { isSafePath } from "./utils.js";

// --- THE FIX ---
// Create the Firestore database client directly in this file.
const db = new Firestore({ projectId: PROJECT_ID });

const SANDBOX_COLLECTION = "gpt-workspace";
const SANDBOX_ROOT_DOC = "main";

function validateAndBuildDocPath(path) {
  if (!isSafePath(path)) {
    throw new Error("Invalid or unsafe Firestore path provided.");
  }
  const segments = path.split('/');
  if (segments.length === 0 || segments.length % 2 !== 0) {
      throw new Error(`Invalid document path: '${path}'. Paths must be in the format 'collection/doc'.`);
  }
  return `${SANDBOX_COLLECTION}/${SANDBOX_ROOT_DOC}/${path}`;
}

export async function getDocument(path) {
  const fullPath = validateAndBuildDocPath(path);
  const docRef = db.doc(fullPath);
  const doc = await docRef.get();
  if (!doc.exists) {
    return null;
  }
  return doc.data();
}

export async function setDocument(path, data) {
  const fullPath = validateAndBuildDocPath(path);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error("Invalid data payload; must be a non-empty object.");
  }
  const docRef = db.doc(fullPath);
  await docRef.set(data, { merge: true });
  return { success: true, path: fullPath };
}

export async function deleteDocument(path) {
  const fullPath = validateAndBuildDocPath(path);
  const docRef = db.doc(fullPath);
  await docRef.delete();
  return { success: true, path: fullPath };
}

```

---

## File: `index.js`

```javascript
import express from "express";
import { listAllFiles, readFileText, writeFileText } from "./storage.js"; // readFileText & writeFileText are used by the /file routes
import { isSafePath, log } from "./utils.js"; // isSafePath is used by the /file routes
import { scaffoldFunction, scaffoldRun } from "./scaffold.js";
import { deploy } from "./deploy.js";
import { getBuildLogs } from "./logs.js";
import { getDocument, setDocument, deleteDocument } from "./firestore.js";
import { taskRegistry } from "./tasks.js";
import { executeInSandbox } from "./sandbox.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
app.use(express.json());

// --- Core & Scaffolding Endpoints ---
app.get(["/", "/healthz"], (_, res) => res.send("🚀 Primordia Bridge OK"));
app.get("/files", asyncHandler(async (_, res) => res.json({ files: await listAllFiles() })));

// --- THIS IS THE MISSING BLOCK THAT IS NOW RESTORED ---
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
// --- END OF RESTORED BLOCK ---

app.post("/scaffold/function", asyncHandler(async (req, res) => res.json(await scaffoldFunction(req.body))));
app.post("/scaffold/run", asyncHandler(async (req, res) => res.json(await scaffoldRun(req.body))));
app.post("/deploy", asyncHandler(async (req, res) => res.json(await deploy(req.body))));
app.get("/logs", asyncHandler(async (req, res) => res.json({ buildId: req.query.buildId, logs: await getBuildLogs(req.query) })));

// --- Hybrid Engine Endpoints ---
app.post("/task/:taskName", asyncHandler(async (req, res) => {
  // ... (task runner logic is correct)
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
  // ... (script runner logic is correct)
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

// --- Admin Endpoints ---
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

// --- Firestore Endpoints ---
app.get("/firestore/document", asyncHandler(async (req, res) => res.json(await getDocument(req.query.path))));
app.post("/firestore/document", asyncHandler(async (req, res) => res.json(await setDocument(req.body.path, req.body.data))));
app.delete("/firestore/document", asyncHandler(async (req, res) => res.json(await deleteDocument(req.query.path))));


// --- Error Handler ---
app.use(async (err, req, res, next) => {
  log("ERROR:", err.message);
  res.status(500).json({ error: err.message || "An unexpected error occurred." });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => log(`🚀 Primordia Bridge running on port ${PORT}`));

export default app;

```

---

## File: `logs.js`

```javascript
import { Logging } from "@google-cloud/logging";
import { PROJECT_ID } from "./utils.js";

const logging = new Logging({ projectId: PROJECT_ID });

export async function getBuildLogs({ buildId }) {
  if (!buildId) throw new Error("Missing buildId");

  const encodedUuid = buildId.split('/').pop();
  const actualBuildUuid = Buffer.from(encodedUuid, 'base64').toString('utf8');
  
  const filter = `resource.type="build" AND resource.labels.build_id="${actualBuildUuid}"`;
  
  const options = {
    filter: filter,
    orderBy: "timestamp desc",
    pageSize: 200,
  };

  try {
    const [entries] = await logging.getEntries(options);
    if (!entries.length) {
      return [`No logs found for build ID: ${actualBuildUuid}.`];
    }
    
    const formattedLogs = entries.reverse().map(entry => entry.data?.message || JSON.stringify(entry.data));
    
    return formattedLogs;
  } catch (err) {
    console.error("ERROR fetching logs from Cloud Logging:", err);
    throw new Error(`Could not retrieve build logs for ${actualBuildUuid}.`);
  }
}

```

---

## File: `sandbox.js`

```javascript
import vm from 'vm';

/**
 * Executes a script in a sandboxed environment using Node.js's native vm module.
 * @param {string} scriptCode The JavaScript code to execute.
 * @param {object} params The parameters to make available to the script.
 * @returns {Promise<any>} A promise that resolves with the script's result.
 */
export async function executeInSandbox(scriptCode, params = {}) {
  const context = {
    params,
    result: null, // The script is expected to set this variable.
    console: {
      log: (...args) => console.log('[Sandbox Log]', ...args)
    }
  };

  vm.createContext(context);

  try {
    vm.runInContext(scriptCode, context, { timeout: 1000 }); // 1-second timeout
    return { success: true, result: context.result };
  } catch (err) {
    console.error('[Sandbox] Script execution error:', err.message);
    return { success: false, error: err.message };
  }
}

```

---

## File: `scaffold.js`

```javascript
import fs from "fs";
import os from "os";
import path from "path";
import { Storage } from "@google-cloud/storage";
import { PROJECT_ID, BUCKET } from "./utils.js";
import { cache } from "./cache.js";

const storage = new Storage({ projectId: PROJECT_ID });

function fnIndex(name) {
  return `exports.main = (req, res) => { res.json({ message: "Hello from ${name}! (Cloud Function Gen2)", method: req.method, time: new Date().toISOString() }); };`;
}

function runIndex(name) {
  return `import express from "express";
const app = express();
app.use(express.json());
app.get("/", (_, res) => res.json({ service: "${name}", ok: true, time: new Date().toISOString() }));
app.post("/echo", (req, res) => res.json({ received: req.body || null }));
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log("[Service:${name}] listening on", PORT));`;
}

async function uploadString(dest, content) {
  // Use a try/finally block to ensure cleanup even if upload fails
  const tmp = path.join(os.tmpdir(), `pm-${Date.now()}-${path.basename(dest)}`);
  try {
    fs.writeFileSync(tmp, content);
    await storage.bucket(BUCKET).upload(tmp, { destination: dest });
  } finally {
    fs.unlinkSync(tmp);
  }
}

export async function scaffoldFunction({ name }) {
  if (!name) throw new Error("Missing function name");

  const destPath = `functions/${name}/index.js`;
  const [exists] = await storage.bucket(BUCKET).file(destPath).exists();
  if (exists) {
    throw new Error(`Function '${name}' already exists. Scaffolding aborted to prevent overwrite.`);
  }

  await uploadString(destPath, fnIndex(name));
  await uploadString(`functions/${name}/package.json`, JSON.stringify({ name, type: "commonjs", dependencies: {} }, null, 2));
  await cache.set(`scaffold_${name}`, { name, createdAt: new Date().toISOString(), kind: "function" }, true);
  return { success: true, message: `Scaffolded function ${name}` };
}

export async function scaffoldRun({ name }) {
  if (!name) throw new Error("Missing service name");
  
  const destPath = `runs/${name}/index.js`;
  const [exists] = await storage.bucket(BUCKET).file(destPath).exists();
  if (exists) {
    throw new Error(`Cloud Run service '${name}' already exists. Scaffolding aborted to prevent overwrite.`);
  }
  
  await uploadString(destPath, runIndex(name));
  await uploadString(`runs/${name}/package.json`, JSON.stringify({
    name, type: "module", scripts: { start: "node index.js" }, dependencies: { express: "^4.19.2" }
  }, null, 2));
  await cache.set(`scaffold_run_${name}`, { name, createdAt: new Date().toISOString(), kind: "run" }, true);
  return { success: true, message: `Scaffolded Cloud Run service ${name}` };
}
```

---

## File: `storage.js`

```javascript
import fs from "fs";
import os from "os";
import path from "path";
import archiver from "archiver";
import { Storage } from "@google-cloud/storage";
import { BUCKET, PROJECT_ID } from "./utils.js";

const storage = new Storage({ projectId: PROJECT_ID });

export async function listAllFiles() {
  const [files] = await storage.bucket(BUCKET).getFiles();
  return files.map(f => f.name);
}

export async function readFileText(filePath) {
  const [buf] = await storage.bucket(BUCKET).file(filePath).download();
  return buf.toString();
}

export async function writeFileText(destPath, content) {
  const tmp = path.join(os.tmpdir(), `pm-${Date.now()}-${path.basename(destPath)}`);
  fs.writeFileSync(tmp, content);
  await storage.bucket(BUCKET).upload(tmp, { destination: destPath });
  fs.unlinkSync(tmp);
}

export async function uploadLocalFile(localPath, destPath) {
  await storage.bucket(BUCKET).upload(localPath, { destination: destPath });
}

export async function downloadPrefixToTmp(prefix) {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pm-src-"));
  const [files] = await storage.bucket(BUCKET).getFiles({ prefix });
  if (!files.length) throw new Error(`No objects under ${prefix}`);
  for (const file of files) {
    const rel = file.name.slice(prefix.length);
    if (!rel) continue;
    const dest = path.join(tmpDir, rel);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await file.download({ destination: dest });
  }
  return tmpDir;
}

export async function zipDirectoryToGcs(localDir, gcsDest) {
  const zipPath = path.join(os.tmpdir(), `pm-${Date.now()}.zip`);
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(localDir, false);
    archive.finalize();
  });
  await uploadLocalFile(zipPath, gcsDest);
  return `gs://${BUCKET}/${gcsDest}`;
}

```

---

## File: `tasks.js`

```javascript
// This file contains the hard-coded business logic of your service.

// A simple task that adds two numbers based on config.
async function add(config) {
  const { a, b } = config;
  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new Error("Parameters 'a' and 'b' must be numbers.");
  }
  return { result: a + b };
}

// A task that creates a greeting message.
async function greet(config) {
  const { name, message = "Hello" } = config; // Uses a default value
  if (!name) {
    throw new Error("Parameter 'name' is required.");
  }
  return { greeting: `${message}, ${name}!` };
}

// The task registry. This maps a task name to its function.
export const taskRegistry = {
  add,
  greet,
};

```

---

## File: `utils.js`

```javascript
// ----------------------------------------------------------------------
// utils.js — helpers, constants, and fetch wrapper
// ----------------------------------------------------------------------
export const PROJECT_ID = process.env.PROJECT_ID || "ticktalk-472521";
export const REGION = process.env.REGION || "us-central1";
export const BUCKET = process.env.WORKSPACE_BUCKET;
export const CACHE_DIR = process.env.CACHE_DIR || "./cache";
export const CACHE_COLLECTION = process.env.CACHE_COLLECTION || "primordia_cache";
export const TASKS_COLLECTION = process.env.TASKS_COLLECTION || "primordia_tasks";

// THIS IS THE CRITICAL CHANGE: We now THROW AN ERROR if the bucket is missing.
// This will cause a clean, obvious crash on startup if the configuration is wrong.
if (!BUCKET) {
  throw new Error("[Primordia FATAL] WORKSPACE_BUCKET environment variable is not set. Service cannot start.");
}

export const fetchFn = global.fetch || (await import("node-fetch")).default;

export function isSafePath(p) {
  return typeof p === "string" && p.length > 0 && !p.includes("..");
}

export function log(...args) {
  console.log("[Primordia]", ...args);
}

```
