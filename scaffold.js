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