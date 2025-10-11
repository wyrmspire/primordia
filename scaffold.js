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

// This is the code for the HOST service (`index.js`) for mutable services
function runIndex(name) {
  return `import express from "express";
import { Storage } from "@google-cloud/storage";
import fs from "fs/promises";
import path from "path";
import os from "os";

const app = express();
app.use(express.json());

const BUCKET_NAME = process.env.WORKSPACE_BUCKET;
const GCS_LOGIC_PATH = "runs/${name}/handler.js";
const LOCAL_TMP_PATH = path.join(os.tmpdir(), "${name}-handler.js");
const storage = new Storage();

app.all('*', async (req, res) => {
  if (!BUCKET_NAME) {
    return res.status(500).json({ error: "FATAL: WORKSPACE_BUCKET is not configured for this service." });
  }

  try {
    await storage.bucket(BUCKET_NAME).file(GCS_LOGIC_PATH).download({ destination: LOCAL_TMP_PATH });
    const handlerModule = await import(LOCAL_TMP_PATH + '?v=' + Date.now());
    const handler = handlerModule.default;

    if (typeof handler !== 'function') {
      return res.status(500).json({ error: "Loaded handler is not a function." });
    }
    await handler(req, res);
  } catch (err) {
    console.error("Error loading or executing dynamic handler:", err);
    res.status(500).json({ error: 'Failed to execute dynamic logic', details: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log("[Service:${name}] MUTABLE host is live, listening on", PORT);
});`;
}

// This function will create the initial "Guest" logic file (`handler.js`)
function runHandlerIndex(name) {
    return `// Default GUEST logic for '${name}'. This file can be updated live.
export default (req, res) => {
  res.json({
    service: "${name}",
    message: "This is the default, scaffolded behavior.",
    ok: true,
    timestamp: new Date().toISOString()
  });
};`;
}

async function uploadString(dest, content) {
  const tmp = path.join(os.tmpdir(), `pm-${Date.now()}-${path.basename(dest)}`);
  try {
    fs.writeFileSync(tmp, content);
    await storage.bucket(BUCKET).upload(tmp, { destination: dest });
  } finally {
    fs.unlinkSync(tmp);
  }
}

// --- THIS IS THE GUARANTEED CORRECT FUNCTION ---
// The stray backslashes have been removed from all template literals.
export async function scaffoldFunction({ name }) {
  if (!name) throw new Error("Missing function name");

  const destPath = `functions/\${name}/index.js`;
  const [exists] = await storage.bucket(BUCKET).file(destPath).exists();
  if (exists) {
    throw new Error(`Function '\${name}' already exists. Scaffolding aborted to prevent overwrite.`);
  }

  await uploadString(destPath, fnIndex(name));
  await uploadString(`functions/\${name}/package.json`, JSON.stringify({ name, type: "commonjs", dependencies: {} }, null, 2));
  await cache.set(`scaffold_\${name}`, { name, createdAt: new Date().toISOString(), kind: "function" }, true);
  return { success: true, message: `Scaffolded function \${name}` };
}

export async function scaffoldRun({ name }) {
  if (!name) throw new Error("Missing service name");
  
  const indexPath = `runs/\${name}/index.js`;
  const handlerPath = `runs/\${name}/handler.js`;
  const packagePath = `runs/\${name}/package.json`;

  const [exists] = await storage.bucket(BUCKET).file(indexPath).exists();
  if (exists) {
    throw new Error(`Cloud Run service '\${name}' already exists. Scaffolding aborted to prevent overwrite.`);
  }
  
  await uploadString(indexPath, runIndex(name));
  await uploadString(handlerPath, runHandlerIndex(name));
  await uploadString(packagePath, JSON.stringify({
    name, type: "module", scripts: { start: "node index.js" }, dependencies: { express: "^4.19.2", "@google-cloud/storage": "^7.7.0" }
  }, null, 2));

  await cache.set(`scaffold_run_\${name}`, { name, createdAt: new Date().toISOString(), kind: "run" }, true);
  return { success: true, message: `Scaffolded Cloud Run service \${name}` };
}
