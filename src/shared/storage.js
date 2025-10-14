import fs from "fs";
import os from "os";
import path from "path";
import archiver from "archiver";
import { BUCKET as FALLBACK_BUCKET, PROJECT_ID } from "./utils.js";

const BUCKET = process.env.WORKSPACE_BUCKET || FALLBACK_BUCKET;
const EMULATOR = process.env.STORAGE_EMULATOR_HOST || "";
const USE_HTTP_EMULATOR = !!EMULATOR;

let StorageSDK = null;
async function getSdkStorage() {
  if (!StorageSDK) {
    const { Storage } = await import("@google-cloud/storage");
    StorageSDK = new Storage({ projectId: PROJECT_ID });
  }
  return StorageSDK;
}

async function httpJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }
  return res.json();
}

async function httpText(url, init = {}) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }
  return res.text();
}

async function ensureEmuBucket() {
  const base = EMULATOR.replace(/\/$/, "");
  const listUrl = `${base}/storage/v1/b?project=${encodeURIComponent(PROJECT_ID)}`;
  const data = await httpJson(listUrl);
  const exists = Array.isArray(data.items) && data.items.some(b => b.name === BUCKET);
  if (!exists) {
    const createUrl = `${base}/storage/v1/b?project=${encodeURIComponent(PROJECT_ID)}`;
    await httpJson(createUrl, { method: "POST", body: JSON.stringify({ name: BUCKET }) });
  }
}

export async function listAllFiles(prefix = "") {
  if (USE_HTTP_EMULATOR) {
    await ensureEmuBucket();
    const base = EMULATOR.replace(/\/$/, "");
    const url = `${base}/storage/v1/b/${encodeURIComponent(BUCKET)}/o?prefix=${encodeURIComponent(prefix)}`;
    const data = await httpJson(url);
    const items = Array.isArray(data.items) ? data.items : [];
    return items.map(o => o.name);
  }
  const storage = await getSdkStorage();
  const [files] = await storage.bucket(BUCKET).getFiles({ prefix });
  return files.map(f => f.name);
}

export async function readFileText(filePath) {
  if (USE_HTTP_EMULATOR) {
    await ensureEmuBucket();
    const base = EMULATOR.replace(/\/$/, "");
    const url = `${base}/download/storage/v1/b/${encodeURIComponent(BUCKET)}/o/${encodeURIComponent(filePath)}?alt=media`;
    return await httpText(url);
  }
  const storage = await getSdkStorage();
  const [buf] = await storage.bucket(BUCKET).file(filePath).download();
  return buf.toString();
}

export async function writeFileText(destPath, content) {
  if (USE_HTTP_EMULATOR) {
    await ensureEmuBucket();
    const base = EMULATOR.replace(/\/$/, "");
    const url = `${base}/upload/storage/v1/b/${encodeURIComponent(BUCKET)}/o?uploadType=media&name=${encodeURIComponent(destPath)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: typeof content === "string" ? content : String(content),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
    }
    return;
  }
  const { Storage } = await import("@google-cloud/storage");
  const storage = new Storage({ projectId: PROJECT_ID });
  const tmp = path.join(os.tmpdir(), `pm-${Date.now()}-${path.basename(destPath)}`);
  fs.writeFileSync(tmp, content);
  await storage.bucket(BUCKET).upload(tmp, { destination: destPath, resumable: false });
  fs.unlinkSync(tmp);
}

export async function uploadLocalFile(localPath, destPath) {
  const data = await fs.promises.readFile(localPath, "utf8");
  await writeFileText(destPath, data);
}

export async function downloadPrefixToTmp(prefix) {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pm-src-"));
  const files = await listAllFiles(prefix);
  if (!files.length) throw new Error(`No objects under ${prefix}`);
  for (const name of files) {
    const rel = name.slice(prefix.length);
    if (!rel) continue;
    const dest = path.join(tmpDir, rel);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    const txt = await readFileText(name);
    await fs.promises.writeFile(dest, txt);
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
  const buf = await fs.promises.readFile(zipPath);
  await writeFileText(gcsDest, buf);
  return `gs://${BUCKET}/${gcsDest}`;
}
