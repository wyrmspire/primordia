import { CloudBuildClient } from "@google-cloud/cloudbuild";
import { PROJECT_ID, REGION } from "./utils.js";
import { cache } from "./cache.js";
import { downloadPrefixToTmp, zipDirectoryToGcs } from "./storage.js";
import { log } from "./utils.js";

const cloudBuild = new CloudBuildClient();

// --- MODIFIED FUNCTION SIGNATURE ---
// We accept the `useCache` param but will now ignore it for Cloud Run,
// as the flag was incorrect. This prevents the bug from happening.
export async function deploy({ name, confirm, target = "cloudfunctions", version = "latest", useCache = false }) {
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

  // --- THE FIX ---
  // The faulty `cacheFlag` logic has been completely removed.
  // The gcloud command is now restored to its original, working state.
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
