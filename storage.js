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
